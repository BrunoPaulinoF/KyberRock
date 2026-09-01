import type { DesktopDatabase } from "../database/sqlite.js";
import { customerIdentityKey, documentKey } from "./customer-identity.js";
import { normalizeMatchKey } from "./customer-import-sheet.js";

/**
 * O DIAGNOSTICO dos cadastros repetidos que ainda estao no banco desta maquina.
 *
 * Ele so OLHA. Juntar dois cadastros mexe em pesagem, fatura, extrato e saldo, e quando o
 * criterio e o nome nao ha como a maquina ter certeza — "Transportes Silva" pode ser duas
 * empresas. Por isso a decisao fica com quem conhece a operacao: aqui saem os pares, o
 * motivo de cada um e quantas pesagens estao penduradas em cada linha, que e o que diz o
 * tamanho do estrago antes de qualquer merge.
 *
 * Existe porque o duplicado nao aparece igual nas duas maquinas da pedreira: as linhas
 * `omie_<codigo>` nascem so onde o sync direto com o OMIE roda (a que tem as credenciais,
 * normalmente a balanca principal) e nunca sobem para a nuvem, entao a outra maquina mostra
 * um cadastro so e ninguem consegue comparar as duas telas.
 */

/** Uma linha de `customers` dentro de um grupo suspeito. */
export interface DuplicateCadastroRow {
  id: string;
  name: string;
  document: string | null;
  omieCustomerId: number | null;
  isActive: boolean;
  /** Pesagens apontando para ESTA linha — o que se perde de vista se ela for ignorada. */
  operations: number;
}

/**
 * Por que estas linhas parecem o mesmo cliente:
 *
 *  - `documento`: mesmo CNPJ/CPF (ou mesmo codigo OMIE). E certeza, nao suspeita — a
 *    migracao 39 ja funde estes, entao um grupo destes sobrando aqui e novidade.
 *  - `nome-sem-documento`: mesmo nome, e pelo menos uma das linhas esta sem CNPJ/CPF. E o
 *    "cadastro da correria" que o pull do OMIE nao reconhecia e duplicava. Suspeita, nao
 *    certeza: matriz e filial dividem o nome e sao clientes diferentes.
 */
export type DuplicateCadastroReason = "documento" | "nome-sem-documento";

export interface DuplicateCadastroGroup {
  reason: DuplicateCadastroReason;
  /** O que amarra o grupo: o documento/codigo, ou o nome normalizado. */
  key: string;
  rows: DuplicateCadastroRow[];
}

interface CustomerRecord {
  id: string;
  legal_name: string | null;
  trade_name: string | null;
  document: string | null;
  omie_customer_id: number | null;
  is_active: number;
}

function displayName(row: CustomerRecord): string {
  return (row.trade_name ?? "").trim() || (row.legal_name ?? "").trim() || "Sem nome";
}

/**
 * Cadastros ativos e nao excluidos que parecem ser o mesmo cliente real.
 *
 * Fica de fora quem ja foi soft-deletado: essa linha nao aparece em lista nenhuma, entao
 * nao e o duplicado que o operador esta vendo na tela.
 */
export function findDuplicateCustomerCadastros(
  database: DesktopDatabase,
  companyId: string
): DuplicateCadastroGroup[] {
  const rows = database
    .prepare(
      `SELECT id, legal_name, trade_name, document, omie_customer_id, is_active
         FROM customers
        WHERE company_id = ?
          AND deleted_at IS NULL`
    )
    .all(companyId) as CustomerRecord[];

  const operationCounts = new Map<string, number>();
  for (const row of database
    .prepare(
      `SELECT customer_id AS customerId, COUNT(*) AS total
         FROM weighing_operations
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id`
    )
    .all() as Array<{ customerId: string; total: number }>) {
    operationCounts.set(row.customerId, row.total);
  }

  const toRow = (row: CustomerRecord): DuplicateCadastroRow => ({
    id: row.id,
    name: displayName(row),
    document: row.document,
    omieCustomerId: row.omie_customer_id,
    isActive: row.is_active === 1,
    operations: operationCounts.get(row.id) ?? 0
  });

  const groups: DuplicateCadastroGroup[] = [];
  const grouped = new Set<string>();

  // 1. Mesmo documento (ou mesmo codigo OMIE): a identidade que o resto do sistema ja usa.
  const byIdentity = new Map<string, CustomerRecord[]>();
  for (const row of rows) {
    const key = customerIdentityKey({
      id: row.id,
      document: row.document,
      omie_customer_id: row.omie_customer_id
    });
    // `id:<uuid>` so responde por si — agrupar por ela juntaria a base inteira.
    if (key.startsWith("id:")) continue;
    const bucket = byIdentity.get(key);
    if (bucket) bucket.push(row);
    else byIdentity.set(key, [row]);
  }
  for (const [key, bucket] of byIdentity) {
    if (bucket.length < 2) continue;
    for (const row of bucket) grouped.add(row.id);
    groups.push({ reason: "documento", key, rows: bucket.map(toRow) });
  }

  // 2. Mesmo nome com pelo menos um cadastro sem CNPJ/CPF — o furo que o pull do OMIE
  //    abria. Quem ja entrou num grupo por documento nao entra de novo aqui.
  const byName = new Map<string, CustomerRecord[]>();
  for (const row of rows) {
    if (grouped.has(row.id)) continue;
    const keys = new Set(
      [row.trade_name, row.legal_name]
        .map((name) => normalizeMatchKey(name ?? ""))
        .filter((key) => key !== "")
    );
    for (const key of keys) {
      const bucket = byName.get(key);
      if (bucket) bucket.push(row);
      else byName.set(key, [row]);
    }
  }
  // Nome fantasia e razao social geram chaves diferentes: o mesmo par casa pelas duas e
  // sairia repetido no relatorio. O conjunto de ids e que diz se o grupo ja foi visto.
  const reportedNameGroups = new Set<string>();
  for (const [key, bucket] of byName) {
    if (bucket.length < 2) continue;
    // Duas linhas que JA tem documento e nome igual sao matriz e filial, nao duplicata.
    if (!bucket.some((row) => documentKey(row.document) === "")) continue;
    // Um cadastro cujos dois nomes casam com o mesmo grupo entraria duas vezes.
    const unique = [...new Map(bucket.map((row) => [row.id, row])).values()];
    if (unique.length < 2) continue;
    const signature = unique
      .map((row) => row.id)
      .sort()
      .join("|");
    if (reportedNameGroups.has(signature)) continue;
    reportedNameGroups.add(signature);
    groups.push({ reason: "nome-sem-documento", key, rows: unique.map(toRow) });
  }

  return groups;
}
