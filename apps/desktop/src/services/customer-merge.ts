import type { DesktopDatabase } from "../database/sqlite.js";
import { DOCUMENT_KEY_SQL, documentKey } from "./customer-identity.js";

/**
 * Juntar dois cadastros do MESMO cliente em um so — e fazer isso durar.
 *
 * O duplicado nasceu de um furo ja fechado: ate 21/08/2026 o pull do OMIE inseria como linha
 * NOVA (`omie_<codigo>`) o cliente que tinha sido criado na balanca e enviado para la, porque
 * a maquina que fala com o OMIE ainda nao tinha recebido o cadastro da outra (o cadastro so
 * andava na varredura de 30 min, quando andava). Desde a adocao por codigo/documento
 * (`resolveExistingCustomerId`) nao nasce mais nenhum — a ultima linha duplicada da Pedreira
 * Ibiuna e da semana de 24/08.
 *
 * O que sobrou sao as ~200 linhas que ja existiam, e elas nao saiam mais. A limpeza anterior
 * (migracao local 39) juntava o par NA MAQUINA e marcava a perdedora com `needs_push = 0`,
 * e o pull seguinte desfazia tudo:
 *
 *     deleted_at = CASE WHEN customers.needs_push = 0 THEN NULL ELSE customers.deleted_at END
 *
 * A linha da nuvem continuava viva (a tabela `customers` de la nem tinha `deleted_at`), entao
 * o espelho ressuscitava a perdedora e o operador via os dois cadastros de novo. Por isso o
 * merge daqui tem duas metades que andam juntas:
 *
 *  1. a perdedora vira TOMBSTONE local (`deleted_at`, inativa) com `needs_push = 1` — que e o
 *     que impede o pull de reescreve-la enquanto a nuvem nao souber da exclusao (o envio ao
 *     OMIE ignora quem tem `deleted_at`, entao isso nao vira chamada la); e
 *  2. o tombstone SOBE (a nuvem ganhou `deleted_at` em `customers`/`carriers`), entao as
 *     outras balancas recebem a exclusao em vez de devolve-la.
 *
 * Sem a metade 2, qualquer unificacao — a automatica ou a do botao — volta no proximo pull.
 */

/** Quantos registros mudaram de dono. E o que a tela mostra depois de unificar. */
export interface CustomerMergeCounts {
  /** Pesagens repontadas para a sobrevivente. */
  operations: number;
  /** Orcamentos repontados. */
  quotations: number;
  /** Lancamentos do extrato de credito repontados. */
  creditMovements: number;
  /** Vinculos (preco especial, frete, transportadora, placa, tabela) repontados. */
  links: number;
  /** Vinculos descartados porque a sobrevivente ja tinha o mesmo. */
  discardedLinks: number;
}

export interface CustomerMergeResult {
  keeperId: string;
  loserId: string;
  counts: CustomerMergeCounts;
}

interface CustomerMergeRow {
  id: string;
  company_id: string;
  document: string | null;
  omie_customer_id: number | null;
  omie_integration_code: string | null;
  phone: string | null;
  email: string | null;
  deleted_at: string | null;
}

/**
 * Vinculo com chave natural: repontar as cegas violaria o indice unico (ou criaria duas
 * linhas onde so pode haver uma). Quando a sobrevivente ja tem a mesma chave, a linha da
 * perdedora e DESCARTADA (soft-delete) em vez de repontada — a configuracao de quem fica e a
 * que vale.
 */
interface LinkTable {
  table: string;
  /** Colunas que, junto com `customer_id`, formam a chave natural. */
  keyColumns: readonly string[];
  /**
   * Quando `true`, basta a sobrevivente ter QUALQUER linha viva para a da perdedora ser
   * descartada — e o caso da tabela de preco, em que duas tabelas vinculadas ao mesmo cliente
   * nao teriam desempate previsivel.
   */
  singlePerCustomer?: boolean;
}

const LINK_TABLES: readonly LinkTable[] = [
  { table: "customer_special_prices", keyColumns: ["product_id"] },
  { table: "customer_freight_rules", keyColumns: ["product_id"] },
  { table: "customer_future_billing_invoices", keyColumns: ["product_id", "nfe_number"] },
  { table: "customer_vehicles", keyColumns: ["vehicle_id"] },
  // Sem indice unico no SQLite, mas com `(customer_id, carrier_id)` unico NA NUVEM: repontar
  // as duas linhas faria o proximo push bater em 23505 e derrubar o lote inteiro.
  { table: "customer_carriers", keyColumns: ["carrier_id"] },
  { table: "customer_price_tables", keyColumns: ["price_table_id"], singlePerCustomer: true }
];

/**
 * `a IS b`, e nao `a = b`: a chave aceita NULL (o frete PADRAO do cliente e a linha com
 * `product_id NULL`, e com `=` ela nunca casaria com a outra linha padrao).
 */
function keyMatchSql(table: string, column: string): string {
  return `keep.${column} IS ${table}.${column}`;
}

function readCustomer(database: DesktopDatabase, id: string): CustomerMergeRow | undefined {
  return database
    .prepare(
      `SELECT id, company_id, document, omie_customer_id, omie_integration_code, phone, email, deleted_at
         FROM customers WHERE id = ?`
    )
    .get(id) as CustomerMergeRow | undefined;
}

/**
 * Junta `loserId` em `keeperId`: o historico passa a apontar para a sobrevivente e a perdedora
 * vira tombstone.
 *
 * Recusa antes de mexer em qualquer linha quando os dois cadastros tem documento e os
 * documentos sao DIFERENTES. E a unica salvaguarda que importa aqui: unificar dois CNPJs
 * distintos mistura pesagem, fatura e saldo de duas empresas de verdade, e nao ha como
 * desfazer isso pela tela. Cadastro sem documento pode ser unificado — e justamente o
 * "cadastro da correria" que o duplicado costuma ser.
 */
export function mergeCustomerInto(
  database: DesktopDatabase,
  input: { keeperId: string; loserId: string },
  now: Date = new Date()
): CustomerMergeResult {
  const { keeperId, loserId } = input;
  if (keeperId === loserId) {
    throw new Error("Escolha dois cadastros diferentes para unificar.");
  }

  const keeper = readCustomer(database, keeperId);
  const loser = readCustomer(database, loserId);
  if (!keeper || keeper.deleted_at) {
    throw new Error("O cadastro que vai ficar nao foi encontrado.");
  }
  if (!loser || loser.deleted_at) {
    throw new Error("O cadastro que vai sair nao foi encontrado.");
  }
  if (keeper.company_id !== loser.company_id) {
    throw new Error("Os dois cadastros precisam ser da mesma empresa.");
  }

  const keeperDocument = documentKey(keeper.document);
  const loserDocument = documentKey(loser.document);
  if (keeperDocument && loserDocument && keeperDocument !== loserDocument) {
    throw new Error(
      "Estes cadastros tem CNPJ/CPF diferentes. Unificar juntaria as pesagens e o saldo de duas " +
        "empresas — corrija o documento antes, ou inative o cadastro errado."
    );
  }

  const nowIso = now.toISOString();
  const counts: CustomerMergeCounts = {
    operations: 0,
    quotations: 0,
    creditMovements: 0,
    links: 0,
    discardedLinks: 0
  };

  const run = database.transaction(() => {
    /*
     * O tombstone vem PRIMEIRO, e nao por estilo: a sobrevivente pode estar prestes a adotar o
     * codigo OMIE da perdedora, e enquanto as duas linhas estiverem vivas o mesmo codigo
     * apontaria para dois cadastros — que e exatamente o estado que o pull do OMIE usa para
     * decidir quem adotar (`resolveExistingCustomerId`).
     */
    database
      .prepare(
        `UPDATE customers
            SET deleted_at = ?, is_active = 0, updated_at = ?, local_updated_at = ?, needs_push = 1
          WHERE id = ?`
      )
      .run(nowIso, nowIso, nowIso, loserId);

    counts.operations = database
      .prepare("UPDATE weighing_operations SET customer_id = ? WHERE customer_id = ?")
      .run(keeperId, loserId).changes;

    counts.quotations = database
      .prepare("UPDATE quotations SET customer_id = ? WHERE customer_id = ?")
      .run(keeperId, loserId).changes;

    counts.creditMovements = database
      .prepare("UPDATE customer_credit_movements SET customer_id = ? WHERE customer_id = ?")
      .run(keeperId, loserId).changes;

    for (const link of LINK_TABLES) {
      const conflictMatch = link.singlePerCustomer
        ? "1 = 1"
        : link.keyColumns.map((column) => keyMatchSql(link.table, column)).join(" AND ");

      counts.discardedLinks += database
        .prepare(
          `UPDATE ${link.table}
              SET deleted_at = ?, is_active = 0, updated_at = ?
            WHERE customer_id = ?
              AND deleted_at IS NULL
              AND EXISTS (
                SELECT 1 FROM ${link.table} keep
                 WHERE keep.customer_id = ?
                   AND keep.deleted_at IS NULL
                   AND ${conflictMatch}
              )`
        )
        .run(nowIso, nowIso, loserId, keeperId).changes;

      counts.links += database
        .prepare(
          `UPDATE ${link.table} SET customer_id = ?, updated_at = ?
            WHERE customer_id = ? AND deleted_at IS NULL`
        )
        .run(keeperId, nowIso, loserId).changes;

      /*
       * O que ja estava excluido tambem muda de dono. Nao e capricho: a linha excluida da
       * perdedora continua na nuvem (ela e tombstone, nao sumico), e deixa-la apontando para um
       * cadastro que nao existe mais faria o pull da proxima balanca escrever um vinculo orfao.
       */
      database
        .prepare(`UPDATE ${link.table} SET customer_id = ? WHERE customer_id = ?`)
        .run(keeperId, loserId);
    }

    /*
     * Saldo de credito: some a linha da perdedora e o saldo da sobrevivente e RECALCULADO a
     * partir do extrato ja unificado — somar os dois saldos prontos repetiria qualquer ajuste
     * que uma das linhas tivesse recebido fora do extrato.
     */
    database.prepare("DELETE FROM customer_credit_balances WHERE customer_id = ?").run(loserId);
    database
      .prepare(
        `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
         SELECT ?,
                COALESCE((SELECT SUM(CASE WHEN movement_type IN ('debit_product', 'debit_freight')
                                          THEN -amount_cents ELSE amount_cents END)
                            FROM customer_credit_movements WHERE customer_id = ?), 0),
                ?
          WHERE true
             ON CONFLICT(customer_id) DO UPDATE SET
               balance_cents = excluded.balance_cents,
               updated_at = excluded.updated_at`
      )
      .run(keeperId, keeperId, nowIso);

    /*
     * A sobrevivente herda o que so a perdedora tinha. O codigo OMIE e o que importa de
     * verdade: sem ele, o proximo pedido deste cliente tentaria um IncluirCliente de um
     * cadastro que ja existe la e pararia a fila em "Cliente ja cadastrado".
     *
     * `needs_push` NAO e ligado aqui de proposito: herdar o codigo do OMIE nao e uma edicao que
     * precise voltar para la, e marcar o envio transformaria uma limpeza de cadastro numa
     * escrita no ERP.
     */
    database
      .prepare(
        `UPDATE customers
            SET omie_customer_id = COALESCE(omie_customer_id, ?),
                omie_integration_code = COALESCE(omie_integration_code, ?),
                document = CASE WHEN COALESCE(document, '') = '' THEN ? ELSE document END,
                phone = CASE WHEN COALESCE(phone, '') = '' THEN ? ELSE phone END,
                email = CASE WHEN COALESCE(email, '') = '' THEN ? ELSE email END,
                updated_at = ?,
                local_updated_at = ?
          WHERE id = ?`
      )
      .run(
        loser.omie_customer_id,
        loser.omie_integration_code,
        loser.document,
        loser.phone,
        loser.email,
        nowIso,
        nowIso,
        keeperId
      );
  });

  run();

  return { keeperId, loserId, counts };
}

/** Um grupo de cadastros com o mesmo documento, ja com a sobrevivente escolhida. */
interface DocumentGroup {
  keeperId: string;
  loserIds: string[];
}

/**
 * Quem fica, dentro de um grupo do mesmo documento.
 *
 * A ordem e a MESMA da migracao 39 e a mesma usada na limpeza da nuvem — e isso nao e
 * coincidencia, e requisito: as oito balancas e o Postgres resolvem o mesmo grupo cada um por
 * sua conta, e so convergem para a mesma sobrevivente se a regra for identica nos tres lugares.
 * Primeiro quem ja tem codigo OMIE (e o cadastro que o ERP conhece), depois o mais antigo,
 * empate no menor id.
 */
function chooseGroups(
  rows: Array<{ id: string; omie_customer_id: number | null; created_at: string; key: string }>
): DocumentGroup[] {
  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byKey.get(row.key);
    if (bucket) bucket.push(row);
    else byKey.set(row.key, [row]);
  }

  const groups: DocumentGroup[] = [];
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort((a, b) => {
      const aHasOmie = a.omie_customer_id !== null ? 0 : 1;
      const bHasOmie = b.omie_customer_id !== null ? 0 : 1;
      if (aHasOmie !== bHasOmie) return aHasOmie - bHasOmie;
      // Compara a DATA, nao o texto: o SQLite guarda ora "2026-08-01T12:44:48.000Z", ora
      // "2026-08-01 12:44:48", e ordenar como texto misturaria os dois formatos — na nuvem, que
      // tem timestamptz, a ordem seria outra. Duas pontas com ordens diferentes escolheriam
      // sobreviventes diferentes, e cada uma encerraria a linha que a outra manteve.
      const aTime = Date.parse(a.created_at);
      const bTime = Date.parse(b.created_at);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return aTime - bTime;
      }
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    const [keeper, ...losers] = ordered;
    groups.push({ keeperId: keeper.id, loserIds: losers.map((row) => row.id) });
  }
  return groups;
}

/**
 * Unifica automaticamente os cadastros que tem o MESMO CNPJ/CPF.
 *
 * Documento igual e certeza, nao suspeita: e a identidade que a nota fiscal carrega e a que o
 * resto do sistema ja usa para reconhecer o cliente (`customerIdentityKey`). Duplicado por
 * NOME continua fora daqui — "Transportes Silva" pode ser duas empresas, e quem decide isso e
 * o operador, pelo botao de unificar.
 *
 * Roda na abertura do programa e e idempotente: sem duplicado, uma consulta e nada mais.
 */
export function mergeDuplicateCustomersByDocument(
  database: DesktopDatabase,
  companyId: string,
  now: Date = new Date()
): CustomerMergeResult[] {
  const rows = database
    .prepare(
      `SELECT id, omie_customer_id, created_at, ${DOCUMENT_KEY_SQL} AS key
         FROM customers
        WHERE company_id = ?
          AND deleted_at IS NULL
          AND ${DOCUMENT_KEY_SQL} <> ''`
    )
    .all(companyId) as Array<{
    id: string;
    omie_customer_id: number | null;
    created_at: string;
    key: string;
  }>;

  const results: CustomerMergeResult[] = [];
  for (const group of chooseGroups(rows)) {
    for (const loserId of group.loserIds) {
      results.push(mergeCustomerInto(database, { keeperId: group.keeperId, loserId }, now));
    }
  }
  return results;
}
