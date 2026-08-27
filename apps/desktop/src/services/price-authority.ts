import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

/**
 * Balanca principal de precos da pedreira.
 *
 * O cadastro de preco (preco padrao do produto, preco especial por cliente, tabela de
 * preco + vinculo com o cliente e o valor de frete do cadastro) nasce no SQLite de UMA
 * maquina. O cadastro compartilhado ja projetava tudo isso na nuvem, mas empatava: duas
 * balancas que cadastram o mesmo par (cliente, produto) geram ids diferentes, e o pull de
 * cada lado descartava a linha da outra para nao violar o indice unico local. Cada
 * computador ficava com o preco que ele mesmo digitou — o sintoma relatado na operacao.
 *
 * Com uma principal eleita no painel, o cadastro de preco passa a ter dono:
 *
 * - **principal** (`master`): publica o proprio cadastro de preco, como sempre fez.
 * - **secundaria** (`follower`): NAO publica preco e aceita o da nuvem mesmo quando ja
 *   existe uma linha local para o mesmo par — a linha local perde e sai da frente.
 * - **sem principal** (`standalone`): nada muda em relacao ao comportamento anterior.
 *
 * O modo vem do `desktop-status` a cada validacao de acesso e fica gravado localmente,
 * para sobreviver a reinicio e a queda de internet.
 */

export type PriceAuthorityMode = "master" | "follower" | "standalone";

export interface PriceAuthority {
  mode: PriceAuthorityMode;
  /** Id da balanca principal da pedreira; null quando nao ha uma definida. */
  masterDeviceId: string | null;
  /** Nome da principal, para a tela dizer de onde os precos vem. */
  masterDeviceName: string | null;
}

/**
 * Chaves do cadastro compartilhado cujo dono e a balanca principal. Sao as mesmas nos dois
 * sentidos: o que a secundaria deixa de empurrar e exatamente o que ela aceita da nuvem
 * sem discutir.
 */
export const PRICE_MASTERED_CADASTRO_KEYS = [
  "productDefaultPrices",
  "customerSpecialPrices",
  "priceTables",
  "priceTableItems",
  "customerPriceTables",
  "customerFreightRules"
] as const;

export type PriceMasteredCadastroKey = (typeof PRICE_MASTERED_CADASTRO_KEYS)[number];

const PRICE_MASTERED_KEY_SET: ReadonlySet<string> = new Set(PRICE_MASTERED_CADASTRO_KEYS);

export function isPriceMasteredCadastroKey(key: string): boolean {
  return PRICE_MASTERED_KEY_SET.has(key);
}

/**
 * Colunas de `customers` cujo dono tambem e a balanca principal: o cadastro COMERCIAL e as
 * regras de CREDITO do cliente.
 *
 * Elas seguem o mesmo combinado do preco, mas por um caminho diferente. Preco e uma
 * ENTIDADE inteira, e a secundaria simplesmente deixa de publica-la. Aqui o dono e de parte
 * de uma linha: o cliente continua sendo publicado por qualquer balanca (nome, documento,
 * telefone e endereco nao tem dono), e o que a secundaria tira do payload sao apenas estas
 * colunas. Coluna ausente no upsert preserva o valor que a nuvem ja tem — e por isso a
 * secundaria pode publicar o cliente sem derrubar o bloco da principal.
 *
 * `default_payment_term_id` fica de fora: a condicao de pagamento padrao ja viaja pelo
 * OMIE (sobe no `push_customer`, volta no cadastro de referencia), entao ela ja e a mesma
 * em todas as maquinas e nao precisa de dono aqui. `observations` idem, pelo mesmo caminho.
 */
export const MASTERED_CUSTOMER_COLUMNS = [
  "default_payment_method_id",
  "default_carrier_id",
  "nf_required",
  "credit_mode",
  "credit_account_enabled",
  "credit_periodicity",
  "credit_closing_day",
  "credit_second_closing_day",
  "credit_boleto_days",
  "credit_second_boleto_days",
  "credit_closing_weekday"
] as const;

export type MasteredCustomerColumn = (typeof MASTERED_CUSTOMER_COLUMNS)[number];

/**
 * Marca de "alguem ja publicou o bloco comercial desta linha".
 *
 * Ela viaja junto das colunas acima e existe para desfazer a ambiguidade do nulo: sem ela,
 * a secundaria nao consegue distinguir "a principal limpou a transportadora padrao" de "a
 * nuvem ainda nao sabe nada sobre este bloco" (migracao pendente, ou principal que ainda
 * nao republicou). O primeiro caso precisa chegar; o segundo precisa ser ignorado, senao a
 * configuracao boa da secundaria seria apagada por um nulo que nao quer dizer nada.
 */
export const CUSTOMER_COMMERCIAL_PUBLISHED_AT_COLUMN = "commercial_published_at";

/** As colunas com dono mais a marca de publicacao: o que sai do payload da secundaria. */
export const MASTERED_CUSTOMER_PAYLOAD_COLUMNS: readonly string[] = [
  ...MASTERED_CUSTOMER_COLUMNS,
  CUSTOMER_COMMERCIAL_PUBLISHED_AT_COLUMN
];

/**
 * Esta maquina virou principal (ou a versao trouxe o bloco comercial pela primeira vez): o
 * proximo push tem de reenviar TODOS os clientes para o bloco comercial chegar a nuvem.
 *
 * Diferente do `PRICE_MASTER_REPUBLISH_KEY`, esta marca tambem vale para a pedreira SEM
 * principal eleita: la o bloco comercial continua sendo compartilhado (ultima escrita
 * vence, como o resto do cadastro), e sem republicar ele so chegaria nos clientes que
 * alguem editasse depois da atualizacao.
 */
export const CUSTOMER_COMMERCIAL_REPUBLISH_KEY = "customer_commercial_republish_pending";

export function isCustomerCommercialRepublishPending(database: DesktopDatabase): boolean {
  return readLocalSetting(database, CUSTOMER_COMMERCIAL_REPUBLISH_KEY) === true;
}

export function clearCustomerCommercialRepublishPending(database: DesktopDatabase): void {
  database
    .prepare("DELETE FROM local_settings WHERE key = ?")
    .run(CUSTOMER_COMMERCIAL_REPUBLISH_KEY);
}

export const PRICE_MASTER_DEVICE_ID_KEY = "price_master_device_id";
export const PRICE_MASTER_DEVICE_NAME_KEY = "price_master_device_name";
/** Esta maquina virou secundaria: o proximo pull tem de vir inteiro e realinhar os precos. */
export const PRICE_MASTER_RESYNC_KEY = "price_master_resync_pending";
/** Esta maquina virou principal: o proximo push tem de reenviar TODO o cadastro de preco. */
export const PRICE_MASTER_REPUBLISH_KEY = "price_master_republish_pending";

export function resolvePriceAuthorityMode(
  masterDeviceId: string | null,
  deviceId: string | null
): PriceAuthorityMode {
  if (!masterDeviceId) return "standalone";
  // Sem saber quem e esta maquina, tratar como secundaria seria travar o cadastro de preco
  // de quem talvez seja a propria principal. O modo neutro e o unico seguro aqui.
  if (!deviceId) return "standalone";
  return masterDeviceId === deviceId ? "master" : "follower";
}

/**
 * Id desta balanca NA NUVEM — o mesmo que o painel elege e que o `desktop-status` devolve.
 * O id da identidade local coincide com ele depois da ativacao, mas so este e garantido.
 */
export function readActiveCloudDeviceId(database: DesktopDatabase): string | null {
  return readStringLocalSetting(database, "cloud_device_id");
}

export function readPriceAuthority(
  database: DesktopDatabase,
  deviceId: string | null
): PriceAuthority {
  const masterDeviceId = readStringLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY);
  return {
    mode: resolvePriceAuthorityMode(masterDeviceId, deviceId),
    masterDeviceId,
    masterDeviceName: readStringLocalSetting(database, PRICE_MASTER_DEVICE_NAME_KEY)
  };
}

export function isPriceFollower(database: DesktopDatabase, deviceId: string | null): boolean {
  return readPriceAuthority(database, deviceId).mode === "follower";
}

/**
 * Grava a principal que o `desktop-status` informou.
 *
 * `undefined` significa "a nuvem nao falou disso" (funcao antiga, ou migracao ainda nao
 * aplicada) e NAO pode ser confundido com `null`, que significa "esta pedreira nao tem
 * principal": aceitar o silencio como ausencia devolveria ao empate cada balanca que ja
 * espelha os precos. Best-effort — falha aqui nunca derruba a validacao de acesso.
 */
export function applyPriceMasterFromCloud(
  database: DesktopDatabase,
  master: { id: string | null; name: string | null } | undefined,
  deviceId: string | null,
  now: Date = new Date()
): void {
  if (master === undefined) return;
  const nowIso = now.toISOString();
  const previousId = readStringLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY);
  const nextId = master.id?.trim() ? master.id.trim() : null;

  try {
    writeLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY, nextId, nowIso);
    writeLocalSetting(
      database,
      PRICE_MASTER_DEVICE_NAME_KEY,
      master.name?.trim() ? master.name.trim() : null,
      nowIso
    );

    if (previousId === nextId) return;

    // Trocou de papel: o novo estado so vale de verdade depois de uma passada completa.
    // Principal recem-eleita reenvia todo o cadastro de preco (senao os precos dela nunca
    // chegariam a quem ja estava sincronizado); secundaria recem-criada puxa o cadastro
    // inteiro e apaga o que nao existe na principal.
    const mode = resolvePriceAuthorityMode(nextId, deviceId);
    if (mode === "master") {
      writeLocalSetting(database, PRICE_MASTER_REPUBLISH_KEY, true, nowIso);
    } else if (mode === "follower") {
      writeLocalSetting(database, PRICE_MASTER_RESYNC_KEY, true, nowIso);
    }
  } catch {
    // Ignora: o papel atual continua valendo ate a proxima validacao.
  }
}

export function isPriceMasterResyncPending(database: DesktopDatabase): boolean {
  return readLocalSetting(database, PRICE_MASTER_RESYNC_KEY) === true;
}

export function clearPriceMasterResyncPending(database: DesktopDatabase): void {
  database.prepare("DELETE FROM local_settings WHERE key = ?").run(PRICE_MASTER_RESYNC_KEY);
}

export function isPriceMasterRepublishPending(database: DesktopDatabase): boolean {
  return readLocalSetting(database, PRICE_MASTER_REPUBLISH_KEY) === true;
}

export function clearPriceMasterRepublishPending(database: DesktopDatabase): void {
  database.prepare("DELETE FROM local_settings WHERE key = ?").run(PRICE_MASTER_REPUBLISH_KEY);
}

/**
 * Mensagem unica de recusa. Ela aparece tanto no erro do IPC quanto no aviso da tela, e diz
 * onde resolver — parar a operadora sem dizer para onde ir e o que faz ela ligar para o
 * suporte.
 */
export function priceEditBlockedMessage(masterDeviceName: string | null): string {
  const where = masterDeviceName?.trim()
    ? `no computador "${masterDeviceName.trim()}"`
    : "no computador principal da pedreira";
  return `Os precos desta pedreira sao definidos ${where}. Altere o preco la: em segundos ele chega a este computador.`;
}

/**
 * Mesma recusa, para o cadastro comercial e de credito do cliente. O texto muda porque a
 * frase do preco mandaria a operadora procurar uma tela de preco que nao e a que ela esta
 * vendo — ela esta na aba Comercial do cadastro.
 */
export function commercialEditBlockedMessage(masterDeviceName: string | null): string {
  const where = masterDeviceName?.trim()
    ? `no computador "${masterDeviceName.trim()}"`
    : "no computador principal da pedreira";
  return `Os dados comerciais e de credito do cliente sao definidos ${where}. Altere la: em segundos a mudanca chega a este computador.`;
}
