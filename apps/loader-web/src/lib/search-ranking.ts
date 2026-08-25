// Busca dos cadastros do painel: casa por termo e ORDENA por proximidade.
//
// Mesma regra do desktop (`packages/shared/src/search-ranking.ts`): todos os termos
// digitados precisam casar, quem casa melhor sobe, e pontuacao nao atrapalha. A
// duplicacao e proposital, pelo mesmo motivo do `billing.ts`: o loader-web nao depende
// de `@kyberrock/shared` porque o Dockerfile so instala e builda ESTE workspace — o
// `dist/` do pacote compartilhado nao existe dentro do container.
//
// Se a regra mudar de um lado, tem de mudar no outro. Os dois lados sao cobertos por
// teste, entao a divergencia aparece.

/** Texto comparavel: sem acento, minusculo, pontuacao virando espaco. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Os termos de uma busca, ja normalizados. Frase vazia devolve lista vazia. */
export function searchTerms(search: string): string[] {
  const normalized = normalizeSearchText(search);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Quanto um termo vale contra UM texto. `0` = nao casa.
 *
 * Por degraus, e nao continuo: quem comeca igual ao que foi digitado esta SEMPRE acima de
 * quem so contem aquilo no meio. Dentro do degrau valem os desempates — quanto mais cedo o
 * trecho aparece e quanto menos sobra do texto, melhor.
 */
export function scoreTermAgainstText(term: string, text: string): number {
  if (term.length === 0) return 0;
  const haystack = normalizeSearchText(text);
  if (haystack.length === 0) return 0;

  const coverage = (needle: string, hay: string) => Math.round((needle.length / hay.length) * 100);

  if (haystack === term) return 1000;
  if (haystack.startsWith(term)) return 800 + coverage(term, haystack);

  const at = haystack.indexOf(term);
  if (at >= 0) {
    const wordStart = haystack[at - 1] === " ";
    return (wordStart ? 600 : 400) + coverage(term, haystack) - Math.min(at, 60);
  }

  // Sem a pontuacao: e o caminho do CNPJ digitado com pontos.
  const compactHaystack = haystack.replace(/\s+/g, "");
  const compactTerm = term.replace(/\s+/g, "");
  if (compactTerm.length > 0 && compactHaystack.includes(compactTerm)) {
    return 300 + coverage(compactTerm, compactHaystack);
  }

  return 0;
}

/**
 * Casa quando TODOS os termos digitados aparecem em algum dos campos da linha.
 *
 * Buscar por termo (e nao pela frase inteira) e o que faz "sul joao" achar o carregador
 * Joao da Pedreira Sul — a ordem em que a pessoa lembra dos dois nao pode importar.
 */
export function matchesSearch(search: string, fields: Array<string | null | undefined>): boolean {
  const terms = searchTerms(search);
  if (terms.length === 0) return true;
  const haystack = fields.filter((field): field is string => Boolean(field)).join(" ");
  return terms.every((term) => scoreTermAgainstText(term, haystack) > 0);
}

/**
 * Filtra e ORDENA uma lista pela proximidade com o que foi digitado.
 *
 * `fieldsOf` devolve os campos pesquisaveis da linha, na ordem em que aparecem na tabela.
 * Busca vazia devolve a lista como veio — ordenar sem termo nao significa nada.
 */
export function rankBySearch<T>(
  items: readonly T[],
  fieldsOf: (item: T) => Array<string | null | undefined>,
  search: string
): T[] {
  const terms = searchTerms(search);
  if (terms.length === 0) return [...items];

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const haystack = fieldsOf(item)
      .filter((field): field is string => Boolean(field))
      .join(" ");
    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      const score = scoreTermAgainstText(term, haystack);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (!matchedAll) continue;
    scored.push({ item, score: total });
  }

  // `sort` estavel: empate mantem a ordem que a lista ja tinha.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}
