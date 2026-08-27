import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

/**
 * Balancas principais de precos da pedreira.
 *
 * O cadastro de preco (preco padrao do produto, preco especial por cliente, tabela de
 * preco + vinculo com o cliente e o valor de frete do cadastro) nasce no SQLite de UMA
 * maquina. O cadastro compartilhado ja projetava tudo isso na nuvem, mas empatava: duas
 * balancas que cadastram o mesmo par (cliente, produto) geram ids diferentes, e o pull de
 * cada lado descartava a linha da outra para nao violar o indice unico local. Cada
 * computador ficava com o preco que ele mesmo digitou — o sintoma relatado na operacao.
 *
 * Com pelo menos uma principal eleita no painel, o cadastro de preco passa a ter dono:
 *
 * - **principal** (`master`): publica o proprio cadastro de preco e edita preco na tela.
 * - **secundaria** (`follower`): NAO publica preco e aceita o da nuvem mesmo quando ja
 *   existe uma linha local para o mesmo par — a linha local perde e sai da frente.
 * - **sem principal** (`standalone`): nada muda em relacao ao comportamento anterior.
 *
 * A pedreira pode eleger MAIS DE UMA principal (a balanca da portaria e a do escritorio,
 * por exemplo). Duas principais so nao se derrubam alternadamente porque o desempate entre
 * elas nao e "quem publicou por ultimo", e sim QUEM EDITOU por ultimo (ver
 * `cloudRowWins`): o resultado e o mesmo seja qual for a ordem em que as maquinas
 * sincronizam, entao o preco converge em vez de oscilar.
 *
 * O papel vem do `desktop-status` a cada validacao de acesso e fica gravado localmente,
 * para sobreviver a reinicio e a queda de internet.
 */

export type PriceAuthorityMode = "master" | "follower" | "standalone";

export interface PriceAuthority {
  mode: PriceAuthorityMode;
  /** Ids das balancas principais da pedreira; vazio quando nao ha nenhuma definida. */
  masterDeviceIds: string[];
  /** Nomes das principais, na mesma ordem, para a tela dizer de onde os precos vem. */
  masterDeviceNames: string[];
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
 * Colunas de `customers` cujo dono tambem sao as balancas principais: o cadastro COMERCIAL
 * e as regras de CREDITO do cliente.
 *
 * Elas seguem o mesmo combinado do preco, mas por um caminho diferente. Preco e uma
 * ENTIDADE inteira, e a secundaria simplesmente deixa de publica-la. Aqui o dono e de parte
 * de uma linha: o cliente continua sendo publicado por qualquer balanca (nome, documento,
 * telefone e endereco nao tem dono), e o que a secundaria tira do payload sao apenas estas
 * colunas. Coluna ausente no upsert preserva o valor que a nuvem ja tem — e por isso a
 * secundaria pode publicar o cliente sem derrubar o bloco das principais.
 *
 * Com mais de uma principal o desempate e o mesmo do preco (`cloudRowWins` com a politica
 * `newest`): quem editou o cliente por ultimo manda. Sem isso, duas principais voltariam a
 * ficar cada uma com a configuracao que ela mesma digitou — o empate original.
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

export const PRICE_MASTER_DEVICE_IDS_KEY = "price_master_device_ids";
export const PRICE_MASTER_DEVICE_NAMES_KEY = "price_master_device_names";
/**
 * Formato antigo (uma principal so). Continua sendo LIDO como reserva: uma instalacao que
 * gravou o formato antigo e atualizou sem internet ficaria sem papel nenhum ate o primeiro
 * heartbeat — e nesse intervalo uma secundaria voltaria a aceitar edicao de preco.
 */
export const PRICE_MASTER_DEVICE_ID_KEY = "price_master_device_id";
export const PRICE_MASTER_DEVICE_NAME_KEY = "price_master_device_name";
/** Esta maquina virou secundaria: o proximo pull tem de vir inteiro e realinhar os precos. */
export const PRICE_MASTER_RESYNC_KEY = "price_master_resync_pending";
/** Esta maquina virou principal: o proximo push tem de reenviar TODO o cadastro de preco. */
export const PRICE_MASTER_REPUBLISH_KEY = "price_master_republish_pending";

export function resolvePriceAuthorityMode(
  masterDeviceIds: readonly string[],
  deviceId: string | null
): PriceAuthorityMode {
  if (masterDeviceIds.length === 0) return "standalone";
  // Sem saber quem e esta maquina, tratar como secundaria seria travar o cadastro de preco
  // de quem talvez seja a propria principal. O modo neutro e o unico seguro aqui.
  if (!deviceId) return "standalone";
  return masterDeviceIds.includes(deviceId) ? "master" : "follower";
}

/**
 * Id desta balanca NA NUVEM — o mesmo que o painel elege e que o `desktop-status` devolve.
 * O id da identidade local coincide com ele depois da ativacao, mas so este e garantido.
 */
export function readActiveCloudDeviceId(database: DesktopDatabase): string | null {
  return readStringLocalSetting(database, "cloud_device_id");
}

function readStringList(database: DesktopDatabase, key: string): string[] | null {
  const value = readLocalSetting(database, key);
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Principais gravadas, no formato novo ou (como reserva) no antigo. */
function readMasters(database: DesktopDatabase): { ids: string[]; names: string[] } {
  const ids = readStringList(database, PRICE_MASTER_DEVICE_IDS_KEY);
  if (ids) {
    return { ids, names: readStringList(database, PRICE_MASTER_DEVICE_NAMES_KEY) ?? [] };
  }
  const legacyId = readStringLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY);
  if (!legacyId) return { ids: [], names: [] };
  const legacyName = readStringLocalSetting(database, PRICE_MASTER_DEVICE_NAME_KEY);
  return { ids: [legacyId], names: legacyName ? [legacyName] : [] };
}

export function readPriceAuthority(
  database: DesktopDatabase,
  deviceId: string | null
): PriceAuthority {
  const { ids, names } = readMasters(database);
  return {
    mode: resolvePriceAuthorityMode(ids, deviceId),
    masterDeviceIds: ids,
    masterDeviceNames: names
  };
}

export function isPriceFollower(database: DesktopDatabase, deviceId: string | null): boolean {
  return readPriceAuthority(database, deviceId).mode === "follower";
}

/**
 * Quem vence quando a linha da nuvem e a linha local disputam a mesma chave natural.
 *
 * - `cloud` — secundaria: o preco e das principais, a linha local sempre cede.
 * - `newest` — principal: cede para a linha que foi EDITADA depois. E o que permite mais de
 *   uma principal: as duas pontas chegam a mesma conclusao sem se falar, entao o par
 *   disputado converge em vez de oscilar a cada ciclo de sync.
 * - `local` — sem principal na pedreira: comportamento anterior, a linha local manda.
 */
export type PriceConflictPolicy = "local" | "newest" | "cloud";

export function priceConflictPolicy(mode: PriceAuthorityMode): PriceConflictPolicy {
  if (mode === "follower") return "cloud";
  if (mode === "master") return "newest";
  return "local";
}

function editedAt(updatedAt: string | null | undefined): number {
  const parsed = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  // Hora ausente ou invalida vale como a mais antiga possivel — nunca como NaN, que
  // perderia toda comparacao e faria a linha vencer ou perder por acidente.
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * A linha da nuvem substitui a linha local que ocupa a mesma chave natural?
 *
 * O criterio de `newest` e o MESMO do lado da nuvem (`_shared/price-master-conflicts.ts`):
 * hora da edicao, empate no maior id. Os dois runtimes sao separados (Deno x workspace do
 * desktop), entao a regra aparece duas vezes de proposito — mudar uma sem a outra faz a
 * balanca e a nuvem discordarem sobre a mesma linha.
 */
export function cloudRowWins(
  policy: PriceConflictPolicy,
  cloud: { id: string; updatedAt: string | null },
  local: { id: string; updatedAt: string | null }
): boolean {
  if (policy === "cloud") return true;
  if (policy === "local") return false;
  const cloudAt = editedAt(cloud.updatedAt);
  const localAt = editedAt(local.updatedAt);
  if (cloudAt !== localAt) return cloudAt > localAt;
  return cloud.id > local.id;
}

/**
 * Grava as principais que o `desktop-status` informou.
 *
 * `undefined` significa "a nuvem nao falou disso" (funcao antiga, ou migracao ainda nao
 * aplicada) e NAO pode ser confundido com lista vazia, que significa "esta pedreira nao tem
 * principal": aceitar o silencio como ausencia devolveria ao empate cada balanca que ja
 * espelha os precos. Best-effort — falha aqui nunca derruba a validacao de acesso.
 */
export function applyPriceMasterFromCloud(
  database: DesktopDatabase,
  masters: Array<{ id: string | null; name: string | null }> | undefined,
  deviceId: string | null,
  now: Date = new Date()
): void {
  if (masters === undefined) return;
  const nowIso = now.toISOString();
  const previous = readMasters(database).ids;
  const clean = masters
    .map((master) => ({
      id: master.id?.trim() ? master.id.trim() : null,
      name: master.name?.trim() ? master.name.trim() : ""
    }))
    .filter((master): master is { id: string; name: string } => master.id !== null);
  const nextIds = clean.map((master) => master.id);

  try {
    writeLocalSetting(database, PRICE_MASTER_DEVICE_IDS_KEY, nextIds, nowIso);
    writeLocalSetting(
      database,
      PRICE_MASTER_DEVICE_NAMES_KEY,
      clean.map((master) => master.name),
      nowIso
    );

    const previousMode = resolvePriceAuthorityMode(previous, deviceId);
    const mode = resolvePriceAuthorityMode(nextIds, deviceId);
    if (previousMode === mode) return;

    // Trocou de papel: o novo estado so vale de verdade depois de uma passada completa.
    // Principal recem-eleita reenvia todo o cadastro de preco (senao os precos dela nunca
    // chegariam a quem ja estava sincronizado); secundaria recem-criada puxa o cadastro
    // inteiro em vez do delta.
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
 * "no computador X" / "nos computadores X e Y" — o lugar onde o preco se altera.
 *
 * Dizer o nome importa mais do que parece: sem ele a operadora nao sabe para onde ir e a
 * saida dela e ligar para o suporte com o caminhao em cima da balanca.
 */
export function priceMasterWhere(masterDeviceNames: readonly string[]): string {
  const names = masterDeviceNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return "no computador principal da pedreira";
  if (names.length === 1) return `no computador "${names[0]}"`;
  const quoted = names.map((name) => `"${name}"`);
  return `nos computadores ${quoted.slice(0, -1).join(", ")} ou ${quoted[quoted.length - 1]}`;
}

/**
 * Mensagem unica de recusa. Ela aparece tanto no erro do IPC quanto no aviso da tela, e diz
 * onde resolver.
 */
export function priceEditBlockedMessage(masterDeviceNames: readonly string[]): string {
  return `Os precos desta pedreira sao definidos ${priceMasterWhere(masterDeviceNames)}. Altere o preco la: em segundos ele chega a este computador.`;
}

/**
 * Mesma recusa, para o cadastro comercial e de credito do cliente. O texto muda porque a
 * frase do preco mandaria a operadora procurar uma tela de preco que nao e a que ela esta
 * vendo — ela esta na aba Comercial do cadastro.
 */
export function commercialEditBlockedMessage(masterDeviceNames: readonly string[]): string {
  return `Os dados comerciais e de credito do cliente sao definidos ${priceMasterWhere(masterDeviceNames)}. Altere la: em segundos a mudanca chega a este computador.`;
}
