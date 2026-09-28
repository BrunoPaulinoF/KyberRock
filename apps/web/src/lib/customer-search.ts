/**
 * Busca de cliente NO BANCO. A lista de clientes da Pedreira Ibiuna tem mais de 2 mil
 * cadastros: trazer todos para filtrar na tela era o que deixava Cadastros e Produtos pesados.
 * Agora o site pede 50 por vez, ja filtrados, e o filtro abaixo e o `or` do PostgREST.
 */

/**
 * Caracteres que quebram a sintaxe do `or(...)` do PostgREST (virgula, parenteses, aspas) ou
 * que ja sao curinga viram `*` — "Silva, Jose" continua achando "Silva Jose".
 */
export function sanitizeSearchTerm(search: string): string {
  return search
    .trim()
    .replace(/[,()"'\\%*]+/g, "*")
    .replace(/\s+/g, " ");
}

/**
 * O documento esta gravado com e sem pontuacao ("29.346.488/0001-95" e "58484141000107"). Com
 * um curinga entre cada caractere, o "29346488" digitado acha os dois jeitos. So com 3 ou mais
 * caracteres: menos que isso acharia metade da lista.
 */
export function documentPattern(search: string): string | null {
  const key = search.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (key.length < 3 || !/\d/.test(key)) return null;
  return `*${key.split("").join("*")}*`;
}

/** O filtro `or` do PostgREST para a busca, ou `null` sem busca. */
export function customerSearchFilter(search: string): string | null {
  const term = sanitizeSearchTerm(search);
  if (!term.replace(/\*/g, "").trim()) return null;
  const like = `*${term}*`;
  const parts = [`trade_name.ilike.${like}`, `legal_name.ilike.${like}`];
  const doc = documentPattern(search);
  if (doc) parts.push(`document.ilike.${doc}`);
  return parts.join(",");
}
