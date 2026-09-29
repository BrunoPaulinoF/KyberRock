import type { DesktopDatabase } from "../database/sqlite.js";
import { documentKey } from "./customer-identity.js";
import { mergeCustomerInto } from "./customer-merge.js";

/**
 * Cadastro feito SEM INTERNET.
 *
 * Sem internet a balanca continua vendendo: da para cadastrar cliente, transportadora,
 * placa e motorista novos na Nova entrada. O que ela NAO faz e editar o que ja existia —
 * o site pode estar mudando o mesmo cadastro ao mesmo tempo, e na volta um apagaria o
 * outro (a nuvem grava por id, sem comparar hora). Cadastro novo nao tem esse problema:
 * nasce com um id que so esta maquina conhece.
 *
 * O risco que sobra e o REPETIDO: o mesmo cliente cadastrado aqui sem internet e, no mesmo
 * intervalo, no site. Por isso o cadastro feito sem internet nasce marcado
 * (`offline_pending = 1`) e NAO sobe sozinho: na volta da internet o runtime primeiro puxa
 * a nuvem, depois `reconcileOfflineCadastros` procura o gemeo de cada marcado e, achando,
 * junta o daqui no de la — as pesagens passam para o cadastro que ficou. So entao a marca
 * cai e o resto sobe.
 *
 * Quem fica e SEMPRE o cadastro que ja existia (o da nuvem ou o que esta maquina ja tinha):
 * o marcado nunca saiu daqui, entao ninguem mais aponta para ele. Escolher pelo "mais
 * antigo" poderia derrubar o do site, que outras balancas e o OMIE ja conhecem.
 *
 * Gemeo e: cliente e transportadora pelo CPF/CNPJ (`documentKey`, que preserva as letras do
 * CNPJ alfanumerico), placa pela placa (so letras e numeros) e motorista pelo NOME (sem
 * acento, caixa e espacos repetidos) — o CPF do motorista nao e obrigatorio.
 */

export const OFFLINE_CADASTRO_TABLES = ["customers", "carriers", "vehicles", "drivers"] as const;
export type OfflineCadastroTable = (typeof OFFLINE_CADASTRO_TABLES)[number];

export type OfflinePendingCadastro = Record<OfflineCadastroTable, string[]>;

export interface OfflineReconcileResult {
  /** Cadastros feitos sem internet que foram juntados ao gemeo. */
  merged: Array<{ table: OfflineCadastroTable; loserId: string; keeperId: string }>;
  /** Cadastros feitos sem internet que eram novos de verdade e agora sobem. */
  released: number;
}

/** Posicao da ultima linha gravada na tabela (o `rowid` implicito do SQLite). */
export function lastRowId(database: DesktopDatabase, table: OfflineCadastroTable): number {
  return database.prepare(`SELECT COALESCE(MAX(rowid), 0) FROM ${table}`).pluck().get() as number;
}

/**
 * Marca como "feito sem internet" o que a chamada acabou de criar: as linhas da empresa
 * gravadas depois de `afterRowId`. Pela posicao de gravacao, e nao pela hora, para nao
 * confundir com um cadastro feito no mesmo milissegundo. Reaproveitar uma placa ja
 * cadastrada nao cria linha e, portanto, nao marca nada.
 */
export function markCreatedOffline(
  database: DesktopDatabase,
  table: OfflineCadastroTable,
  companyId: string,
  afterRowId: number
): number {
  return database
    .prepare(
      `UPDATE ${table} SET offline_pending = 1
        WHERE company_id = ? AND rowid > ? AND offline_pending = 0 AND deleted_at IS NULL`
    )
    .run(companyId, afterRowId).changes;
}

export function hasOfflinePendingCadastro(database: DesktopDatabase): boolean {
  return OFFLINE_CADASTRO_TABLES.some(
    (table) =>
      database.prepare(`SELECT 1 FROM ${table} WHERE offline_pending = 1 LIMIT 1`).get() !==
      undefined
  );
}

export function isOfflinePending(
  database: DesktopDatabase,
  table: OfflineCadastroTable,
  id: string
): boolean {
  const flag = database
    .prepare(`SELECT offline_pending FROM ${table} WHERE id = ?`)
    .pluck()
    .get(id) as number | undefined;
  return flag === 1;
}

export function listOfflinePendingCadastro(database: DesktopDatabase): OfflinePendingCadastro {
  const read = (table: OfflineCadastroTable) =>
    database
      .prepare(`SELECT id FROM ${table} WHERE offline_pending = 1 AND deleted_at IS NULL`)
      .pluck()
      .all() as string[];
  return {
    customers: read("customers"),
    carriers: read("carriers"),
    vehicles: read("vehicles"),
    drivers: read("drivers")
  };
}

/** Placa comparavel: so letras e numeros, em maiusculas ("hji-0517" = "HJI0517"). */
export function plateKey(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Nome comparavel: sem acento, em maiusculas, com um espaco so ("  joão  da silva"). */
export function personNameKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface CandidateRow {
  id: string;
  company_id: string;
  key_source: string | null;
  omie_id: number | null;
  created_at: string;
  offline_pending: number;
}

const CANDIDATE_SQL: Record<OfflineCadastroTable, string> = {
  customers: `SELECT id, company_id, document AS key_source, omie_customer_id AS omie_id, created_at, offline_pending
                FROM customers WHERE deleted_at IS NULL`,
  carriers: `SELECT id, company_id, document AS key_source, omie_customer_id AS omie_id, created_at, offline_pending
               FROM carriers WHERE deleted_at IS NULL`,
  vehicles: `SELECT id, company_id, plate AS key_source, NULL AS omie_id, created_at, offline_pending
               FROM vehicles WHERE deleted_at IS NULL`,
  drivers: `SELECT id, company_id, name AS key_source, NULL AS omie_id, created_at, offline_pending
              FROM drivers WHERE deleted_at IS NULL`
};

function twinKey(table: OfflineCadastroTable, value: string | null): string {
  if (table === "vehicles") return plateKey(value);
  if (table === "drivers") return personNameKey(value);
  return documentKey(value);
}

/** Entre varios gemeos, o que o OMIE ja conhece, depois o mais antigo, empate no menor id. */
function pickKeeper(twins: CandidateRow[]): CandidateRow {
  return [...twins].sort((a, b) => {
    const omieA = a.omie_id && a.omie_id > 0 ? 0 : 1;
    const omieB = b.omie_id && b.omie_id > 0 ? 0 : 1;
    if (omieA !== omieB) return omieA - omieB;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  })[0];
}

/**
 * Na volta da internet (DEPOIS do pull): junta cada cadastro feito sem internet ao gemeo
 * que ja existia e libera o resto para subir. Tudo numa transacao.
 */
export function reconcileOfflineCadastros(
  database: DesktopDatabase,
  now: Date = new Date()
): OfflineReconcileResult {
  const nowIso = now.toISOString();
  const result: OfflineReconcileResult = { merged: [], released: 0 };

  const run = database.transaction(() => {
    for (const table of OFFLINE_CADASTRO_TABLES) {
      const rows = database.prepare(CANDIDATE_SQL[table]).all() as CandidateRow[];
      const existingByKey = new Map<string, CandidateRow[]>();
      for (const row of rows) {
        if (row.offline_pending === 1) continue;
        const key = twinKey(table, row.key_source);
        if (!key) continue;
        const mapKey = `${row.company_id}|${key}`;
        existingByKey.set(mapKey, [...(existingByKey.get(mapKey) ?? []), row]);
      }

      for (const pending of rows.filter((row) => row.offline_pending === 1)) {
        const key = twinKey(table, pending.key_source);
        const twins = key ? existingByKey.get(`${pending.company_id}|${key}`) : undefined;
        if (twins && twins.length > 0) {
          const keeper = pickKeeper(twins);
          mergeOfflineInto(database, table, keeper.id, pending.id, nowIso);
          result.merged.push({ table, loserId: pending.id, keeperId: keeper.id });
        }
      }

      // O que sobrou marcado e novo de verdade. `updated_at` anda para o cursor do push
      // enxergar a linha mesmo que ele tenha passado dela enquanto a internet estava fora.
      result.released += database
        .prepare(
          `UPDATE ${table} SET offline_pending = 0, updated_at = ?
            WHERE offline_pending = 1 AND deleted_at IS NULL`
        )
        .run(nowIso).changes;
      database.prepare(`UPDATE ${table} SET offline_pending = 0 WHERE offline_pending = 1`).run();
    }
  });
  run();

  return result;
}

/** Tira a marca de tudo, sem juntar nada (saida de emergencia se a juncao falhar). */
export function releaseOfflineCadastros(database: DesktopDatabase, now: Date = new Date()): void {
  const nowIso = now.toISOString();
  for (const table of OFFLINE_CADASTRO_TABLES) {
    database
      .prepare(`UPDATE ${table} SET offline_pending = 0, updated_at = ? WHERE offline_pending = 1`)
      .run(nowIso);
  }
}

/** Vinculo N:N em que o cadastro aparece: a coluna dele e a do outro lado do par. */
interface JunctionRef {
  table: string;
  own: string;
  other: string;
}

/** Coluna simples que aponta para o cadastro. `touch` = anda o `updated_at` (para subir). */
interface ColumnRef {
  table: string;
  column: string;
  touch: boolean;
}

const REFERENCES: Record<
  Exclude<OfflineCadastroTable, "customers">,
  { columns: ColumnRef[]; junctions: JunctionRef[] }
> = {
  carriers: {
    columns: [
      { table: "weighing_operations", column: "carrier_id", touch: false },
      { table: "vehicles", column: "carrier_id", touch: true },
      { table: "customers", column: "default_carrier_id", touch: true }
    ],
    junctions: [
      { table: "vehicle_carriers", own: "carrier_id", other: "vehicle_id" },
      { table: "customer_carriers", own: "carrier_id", other: "customer_id" },
      { table: "driver_carriers", own: "carrier_id", other: "driver_id" }
    ]
  },
  vehicles: {
    columns: [{ table: "weighing_operations", column: "vehicle_id", touch: false }],
    junctions: [
      { table: "vehicle_carriers", own: "vehicle_id", other: "carrier_id" },
      { table: "customer_vehicles", own: "vehicle_id", other: "customer_id" }
    ]
  },
  drivers: {
    columns: [{ table: "weighing_operations", column: "driver_id", touch: false }],
    junctions: [{ table: "driver_carriers", own: "driver_id", other: "carrier_id" }]
  }
};

function mergeOfflineInto(
  database: DesktopDatabase,
  table: OfflineCadastroTable,
  keeperId: string,
  loserId: string,
  nowIso: string
): void {
  if (table === "customers") {
    // O caminho de sempre da unificacao: pesagens, credito, precos e vinculos mudam de
    // dono, e a perdedora vira tombstone (que a nuvem recebe como excluida).
    mergeCustomerInto(database, { keeperId, loserId }, new Date(nowIso));
    return;
  }

  const refs = REFERENCES[table];
  for (const ref of refs.columns) {
    const touch = ref.touch ? ", updated_at = @now" : "";
    database
      .prepare(
        `UPDATE ${ref.table} SET ${ref.column} = @keeper${touch} WHERE ${ref.column} = @loser`
      )
      .run({ keeper: keeperId, loser: loserId, now: nowIso });
  }
  for (const ref of refs.junctions) {
    // O mesmo par ja existe no cadastro que fica: o vinculo do marcado so sai. Ele nunca
    // subiu (nada sobe enquanto ha cadastro marcado), entao apagar nao deixa orfao na nuvem.
    database
      .prepare(
        `DELETE FROM ${ref.table}
          WHERE ${ref.own} = @loser
            AND EXISTS (SELECT 1 FROM ${ref.table} keep
                         WHERE keep.${ref.own} = @keeper AND keep.${ref.other} = ${ref.table}.${ref.other})`
      )
      .run({ keeper: keeperId, loser: loserId });
    database
      .prepare(
        `UPDATE ${ref.table} SET ${ref.own} = @keeper, updated_at = @now WHERE ${ref.own} = @loser`
      )
      .run({ keeper: keeperId, loser: loserId, now: nowIso });
  }
  // Ninguem aponta mais para ele e ele nunca saiu daqui: some sem deixar tombstone.
  database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(loserId);
}
