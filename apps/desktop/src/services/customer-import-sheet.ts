import { normalizeDocument, normalizePhone, parseMoneyInputToCents } from "@kyberrock/shared";

import type { SheetRow, SheetTable } from "./spreadsheet-read.js";
import { toCsvFile } from "./spreadsheet-read.js";

/**
 * Leitura e conciliacao das planilhas de cliente.
 *
 * O cadastro do cliente costuma chegar quebrado em duas planilhas: uma com o comercial
 * (contato + preco por produto) e outra com nome + CNPJ/CPF. Este modulo entende as duas,
 * junta pelo nome e devolve um registro por cliente — sem tocar em banco, para poder ser
 * conferido antes de importar.
 */

export interface CustomerImportPrice {
  /** Produto como veio da planilha (cabecalho da coluna ou celula). Resolvido na importacao. */
  product: string;
  unitPriceCents: number;
}

export interface CustomerImportRecord {
  /** Linha de origem na planilha, para o relatorio apontar onde corrigir. */
  sourceLine: number;
  tradeName: string;
  legalName: string | null;
  document: string | null;
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  observations: string | null;
  creditLimitCents: number | null;
  nfRequired: boolean | null;
  prices: CustomerImportPrice[];
}

export type CustomerFieldKey =
  | "tradeName"
  | "legalName"
  | "document"
  | "phone"
  | "email"
  | "zipcode"
  | "addressStreet"
  | "addressNumber"
  | "addressComplement"
  | "neighborhood"
  | "city"
  | "state"
  | "observations"
  | "creditLimit"
  | "nfRequired"
  | "product"
  | "price";

/** Aliases de cabecalho, ja normalizados (minusculo, sem acento, sem pontuacao). */
const HEADER_ALIASES: Record<CustomerFieldKey, string[]> = {
  tradeName: [
    "nome fantasia",
    "fantasia",
    "nome",
    "cliente",
    "nome do cliente",
    "nome cliente",
    "apelido"
  ],
  legalName: ["razao social", "razao", "nome empresarial", "empresa"],
  document: ["cnpj", "cpf", "cnpj cpf", "cpf cnpj", "documento", "doc", "cnpj ou cpf"],
  phone: ["telefone", "fone", "celular", "whatsapp", "tel", "telefone 1", "contato telefone"],
  email: ["email", "e mail", "emails", "e mails", "email nfe", "email nf e"],
  zipcode: ["cep"],
  addressStreet: ["endereco", "logradouro", "rua", "av", "avenida"],
  addressNumber: ["numero", "num", "nro", "n"],
  addressComplement: ["complemento", "compl"],
  neighborhood: ["bairro"],
  city: ["cidade", "municipio"],
  state: ["uf", "estado"],
  observations: ["observacao", "observacoes", "obs", "observacoes internas"],
  creditLimit: ["limite de credito", "limite credito", "limite"],
  nfRequired: ["exige nota fiscal", "exige nf", "nota fiscal", "nf", "emite nf"],
  product: ["produto", "material", "descricao do produto", "item vendido", "mercadoria"],
  price: [
    "preco",
    "valor",
    "preco unitario",
    "valor unitario",
    "preco por tonelada",
    "preco ton",
    "valor ton",
    "preco tonelada",
    "vlr"
  ]
};

/** Colunas de controle da planilha que nao viram nem campo nem produto. */
const IGNORED_ALIASES = new Set([
  "codigo",
  "cod",
  "id",
  "ordem",
  "seq",
  "sequencia",
  "linha",
  "status",
  "situacao",
  "data",
  "data cadastro",
  "vendedor",
  "responsavel"
]);

const PRICE_PREFIX = /^(?:precos?|valor(?:es)?|vlr|pr)\b[\s.:-]*(?:por|de|do|da)?\s*/;

export function normalizeHeader(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

export interface CustomerColumnMap {
  /** Campo do cadastro -> cabecalho original da coluna. */
  fields: Partial<Record<CustomerFieldKey, string>>;
  /** Colunas que viraram preco de um produto (formato largo: uma coluna por produto). */
  priceColumns: Array<{ header: string; product: string }>;
  /** Formato longo: uma linha por (cliente, produto). */
  longFormat: { productHeader: string; priceHeader: string } | null;
  /** Colunas ignoradas — o CLI mostra para o operador conferir. */
  ignored: string[];
}

export interface DetectColumnsOptions {
  /** Cabecalhos forcados como preco de produto (quando a heuristica erra). */
  priceColumns?: string[];
  /** Cabecalhos a ignorar sempre. */
  ignoreColumns?: string[];
}

/**
 * Descobre o significado de cada coluna. Alem dos aliases, qualquer coluna desconhecida
 * cujos valores sejam dinheiro vira preco do produto com o nome da coluna — e o formato
 * que as planilhas comerciais usam ("BRITA 1", "PO DE PEDRA", uma coluna por produto).
 */
export function detectCustomerColumns(
  table: SheetTable,
  options: DetectColumnsOptions = {}
): CustomerColumnMap {
  const forcedPrices = new Set((options.priceColumns ?? []).map(normalizeHeader));
  const forcedIgnore = new Set((options.ignoreColumns ?? []).map(normalizeHeader));

  const fields: Partial<Record<CustomerFieldKey, string>> = {};
  const priceColumns: Array<{ header: string; product: string }> = [];
  const ignored: string[] = [];

  for (const header of table.headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;

    if (forcedIgnore.has(normalized)) {
      ignored.push(header);
      continue;
    }

    if (forcedPrices.has(normalized)) {
      priceColumns.push({ header, product: stripPricePrefix(header) });
      continue;
    }

    const fieldKey = matchFieldAlias(normalized);
    if (fieldKey && fields[fieldKey] === undefined) {
      fields[fieldKey] = header;
      continue;
    }
    if (fieldKey) {
      // Segunda coluna com o mesmo significado (ex.: "Telefone 2"): nao sobrescreve.
      ignored.push(header);
      continue;
    }

    if (IGNORED_ALIASES.has(normalized)) {
      ignored.push(header);
      continue;
    }

    const withoutPrefix = stripPricePrefix(header);
    const looksLikePrefixedPrice = normalizeHeader(withoutPrefix) !== normalized;

    if (looksLikePrefixedPrice || columnLooksLikeMoney(table.rows, header)) {
      priceColumns.push({ header, product: withoutPrefix });
      continue;
    }

    ignored.push(header);
  }

  const longFormat =
    fields.product && fields.price
      ? { productHeader: fields.product, priceHeader: fields.price }
      : null;

  return { fields, priceColumns, longFormat, ignored };
}

function matchFieldAlias(normalizedHeader: string): CustomerFieldKey | null {
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [CustomerFieldKey, string[]]
  >) {
    if (aliases.includes(normalizedHeader)) return key;
  }
  return null;
}

/**
 * "Preco Brita 1" -> "Brita 1". O prefixo e procurado na versao sem acento (para pegar
 * "Preço"/"Preco"/"Valor"), mas o corte acontece no texto original — o nome do produto
 * precisa chegar na importacao exatamente como o operador escreveu.
 */
function stripPricePrefix(header: string): string {
  const trimmed = header.trim();
  const match = PRICE_PREFIX.exec(stripAccents(trimmed).toLowerCase());
  if (!match || match[0].length === 0) return trimmed;
  return trimmed.slice(match[0].length).trim() || trimmed;
}

/**
 * Valor que e SO dinheiro. `parseMoneyInputToCents` joga fora as letras antes de
 * converter, entao "30 dias" viraria R$ 30,00 — o que transformaria uma coluna de
 * condicao de pagamento em produto. Aqui a celula inteira precisa ser numero.
 */
function looksLikeMoneyValue(value: string): boolean {
  const cleaned = value
    .trim()
    .replace(/^r\$\s*/i, "")
    .replace(/\s/g, "");
  if (!cleaned) return false;

  return (
    /^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(cleaned) || // 1.234,56
    /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(cleaned) || // 1,234.56
    /^-?\d+(?:[.,]\d+)?$/.test(cleaned) // 1234 / 1234,56 / 1234.56
  );
}

/**
 * Uma coluna so vira preco quando TODOS os valores preenchidos sao dinheiro. Basta uma
 * celula com texto ("a combinar", "30 dias") para a coluna voltar a ser ignorada — melhor
 * pedir a coluna explicita ao operador do que inventar um produto a partir de texto solto.
 */
function columnLooksLikeMoney(rows: readonly SheetRow[], header: string): boolean {
  let filled = 0;
  for (const row of rows) {
    const value = row.cells[header];
    if (!value) continue;
    filled++;
    if (!looksLikeMoneyValue(value)) return false;
  }
  return filled > 0;
}

export interface ParseCustomerSheetOptions extends DetectColumnsOptions {
  /** Mapa de colunas ja resolvido (evita detectar duas vezes quando o CLI ja mostrou). */
  columns?: CustomerColumnMap;
}

export interface ParseCustomerSheetResult {
  records: CustomerImportRecord[];
  columns: CustomerColumnMap;
  warnings: string[];
}

export function parseCustomerSheet(
  table: SheetTable,
  options: ParseCustomerSheetOptions = {}
): ParseCustomerSheetResult {
  const columns = options.columns ?? detectCustomerColumns(table, options);
  const warnings: string[] = [];

  const nameHeader = columns.fields.tradeName ?? columns.fields.legalName;
  if (!nameHeader) {
    throw new Error(
      `A planilha "${table.name}" nao tem coluna de nome do cliente. Cabecalhos lidos: ${table.headers.join(", ") || "(nenhum)"}.`
    );
  }

  if (columns.fields.price && !columns.longFormat) {
    warnings.push(
      `A coluna "${columns.fields.price}" tem preco mas nao ha coluna de produto ao lado — ` +
        `nenhum preco foi lido dela. Renomeie para "Preco <produto>" ou adicione a coluna "Produto".`
    );
  }

  const byKey = new Map<string, CustomerImportRecord>();
  const records: CustomerImportRecord[] = [];

  for (const row of table.rows) {
    const tradeName = cleanText(row.cells[nameHeader]);
    const legalName = cleanText(readCell(row, columns.fields.legalName));
    const displayName = tradeName || legalName;

    if (!displayName) {
      warnings.push(`Linha ${row.lineNumber}: sem nome de cliente — ignorada.`);
      continue;
    }

    // Linhas do mesmo cliente (formato "uma linha por produto") se juntam num registro so.
    // O agrupamento e pelo CNPJ/CPF quando ele existe: duas empresas com o mesmo nome
    // fantasia — matriz e filial, ou o CPF do dono e o CNPJ da empresa dele — sao clientes
    // diferentes, e agrupar pelo nome faria um comer o cadastro do outro.
    const documentKey = normalizeDocument(readCell(row, columns.fields.document));
    const key = documentKey ? `documento:${documentKey}` : `nome:${normalizeMatchKey(displayName)}`;
    const existing = byKey.get(key);
    const record =
      existing ?? createEmptyRecord(row.lineNumber, tradeName || displayName, legalName);

    if (!existing) {
      applyFields(record, row, columns, warnings);
      byKey.set(key, record);
      records.push(record);
    }

    applyPrices(record, row, columns, warnings);
  }

  return { records, columns, warnings };
}

function createEmptyRecord(
  sourceLine: number,
  tradeName: string,
  legalName: string | null
): CustomerImportRecord {
  return {
    sourceLine,
    tradeName,
    legalName,
    document: null,
    phone: null,
    email: null,
    zipcode: null,
    addressStreet: null,
    addressNumber: null,
    addressComplement: null,
    neighborhood: null,
    city: null,
    state: null,
    observations: null,
    creditLimitCents: null,
    nfRequired: null,
    prices: []
  };
}

function applyFields(
  record: CustomerImportRecord,
  row: SheetRow,
  columns: CustomerColumnMap,
  warnings: string[]
): void {
  const rawDocument = readCell(row, columns.fields.document);
  if (rawDocument) {
    const digits = normalizeDocument(rawDocument);
    if (digits) record.document = digits;
  }

  const rawPhone = readCell(row, columns.fields.phone);
  if (rawPhone) {
    const digits = normalizePhone(rawPhone);
    record.phone = digits || null;
  }

  record.email = cleanText(readCell(row, columns.fields.email))?.toLowerCase() ?? null;
  record.zipcode = digitsOrNull(readCell(row, columns.fields.zipcode), 8);
  record.addressStreet = cleanText(readCell(row, columns.fields.addressStreet));
  record.addressNumber = cleanText(readCell(row, columns.fields.addressNumber));
  record.addressComplement = cleanText(readCell(row, columns.fields.addressComplement));
  record.neighborhood = cleanText(readCell(row, columns.fields.neighborhood));
  record.city = cleanText(readCell(row, columns.fields.city));

  const state = cleanText(readCell(row, columns.fields.state));
  record.state = state ? state.toUpperCase().slice(0, 2) : null;

  record.observations = cleanText(readCell(row, columns.fields.observations));

  const rawLimit = readCell(row, columns.fields.creditLimit);
  if (rawLimit) {
    const cents = parseMoneyInputToCents(rawLimit);
    if (cents === null) {
      warnings.push(
        `Linha ${row.lineNumber}: limite de credito "${rawLimit}" invalido — ignorado.`
      );
    } else {
      record.creditLimitCents = cents;
    }
  }

  const rawNf = readCell(row, columns.fields.nfRequired);
  if (rawNf) record.nfRequired = parseBoolean(rawNf);
}

function applyPrices(
  record: CustomerImportRecord,
  row: SheetRow,
  columns: CustomerColumnMap,
  warnings: string[]
): void {
  if (columns.longFormat) {
    const product = cleanText(row.cells[columns.longFormat.productHeader]);
    const rawPrice = row.cells[columns.longFormat.priceHeader];
    if (product && rawPrice) {
      addPrice(record, product, rawPrice, row.lineNumber, warnings);
    }
    return;
  }

  for (const column of columns.priceColumns) {
    const rawPrice = row.cells[column.header];
    if (rawPrice) addPrice(record, column.product, rawPrice, row.lineNumber, warnings);
  }
}

function addPrice(
  record: CustomerImportRecord,
  product: string,
  rawPrice: string,
  lineNumber: number,
  warnings: string[]
): void {
  const cents = looksLikeMoneyValue(rawPrice) ? parseMoneyInputToCents(rawPrice) : null;
  if (cents === null || cents <= 0) {
    warnings.push(`Linha ${lineNumber}: preco "${rawPrice}" de "${product}" invalido — ignorado.`);
    return;
  }

  const existing = record.prices.find(
    (price) => normalizeMatchKey(price.product) === normalizeMatchKey(product)
  );
  if (existing) {
    existing.unitPriceCents = cents;
    return;
  }

  record.prices.push({ product, unitPriceCents: cents });
}

function readCell(row: SheetRow, header: string | undefined): string {
  return header ? (row.cells[header] ?? "") : "";
}

function cleanText(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

function digitsOrNull(value: string, length: number): string | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, length);
  return digits.length === length ? digits : null;
}

function parseBoolean(value: string): boolean | null {
  const normalized = normalizeHeader(value);
  if (["sim", "s", "1", "true", "verdadeiro", "x"].includes(normalized)) return true;
  if (["nao", "n", "0", "false", "falso"].includes(normalized)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Conciliacao das duas planilhas
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = [
  "ltda me",
  "ltda epp",
  "ltda",
  "eireli",
  "epp",
  "mei",
  "me",
  "sa",
  "s a",
  "cia",
  "comercio ltda"
];

/**
 * Chave de comparacao de nomes: sem acento, sem pontuacao, sem sufixo societario. E o que
 * permite casar "Pedreira Sao Joao LTDA" (planilha de CNPJ) com "PEDREIRA SAO JOAO"
 * (planilha comercial).
 */
export function normalizeMatchKey(name: string): string {
  let key = stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  for (const suffix of LEGAL_SUFFIXES) {
    if (key.endsWith(` ${suffix}`)) {
      key = key.slice(0, key.length - suffix.length - 1).trim();
    }
  }

  return key.replace(/\s+/g, " ");
}

/** Coeficiente de Dice sobre bigramas — tolera erro de digitacao e abreviacao. */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizeMatchKey(left);
  const b = normalizeMatchKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  // "transportes silva" dentro de "transportes silva e filhos": um nome e o outro
  // com complemento, nao dois clientes diferentes.
  if (shorter.length >= 8 && longer.includes(shorter)) return 0.92;

  const leftBigrams = toBigrams(a);
  const rightBigrams = toBigrams(b);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;

  let shared = 0;
  for (const [bigram, count] of leftBigrams) {
    shared += Math.min(count, rightBigrams.get(bigram) ?? 0);
  }

  const leftTotal = [...leftBigrams.values()].reduce((sum, count) => sum + count, 0);
  const rightTotal = [...rightBigrams.values()].reduce((sum, count) => sum + count, 0);
  return (2 * shared) / (leftTotal + rightTotal);
}

function toBigrams(value: string): Map<string, number> {
  const bigrams = new Map<string, number>();
  const compact = value.replace(/\s+/g, "");
  for (let index = 0; index < compact.length - 1; index++) {
    const bigram = compact.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}

export interface DocumentSheetEntry {
  sourceLine: number;
  name: string;
  legalName: string | null;
  document: string;
}

export function parseDocumentSheet(
  table: SheetTable,
  options: DetectColumnsOptions = {}
): { entries: DocumentSheetEntry[]; warnings: string[] } {
  const columns = detectCustomerColumns(table, options);
  const nameHeader = columns.fields.tradeName ?? columns.fields.legalName;
  const documentHeader = columns.fields.document;
  const warnings: string[] = [];

  if (!nameHeader) {
    throw new Error(
      `A planilha "${table.name}" nao tem coluna de nome. Cabecalhos lidos: ${table.headers.join(", ") || "(nenhum)"}.`
    );
  }
  if (!documentHeader) {
    throw new Error(
      `A planilha "${table.name}" nao tem coluna de CNPJ/CPF. Cabecalhos lidos: ${table.headers.join(", ") || "(nenhum)"}.`
    );
  }

  const entries: DocumentSheetEntry[] = [];

  for (const row of table.rows) {
    const name = cleanText(row.cells[nameHeader]);
    const document = normalizeDocument(row.cells[documentHeader] ?? "");

    if (!name) {
      warnings.push(`Linha ${row.lineNumber}: sem nome — ignorada.`);
      continue;
    }
    if (!document) {
      warnings.push(`Linha ${row.lineNumber}: "${name}" esta sem CNPJ/CPF — ignorada.`);
      continue;
    }

    entries.push({
      sourceLine: row.lineNumber,
      name,
      legalName: cleanText(readCell(row, columns.fields.legalName)),
      document
    });
  }

  return { entries, warnings };
}

export interface MergeCustomerSheetsOptions {
  /** Similaridade minima para casar nomes diferentes. Padrao 0.86. */
  similarityThreshold?: number;
}

export interface MergeCustomerSheetsResult {
  records: CustomerImportRecord[];
  matched: Array<{ customer: string; matchedName: string; document: string; score: number }>;
  /** Clientes que ficaram sem CNPJ/CPF (com o palpite mais proximo, se houver). */
  withoutDocument: Array<{
    sourceLine: number;
    customer: string;
    bestCandidate: string | null;
    bestScore: number;
  }>;
  /** Linhas da planilha de documentos que nao casaram com nenhum cliente. */
  unusedDocuments: DocumentSheetEntry[];
  warnings: string[];
}

/**
 * Junta a planilha comercial (contato + precos) com a de CNPJ/CPF pelo nome do cliente.
 * Casamento exato primeiro; o restante por similaridade, e so quando o melhor candidato
 * esta claramente na frente do segundo — empate vira pendencia no relatorio, nunca um
 * CNPJ chutado no cadastro errado.
 */
export function mergeCustomerSheets(
  records: readonly CustomerImportRecord[],
  documents: readonly DocumentSheetEntry[],
  options: MergeCustomerSheetsOptions = {}
): MergeCustomerSheetsResult {
  const threshold = options.similarityThreshold ?? 0.86;
  const warnings: string[] = [];
  const matched: MergeCustomerSheetsResult["matched"] = [];
  const withoutDocument: MergeCustomerSheetsResult["withoutDocument"] = [];
  const used = new Set<DocumentSheetEntry>();

  const byKey = new Map<string, DocumentSheetEntry[]>();
  for (const entry of documents) {
    const key = normalizeMatchKey(entry.name);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(entry);
    else byKey.set(key, [entry]);
  }

  const merged = records.map((record) => ({ ...record, prices: [...record.prices] }));

  for (const record of merged) {
    const name = record.tradeName || record.legalName || "";

    if (record.document) {
      // A planilha comercial ja trouxe o documento: ele manda. Ainda assim marcamos a
      // linha correspondente como usada, para nao aparecer como "sobrou" no relatorio.
      const sameDocument = documents.find((entry) => entry.document === record.document);
      if (sameDocument) used.add(sameDocument);
      continue;
    }

    const exact = byKey.get(normalizeMatchKey(name)) ?? [];
    if (exact.length === 1) {
      applyDocument(record, exact[0]);
      used.add(exact[0]);
      matched.push({
        customer: name,
        matchedName: exact[0].name,
        document: exact[0].document,
        score: 1
      });
      continue;
    }
    if (exact.length > 1) {
      const distinct = new Set(exact.map((entry) => entry.document));
      if (distinct.size === 1) {
        applyDocument(record, exact[0]);
        exact.forEach((entry) => used.add(entry));
        matched.push({
          customer: name,
          matchedName: exact[0].name,
          document: exact[0].document,
          score: 1
        });
        continue;
      }
      warnings.push(
        `"${name}" aparece com ${distinct.size} CNPJ/CPF diferentes na planilha de documentos — deixado sem documento.`
      );
      withoutDocument.push({
        sourceLine: record.sourceLine,
        customer: name,
        bestCandidate: exact[0].name,
        bestScore: 1
      });
      continue;
    }

    let best: DocumentSheetEntry | null = null;
    let bestScore = 0;
    let runnerUpScore = 0;

    for (const entry of documents) {
      const score = nameSimilarity(name, entry.name);
      if (score > bestScore) {
        runnerUpScore = bestScore;
        bestScore = score;
        best = entry;
      } else if (score > runnerUpScore) {
        runnerUpScore = score;
      }
    }

    // Margem sobre o segundo colocado: sem ela, "Transportadora Sul" e "Transportadora
    // Norte" (quase identicos) sorteariam o CNPJ um do outro.
    if (best && bestScore >= threshold && bestScore - runnerUpScore >= 0.05) {
      applyDocument(record, best);
      used.add(best);
      matched.push({
        customer: name,
        matchedName: best.name,
        document: best.document,
        score: Number(bestScore.toFixed(3))
      });
      continue;
    }

    withoutDocument.push({
      sourceLine: record.sourceLine,
      customer: name,
      bestCandidate: best?.name ?? null,
      bestScore: Number(bestScore.toFixed(3))
    });
  }

  return {
    records: merged,
    matched,
    withoutDocument,
    unusedDocuments: documents.filter((entry) => !used.has(entry)),
    warnings
  };
}

function applyDocument(record: CustomerImportRecord, entry: DocumentSheetEntry): void {
  record.document = entry.document;
  if (!record.legalName) {
    record.legalName = entry.legalName ?? entry.name;
  }
}

// ---------------------------------------------------------------------------
// Saida consolidada
// ---------------------------------------------------------------------------

const CSV_FIELDS: Array<[string, (record: CustomerImportRecord) => string]> = [
  ["CNPJ/CPF", (record) => record.document ?? ""],
  ["Nome fantasia", (record) => record.tradeName],
  ["Razao social", (record) => record.legalName ?? ""],
  ["Telefone", (record) => record.phone ?? ""],
  ["E-mail", (record) => record.email ?? ""],
  ["CEP", (record) => record.zipcode ?? ""],
  ["Endereco", (record) => record.addressStreet ?? ""],
  ["Numero", (record) => record.addressNumber ?? ""],
  ["Complemento", (record) => record.addressComplement ?? ""],
  ["Bairro", (record) => record.neighborhood ?? ""],
  ["Cidade", (record) => record.city ?? ""],
  ["UF", (record) => record.state ?? ""],
  ["Limite de credito", (record) => formatCents(record.creditLimitCents)],
  [
    "Exige nota fiscal",
    (record) => (record.nfRequired === null ? "" : record.nfRequired ? "Sim" : "Nao")
  ],
  ["Observacoes", (record) => record.observations ?? ""]
];

/**
 * Planilha unica com CNPJ + todos os dados + uma coluna "Preco <produto>" por produto.
 * A saida e relida pelo proprio importador (o prefixo "Preco " marca a coluna de preco),
 * entao o operador pode corrigir o arquivo no Excel antes de importar.
 */
export function customerRecordsToCsv(
  records: readonly CustomerImportRecord[],
  delimiter = ";"
): string {
  const products: string[] = [];
  const productKeys = new Set<string>();

  for (const record of records) {
    for (const price of record.prices) {
      const key = normalizeMatchKey(price.product);
      if (!productKeys.has(key)) {
        productKeys.add(key);
        products.push(price.product);
      }
    }
  }

  const rows: string[][] = [
    [...CSV_FIELDS.map(([label]) => label), ...products.map((name) => `Preco ${name}`)]
  ];

  for (const record of records) {
    const cells = CSV_FIELDS.map(([, read]) => read(record));
    for (const product of products) {
      const key = normalizeMatchKey(product);
      const price = record.prices.find((item) => normalizeMatchKey(item.product) === key);
      cells.push(price ? formatCents(price.unitPriceCents) : "");
    }
    rows.push(cells);
  }

  return toCsvFile(rows, delimiter);
}

function formatCents(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
