// Nota de entrega futura: o que a NF-e emitida no OMIE diz sobre produto e volume.
//
// Na ficha do cliente (aba Entrega futura) a pessoa digita o NUMERO da nota; o resto — qual
// produto e quanto a nota faturou — ja esta na propria nota, no OMIE. A `omie-sync` lista a
// nota pelo numero (`ListarNF` com `nNFInicial`/`nNFFinal`) e esta parte le a resposta.
//
// A estrutura e a do cadastro de notas do OMIE (`/produtos/nfconsultar/`): `ide.nNF` (numero,
// com zeros a esquerda), `ide.serie`, `ide.dEmi`, `nfDestInt.nCodCli` (cliente) e `det[]`, cada
// item com `prod` (`cProd`, `xProd`, `qCom`, `uCom`) e `nfProdInt.nCodProd` (produto no OMIE).
//
// Puro (sem Deno/fetch) para ser testado com vitest, como `omie-customer-advances.ts`.

export interface OmieInvoiceItem {
  /** Codigo do produto no OMIE (`nfProdInt.nCodProd`) — casa com `products.omie_product_id`. */
  omieProductId: number | null;
  /** Codigo do produto como sai na nota (`prod.cProd`). */
  code: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  /** A quantidade em quilos, quando a unidade e de peso (t, kg); null em m3, unidade... */
  weightKg: number | null;
}

export interface OmieInvoice {
  /** Sem os zeros a esquerda — o mesmo formato que a conferencia grava. */
  invoiceNumber: string;
  series: string | null;
  /** aaaa-mm-dd */
  issueDate: string | null;
  omieCustomerId: number | null;
  customerName: string | null;
  cancelled: boolean;
  items: OmieInvoiceItem[];
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function positiveInt(value: unknown): number | null {
  const number = Number(text(value));
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** "30,5" e 30.5 viram 30.5. */
function decimal(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const number = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(number) ? number : null;
}

/**
 * O numero da nota digitado ou lido do OMIE, so com os digitos e sem os zeros a esquerda
 * ("000029490" e "29.490" viram "29490"). Null quando nao sobra numero.
 */
export function normalizeInvoiceNumber(value: unknown): string | null {
  const digits = (text(value) ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits ? digits : null;
}

/** Unidade sem acento, ponto nem espaco, em maiuscula ("Ton." -> "TON"). */
function unitKey(unit: string | null): string {
  return (unit ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
}

const TON_UNITS = new Set(["T", "TN", "TO", "TON", "TONS", "TONELADA", "TONELADAS"]);
const KG_UNITS = new Set(["KG", "KGS", "QUILO", "QUILOS", "KILO", "KILOS", "QUILOGRAMA"]);

/**
 * A quantidade da nota em quilos — o que o campo "Total da nota (kg)" guarda. So unidade de
 * peso vira quilo: m3 e unidade nao tem conversao honesta sem a densidade, e um numero
 * inventado ali baixaria o saldo da nota errado a cada pesagem.
 */
export function quantityToKg(quantity: number, unit: string | null): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const key = unitKey(unit);
  if (TON_UNITS.has(key)) return Math.round(quantity * 1000 * 1000) / 1000;
  if (KG_UNITS.has(key)) return Math.round(quantity * 1000) / 1000;
  return null;
}

/** "dd/mm/aaaa" -> "aaaa-mm-dd". */
function isoDate(value: unknown): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text(value) ?? "");
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Data de cancelamento/inutilizacao preenchida (nem vazia, nem so zeros). */
function hasDate(value: unknown): boolean {
  const raw = text(value);
  return raw !== null && !/^0+$/.test(raw.replace(/\D/g, ""));
}

function parseItem(raw: unknown): OmieInvoiceItem | null {
  const item = asObject(raw);
  if (!item) return null;
  const prod = asObject(item.prod) ?? item;
  const integration = asObject(item.nfProdInt) ?? {};
  const description = text(prod.xProd) ?? text(prod.descricao);
  const quantity = decimal(prod.qCom) ?? decimal(prod.qTrib) ?? decimal(prod.quantidade);
  if (!description || quantity === null) return null;
  const unit = text(prod.uCom) ?? text(prod.uTrib) ?? text(prod.unidade);
  return {
    omieProductId: positiveInt(integration.nCodProd) ?? positiveInt(prod.nCodProd),
    code: text(prod.cProd) ?? text(integration.cCodProdInt),
    description,
    quantity,
    unit,
    weightKg: quantityToKg(quantity, unit)
  };
}

/** Uma nota do cadastro de notas do OMIE. Null quando nao tem numero. */
export function parseOmieInvoice(raw: unknown): OmieInvoice | null {
  const record = asObject(raw);
  if (!record) return null;
  const ide = asObject(record.ide) ?? {};
  const dest = asObject(record.nfDestInt) ?? {};
  const invoiceNumber = normalizeInvoiceNumber(ide.nNF);
  if (!invoiceNumber) return null;
  const details = Array.isArray(record.det) ? record.det : [];
  return {
    invoiceNumber,
    series: text(ide.serie),
    issueDate: isoDate(ide.dEmi),
    omieCustomerId: positiveInt(dest.nCodCli),
    customerName: text(dest.cRazao) ?? text(dest.razao_social),
    cancelled:
      hasDate(ide.dCan) || hasDate(ide.dInut) || (text(ide.cDeneg) ?? "").toUpperCase() === "S",
    items: details.map(parseItem).filter((item): item is OmieInvoiceItem => item !== null)
  };
}

/**
 * As notas de uma resposta de `ListarNF` com aquele numero. A listagem ja vem filtrada pelo
 * numero, mas a conferencia e feita de novo aqui: se o OMIE ignorasse o filtro, a tela
 * preencheria o produto de OUTRA nota — o pior erro possivel, porque parece certo. Nota
 * cancelada fica de fora pelo mesmo motivo. Mais de uma (series diferentes) volta inteira, e
 * quem pergunta escolhe.
 */
export function invoicesWithNumber(response: unknown, invoiceNumber: string): OmieInvoice[] {
  const wanted = normalizeInvoiceNumber(invoiceNumber);
  if (!wanted) return [];
  return invoiceRecords(response)
    .map(parseOmieInvoice)
    .filter(
      (invoice): invoice is OmieInvoice =>
        invoice !== null && invoice.invoiceNumber === wanted && !invoice.cancelled
    );
}

/** O array de notas da resposta (`nfCadastro`, ou o primeiro array de objetos). */
function invoiceRecords(response: unknown): unknown[] {
  const record = asObject(response);
  if (!record) return [];
  for (const key of ["nfCadastro", "nf_cadastro", "nfsCadastro"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  // `ConsultarNF` devolve a propria nota, sem envelope.
  if (asObject(record.ide)) return [record];
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.some((item) => asObject(item))) return value;
  }
  return [];
}

/** O produto do cadastro, como o casamento precisa dele. */
export interface InvoiceLocalProduct {
  id: string;
  description: string;
  code: string | null;
  omieProductId: number | null;
}

/**
 * O produto do cadastro que corresponde ao item da nota: pelo codigo do OMIE (`nCodProd`, o
 * mesmo `omie_product_id` que o pull grava) e, sem ele, pelo codigo do produto. Nome nao casa:
 * "BRITA 1" e "BRITA 1 LAVADA" sao produtos diferentes, e errar aqui carimbaria a nota no
 * produto errado. Sem casamento, a tela pede para escolher.
 */
export function matchInvoiceProduct<T extends InvoiceLocalProduct>(
  item: Pick<OmieInvoiceItem, "omieProductId" | "code">,
  products: readonly T[]
): T | null {
  if (item.omieProductId !== null) {
    const byOmie = products.find((product) => product.omieProductId === item.omieProductId);
    if (byOmie) return byOmie;
  }
  const code = (item.code ?? "").trim().toUpperCase();
  if (!code) return null;
  return products.find((product) => (product.code ?? "").trim().toUpperCase() === code) ?? null;
}
