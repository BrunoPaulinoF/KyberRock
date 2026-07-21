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
  paymentMethodName: string | null;
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

export interface ReceiptTemplateConfig {
  mode: "default" | "custom";
  showCompanyHeader: boolean;
  showCopyInfo: boolean;
  showCustomerInfo: boolean;
  showProductDetail: boolean;
  showFreight: boolean;
  showWeights: boolean;
  showEntryExitTimes: boolean;
  showPermanence: boolean;
  showFinancial: boolean;
  showSignature: boolean;
  showVehicleDriver: boolean;
  showFooter: boolean;
  customHeaderText: string;
  customFooterText: string;
}

export const DEFAULT_RECEIPT_TEMPLATE_CONFIG: ReceiptTemplateConfig = {
  mode: "default",
  showCompanyHeader: true,
  showCopyInfo: true,
  showCustomerInfo: true,
  showProductDetail: true,
  showFreight: true,
  showWeights: true,
  showEntryExitTimes: true,
  showPermanence: true,
  showFinancial: true,
  showSignature: true,
  showVehicleDriver: true,
  showFooter: true,
  customHeaderText: "",
  customFooterText: ""
};

export function normalizeReceiptTemplateConfig(
  config: Partial<ReceiptTemplateConfig> | null | undefined
): ReceiptTemplateConfig {
  if (!config) return { ...DEFAULT_RECEIPT_TEMPLATE_CONFIG };
  return {
    mode: config.mode === "custom" ? "custom" : "default",
    showCompanyHeader: config.showCompanyHeader ?? true,
    showCopyInfo: config.showCopyInfo ?? true,
    showCustomerInfo: config.showCustomerInfo ?? true,
    showProductDetail: config.showProductDetail ?? true,
    showFreight: config.showFreight ?? true,
    showWeights: config.showWeights ?? true,
    showEntryExitTimes: config.showEntryExitTimes ?? true,
    showPermanence: config.showPermanence ?? true,
    showFinancial: config.showFinancial ?? true,
    showSignature: config.showSignature ?? true,
    showVehicleDriver: config.showVehicleDriver ?? true,
    showFooter: config.showFooter ?? true,
    customHeaderText: config.customHeaderText ?? "",
    customFooterText: config.customFooterText ?? ""
  };
}

export function buildReceiptLines(input: ReceiptTemplateInput): string[] {
  return buildReceiptLinesWithConfig(input, DEFAULT_RECEIPT_TEMPLATE_CONFIG);
}

export function buildReceiptLinesWithConfig(
  input: ReceiptTemplateInput,
  config: ReceiptTemplateConfig
): string[] {
  const productLabel = [input.productCode, input.productDescription].filter(Boolean).join("-");
  const customerLocation = [input.customerZipCode, formatCityState(input.customerCity, input.customerState)]
    .filter(Boolean)
    .join("-");
  const quantityTon = input.netWeightKg / 1000;
  const lines: (string | null)[] = [];

  if (config.customHeaderText.trim()) {
    lines.push(config.customHeaderText.trim().toUpperCase());
  }

  if (config.showCompanyHeader) {
    lines.push(
      input.companyName.toUpperCase(),
      divider(),
      input.unitName.toUpperCase(),
      `DATA: ${formatDate(input.printedAt)}  HORA: ${formatTime(input.printedAt)}`
    );
  }

  if (config.showCopyInfo) {
    lines.push(
      `COPIA NRO ${input.receiptNumber.toString().padStart(9, "0")}`,
      input.copyNumber > 1 ? `${input.copyNumber}a VIA` : "1a VIA"
    );
  }

  if (config.showCompanyHeader || config.showCopyInfo) {
    lines.push(divider());
  }

  if (config.showCompanyHeader) {
    lines.push(
      input.companyName.toUpperCase(),
      formatCompanyDocuments(input.companyDocument, input.companyStateRegistration),
      divider()
    );
  }

  if (config.showCustomerInfo) {
    lines.push(
      `CODIGO.: ${input.operationId.slice(0, 13).toUpperCase()}`,
      `Cliente: ${input.customerName}`,
      customerLocation ? `CEP: ${customerLocation}` : "CEP:",
      `Telefone: ${input.customerPhone ?? ""}`,
      input.customerDocument ? `Documento: ${input.customerDocument}` : "Documento:",
      divider()
    );
  }

  if (config.showProductDetail) {
    lines.push(
      productLabel.toUpperCase(),
      threeColumns("Quantidade", "Unitario R$", "Total R$"),
      threeColumns(
        `${formatTon(quantityTon)} TN`,
        formatDecimalMoney(input.unitPriceCents),
        formatNumber(input.productTotalCents / 100)
      ),
      divider(),
      `TOTAL DA VENDA - Itens (1) R$ ${formatNumber(input.productTotalCents / 100)}`
    );
  }

  if (config.showFreight && input.freightTotalCents > 0) {
    lines.push(`FRETE R$ ${formatNumber(input.freightTotalCents / 100)}`);
  }

  if (config.showProductDetail) {
    lines.push(`Cond.Pagto.: ${input.paymentTermName ?? "NAO INFORMADA"}`);
    lines.push(`Meio Pagto.: ${input.paymentMethodName ?? "NAO INFORMADO"}`);
  }

  if (config.showWeights || config.showProductDetail) {
    lines.push(divider());
  }

  if (config.showWeights) {
    lines.push(
      `ENTRADA <TARA>: ${formatTon(input.entryWeightKg / 1000)} <TON>`,
      `SAIDA <CARREGADO>: ${formatTon(input.exitWeightKg / 1000)} <TON>`,
      `LIQUIDO: ${formatTon(input.netWeightKg / 1000)} <TON>`
    );
  }

  if (config.showEntryExitTimes) {
    lines.push(
      `Entrada: ${formatDateTime(input.entryCapturedAt)}`,
      `Saida: ${formatDateTime(input.exitCapturedAt)}`
    );
  }

  if (config.showPermanence) {
    lines.push(`Permanencia: ${input.permanenceLabel}`);
  }

  if (config.showFinancial) {
    lines.push(
      divider(),
      "FINANCEIRO",
      `VENCTO: ${formatDate(input.printedAt)} - VALOR R$ ${formatNumber(input.totalCents / 100)}`
    );
  }

  if (config.showSignature) {
    lines.push(
      divider(),
      `Data: ${formatDateTime(input.printedAt)}`,
      "Assinatura do Recebimento:",
      "",
      "",
      "",
      signatureLine(),
      "Assinatura do Cliente",
      ""
    );
  }

  if (config.showVehicleDriver) {
    lines.push(
      `Veiculo: ${input.plate}`,
      `Motorista: ${input.driverName}`
    );
  }

  if (config.showFooter) {
    lines.push(
      dashed(),
      "AGRADECEMOS PELA PREFERENCIA! VOLTE SEMPRE",
      dashed()
    );
  }

  if (config.customFooterText.trim()) {
    lines.push(config.customFooterText.trim().toUpperCase());
  }

  return lines.filter((line): line is string => line !== null);
}

/**
 * Largura de cada coluna do bloco Quantidade/Unitario/Total. 3 x 12 = 36 caracteres,
 * mais estreito que o divisor (48) para caber com folga tambem em papel de 58 mm.
 */
const RECEIPT_COLUMN_WIDTH = 12;

/**
 * Formata tres colunas alinhadas a direita (uma sob a outra), para que os valores
 * fiquem exatamente sob os cabecalhos (Quantidade/Unitario/Total). Nunca trunca: se um
 * valor exceder a coluna, a linha so fica um pouco mais larga (sem perder digitos).
 */
function threeColumns(col1: string, col2: string, col3: string): string {
  return (
    col1.padStart(RECEIPT_COLUMN_WIDTH) +
    col2.padStart(RECEIPT_COLUMN_WIDTH) +
    col3.padStart(RECEIPT_COLUMN_WIDTH)
  );
}

function divider(): string {
  return "------------------------------------------------";
}

function dashed(): string {
  return "------------------------------------------------";
}

/**
 * Linha continua para o cliente assinar. Tem a mesma largura do divisor (48
 * caracteres) para ocupar toda a faixa util do papel de 80 mm.
 */
function signatureLine(): string {
  return "________________________________________________";
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
