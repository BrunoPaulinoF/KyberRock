/**
 * A busca de cadastro do KyberRock: casa por trecho e ORDENA por proximidade.
 *
 * Antes cada tela tinha a sua: umas comparavam a frase inteira, outras cada palavra, e
 * nenhuma ordenava — a lista saia na ordem em que o cadastro entrou no banco. O efeito na
 * balanca era sempre o mesmo: o operador digitava "levisa", o cliente Levisa aparecia na
 * decima linha (atras de "Transportadora Levisa Norte", que entrou no banco antes) e ele
 * rolava a lista com o caminhao na fila. Pior: com a barra vazia a lista abria com o
 * cadastro INTEIRO, e uma pedreira com milhares de clientes travava na hora de abrir.
 *
 * Aqui a regra e uma so, e vale para cliente, produto, placa, motorista, transportadora,
 * forma de pagamento e o que mais vier:
 *
 *  1. **Todos os termos precisam casar** (em campos possivelmente diferentes). E o que faz
 *     "sul joao" achar o motorista Joao da Pedreira Sul sem obrigar a lembrar a ordem.
 *  2. **Quem casa melhor sobe.** Igual ao que foi digitado ganha de comeco de nome, que
 *     ganha de comeco de palavra no meio do nome, que ganha de trecho solto. Entre dois
 *     iguais, ganha o nome mais curto — "Levisa" antes de "Levisa Transportes".
 *  3. **Pontuacao nao atrapalha.** "12.345.678/0001-90" e achado por "12345678000190", e a
 *     placa por "abc1d23" ou "ABC-1D23" — foi por isso que operador ja cadastrou cliente
 *     repetido, achando que o primeiro nao existia.
 *
 * O modulo e puro: nao conhece React, nem SQLite, nem a tela. Quem chama decide de onde
 * vem a linha e o que fazer com a ordem.
 */

/** Texto comparavel: sem acento, minusculo, pontuacao virando espaco. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Versao so com letras e digitos.
 *
 * E o que casa "12.345.678/0001-90" com "12345678000190" e "ABC-1D23" com "abc1d23" — o
 * jeito como o documento e a placa aparecem no papel quase nunca e o jeito como estao
 * gravados no cadastro.
 */
export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

/** Os termos de uma busca, ja normalizados. Frase vazia devolve lista vazia. */
export function searchTerms(search: string): string[] {
  const normalized = normalizeSearchText(search);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Um campo pesquisavel de uma linha.
 *
 * `weight` diz o quanto aquele campo vale na hora de ordenar: o nome pelo qual o operador
 * procura o cadastro vale mais que a cidade dele. Nao muda QUEM casa — so quem sobe.
 */
export interface SearchField {
  /** Nome da propriedade na linha. */
  key: string;
  /** Peso relativo (1 = o campo principal). */
  weight: number;
}

/** Aceita `"nome"` como atalho de `{ key: "nome", weight: 1 }`. */
export type SearchFieldSpec = string | SearchField;

function toField(spec: SearchFieldSpec): SearchField {
  return typeof spec === "string" ? { key: spec, weight: 1 } : spec;
}

/**
 * Quanto um termo vale contra UM texto. `0` = nao casa.
 *
 * A escala e por degraus, e nao continua, para a ordem ser previsivel para quem digita:
 * quem comeca igual ao que foi digitado esta SEMPRE acima de quem so contem aquilo no meio,
 * por mais curto que o segundo seja. Dentro do mesmo degrau e que valem os desempates —
 * quanto mais cedo o trecho aparece e quanto menos sobra do texto, melhor.
 */
export function scoreTermAgainstText(term: string, text: string): number {
  if (term.length === 0) return 0;
  const haystack = normalizeSearchText(text);
  if (haystack.length === 0) return 0;

  if (haystack === term) return 1000;
  if (haystack.startsWith(term)) return 800 + coverageBonus(term, haystack);

  const at = haystack.indexOf(term);
  if (at >= 0) {
    // Comeco de PALAVRA no meio do texto: "brita" achando "Pedra brita 1" nao e a mesma
    // coisa que "rita" achando o mesmo texto, e o operador espera o primeiro na frente.
    const wordStart = haystack[at - 1] === " ";
    const base = wordStart ? 600 : 400;
    return base + coverageBonus(term, haystack) - Math.min(at, 60);
  }

  // Ultimo degrau: sem a pontuacao. E o caminho do CNPJ digitado com pontos e da placa
  // digitada com hifen — casa, mas nunca passa na frente de um nome que casou de verdade.
  const compactHaystack = haystack.replace(/\s+/g, "");
  const compactTerm = term.replace(/\s+/g, "");
  if (compactTerm.length > 0 && compactHaystack.includes(compactTerm)) {
    return 300 + coverageBonus(compactTerm, compactHaystack);
  }

  return 0;
}

/**
 * O quanto do texto o termo cobriu, de 0 a 100.
 *
 * Serve de desempate dentro do mesmo degrau: procurando "levisa", o cliente "Levisa" vem
 * antes de "Levisa Transportes e Locacoes" — e o que o operador quer em 9 de 10 vezes.
 */
function coverageBonus(term: string, haystack: string): number {
  return Math.round((term.length / haystack.length) * 100);
}

/** Uma linha pontuada. `score` maior = mais perto do que foi digitado. */
export interface RankedMatch<T> {
  item: T;
  score: number;
}

/**
 * Pontua UMA linha. `null` quando algum termo nao casou em campo nenhum.
 *
 * Cada termo procura o melhor campo por conta propria — e por isso que "levisa 0001"
 * acha o cliente Levisa pelo nome e confirma pelo CNPJ, em campos diferentes.
 */
export function scoreRow<T extends object>(
  row: T,
  fields: readonly SearchFieldSpec[],
  terms: readonly string[]
): number | null {
  if (terms.length === 0) return 0;

  const record = row as Record<string, unknown>;
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const spec of fields) {
      const field = toField(spec);
      const value = record[field.key];
      const text =
        typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
      if (!text) continue;
      const score = scoreTermAgainstText(term, text) * field.weight;
      if (score > best) best = score;
    }
    // Conjuncao: um termo sem casa nenhuma elimina a linha. Sem isso, digitar mais para
    // refinar AUMENTARIA a lista — o contrario do que quem digita espera.
    if (best === 0) return null;
    total += best;
  }
  return total;
}

/**
 * Filtra e ORDENA as linhas pela proximidade com o que foi digitado.
 *
 * Busca vazia devolve a lista como veio (quem chama e que decide se mostra tudo, um
 * pedaco ou nada) — ordenar sem termo nao significa nada.
 *
 * `tieBreak` decide entre pontuacoes iguais; sem ele a ordem original e mantida, que ja e
 * a alfabetica na maioria das telas. O `sort` do JavaScript e estavel, entao empate nunca
 * embaralha a lista de um redesenho para o outro.
 */
export function rankSearchMatches<T extends object>(
  rows: readonly T[],
  fields: readonly SearchFieldSpec[],
  search: string,
  options: { tieBreak?: (a: T, b: T) => number } = {}
): T[] {
  const terms = searchTerms(search);
  if (terms.length === 0) return [...rows];

  const scored: Array<RankedMatch<T>> = [];
  for (const row of rows) {
    const score = scoreRow(row, fields, terms);
    if (score === null) continue;
    scored.push({ item: row, score });
  }

  const tieBreak = options.tieBreak;
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return tieBreak ? tieBreak(a.item, b.item) : 0;
  });

  return scored.map((match) => match.item);
}

/**
 * A mesma ordenacao para quem ja tem o texto pronto, e nao uma linha com campos.
 *
 * E o caso das listas montadas na tela (o modal de troca de cliente, a lista de operacoes
 * concluidas): o texto pesquisavel ja foi juntado uma vez, na hora de montar a lista, e
 * nao ha por que desmonta-lo de volta em campos.
 */
export function rankByText<T>(
  items: readonly T[],
  textOf: (item: T) => string,
  search: string,
  options: { tieBreak?: (a: T, b: T) => number } = {}
): T[] {
  const terms = searchTerms(search);
  if (terms.length === 0) return [...items];

  const scored: Array<RankedMatch<T>> = [];
  for (const item of items) {
    const text = textOf(item);
    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      const score = scoreTermAgainstText(term, text);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (!matchedAll) continue;
    scored.push({ item, score: total });
  }

  const tieBreak = options.tieBreak;
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return tieBreak ? tieBreak(a.item, b.item) : 0;
  });

  return scored.map((match) => match.item);
}
