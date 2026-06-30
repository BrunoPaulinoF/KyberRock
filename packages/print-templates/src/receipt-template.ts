export interface ReceiptTemplateInput {
  companyName: string;
  companyDocument: string | null;
  companyStateRegistration: string | null;
  unitName: string;
  receiptNumber: number;
  copyNumber: number;
  printedAt: string;
  operationId: string;
  operationType: "invoice" | "internal";
  customerName: string;
  customerDocument: string | null;
  customerPhone: string | null;
  customerZipCode: string | null;
  customerCity: string | null;
  customerState: string | null;
  productCode: string | null;
  productDescription: string;
  plate: string;
  driverName: string;
  paymentTermName: string | null;
  entryCapturedAt: string;
  exitCapturedAt: string;
  permanenceLabel: string;
  entryWeightKg: number;
  exitWeightKg: number;
  netWeightKg: number;
  unitPriceCents: number | null;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
}

export function buildReceiptLines(input: ReceiptTemplateInput): string[] {
  const productLabel = [input.productCode, input.productDescription].filter(Boolean).join("-");
  const customerLocation = [input.customerZipCode, formatCityState(input.customerCity, input.customerState)]
    .filter(Boolean)
    .join("-");
  const quantityTon = input.netWeightKg / 1000;
  const lines = [
    input.companyName.toUpperCase(),
    divider(),
    input.unitName.toUpperCase(),
    `DATA: ${formatDate(input.printedAt)}  HORA: ${formatTime(input.printedAt)}`,
    `COPIA NRO ${input.receiptNumber.toString().padStart(9, "0")}`,
    input.copyNumber > 1 ? `${input.copyNumber}a VIA` : "1a VIA",
    divider(),
    input.companyName.toUpperCase(),
    formatCompanyDocuments(input.companyDocument, input.companyStateRegistration),
    divider(),
    `CODIGO.: ${input.operationId.slice(0, 13).toUpperCase()}`,
    `Cliente: ${input.customerName}`,
    customerLocation ? `CEP: ${customerLocation}` : "CEP:",
    `Telefone: ${input.customerPhone ?? ""}`,
    input.customerDocument ? `Documento: ${input.customerDocument}` : "Documento:",
    divider(),
    productLabel.toUpperCase(),
    "  Quantidade |   Unitario R$ |   Total R$",
    `  ${formatTon(quantityTon)} TN | ${formatDecimalMoney(input.unitPriceCents)} | ${formatNumber(input.productTotalCents / 100)}`,
    divider(),
    `TOTAL DA VENDA - Itens (1) R$ ${formatNumber(input.productTotalCents / 100)}`,
    input.freightTotalCents > 0 ? `FRETE R$ ${formatNumber(input.freightTotalCents / 100)}` : null,
    `Cond.Pagto.: ${input.paymentTermName ?? "NAO INFORMADA"}`,
    divider(),
    `ENTRADA <TARA>: ${formatTon(input.entryWeightKg / 1000)} <TON>` ,
    `SAIDA <CARREGADO>: ${formatTon(input.exitWeightKg / 1000)} <TON>`,
    `LIQUIDO: ${formatTon(input.netWeightKg / 1000)} <TON>`,
    `Entrada: ${formatDateTime(input.entryCapturedAt)}`,
    `Saida: ${formatDateTime(input.exitCapturedAt)}`,
    `Permanencia: ${input.permanenceLabel}`,
    divider(),
    "FINANCEIRO",
    `VENCTO: ${formatDate(input.printedAt)} - VALOR R$ ${formatNumber(input.totalCents / 100)}`,
    divider(),
    `Data: ${formatDateTime(input.printedAt)} | Assinatura do Recebimento`,
    "",
    `Veiculo: ${input.plate}`,
    `Motorista: ${input.driverName}`,
    dashed(),
    "AGRADECEMOS PELA PREFERENCIA! VOLTE SEMPRE",
    dashed()
  ].filter((line): line is string => line !== null);

  return lines;
}

function divider(): string {
  return "------------------------------------------------";
}

function dashed(): string {
  return "------------------------------------------------";
}

function formatCompanyDocuments(document: string | null, stateRegistration: string | null): string {
  return [document, stateRegistration].filter(Boolean).join(" - ");
}

function formatCityState(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join("/");
}

function formatTon(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}

function formatDecimalMoney(valueCents: number | null): string {
  if (valueCents === null) return "0,0000";
  return (valueCents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}
