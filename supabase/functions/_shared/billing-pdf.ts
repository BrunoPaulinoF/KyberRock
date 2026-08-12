// Fatura em PDF (A4) da mensalidade da plataforma.
//
// Reaproveita o `buildTablePdf` de `pdf.ts` (pdf-lib puro, sem Chromium — ver o
// comentario de la sobre o Deno Deploy). O documento e simples de proposito: a
// cobranca legal e o boleto do Mercado Pago; este PDF e o demonstrativo que o
// financeiro da pedreira arquiva e recebe junto no WhatsApp.
//
// Depende de `npm:pdf-lib` via `./pdf.ts`, entao NAO tem `_test.ts` — o vitest
// carregaria o especificador `npm:` e quebraria. O que da para testar sem PDF
// (textos, valores, datas) vive em `billing-invoice.ts`.
import { buildTablePdf } from "./pdf.ts";
import { formatCents, formatDateBr } from "./billing-invoice.ts";

export interface InvoicePdfInput {
  issuerName: string;
  issuerDocument?: string | null;
  issuerEmail?: string | null;
  issuerPhone?: string | null;
  issuerPixKey?: string | null;
  invoiceNumber: string;
  referenceLabel: string;
  status: string;
  companyName: string;
  customerLegalName: string;
  customerDocument: string;
  customerAddress: string;
  periodStart: string;
  periodEnd: string;
  closingDate: string;
  dueDate: string;
  baseAmountCents: number;
  discountCents: number;
  additionCents: number;
  amountCents: number;
  isProrated: boolean;
  proratedDays?: number | null;
  fullPeriodDays?: number | null;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
  notes?: string | null;
  generatedAtLabel: string;
}

/** Rotulo + valor: a tabela generica do `pdf.ts` so desenha linhas, entao a fatura vira duas colunas. */
const COLUMNS = [
  { header: "Descricao", width: 330 },
  { header: "Detalhe", width: 193.28, align: "right" as const }
];

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const rows: string[][] = [
    ["Situacao", input.status],
    ["Pedreira", input.companyName],
    ["Razao social", input.customerLegalName],
    ["CNPJ/CPF", input.customerDocument || "-"],
    ["Endereco", input.customerAddress || "-"],
    ["", ""],
    ["Periodo de uso", `${formatDateBr(input.periodStart)} a ${formatDateBr(input.periodEnd)}`],
    ["Fechamento", formatDateBr(input.closingDate)],
    ["Vencimento", formatDateBr(input.dueDate)],
    ["", ""],
    ["Mensalidade contratada", formatCents(input.baseAmountCents)]
  ];

  if (input.isProrated && input.proratedDays && input.fullPeriodDays) {
    rows.push(["Proporcional ao periodo", `${input.proratedDays} de ${input.fullPeriodDays} dias`]);
  }
  if (input.additionCents > 0) rows.push(["Acrescimo", formatCents(input.additionCents)]);
  if (input.discountCents > 0) rows.push(["Desconto", `- ${formatCents(input.discountCents)}`]);

  rows.push(["", ""], ["TOTAL A PAGAR", formatCents(input.amountCents)]);

  if (input.boletoBarcode) {
    rows.push(["", ""], ["Linha digitavel", input.boletoBarcode]);
  }
  if (input.boletoUrl) {
    rows.push(["Boleto", input.boletoUrl]);
  }
  if (input.issuerPixKey) {
    rows.push(["PIX", input.issuerPixKey]);
  }
  if (input.notes) {
    rows.push(["", ""], ["Observacoes", input.notes]);
  }

  const issuerParts = [
    input.issuerName,
    input.issuerDocument ? `CNPJ ${input.issuerDocument}` : "",
    input.issuerEmail ?? "",
    input.issuerPhone ?? ""
  ].filter((part) => part && part.trim().length > 0);

  return buildTablePdf({
    title: `Fatura ${input.invoiceNumber} — Referencia ${input.referenceLabel}`,
    subtitle: issuerParts.join(" • "),
    generatedAtLabel: input.generatedAtLabel,
    columns: COLUMNS,
    rows,
    emptyMessage: "Fatura sem itens.",
    footerNote:
      "Documento gerado automaticamente pelo backoffice financeiro do KyberRock. O pagamento e feito pelo boleto do Mercado Pago."
  });
}

/** PDF em base64, formato aceito pelo anexo do UAZAPI e pelo download do painel. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
