import {
  documentationFaqs,
  documentationGlossary,
  documentationSections,
  troubleshootingFlows,
  type DocumentationFaq,
  type DocumentationFaqCategory,
  type DocumentationSection,
  type GlossaryEntry,
  type TroubleshootingFlow
} from "./documentation-content";

// ---------------------------------------------------------------------------
// Busca da central de ajuda.
//
// O operador da balanca nao digita palavra-chave: ele digita a frase que diria
// para o suporte ("nao consigo faturar", "o carregador nao ve a operacao").
// Uma busca de AND estrito sobre todos os termos devolve zero para essas
// frases, porque "nao", "o" e "que" nao existem no texto dos guias. Por isso
// aqui a busca e por PONTUACAO e nao por filtro:
//
//   1. acentos e pontuacao sao normalizados dos dois lados;
//   2. palavras vazias do portugues sao descartadas da consulta;
//   3. sinonimos expandem o que o operador digitou para o vocabulario do
//      sistema ("nota" -> "nfe", "danfe", "faturar");
//   4. a frase inteira vale muito mais que a soma das palavras, entao quem
//      digita a frase completa ve primeiro o item que fala exatamente daquilo;
//   5. so entra no resultado quem cobre uma fracao minima dos termos uteis —
//      isso evita a lista inteira aparecer por causa de uma palavra comum.
// ---------------------------------------------------------------------------

export type DocumentationSearchResultKind = "section" | "faq" | "flow" | "glossary";

export interface DocumentationSearchResult {
  kind: DocumentationSearchResultKind;
  /** Id estavel do item dentro do seu tipo (id da secao, pergunta do FAQ, ...). */
  id: string;
  title: string;
  /** Uma linha de contexto para a lista de resultados. */
  snippet: string;
  /** Guia a abrir quando o usuario clicar no resultado. */
  sectionId?: string;
  score: number;
}

/**
 * Trecho da documentacao entregue ao assistente como contexto. Cada trecho
 * carrega a fonte para que a resposta possa citar de onde veio.
 */
export interface DocumentationPassage {
  kind: DocumentationSearchResultKind;
  id: string;
  title: string;
  source: string;
  text: string;
  sectionId?: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Palavras que aparecem em quase toda pergunta e nao ajudam a discriminar.
 * Elas sao removidas da CONSULTA (nunca do texto indexado, para que a busca
 * por frase exata continue funcionando).
 */
const STOPWORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "ela",
  "ele",
  "em",
  "essa",
  "esse",
  "esta",
  "este",
  "eu",
  "faco",
  "fazer",
  "faz",
  "isso",
  "ja",
  "la",
  "meu",
  "minha",
  "na",
  "nao",
  "nas",
  "no",
  "nos",
  "num",
  "numa",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelo",
  "por",
  "porque",
  "posso",
  "pra",
  "qual",
  "quando",
  "quais",
  "que",
  "quero",
  "se",
  "sem",
  "ser",
  "seu",
  "sua",
  "tem",
  "ter",
  "um",
  "uma",
  "vou"
]);

/**
 * Vocabulario do operador -> vocabulario do sistema. A chave e o que ele
 * digita; os valores sao termos que existem no corpus. A expansao e de mao
 * unica de proposito: adicionar termos a CONSULTA e barato, enquanto reescrever
 * o texto indexado tornaria o resultado dificil de explicar.
 */
const SYNONYMS: Record<string, string[]> = {
  nota: ["nfe", "danfe", "faturar", "fiscal"],
  notas: ["nfe", "danfe", "faturar", "fiscal"],
  fiscal: ["nfe", "nota", "faturar"],
  nf: ["nfe", "nota", "danfe"],
  nfe: ["nota", "danfe", "faturar"],
  danfe: ["nfe", "nota"],
  faturar: ["nfe", "nota", "faturamento", "omie"],
  faturamento: ["faturar", "nfe", "nota", "omie"],
  emitir: ["faturar", "nfe", "nota"],
  emissao: ["faturar", "nfe", "nota"],
  pedido: ["omie", "venda", "faturar"],
  os: ["ordem", "servico"],
  balanca: ["indicador", "peso", "captura"],
  indicador: ["balanca", "peso"],
  peso: ["balanca", "captura", "liquido"],
  tara: ["entrada", "peso", "vazio"],
  ticket: ["cupom", "comprovante"],
  cupom: ["ticket", "comprovante", "impressao"],
  comprovante: ["cupom", "ticket"],
  imprimir: ["impressao", "impressora", "cupom"],
  impressao: ["impressora", "cupom", "imprimir"],
  impressora: ["impressao", "cupom"],
  internet: ["offline", "nuvem", "cloud", "sincronizacao"],
  nuvem: ["cloud", "sincronizacao", "fila"],
  cloud: ["nuvem", "sincronizacao", "fila"],
  sincronizar: ["sincronizacao", "fila", "nuvem", "cloud"],
  sincronizacao: ["fila", "nuvem", "cloud"],
  pendente: ["fila", "sincronizacao", "aguardando"],
  travado: ["pendente", "fila", "erro"],
  fiado: ["credito", "limite", "bloqueio"],
  credito: ["fiado", "limite", "bloqueio", "saldo"],
  bloqueado: ["bloqueio", "credito", "limite", "financeiro"],
  limite: ["credito", "bloqueio", "financeiro"],
  divida: ["credito", "receber", "titulo"],
  boleto: ["cobranca", "parcela", "vencimento"],
  cobranca: ["boleto", "parcela", "receber"],
  parcela: ["parcelamento", "condicao", "vencimento"],
  parcelar: ["parcelamento", "condicao", "vencimento"],
  vencimento: ["parcela", "condicao", "prazo"],
  prazo: ["condicao", "parcela", "vencimento"],
  carteira: ["fechamento", "acerto", "recebimento", "adiantamento"],
  acerto: ["carteira", "fechamento"],
  // O operador procura pelo que o cliente fez ("deixou pago", "pagou adiantado"), nao
  // pelo nome contabil do lancamento.
  adiantamento: ["carteira", "credito", "saldo", "antecipado"],
  adiantado: ["adiantamento", "carteira", "credito"],
  antecipado: ["adiantamento", "carteira", "credito"],
  abater: ["adiantamento", "desconto", "carteira"],
  bonificacao: ["cortesia", "sem cobranca"],
  frete: ["transporte", "transportadora", "modalidade"],
  transporte: ["frete", "transportadora"],
  motorista: ["transporte", "veiculo", "placa"],
  placa: ["veiculo", "caminhao"],
  caminhao: ["veiculo", "placa"],
  veiculo: ["placa", "caminhao"],
  carregador: ["loader", "patio", "site"],
  loader: ["carregador", "patio", "site"],
  patio: ["carregador", "loader"],
  cliente: ["cadastro", "cnpj", "omie"],
  cadastro: ["cliente", "cnpj", "registro"],
  cnpj: ["documento", "cadastro", "cliente"],
  cpf: ["documento", "cadastro", "cliente"],
  preco: ["valor", "tabela", "tonelada"],
  valor: ["preco", "tabela"],
  tabela: ["preco", "tabela de preco"],
  backup: ["exportar", "restaurar", "banco"],
  restaurar: ["backup", "banco"],
  atualizar: ["atualizacao", "versao", "update"],
  atualizacao: ["versao", "update"],
  versao: ["atualizacao", "update"],
  senha: ["acesso", "preco", "ativacao"],
  ativar: ["ativacao", "codigo", "licenca"],
  ativacao: ["codigo", "licenca"],
  licenca: ["ativacao", "codigo"],
  erro: ["log", "falha", "problema"],
  log: ["erro", "logs"],
  falha: ["erro", "problema"],
  lento: ["lentidao", "travando", "desempenho"],
  cancelar: ["cancelamento", "estorno"],
  cancelamento: ["cancelar", "estorno"],
  estornar: ["estorno", "cancelamento", "credito"],
  editar: ["corrigir", "alterar"],
  corrigir: ["editar", "alterar"],
  alterar: ["editar", "corrigir"],
  relatorio: ["insights", "exportar", "fechamento"],
  atalho: ["tecla", "teclado"],
  tecla: ["atalho", "teclado"]
};

function tokenize(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

/**
 * Termos uteis da consulta + expansao por sinonimo. Os sinonimos entram como
 * termos "de apoio": eles pontuam, mas nao contam para a cobertura minima —
 * senao uma consulta de uma palavra com muitos sinonimos passaria a exigir
 * que o item falasse de todos eles.
 */
export function expandQueryTerms(query: string): { terms: string[]; expanded: string[] } {
  const rawTokens = tokenize(query);
  const meaningful = rawTokens.filter((token) => token.length > 1 && !STOPWORDS.has(token));
  // Consulta feita so de palavras vazias ("como faco?"): usa o que veio, senao
  // nao sobra nada para pontuar.
  const terms = meaningful.length > 0 ? meaningful : rawTokens;

  const expanded = new Set<string>();
  for (const term of terms) {
    for (const synonym of SYNONYMS[term] ?? []) {
      for (const piece of tokenize(synonym)) {
        if (!terms.includes(piece)) expanded.add(piece);
      }
    }
  }

  return { terms, expanded: [...expanded] };
}

interface IndexedEntry {
  kind: DocumentationSearchResultKind;
  id: string;
  title: string;
  snippet: string;
  sectionId?: string;
  /** Titulo normalizado — casar aqui vale mais que casar no corpo. */
  titleText: string;
  /** Palavras-chave normalizadas, incluindo as frases que o operador digita. */
  keywordText: string;
  /** Corpo inteiro normalizado. */
  bodyText: string;
}

function firstSentence(value: string): string {
  const trimmed = value.trim();
  const cut = trimmed.indexOf(". ");
  return cut > 0 ? trimmed.slice(0, cut + 1) : trimmed;
}

function indexSection(section: DocumentationSection): IndexedEntry {
  return {
    kind: "section",
    id: section.id,
    title: section.title,
    snippet: section.summary,
    sectionId: section.id,
    titleText: normalizeSearchText(`${section.title} ${section.eyebrow}`),
    keywordText: normalizeSearchText(section.keywords.join(" ")),
    bodyText: normalizeSearchText(
      [section.title, section.eyebrow, section.summary, ...section.steps, ...section.details].join(
        " "
      )
    )
  };
}

function indexFaq(faq: DocumentationFaq): IndexedEntry {
  return {
    kind: "faq",
    id: faq.question,
    title: faq.question,
    snippet: firstSentence(faq.answer),
    sectionId: faq.sectionId,
    titleText: normalizeSearchText(faq.question),
    keywordText: normalizeSearchText(faq.keywords.join(" ")),
    bodyText: normalizeSearchText(`${faq.question} ${faq.answer}`)
  };
}

function indexFlow(flow: TroubleshootingFlow): IndexedEntry {
  return {
    kind: "flow",
    id: flow.id,
    title: flow.title,
    snippet: flow.symptom,
    titleText: normalizeSearchText(`${flow.title} ${flow.symptom}`),
    keywordText: normalizeSearchText(flow.keywords.join(" ")),
    bodyText: normalizeSearchText(
      [flow.title, flow.symptom, ...flow.checks, flow.escalation].join(" ")
    )
  };
}

function indexGlossary(entry: GlossaryEntry): IndexedEntry {
  return {
    kind: "glossary",
    id: entry.term,
    title: entry.term,
    snippet: entry.definition,
    sectionId: entry.sectionId,
    titleText: normalizeSearchText(entry.term),
    keywordText: normalizeSearchText(entry.keywords.join(" ")),
    bodyText: normalizeSearchText(`${entry.term} ${entry.definition}`)
  };
}

const searchIndex: IndexedEntry[] = [
  ...documentationSections.map(indexSection),
  ...documentationFaqs.map(indexFaq),
  ...troubleshootingFlows.map(indexFlow),
  ...documentationGlossary.map(indexGlossary)
];

/** Casa palavra inteira ou prefixo de pelo menos 4 letras ("sincroniz" acha "sincronizacao"). */
function containsTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  const index = haystack.indexOf(term);
  if (index < 0) return false;
  const before = index === 0 ? " " : haystack[index - 1];
  if (before !== " ") return false;
  const afterIndex = index + term.length;
  if (afterIndex >= haystack.length || haystack[afterIndex] === " ") return true;
  // Prefixo: so aceita a partir de 4 letras, senao "os" casaria com qualquer coisa.
  return term.length >= 4;
}

const SCORE = {
  phraseInTitle: 120,
  phraseInKeywords: 90,
  phraseInBody: 55,
  termInTitle: 14,
  termInKeywords: 10,
  termInBody: 5,
  synonymInTitle: 5,
  synonymInKeywords: 4,
  synonymInBody: 2,
  /** Bonus por cobrir toda a consulta, proporcional ao numero de termos. */
  fullCoverage: 12
} as const;

function scoreEntry(
  entry: IndexedEntry,
  normalizedQuery: string,
  terms: string[],
  expanded: string[]
): number {
  let score = 0;

  if (normalizedQuery.includes(" ")) {
    if (entry.titleText.includes(normalizedQuery)) score += SCORE.phraseInTitle;
    else if (entry.keywordText.includes(normalizedQuery)) score += SCORE.phraseInKeywords;
    else if (entry.bodyText.includes(normalizedQuery)) score += SCORE.phraseInBody;
  }

  let matched = 0;
  for (const term of terms) {
    let termScore = 0;
    if (containsTerm(entry.titleText, term)) termScore += SCORE.termInTitle;
    if (containsTerm(entry.keywordText, term)) termScore += SCORE.termInKeywords;
    if (containsTerm(entry.bodyText, term)) termScore += SCORE.termInBody;
    if (termScore > 0) matched += 1;
    score += termScore;
  }

  for (const term of expanded) {
    if (containsTerm(entry.titleText, term)) score += SCORE.synonymInTitle;
    if (containsTerm(entry.keywordText, term)) score += SCORE.synonymInKeywords;
    if (containsTerm(entry.bodyText, term)) score += SCORE.synonymInBody;
  }

  if (score === 0) return 0;

  const coverage = terms.length > 0 ? matched / terms.length : 0;
  // Cobertura minima: com um termo so, ele precisa casar; com varios, metade.
  // Sem isso, "cliente bloqueado por credito" traria todo item que fala "cliente".
  const required = terms.length <= 1 ? 1 : 0.5;
  if (coverage < required && score < SCORE.phraseInBody) return 0;
  if (coverage >= 1) score += SCORE.fullCoverage * terms.length;

  return score;
}

export interface SearchDocumentationOptions {
  limit?: number;
  kinds?: DocumentationSearchResultKind[];
}

/**
 * Busca global. Devolve os itens ordenados por relevancia; consulta vazia
 * devolve lista vazia (a tela mostra o conteudo normal nesse caso).
 */
export function searchDocumentation(
  query: string,
  options: SearchDocumentationOptions = {}
): DocumentationSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const { terms, expanded } = expandQueryTerms(query);
  if (terms.length === 0) return [];

  const kinds = options.kinds;
  const results: DocumentationSearchResult[] = [];

  for (const entry of searchIndex) {
    if (kinds && !kinds.includes(entry.kind)) continue;
    const score = scoreEntry(entry, normalizedQuery, terms, expanded);
    if (score <= 0) continue;
    results.push({
      kind: entry.kind,
      id: entry.id,
      title: entry.title,
      snippet: entry.snippet,
      sectionId: entry.sectionId,
      score
    });
  }

  results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  return typeof options.limit === "number" ? results.slice(0, options.limit) : results;
}

// ---------------------------------------------------------------------------
// Filtros usados pelas abas
// ---------------------------------------------------------------------------

export function filterDocumentationContent(query: string): {
  sections: DocumentationSection[];
  faqs: DocumentationFaq[];
} {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return { sections: documentationSections, faqs: documentationFaqs };
  }

  const results = searchDocumentation(query);
  const sectionIds = new Set(
    results.filter((result) => result.kind === "section").map((result) => result.id)
  );
  const faqQuestions = new Set(
    results.filter((result) => result.kind === "faq").map((result) => result.id)
  );

  return {
    sections: documentationSections.filter((section) => sectionIds.has(section.id)),
    faqs: documentationFaqs.filter((faq) => faqQuestions.has(faq.question))
  };
}

export function filterTroubleshootingFlows(query: string): TroubleshootingFlow[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return troubleshootingFlows;

  const matched = new Set(
    searchDocumentation(query, { kinds: ["flow"] }).map((result) => result.id)
  );
  return troubleshootingFlows.filter((flow) => matched.has(flow.id));
}

export function filterFaqsByCategory(
  category: DocumentationFaqCategory | "all"
): DocumentationFaq[] {
  if (category === "all") return documentationFaqs;
  return documentationFaqs.filter((faq) => faq.category === category);
}

// ---------------------------------------------------------------------------
// Recuperacao para o assistente
// ---------------------------------------------------------------------------

const KIND_SOURCE_LABEL: Record<DocumentationSearchResultKind, string> = {
  section: "Guia",
  faq: "Duvida frequente",
  flow: "Diagnostico",
  glossary: "Glossario"
};

function passageForSection(section: DocumentationSection): string {
  return [
    section.summary,
    `Passo a passo: ${section.steps.join(" ")}`,
    `Pontos importantes: ${section.details.join(" ")}`
  ].join("\n");
}

function passageForFlow(flow: TroubleshootingFlow): string {
  return [
    `Sintoma: ${flow.symptom}`,
    `Verificacoes: ${flow.checks.join(" ")}`,
    `Se nao resolver: ${flow.escalation}`
  ].join("\n");
}

function buildPassage(result: DocumentationSearchResult): DocumentationPassage | null {
  const source = `${KIND_SOURCE_LABEL[result.kind]}: ${result.title}`;

  if (result.kind === "section") {
    const section = documentationSections.find((item) => item.id === result.id);
    if (!section) return null;
    return {
      kind: result.kind,
      id: result.id,
      title: section.title,
      source,
      text: passageForSection(section),
      sectionId: section.id
    };
  }

  if (result.kind === "faq") {
    const faq = documentationFaqs.find((item) => item.question === result.id);
    if (!faq) return null;
    return {
      kind: result.kind,
      id: result.id,
      title: faq.question,
      source,
      text: faq.answer,
      sectionId: faq.sectionId
    };
  }

  if (result.kind === "flow") {
    const flow = troubleshootingFlows.find((item) => item.id === result.id);
    if (!flow) return null;
    return {
      kind: result.kind,
      id: result.id,
      title: flow.title,
      source,
      text: passageForFlow(flow),
      sectionId: undefined
    };
  }

  const entry = documentationGlossary.find((item) => item.term === result.id);
  if (!entry) return null;
  return {
    kind: result.kind,
    id: result.id,
    title: entry.term,
    source,
    text: entry.definition,
    sectionId: entry.sectionId
  };
}

/**
 * Trechos mais relevantes da documentacao para uma pergunta. E o unico
 * conteudo que sai deste computador quando o assistente consulta a nuvem:
 * a nossa propria documentacao, nunca dado de cliente ou de operacao.
 */
export function retrieveDocumentationPassages(question: string, limit = 6): DocumentationPassage[] {
  return searchDocumentation(question, { limit })
    .map(buildPassage)
    .filter((passage): passage is DocumentationPassage => passage !== null);
}

export interface LocalAssistantAnswer {
  /** Texto pronto para exibir no chat. */
  answer: string;
  /** `false` quando a documentacao nao cobre a pergunta. */
  grounded: boolean;
  sources: Array<{ title: string; sectionId?: string }>;
}

export const SUPPORT_FALLBACK_ANSWER =
  "Nao encontrei essa resposta na documentacao do KyberRock, entao prefiro nao arriscar um palpite. " +
  "Fale diretamente com o suporte: use a aba Suporte aqui da documentacao para copiar o modelo de chamado " +
  "com as informacoes que eles vao pedir (empresa, unidade, horario, codigo da operacao e o texto do erro).";

/**
 * Resposta montada so com o que ja esta instalado neste computador. E o piso do
 * assistente: funciona sem internet e e o que aparece quando a nuvem nao
 * responde. Quando ha nuvem, a IA reescreve isto em linguagem natural.
 */
export function answerFromDocumentation(question: string): LocalAssistantAnswer {
  const passages = retrieveDocumentationPassages(question, 3);
  if (passages.length === 0) {
    return { answer: SUPPORT_FALLBACK_ANSWER, grounded: false, sources: [] };
  }

  const [best, ...rest] = passages;
  const lines = [best.text.trim()];
  if (rest.length > 0) {
    lines.push("", `Veja tambem: ${rest.map((passage) => passage.title).join("; ")}.`);
  }

  return {
    answer: lines.join("\n"),
    grounded: true,
    sources: passages.map((passage) => ({ title: passage.title, sectionId: passage.sectionId }))
  };
}
