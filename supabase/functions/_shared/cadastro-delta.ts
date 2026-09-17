/**
 * O cadastro alterado chega numa viagem so.
 *
 * O pull incremental do desktop roda a cada ~1 min e perguntava, UMA TABELA POR VEZ, "mudou
 * alguma coisa?" para as 21 tabelas do cadastro compartilhado -- clientes, produtos,
 * transportadoras, motoristas, veiculos, vinculos, precos, contas, credito, destinatarios.
 * Cadastro de pedreira muda algumas vezes por dia, entao quase toda resposta era uma lista
 * vazia. Medido em 16/09/2026: das 273 mil requisicoes em 24 h para OITO balancas, ~113 mil
 * eram essas varreduras vazias. O peso nao estava no DADO; estava na VIAGEM.
 *
 * A funcao `desktop_pull_cadastro_delta` (migracao `202609160003`) faz as 21 varreduras dentro
 * do banco, cada uma pelo indice que a migracao `202609150001` ja criou, e devolve o que mudou
 * de uma vez. Este modulo so entende a resposta -- puro e testado, porque o que ele decide e
 * "posso confiar neste lote?", e responder sim a um lote quebrado faria a balanca pular
 * cadastro sem ninguem perceber.
 *
 * DUAS REGRAS, e as duas escolhem o lado seguro:
 *
 * 1. Resposta fora do formato esperado vira `null`, e `null` quer dizer "use o caminho antigo,
 *    tabela por tabela". E o mesmo que acontece enquanto a migracao nao foi aplicada (a Edge
 *    Function sobe no push, a migracao e aplicada a parte): nada deixa de chegar, so chega em
 *    mais viagens.
 * 2. Tabela em `truncated` NAO vem com as linhas. O cursor do desktop e o relogio do servidor,
 *    nao a ultima linha lida: aceitar meia lista avancaria o cursor por cima do resto, e o
 *    cadastro que ficou de fora so reapareceria na varredura completa. Quem chega truncado e
 *    buscado pelo caminho paginado de sempre.
 */

/** Nome da funcao no Postgres. */
export const CADASTRO_DELTA_RPC = "desktop_pull_cadastro_delta";

/**
 * Teto de linhas por tabela numa resposta. E o mesmo `PAGE_SIZE` do caminho paginado: acima
 * disso a tabela nao cabe numa viagem e volta a ser paginada, que e o que ele ja sabe fazer.
 */
export const CADASTRO_DELTA_LIMIT = 1000;

export interface CadastroDelta {
  /** Tabela -> linhas alteradas. Tabela sem mudanca simplesmente nao aparece. */
  tables: Record<string, Record<string, unknown>[]>;
  /** Tabelas que passaram do teto e precisam ser buscadas paginadas. */
  truncated: Set<string>;
}

/**
 * Le a resposta da funcao, ou `null` quando ela nao pode ser usada.
 *
 * Desconfiado de proposito: uma linha que nao seja objeto, ou um valor que nao seja lista,
 * derruba o lote INTEIRO em vez de entrar pela metade. O custo de recusar e uma rodada de
 * viagens a mais; o custo de aceitar errado e cadastro faltando numa balanca.
 */
export function parseCadastroDelta(payload: unknown): CadastroDelta | null {
  if (!isPlainObject(payload)) return null;

  const rawTables = payload.tables;
  if (!isPlainObject(rawTables)) return null;

  const rawTruncated = payload.truncated;
  if (!Array.isArray(rawTruncated)) return null;
  if (!rawTruncated.every((name) => typeof name === "string")) return null;
  const truncated = new Set(rawTruncated as string[]);

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [table, value] of Object.entries(rawTables)) {
    // Truncada e "nao veio": se ela aparecesse nos dois lugares, quem manda e o truncamento.
    if (truncated.has(table)) continue;
    if (!Array.isArray(value)) return null;
    if (!value.every(isPlainObject)) return null;
    tables[table] = value as Record<string, unknown>[];
  }

  return { tables, truncated };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
