import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting } from "./local-settings.js";

/**
 * Cadastro com dois registros na nuvem, e um so nesta balanca — cliente e transportadora.
 *
 * A Levisa tem dois cadastros na nuvem com o mesmo CNPJ e o mesmo codigo OMIE
 * (`omie_11488403507` e um criado numa balanca). Cada balanca guarda UM: o pull descarta o
 * gemeo por documento (`findLocalCadastroWithDocument` em `supabase-sync.ts`). A transportadora
 * passa pelo mesmo descarte. A pesagem fechada na balanca que usa o outro id chegava aqui
 * apontando para um cadastro que esta maquina nao tem — e era gravada SEM cliente (ou sem
 * transportadora). As telas daqui (Conferencia de faturamento, relatorios, carteira, frete) nao
 * achavam essas cargas pelo cadastro.
 *
 * `customer_aliases` e `carrier_aliases` guardam a equivalencia, como `payment_method_aliases`
 * faz para a forma de pagamento: id da nuvem (o gemeo descartado) -> id do cadastro daqui. O
 * pull do cadastro a alimenta e o pull das pesagens a consulta.
 *
 * A volta tambem precisa de cuidado. A pesagem traduzida, quando esta maquina a reenvia (a
 * conferencia da nota no OMIE reenvia), levaria o id DAQUI — e o id da nuvem passaria a
 * alternar entre os gemeos a cada balanca que tocasse a carga. Por isso a pesagem guarda o id
 * que a nuvem tinha (`weighing_operations.remote_customer_id` / `remote_carrier_id`) e o envio
 * devolve ESSE id enquanto o cadastro local continuar sendo o equivalente dele
 * (`cloudCadastroIdForPush`).
 */
export type AliasedCadastroTable = "customers" | "carriers";

const ALIAS_TABLE: Record<AliasedCadastroTable, string> = {
  customers: "customer_aliases",
  carriers: "carrier_aliases"
};

/**
 * A migracao local que cria uma equivalencia liga esta marca: o proximo pull vem INTEIRO. E so
 * a passada completa que traz de novo os gemeos ja descartados (para a equivalencia ser
 * registrada) e as pesagens ja gravadas sem o cadastro (para serem curadas por ela).
 */
export const CADASTRO_ALIAS_RESYNC_KEY = "cadastro_alias_resync_pending";

export function isCadastroAliasResyncPending(database: DesktopDatabase): boolean {
  return readLocalSetting(database, CADASTRO_ALIAS_RESYNC_KEY) === true;
}

export function clearCadastroAliasResyncPending(database: DesktopDatabase): void {
  database.prepare("DELETE FROM local_settings WHERE key = ?").run(CADASTRO_ALIAS_RESYNC_KEY);
}

/**
 * Registra que o cadastro `remoteId` (o gemeo que a nuvem tem e esta maquina descartou) e o
 * mesmo cadastro que o `localId` daqui.
 */
export function rememberCadastroAlias(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  companyId: string,
  remoteId: string,
  localId: string,
  now: Date = new Date()
): void {
  if (!remoteId || !localId || remoteId === localId) return;
  const aliases = ALIAS_TABLE[table];
  const nowIso = now.toISOString();
  database
    .prepare(
      `INSERT INTO ${aliases} (remote_id, company_id, local_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(remote_id) DO UPDATE SET
         company_id = excluded.company_id,
         local_id = excluded.local_id,
         updated_at = excluded.updated_at
       WHERE ${aliases}.local_id <> excluded.local_id
          OR ${aliases}.company_id <> excluded.company_id`
    )
    .run(remoteId, companyId, localId, nowIso, nowIso);
}

/**
 * A unificacao daqui encerrou `loserId` e passou o historico para `keeperId`: a equivalencia
 * vai junto. Sem isto ela apontaria para um tombstone (ou, na juncao do cadastro feito sem
 * internet, para uma linha APAGADA — e a chave estrangeira recusaria a juncao), a traducao do
 * pull deixaria de valer e o envio da pesagem deixaria de reconhecer o id da nuvem.
 */
export function repointCadastroAliases(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  loserId: string,
  keeperId: string,
  now: Date = new Date()
): number {
  return database
    .prepare(`UPDATE ${ALIAS_TABLE[table]} SET local_id = ?, updated_at = ? WHERE local_id = ?`)
    .run(keeperId, now.toISOString(), loserId).changes;
}

/** O cadastro com este id existe aqui (vivo ou tombstone, como `existingId` do pull)? */
function existsLocally(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  id: string
): boolean {
  return Boolean(database.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`).get(id));
}

/** Cadastro VIVO daqui equivalente ao id da nuvem, ou nulo. */
function findCadastroAlias(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  remoteId: string
): string | null {
  const row = database
    .prepare(
      `SELECT alias.local_id AS id
       FROM ${ALIAS_TABLE[table]} alias
       JOIN ${table} c ON c.id = alias.local_id AND c.deleted_at IS NULL
       WHERE alias.remote_id = ?`
    )
    .get(remoteId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Id que veio da nuvem num cadastro que APONTA para outro (transportadora padrao do cliente,
 * transportadora do veiculo), traduzido para o espelho local: o proprio id quando existe aqui,
 * senao o equivalente, senao `fallback`. Vazio continua vazio — e assim que a nuvem limpa o
 * vinculo.
 *
 * Aqui nao ha id da nuvem para lembrar: o cadastro que aponta e reenviado com o id DAQUI, e
 * tudo bem — cada balanca traduz o que recebe, entao o vinculo chega certo nas duas pontas.
 */
export function resolveCloudCadastroReference(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  value: string | null,
  fallback: string | null
): string | null {
  if (!value) return null;
  if (existsLocally(database, table, value)) return value;
  return findCadastroAlias(database, table, value) ?? fallback;
}

/**
 * Cliente da pesagem que veio da nuvem, traduzido para o espelho local.
 *
 * - `customerId`: o que gravar em `weighing_operations.customer_id`. Nulo quando a nuvem
 *   mandou vazio — o upsert mantem o que ja havia (nao existe pesagem sem cliente).
 * - `remoteCustomerId`: o id que a nuvem tem, quando ele NAO pode ser gravado como esta (veio
 *   de um gemeo que esta maquina nao tem). E ele que volta no envio.
 *
 * Quatro casos:
 * - vazio: nada muda aqui;
 * - o cliente existe aqui: e o valor novo, e nao ha id da nuvem para lembrar;
 * - existe equivalencia: o cadastro daqui, lembrando o id da nuvem;
 * - id desconhecido (o cadastro ainda nao chegou): mantem o cliente que esta maquina ja tinha,
 *   mas lembra o id da nuvem — quando a equivalencia aparecer, o envio ja o reconhece.
 */
export function resolveCloudOperationCustomer(
  database: DesktopDatabase,
  incoming: string | null,
  local: { customer_id: string | null; remote_customer_id: string | null } | undefined
): { customerId: string | null; remoteCustomerId: string | null } {
  if (!incoming) {
    return { customerId: null, remoteCustomerId: local?.remote_customer_id ?? null };
  }
  const link = resolveOperationLink(database, "customers", incoming, local?.customer_id ?? null);
  return { customerId: link.id, remoteCustomerId: link.remoteId };
}

/**
 * Transportadora da pesagem que veio da nuvem, traduzida para o espelho local.
 *
 * Mesmos casos do cliente, menos o vazio: na transportadora o vazio E informacao — o cliente
 * passou a usar transporte proprio, e a outra balanca tirou a transportadora da carga. Por isso
 * o vazio limpa os dois, o vinculo e o id da nuvem lembrado.
 */
export function resolveCloudOperationCarrier(
  database: DesktopDatabase,
  incoming: string | null,
  local: { carrier_id: string | null; remote_carrier_id: string | null } | undefined
): { carrierId: string | null; remoteCarrierId: string | null } {
  if (!incoming) return { carrierId: null, remoteCarrierId: null };
  const link = resolveOperationLink(database, "carriers", incoming, local?.carrier_id ?? null);
  return { carrierId: link.id, remoteCarrierId: link.remoteId };
}

function resolveOperationLink(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  incoming: string,
  localId: string | null
): { id: string | null; remoteId: string | null } {
  if (existsLocally(database, table, incoming)) return { id: incoming, remoteId: null };
  const twin = findCadastroAlias(database, table, incoming);
  if (twin) return { id: twin, remoteId: incoming };
  return { id: localId, remoteId: incoming };
}

/**
 * O id que o envio da pesagem leva para a nuvem, para o cliente ou a transportadora.
 *
 * Devolve o id que a nuvem tinha (`remoteId`) so quando o cadastro local continua sendo o
 * equivalente dele. A conferencia e pela tabela de equivalencia, e nao por "a coluna esta
 * preenchida", de proposito: se o operador trocou o cliente (ou a transportadora) da carga
 * aqui, o cadastro local deixa de bater com a equivalencia e quem sobe e a troca — devolver o
 * id antigo desfaria a escolha dele, e cobraria a carga de outra empresa.
 *
 * O vazio local muda de sentido entre os dois. Pesagem sem CLIENTE aqui mas com o id da nuvem
 * lembrado leva o id da nuvem: nao existe pesagem sem cliente, entao o vazio nunca e escolha do
 * operador — e o que a nuvem ja tem. Pesagem sem TRANSPORTADORA e escolha (transporte proprio):
 * devolver a transportadora lembrada desfaria a troca feita aqui.
 */
export function cloudCadastroIdForPush(
  database: DesktopDatabase,
  table: AliasedCadastroTable,
  localValue: unknown,
  remoteValue: unknown
): string | null {
  const localId = textOrNull(localValue);
  const remoteId = textOrNull(remoteValue);
  if (!remoteId) return localId;
  if (!localId) return table === "customers" ? remoteId : null;
  const row = database
    .prepare(`SELECT local_id FROM ${ALIAS_TABLE[table]} WHERE remote_id = ?`)
    .get(remoteId) as { local_id: string } | undefined;
  return row?.local_id === localId ? remoteId : localId;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
