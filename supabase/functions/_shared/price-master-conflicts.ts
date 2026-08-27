/**
 * Abre caminho para o cadastro de preco da balanca PRINCIPAL na projecao da nuvem.
 *
 * As tabelas de preco tem indice unico pela chave natural — `(customer_id, product_id)` no
 * preco especial, `(product_id, is_active)` no preco padrao — enquanto o `desktop-sync`
 * grava com `onConflict: "id"`. Isso basta enquanto uma linha por par existe. Nao basta
 * depois que duas balancas cadastraram o mesmo par antes do primeiro sync: ali nascem dois
 * ids para a mesma chave, quem publicou primeiro ocupa a nuvem e o `upsert` do outro e
 * RECUSADO (23505).
 *
 * Enquanto nao havia dono isso era so um empate. Com uma principal eleita vira o oposto do
 * combinado: o preco dela — o unico que deveria valer — e justamente o que nao entra,
 * porque a secundaria chegou antes. Entao, quando quem envia e a principal, a linha
 * concorrente sai da frente ANTES do upsert.
 *
 * Sai como exclusao logica, e nao apagada: o tombstone viaja no proximo `desktop-pull` e e
 * o que faz a balanca que criou a linha largar a copia local dela. Apagar de vez deixaria a
 * outra maquina com uma linha viva que a nuvem nao tem mais.
 *
 * Este modulo e a parte pura da decisao (quem cede para quem). O acesso ao banco fica na
 * Edge Function.
 */

/** Uma linha de preco reduzida ao que decide conflito: o id e a chave natural. */
export interface PriceRowKey {
  id: string;
  /** Valores da chave natural, na ordem declarada pela tabela. */
  key: Array<string | number | boolean | null>;
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
 * Tabelas de preco em que o indice unico da nuvem pode recusar a linha da principal.
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

/**
 * Ids das linhas que ja estao na nuvem e precisam ceder para as que a principal esta
 * enviando: mesma chave natural, id diferente.
 *
 * Uma linha que a principal esta enviando como EXCLUIDA nao reserva a chave para ninguem —
 * ela nao vai ocupar o indice —, entao nao derruba a linha de ninguem.
 */
export function findRowsToRetire(incoming: PriceRowKey[], existing: PriceRowKey[]): string[] {
  if (incoming.length === 0 || existing.length === 0) return [];

  const claimed = new Map<string, Set<string>>();
  for (const row of incoming) {
    const token = keyToken(row.key);
    const ids = claimed.get(token) ?? new Set<string>();
    ids.add(row.id);
    claimed.set(token, ids);
  }

  const retire = new Set<string>();
  for (const row of existing) {
    const ids = claimed.get(keyToken(row.key));
    if (!ids || ids.has(row.id)) continue;
    retire.add(row.id);
  }
  return [...retire];
}
