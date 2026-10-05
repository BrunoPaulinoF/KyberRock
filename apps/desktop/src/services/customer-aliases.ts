import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting } from "./local-settings.js";

/**
 * Cliente com dois cadastros na nuvem, e um so nesta balanca.
 *
 * A Levisa tem dois cadastros na nuvem com o mesmo CNPJ e o mesmo codigo OMIE
 * (`omie_11488403507` e um criado numa balanca). Cada balanca guarda UM: o pull descarta o
 * gemeo por documento (`findLocalCadastroWithDocument` em `supabase-sync.ts`). A pesagem
 * fechada na balanca que usa o outro id chegava aqui apontando para um cliente que esta
 * maquina nao tem — e era gravada SEM cliente. As telas daqui (Conferencia de faturamento,
 * relatorios por cliente, carteira) nao achavam essas cargas pelo cliente.
 *
 * `customer_aliases` guarda a equivalencia, como `payment_method_aliases` faz para a forma de
 * pagamento: id da nuvem (o gemeo descartado) -> id do cadastro daqui. O pull do cadastro a
 * alimenta e o pull das pesagens a consulta.
 *
 * A volta tambem precisa de cuidado. A pesagem traduzida, quando esta maquina a reenvia (a
 * conferencia da nota no OMIE reenvia), levaria o id DAQUI — e o `customer_id` da nuvem
 * passaria a alternar entre os gemeos a cada balanca que tocasse a carga. Por isso a pesagem
 * guarda o id que a nuvem tinha (`weighing_operations.remote_customer_id`) e o envio devolve
 * ESSE id enquanto o cliente local continuar sendo o equivalente dele (`cloudCustomerIdForPush`).
 */

/**
 * A migracao local que cria a tabela liga esta marca: o proximo pull vem INTEIRO. E so a
 * passada completa que traz de novo os gemeos ja descartados (para a equivalencia ser
 * registrada) e as pesagens ja gravadas sem cliente (para serem curadas por ela).
 */
export const CUSTOMER_ALIAS_RESYNC_KEY = "customer_alias_resync_pending";

export function isCustomerAliasResyncPending(database: DesktopDatabase): boolean {
  return readLocalSetting(database, CUSTOMER_ALIAS_RESYNC_KEY) === true;
}

export function clearCustomerAliasResyncPending(database: DesktopDatabase): void {
  database.prepare("DELETE FROM local_settings WHERE key = ?").run(CUSTOMER_ALIAS_RESYNC_KEY);
}

/**
 * Registra que o cliente `remoteId` (o gemeo que a nuvem tem e esta maquina descartou) e o
 * mesmo cliente que o `localId` daqui.
 */
export function rememberCustomerAlias(
  database: DesktopDatabase,
  companyId: string,
  remoteId: string,
  localId: string,
  now: Date = new Date()
): void {
  if (!remoteId || !localId || remoteId === localId) return;
  const nowIso = now.toISOString();
  database
    .prepare(
      `INSERT INTO customer_aliases (remote_id, company_id, local_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(remote_id) DO UPDATE SET
         company_id = excluded.company_id,
         local_id = excluded.local_id,
         updated_at = excluded.updated_at
       WHERE customer_aliases.local_id <> excluded.local_id
          OR customer_aliases.company_id <> excluded.company_id`
    )
    .run(remoteId, companyId, localId, nowIso, nowIso);
}

/**
 * A unificacao daqui encerrou `loserId` e passou o historico para `keeperId`: a equivalencia
 * vai junto. Sem isto ela apontaria para um tombstone, a traducao do pull deixaria de valer e
 * o envio da pesagem deixaria de reconhecer o id da nuvem.
 */
export function repointCustomerAliases(
  database: DesktopDatabase,
  loserId: string,
  keeperId: string,
  now: Date = new Date()
): number {
  return database
    .prepare("UPDATE customer_aliases SET local_id = ?, updated_at = ? WHERE local_id = ?")
    .run(keeperId, now.toISOString(), loserId).changes;
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
  const direct = database.prepare("SELECT id FROM customers WHERE id = ?").get(incoming) as
    | { id: string }
    | undefined;
  if (direct) return { customerId: direct.id, remoteCustomerId: null };
  const twin = findCustomerAlias(database, incoming);
  if (twin) return { customerId: twin, remoteCustomerId: incoming };
  return { customerId: local?.customer_id ?? null, remoteCustomerId: incoming };
}

/** Cadastro VIVO daqui equivalente ao id da nuvem, ou nulo. */
function findCustomerAlias(database: DesktopDatabase, remoteId: string): string | null {
  const row = database
    .prepare(
      `SELECT alias.local_id AS id
       FROM customer_aliases alias
       JOIN customers c ON c.id = alias.local_id AND c.deleted_at IS NULL
       WHERE alias.remote_id = ?`
    )
    .get(remoteId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * O `customer_id` que o envio da pesagem leva para a nuvem.
 *
 * Devolve o id que a nuvem tinha (`remote_customer_id`) so quando o cliente local continua
 * sendo o equivalente dele. A conferencia e pela tabela de equivalencia, e nao por "a coluna
 * esta preenchida", de proposito: se o operador trocou o cliente da carga aqui, o cliente
 * local deixa de bater com a equivalencia e quem sobe e a troca — devolver o id antigo
 * desfaria a escolha dele, e cobraria a carga de outra empresa.
 *
 * Pesagem sem cliente aqui mas com o id da nuvem lembrado leva o id da nuvem: e o que a nuvem
 * ja tem, e nao ha escolha local nenhuma a respeitar.
 */
export function cloudCustomerIdForPush(
  database: DesktopDatabase,
  operation: { customer_id?: unknown; remote_customer_id?: unknown }
): string | null {
  const customerId = textOrNull(operation.customer_id);
  const remoteId = textOrNull(operation.remote_customer_id);
  if (!remoteId) return customerId;
  if (!customerId) return remoteId;
  const row = database
    .prepare("SELECT local_id FROM customer_aliases WHERE remote_id = ?")
    .get(remoteId) as { local_id: string } | undefined;
  return row?.local_id === customerId ? remoteId : customerId;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
