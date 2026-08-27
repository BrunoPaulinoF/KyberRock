/**
 * Quem fica com a linha quando duas balancas PRINCIPAIS cadastram o mesmo preco.
 *
 * As tabelas de preco tem indice unico pela chave natural — `(customer_id, product_id)` no
 * preco especial, `(product_id, is_active)` no preco padrao — enquanto o `desktop-sync`
 * grava com `onConflict: "id"`. Isso basta enquanto uma linha por par existe. Nao basta
 * depois que duas balancas cadastraram o mesmo par antes do primeiro sync: ali nascem dois
 * ids para a mesma chave, quem publicou primeiro ocupa a nuvem e o `upsert` do outro e
 * RECUSADO (23505).
 *
 * O criterio e o `updated_at` da propria linha: **quem editou por ultimo manda**.
 *
 * Nao e detalhe — e o que torna possivel ter mais de uma principal. "Quem publica por
 * ultimo manda" faria as duas se derrubarem alternadamente a cada ciclo de sync, e o preco
 * do par disputado ficaria oscilando entre os dois valores em TODAS as balancas da
 * pedreira. Comparando a hora da edicao, o resultado e o mesmo seja qual for a ordem em que
 * as maquinas sincronizam: converge, e converge para o que alguem digitou por ultimo.
 *
 * Empate no relogio cai no id (o maior vence). E arbitrario de proposito: o que importa e
 * que as duas pontas cheguem a MESMA conclusao sem se falar.
 *
 * Este modulo e a parte pura da decisao. O acesso ao banco fica na Edge Function.
 */

/** Uma linha de preco reduzida ao que decide conflito: id, chave natural e hora da edicao. */
export interface PriceRowKey {
  id: string;
  /** Valores da chave natural, na ordem declarada pela tabela. */
  key: Array<string | number | boolean | null>;
  /** `updated_at` da linha. Ausente vale como a mais antiga possivel. */
  updatedAt?: string | null;
}

export interface PriceMasterTable {
  /** Chave do payload enviado pelo desktop. */
  payloadKey: string;
  table: string;
  /** Colunas da chave natural, na ordem do indice unico. */
  naturalKey: string[];
  /** A tabela tem coluna `is_active` (as tres tem; explicito para nao supor). */
  hasIsActive: boolean;
}

/**
 * Tabelas de preco em que o indice unico da nuvem pode recusar a linha de uma principal.
 *
 * `price_tables`, `price_table_items` e `customer_price_tables` ficam de fora de proposito:
 * elas nao tem indice unico por chave natural na nuvem, entao nada e recusado ali e nao ha
 * o que liberar.
 */
export const PRICE_MASTER_TABLES: readonly PriceMasterTable[] = [
  {
    payloadKey: "customerSpecialPrices",
    table: "customer_special_prices",
    naturalKey: ["customer_id", "product_id"],
    hasIsActive: true
  },
  {
    payloadKey: "productDefaultPrices",
    table: "product_default_prices",
    naturalKey: ["product_id", "is_active"],
    hasIsActive: true
  },
  {
    // Sem indice unico na nuvem, mas COM indice unico local: duas linhas para o mesmo par
    // chegariam juntas na secundaria e, uma cedendo para a outra, o vencedor dependeria da
    // ordem do lote. Reduzir a nuvem a uma linha por par e o que torna o resultado estavel.
    payloadKey: "customerFreightRules",
    table: "customer_freight_rules",
    naturalKey: ["customer_id", "product_id"],
    hasIsActive: true
  }
];

/** Uma linha excluida nao ocupa o indice unico (todos sao parciais em `deleted_at is null`). */
export function isLiveRow(row: Record<string, unknown>): boolean {
  return row.deleted_at === null || row.deleted_at === undefined;
}

/** Chave natural de uma linha, normalizada para comparacao (`undefined` vira `null`). */
export function naturalKeyOf(
  row: Record<string, unknown>,
  columns: string[]
): Array<string | number | boolean | null> {
  return columns.map((column) => {
    const value = row[column];
    return value === undefined ? null : (value as string | number | boolean | null);
  });
}

function keyToken(key: Array<string | number | boolean | null>): string {
  // JSON e o suficiente: os valores sao uuid, boolean ou null, e o token so precisa ser
  // estavel dentro desta chamada.
  return JSON.stringify(key);
}

function editedAt(row: PriceRowKey): number {
  const parsed = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** A linha `a` vence a linha `b`? Hora da edicao; empate no id (o maior vence). */
export function winsConflict(a: PriceRowKey, b: PriceRowKey): boolean {
  const left = editedAt(a);
  const right = editedAt(b);
  if (left !== right) return left > right;
  return a.id > b.id;
}

export interface PriceConflictResolution {
  /** Linhas ja na nuvem que devem CEDER (exclusao logica) antes do upsert. */
  retire: string[];
  /**
   * Linhas do payload que PERDERAM e nao devem ser gravadas.
   *
   * Perder e sair do payload, e nao ser tentada e recusada: um `upsert` que estoura no
   * indice unico derruba o lote inteiro e vira erro de sincronizacao a cada ciclo, para
   * sempre, num caso que nao e erro nenhum — e so a outra principal tendo editado depois.
   */
  skip: string[];
}

/**
 * Resolve, para um lote de linhas de preco que uma principal esta enviando, o que cede na
 * nuvem e o que nao deve ser gravado.
 *
 * Uma linha enviada como EXCLUIDA nao reserva a chave para ninguem (ela nao vai ocupar o
 * indice), entao nao entra aqui — quem chama filtra com `isLiveRow` antes.
 */
export function resolvePriceConflicts(
  incoming: PriceRowKey[],
  existing: PriceRowKey[]
): PriceConflictResolution {
  const resolution: PriceConflictResolution = { retire: [], skip: [] };
  if (incoming.length === 0 || existing.length === 0) return resolution;

  const byKey = new Map<string, PriceRowKey[]>();
  for (const row of existing) {
    const token = keyToken(row.key);
    byKey.set(token, [...(byKey.get(token) ?? []), row]);
  }

  const retire = new Set<string>();
  const skip = new Set<string>();
  for (const row of incoming) {
    const rivals = (byKey.get(keyToken(row.key)) ?? []).filter((rival) => rival.id !== row.id);
    if (rivals.length === 0) continue;
    if (rivals.every((rival) => winsConflict(row, rival))) {
      for (const rival of rivals) retire.add(rival.id);
      continue;
    }
    skip.add(row.id);
  }

  return { retire: [...retire], skip: [...skip] };
}
