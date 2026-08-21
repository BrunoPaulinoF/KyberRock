import { normalizeDocument } from "@kyberrock/shared";

import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * O CLIENTE REAL por tras de cadastros duplicados.
 *
 * O mesmo cliente pode ter mais de uma linha em `customers`: o cadastro que veio do OMIE
 * (`omie_<codigo>`) e o que nasceu na balanca (UUID), com o mesmo CNPJ e o mesmo codigo
 * OMIE. A deduplicacao por documento so vale na CRIACAO manual (`customers.ts`); o pull do
 * OMIE insere pela chave dele e nao encosta na linha local.
 *
 * Enquanto as telas agrupavam e filtravam por `customer_id`, isso partia o cliente ao
 * meio: no Fechamento de faturas a atendente escolhia "LEVISA" no filtro e via so as
 * cargas de UMA das duas linhas — quatro pesagens da quinzena viravam duas na tela, e a
 * outra metade nao era cobrada de ninguem. Na Carteira o mesmo cliente aparecia em dois
 * blocos, cada um com o seu total.
 *
 * Este modulo e a resposta: uma chave estavel por cliente real, e a lista de todos os
 * `customers.id` que caem nela. Ele NAO funde nem apaga cadastro — a correcao do cadastro
 * e outra conversa, e a cobranca nao pode esperar por ela.
 */

/** As colunas de que a identidade depende — e so essas. */
export interface CustomerIdentityRow {
  id: string;
  document: string | null;
  omie_customer_id: number | null;
}

/**
 * A chave do cliente real.
 *
 * O documento manda: e ele que diz que dois cadastros sao a mesma empresa, e e o que a
 * nota fiscal carrega. Sem documento, o codigo OMIE ainda amarra os dois lados. Sem os
 * dois, o cadastro so pode responder por si mesmo — e por isso a chave cai no proprio id,
 * nunca em algo compartilhado como o nome (dois "Transportes Silva" distintos viverriam
 * fundidos numa fatura so).
 */
export function customerIdentityKey(row: CustomerIdentityRow): string {
  const document = normalizeDocument(row.document ?? "");
  if (document) return `doc:${document}`;
  if (row.omie_customer_id) return `omie:${row.omie_customer_id}`;
  return `id:${row.id}`;
}

/** As duas direcoes da identidade: de um cadastro para a chave, e da chave para os cadastros. */
export interface CustomerIdentityIndex {
  /** `customers.id` -> chave do cliente real. */
  keyById: Map<string, string>;
  /** chave do cliente real -> todos os `customers.id` que caem nela. */
  idsByKey: Map<string, string[]>;
}

/**
 * Monta o indice a partir de TODOS os cadastros da base — inclusive os inativos e os
 * excluidos.
 *
 * De proposito: uma pesagem antiga aponta para o cadastro que existia na epoca, e se ele
 * tiver sido desativado depois (o caminho normal quando alguem percebe o duplicado) a
 * carga sumiria do fechamento justamente por causa da correcao.
 */
export function buildCustomerIdentityIndex(database: DesktopDatabase): CustomerIdentityIndex {
  const rows = database
    .prepare("SELECT id, document, omie_customer_id FROM customers")
    .all() as CustomerIdentityRow[];

  const keyById = new Map<string, string>();
  const idsByKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = customerIdentityKey(row);
    keyById.set(row.id, key);
    const ids = idsByKey.get(key);
    if (ids) ids.push(row.id);
    else idsByKey.set(key, [row.id]);
  }
  return { keyById, idsByKey };
}

/**
 * A chave de uma operacao, mesmo quando o cadastro dela sumiu.
 *
 * Duas orfandades diferentes, tratadas de forma diferente de proposito:
 *
 *  - A operacao APONTA para um cadastro que nao existe mais: o id dela ainda distingue um
 *    cliente sumido do outro, entao cada uma responde por si. Fundi-las juntaria clientes
 *    que nao tem nada a ver um com o outro numa fatura so.
 *  - A operacao nao tem cliente NENHUM (`customer_id` nulo, das pesagens antigas): nao ha
 *    o que distinguir, e todas caem no mesmo "Sem cliente". Uma linha dizendo "Sem cliente
 *    — 3 cargas" e mais visivel que tres faturas de uma carga que ninguem vai emitir.
 */
export function identityKeyForOperation(
  index: CustomerIdentityIndex,
  customerId: string | null
): string {
  if (!customerId) return "id:";
  return index.keyById.get(customerId) ?? `id:${customerId}`;
}

/**
 * Todos os `customers.id` do mesmo cliente real de `customerId` — o proprio incluido.
 *
 * E o que o filtro "Cliente" das telas passa para a consulta: escolher uma das linhas
 * duplicadas tem de trazer as cargas das duas, senao metade da quinzena fica de fora.
 */
export function resolveCustomerIdGroup(database: DesktopDatabase, customerId: string): string[] {
  const row = database
    .prepare("SELECT id, document, omie_customer_id FROM customers WHERE id = ?")
    .get(customerId) as CustomerIdentityRow | undefined;
  if (!row) return [customerId];

  const key = customerIdentityKey(row);
  // Chave que so responde por si mesma (sem documento e sem codigo OMIE): nao ha irmao a
  // procurar, e uma varredura por `id:` traria a base inteira.
  if (key.startsWith("id:")) return [customerId];

  const siblings = database
    .prepare("SELECT id, document, omie_customer_id FROM customers")
    .all() as CustomerIdentityRow[];
  const ids = siblings
    .filter((sibling) => customerIdentityKey(sibling) === key)
    .map((sibling) => sibling.id);
  return ids.length > 0 ? ids : [customerId];
}

/** Uma opcao da lista de clientes das telas, ja sem os duplicados. */
export interface DedupedCustomerOption {
  id: string;
  name: string;
  document: string | null;
}

/**
 * Colapsa os cadastros duplicados numa opcao so por cliente real.
 *
 * Sem isso o filtro "Cliente" mostra "LEVISA DESCARTAVEIS LTDA - 06020284000164" duas
 * vezes, identicas na tela, e escolher uma ou outra dava resultados diferentes — nao ha
 * como a atendente saber qual das duas e "a certa" (e nenhuma e: as cargas estao nas
 * duas). O id que sobra e o de qualquer uma delas; quem consulta expande de volta para o
 * grupo inteiro com `resolveCustomerIdGroup`.
 */
export function dedupeCustomerOptions(
  options: readonly DedupedCustomerOption[],
  keyOf: (option: DedupedCustomerOption) => string
): DedupedCustomerOption[] {
  const seen = new Set<string>();
  const result: DedupedCustomerOption[] = [];
  for (const option of options) {
    const key = keyOf(option);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  return result;
}

/**
 * Os digitos do CNPJ/CPF — a unica forma em que dois documentos podem ser comparados.
 *
 * O OMIE devolve o documento COM mascara ("06.020.284/0001-64") e o KyberRock grava so os
 * digitos (o campo da tela normaliza antes de salvar). Comparar as duas formas letra a
 * letra nunca casa, e foi assim que o mesmo cliente virou dois cadastros: o pull nao
 * reconhecia o cadastro que tinha nascido na balanca e criava um `omie_<id>` novo do lado.
 */
export function documentDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * O mesmo `documentDigits`, em SQL, para comparar a coluna `document` de uma tabela com o
 * resultado de `documentDigits(...)`.
 *
 * Existe como constante compartilhada, e nao copiado em cada consulta, porque a divergencia
 * entre duas copias e exatamente o defeito que originou os cadastros duplicados: o cadastro
 * manual (`customers.ts`) e o sync direto com o OMIE (`omie-sync.ts`) normalizavam, o pull
 * pela nuvem (`supabase-sync.ts`) comparava literal — e so ele criava as linhas repetidas.
 */
export const DOCUMENT_DIGITS_SQL =
  "replace(replace(replace(replace(COALESCE(document, ''), '.', ''), '-', ''), '/', ''), ' ', '')";
