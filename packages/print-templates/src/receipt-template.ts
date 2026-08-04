export interface ReceiptTemplateInput {
  companyName: string;
  companyDocument: string | null;
  companyStateRegistration: string | null;
  unitName: string;
  /**
   * Codigo sequencial da OPERACAO na pedreira (000001, 000002, ...), impresso no topo do
   * cupom. Distinto de `receiptNumber`, que numera IMPRESSOES: duas vias da mesma
   * operacao saem com o mesmo codigo de operacao e numeros de cupom diferentes.
   * Ausente nos cupons emitidos antes do codigo existir.
   */
  operationCode?: number | null;
  receiptNumber: number;
  /**
   * Numero do computador dentro da pedreira, impresso como sufixo do cupom
   * (ex.: 000000101-2). Cada balanca numera a propria sequencia offline, entao
   * o sufixo e o que garante que duas maquinas nunca emitam o mesmo cupom.
   * Ausente/0 em pedreira de um computador so: o numero sai como antes.
   */
  deviceNumber?: number | null;
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
  /**
   * O valor do frete sai no documento (situacao 1 do frete: "valor na nota"). Quando
   * `false` — situacao 2, valor so no sistema —, a linha FRETE nao sai no papel E o total
   * impresso desconta o frete: o que o cliente ve e o que a nota cobra dele. `undefined`
   * nos cupons antigos, quando a escolha nao existia: vale como `true`.
   */
  showFreightValue?: boolean;
  totalCents: number;
}

/**
 * Familia tipografica do cupom. O nome e generico (nao uma fonte especifica) porque
 * quem resolve a pilha real e o renderizador — a impressora do Windows recebe HTML e a
 * previa da tela usa a mesma pilha, entao o que o operador ve e o que sai no papel.
 */
export type ReceiptFontFamily = "monospace" | "sans" | "serif" | "condensed";

export type ReceiptLogoAlignment = "left" | "center" | "right";

/** Aparencia do cupom: fonte, corpo, numeros e posicao da logo. */
export interface ReceiptStyle {
  fontFamily: ReceiptFontFamily;
  /** Corpo do cupom, em px (o cupom e renderizado em 80 mm de largura). */
  fontSizePx: number;
  /**
   * Numeros (pesos, valores, quantidades), em px. Sai separado do corpo porque o que o
   * operador e o cliente conferem no papel sao os numeros — aumentar so eles deixa o
   * cupom legivel sem gastar papel com o texto todo maior.
   */
  numberFontSizePx: number;
  /** Cabecalho grafico: empresa, data/hora e numero do cupom. */
  headerFontSizePx: number;
  lineHeight: number;
  boldBody: boolean;
  /** Imprime a logo configurada no topo do cupom. */
  showLogo: boolean;
  logoAlignment: ReceiptLogoAlignment;
}

export interface ReceiptTemplateConfig extends ReceiptStyle {
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

/**
 * Aparencia do modelo padrao — os mesmos tamanhos que o cupom ja usava antes da
 * personalizacao existir. Selecionar "Padrao" precisa devolver exatamente o cupom
 * atual, entao esses valores sao a referencia dos dois lados (impressao e previa).
 */
export const DEFAULT_RECEIPT_STYLE: ReceiptStyle = {
  fontFamily: "monospace",
  fontSizePx: 11,
  numberFontSizePx: 11,
  headerFontSizePx: 14,
  lineHeight: 1.28,
  boldBody: false,
  showLogo: true,
  logoAlignment: "center"
};

export const DEFAULT_RECEIPT_TEMPLATE_CONFIG: ReceiptTemplateConfig = {
  ...DEFAULT_RECEIPT_STYLE,
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

/** Limites de cada tamanho: fora deles o cupom de 80 mm quebra ou fica ilegivel. */
const STYLE_LIMITS = {
  fontSizePx: [7, 20],
  numberFontSizePx: [7, 28],
  headerFontSizePx: [8, 30],
  lineHeight: [1, 2.4]
} as const;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeFontFamily(value: unknown): ReceiptFontFamily {
  return value === "sans" || value === "serif" || value === "condensed" ? value : "monospace";
}

function normalizeLogoAlignment(value: unknown): ReceiptLogoAlignment {
  return value === "left" || value === "right" ? value : "center";
}

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
    customFooterText: config.customFooterText ?? "",
    fontFamily: normalizeFontFamily(config.fontFamily),
    fontSizePx: clamp(
      Number(config.fontSizePx ?? DEFAULT_RECEIPT_STYLE.fontSizePx),
      ...STYLE_LIMITS.fontSizePx,
      DEFAULT_RECEIPT_STYLE.fontSizePx
    ),
    numberFontSizePx: clamp(
      Number(config.numberFontSizePx ?? DEFAULT_RECEIPT_STYLE.numberFontSizePx),
      ...STYLE_LIMITS.numberFontSizePx,
      DEFAULT_RECEIPT_STYLE.numberFontSizePx
    ),
    headerFontSizePx: clamp(
      Number(config.headerFontSizePx ?? DEFAULT_RECEIPT_STYLE.headerFontSizePx),
      ...STYLE_LIMITS.headerFontSizePx,
      DEFAULT_RECEIPT_STYLE.headerFontSizePx
    ),
    lineHeight: clamp(
      Number(config.lineHeight ?? DEFAULT_RECEIPT_STYLE.lineHeight),
      ...STYLE_LIMITS.lineHeight,
      DEFAULT_RECEIPT_STYLE.lineHeight
    ),
    boldBody: config.boldBody ?? DEFAULT_RECEIPT_STYLE.boldBody,
    showLogo: config.showLogo ?? DEFAULT_RECEIPT_STYLE.showLogo,
    logoAlignment: normalizeLogoAlignment(config.logoAlignment)
  };
}

/**
 * Configuracao que vale de fato na hora de imprimir. No modo "Padrao" toda a
 * personalizacao e ignorada — o cupom sai exatamente no modelo atual, mesmo que o
 * operador tenha mexido nos campos antes de voltar para o padrao. So a logo escapa
 * disso: ela e do cadastro da pedreira, nao um enfeite do modelo, e sempre imprime.
 */
export function resolveReceiptTemplateConfig(
  config: Partial<ReceiptTemplateConfig> | null | undefined
): ReceiptTemplateConfig {
  const normalized = normalizeReceiptTemplateConfig(config);
  if (normalized.mode !== "custom") {
    return { ...DEFAULT_RECEIPT_TEMPLATE_CONFIG };
  }
  return normalized;
}

/**
 * Marcacao obrigatoria do cupom da operacao interna (venda sem nota): o cupom sai igual
 * ao da venda com nota, mas precisa deixar explicito que nao e documento fiscal. Nao e
 * controlada pela configuracao do template — nenhuma pedreira pode desligar o aviso.
 */
export const NON_FISCAL_SALE_LABEL = "VENDA SEM VALOR FISCAL";

/**
 * Cabecalho do cupom em pedacos nomeados. O renderizador HTML (impressora do Windows) e
 * a previa da tela desenham esse bloco graficamente — com a logo, a empresa em destaque e
 * o numero do cupom grande —, enquanto o ESC/POS imprime as mesmas informacoes como texto.
 * Antes o HTML descartava as 6 primeiras linhas por posicao fixa: bastava desligar um bloco
 * ou fechar uma operacao interna (que insere o aviso "sem valor fiscal" no topo) para o
 * cupom sair com o cabecalho picado.
 */
export interface ReceiptHeaderBlock {
  operationCodeLabel: string | null;
  customHeaderText: string | null;
  nonFiscalLabel: string | null;
  companyName: string | null;
  unitName: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
  receiptNumberLabel: string | null;
  copyLabel: string | null;
}

export interface ReceiptDocument {
  /** Cupom inteiro em texto puro — o que a impressora ESC/POS recebe. */
  lines: string[];
  /** Cabecalho para o renderizador grafico. */
  header: ReceiptHeaderBlock;
  /** Linhas depois do cabecalho: o que vai no `<pre>` do HTML e da previa. */
  bodyLines: string[];
  /** Aparencia ja resolvida (padrao ou personalizada). */
  style: ReceiptStyle;
}

export function buildReceiptLines(input: ReceiptTemplateInput): string[] {
  return buildReceiptLinesWithConfig(input, DEFAULT_RECEIPT_TEMPLATE_CONFIG);
}

export function buildReceiptLinesWithConfig(
  input: ReceiptTemplateInput,
  config: ReceiptTemplateConfig
): string[] {
  return buildReceiptDocument(input, config).lines;
}

/**
 * Monta o cupom uma unica vez para os tres consumidores (ESC/POS, HTML de impressao e
 * previa da tela), de forma que a previa nunca minta sobre o que vai sair no papel.
 */
export function buildReceiptDocument(
  input: ReceiptTemplateInput,
  config: Partial<ReceiptTemplateConfig> | null | undefined
): ReceiptDocument {
  const resolved = resolveReceiptTemplateConfig(config);
  const header = buildHeaderBlock(input, resolved);
  const headerLines = buildHeaderLines(header);
  const bodyLines = buildBodyLines(input, resolved);

  return {
    lines: [...headerLines, ...bodyLines],
    header,
    bodyLines,
    style: {
      fontFamily: resolved.fontFamily,
      fontSizePx: resolved.fontSizePx,
      numberFontSizePx: resolved.numberFontSizePx,
      headerFontSizePx: resolved.headerFontSizePx,
      lineHeight: resolved.lineHeight,
      boldBody: resolved.boldBody,
      showLogo: resolved.showLogo,
      logoAlignment: resolved.logoAlignment
    }
  };
}

/** O valor do frete sai neste documento (cupons antigos, sem a escolha, mantem "sim"). */
function showsFreightValue(input: ReceiptTemplateInput): boolean {
  return input.showFreightValue !== false;
}

/**
 * Total impresso. Com o frete fora do documento (valor so no sistema), o frete tambem sai
 * do total — senao o cupom cobraria um valor que a nota nao mostra de onde veio.
 */
function invoiceTotalCents(input: ReceiptTemplateInput): number {
  if (showsFreightValue(input)) return input.totalCents;
  return Math.max(0, input.totalCents - input.freightTotalCents);
}

function buildHeaderBlock(
  input: ReceiptTemplateInput,
  config: ReceiptTemplateConfig
): ReceiptHeaderBlock {
  const nonFiscal = input.operationType === "internal";

  return {
    // Primeira coisa do cupom: e por este codigo que o operador acha a operacao depois.
    operationCodeLabel: formatOperationCode(input.operationCode),
    customHeaderText: config.customHeaderText.trim()
      ? config.customHeaderText.trim().toUpperCase()
      : null,
    // Aviso antes de qualquer bloco opcional: mesmo com o template todo desligado, quem
    // recebe o cupom ve de cara que a venda nao tem valor fiscal.
    nonFiscalLabel: nonFiscal ? NON_FISCAL_SALE_LABEL : null,
    companyName: config.showCompanyHeader ? input.companyName.toUpperCase() : null,
    unitName: config.showCompanyHeader ? input.unitName.toUpperCase() : null,
    dateLabel: config.showCompanyHeader ? formatDate(input.printedAt) : null,
    timeLabel: config.showCompanyHeader ? formatTime(input.printedAt) : null,
    receiptNumberLabel: config.showCopyInfo
      ? formatReceiptNumber(input.receiptNumber, input.deviceNumber)
      : null,
    copyLabel: config.showCopyInfo
      ? input.copyNumber > 1
        ? `${input.copyNumber}a VIA`
        : "1a VIA"
      : null
  };
}

function buildHeaderLines(header: ReceiptHeaderBlock): string[] {
  const lines: string[] = [];

  if (header.operationCodeLabel) {
    lines.push(centered(`OPERACAO ${header.operationCodeLabel}`));
  }

  if (header.customHeaderText) {
    lines.push(header.customHeaderText);
  }

  if (header.nonFiscalLabel) {
    lines.push(divider(), centered(header.nonFiscalLabel), divider());
  }

  if (header.companyName && header.unitName) {
    lines.push(
      header.companyName,
      divider(),
      header.unitName,
      `DATA: ${header.dateLabel}  HORA: ${header.timeLabel}`
    );
  }

  if (header.receiptNumberLabel && header.copyLabel) {
    lines.push(`COPIA NRO ${header.receiptNumberLabel}`, header.copyLabel);
  }

  if (lines.length > 0 && (header.companyName || header.receiptNumberLabel)) {
    lines.push(divider());
  } else if (lines.length > 0 && header.operationCodeLabel) {
    // Cupom com todos os blocos desligados: o codigo ainda precisa se separar do corpo.
    lines.push(divider());
  }

  return lines;
}

function buildBodyLines(input: ReceiptTemplateInput, config: ReceiptTemplateConfig): string[] {
  const productLabel = [input.productCode, input.productDescription].filter(Boolean).join("-");
  const customerLocation = [
    input.customerZipCode,
    formatCityState(input.customerCity, input.customerState)
  ]
    .filter(Boolean)
    .join("-");
  const quantityTon = input.netWeightKg / 1000;
  const nonFiscal = input.operationType === "internal";
  const lines: (string | null)[] = [];

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

  if (config.showFreight && showsFreightValue(input) && input.freightTotalCents > 0) {
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
      `VENCTO: ${formatDate(input.printedAt)} - VALOR R$ ${formatNumber(invoiceTotalCents(input) / 100)}`
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
    lines.push(`Veiculo: ${input.plate}`, `Motorista: ${input.driverName}`);
  }

  if (config.showFooter) {
    lines.push(dashed(), "AGRADECEMOS PELA PREFERENCIA! VOLTE SEMPRE", dashed());
  }

  if (config.customFooterText.trim()) {
    lines.push(config.customFooterText.trim().toUpperCase());
  }

  // Repete o aviso no pe do cupom: o cliente costuma guardar so a parte de baixo,
  // com a assinatura e o valor.
  if (nonFiscal) {
    lines.push(centered(NON_FISCAL_SALE_LABEL), divider());
  }

  return lines.filter((line): line is string => line !== null);
}

/**
 * Cupom de exemplo usado pela previa da tela de impressao e pela impressao de teste.
 * Vem daqui (e nao de cada tela) para que a previa mostre exatamente o mesmo conteudo
 * que sai no papel quando o operador clica em "Testar impressora".
 */
export function buildSampleReceiptInput(printedAt: string): ReceiptTemplateInput {
  return {
    companyName: "Pedreira Teste LTDA",
    companyDocument: "00.000.000/0001-00",
    companyStateRegistration: "000.000.000.000",
    unitName: "Pedreira Teste",
    operationCode: 1,
    receiptNumber: 0,
    copyNumber: 0,
    printedAt,
    operationId: "test",
    operationType: "invoice",
    customerName: "Cliente Exemplo",
    customerDocument: "11.111.111/0001-11",
    customerPhone: "(11) 99999-0000",
    customerZipCode: "00000-000",
    customerCity: "Cidade",
    customerState: "SP",
    productCode: "0001",
    productDescription: "Brita 1 (Teste)",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    paymentTermName: "A vista",
    paymentMethodName: "Dinheiro",
    entryCapturedAt: printedAt,
    exitCapturedAt: printedAt,
    permanenceLabel: "0min",
    entryWeightKg: 12_000,
    exitWeightKg: 18_500,
    netWeightKg: 6_500,
    unitPriceCents: 12_000,
    productTotalCents: 78_000,
    freightTotalCents: 0,
    totalCents: 78_000
  };
}

/** Pilha de fontes de cada familia, compartilhada entre a previa e o HTML de impressao. */
export const RECEIPT_FONT_STACKS: Record<ReceiptFontFamily, string> = {
  monospace: 'Consolas, "Courier New", monospace',
  sans: '"Segoe UI", Arial, Helvetica, sans-serif',
  serif: '"Times New Roman", Georgia, serif',
  condensed: '"Arial Narrow", "Liberation Sans Narrow", "Segoe UI", sans-serif'
};

/**
 * Centraliza o texto na largura do divisor (48 caracteres). Texto maior que a
 * largura sai sem recuo, em vez de estourar a linha para a direita.
 */
function centered(text: string): string {
  const padding = Math.max(0, Math.floor((RECEIPT_LINE_WIDTH - text.length) / 2));
  return `${" ".repeat(padding)}${text}`;
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

/**
 * Numero do cupom como sai no papel: sequencia da balanca com o numero do
 * computador como sufixo quando a pedreira tem mais de um (000000101-2).
 */
/**
 * Codigo da operacao como sai no papel: seis digitos com zeros a esquerda (000001).
 * `null` quando a operacao nao tem codigo (cupons anteriores ao campo existir), e ai a
 * linha simplesmente nao sai.
 */
export function formatOperationCode(operationCode: number | null | undefined): string | null {
  if (typeof operationCode !== "number" || !Number.isFinite(operationCode) || operationCode <= 0) {
    return null;
  }
  return Math.trunc(operationCode).toString().padStart(6, "0");
}

export function formatReceiptNumber(receiptNumber: number, deviceNumber?: number | null): string {
  const base = receiptNumber.toString().padStart(9, "0");
  return deviceNumber && deviceNumber > 0 ? `${base}-${deviceNumber}` : base;
}

/** Largura util do papel de 80 mm, em caracteres — a mesma do divisor. */
const RECEIPT_LINE_WIDTH = 48;

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
