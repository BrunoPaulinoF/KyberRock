import { describe, expect, it } from "vitest";

import {
  buildReceiptDocument,
  buildReceiptLines,
  buildReceiptLinesWithConfig,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_STYLE,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  NON_FISCAL_SALE_LABEL,
  normalizeReceiptTemplateConfig,
  resolveReceiptTemplateConfig
} from "./receipt-template";

describe("buildReceiptLines", () => {
  it("includes freight when it exists", () => {
    const lines = buildReceiptLines({ ...baseInput(), freightTotalCents: 25_000, totalCents: 175_000 });

    const freightLine = lines.find((line) => line.startsWith("FRETE"));

    expect(freightLine).toBe("FRETE R$ 250,00");
    expect(lines).toContain("TOTAL DA VENDA - Itens (1) R$ 1.500,00");
    expect(lines.at(-1)).toBe("------------------------------------------------");
  });

  it("marks reprints as second copy", () => {
    const lines = buildReceiptLines({
      ...baseInput(),
      receiptNumber: 7,
      copyNumber: 2,
      operationType: "internal",
      paymentTermName: null
    });

    expect(lines).toContain("COPIA NRO 000000007");
    expect(lines).toContain("2a VIA");
    expect(lines).toContain("Cond.Pagto.: NAO INFORMADA");
  });

  it("imprime o numero do computador como sufixo quando a pedreira tem mais de um", () => {
    // Cada balanca numera offline pela propria sequencia: sem o sufixo, duas
    // maquinas emitiriam o mesmo numero de cupom para caminhoes diferentes.
    const lines = buildReceiptLines({ ...baseInput(), receiptNumber: 101, deviceNumber: 2 });

    expect(lines).toContain("COPIA NRO 000000101-2");
  });

  it("mantem o numero sem sufixo na pedreira de um computador so", () => {
    const lines = buildReceiptLines({ ...baseInput(), receiptNumber: 101, deviceNumber: null });

    expect(lines).toContain("COPIA NRO 000000101");
  });

  it("prints the payment method alongside the condition", () => {
    const lines = buildReceiptLines(baseInput());

    expect(lines).toContain("Cond.Pagto.: A vista");
    expect(lines).toContain("Meio Pagto.: Dinheiro");
  });

  it("falls back when the payment method is missing", () => {
    const lines = buildReceiptLines({ ...baseInput(), paymentMethodName: null });

    expect(lines).toContain("Meio Pagto.: NAO INFORMADO");
  });

  it("aligns the quantity/unit/total columns to the same width as the header", () => {
    const lines = buildReceiptLines(baseInput());

    const headerIndex = lines.findIndex((line) => line.includes("Quantidade"));
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    const header = lines[headerIndex];
    const values = lines[headerIndex + 1];
    // Cabecalho e valores tem a mesma largura (colunas de 1/3 do cupom).
    expect(header.length).toBe(values.length);
    expect(header.trimEnd()).toBe(header); // sem espacos sobrando a direita
  });

  it("breaks the signature onto its own line so it is not cut off", () => {
    const lines = buildReceiptLines(baseInput());

    const dateLine = lines.find((line) => line.startsWith("Data: "));
    expect(dateLine).toBeDefined();
    // A data e a assinatura ficam em linhas separadas (antes iam juntas e cortavam).
    expect(dateLine).not.toContain("Assinatura");
    expect(lines).toContain("Assinatura do Recebimento:");
  });

  it("leaves a wide line and space for the customer to sign", () => {
    const lines = buildReceiptLines(baseInput());

    const signatureLineIndex = lines.findIndex((line) => /^_{10,}$/.test(line));
    // Ha uma linha continua larga para o cliente assinar...
    expect(signatureLineIndex).toBeGreaterThanOrEqual(0);
    expect(lines[signatureLineIndex].length).toBe(48);
    // ...com o rotulo logo abaixo dela.
    expect(lines[signatureLineIndex + 1]).toBe("Assinatura do Cliente");

    // Ha espaco em branco reservado acima da linha para a assinatura fisica.
    const receiptLabelIndex = lines.indexOf("Assinatura do Recebimento:");
    const blankLinesBefore = lines
      .slice(receiptLabelIndex + 1, signatureLineIndex)
      .filter((line) => line === "").length;
    expect(blankLinesBefore).toBeGreaterThanOrEqual(3);
  });

  it("marca a operacao interna como venda sem valor fiscal no topo e no pe", () => {
    const lines = buildReceiptLines({ ...baseInput(), operationType: "internal" });

    const marked = lines.filter((line) => line.includes(NON_FISCAL_SALE_LABEL));
    expect(marked).toHaveLength(2);
    // O aviso do topo vem antes dos dados do cliente e o do pe depois da assinatura.
    expect(lines.findIndex((line) => line.includes(NON_FISCAL_SALE_LABEL))).toBeLessThan(
      lines.findIndex((line) => line.startsWith("Cliente:"))
    );
    expect(lines.at(-2)).toContain(NON_FISCAL_SALE_LABEL);
  });

  it("nao marca a venda com nota como sem valor fiscal", () => {
    const lines = buildReceiptLines(baseInput());

    expect(lines.some((line) => line.includes(NON_FISCAL_SALE_LABEL))).toBe(false);
  });

  it("mantem o aviso mesmo com o template todo desligado", () => {
    // A pedreira pode esconder cabecalho, cliente, valores... mas nunca o aviso de
    // que o cupom nao vale como documento fiscal.
    const lines = buildReceiptLinesWithConfig(
      { ...baseInput(), operationType: "internal" },
      {
        ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
        mode: "custom",
        showCompanyHeader: false,
        showCopyInfo: false,
        showCustomerInfo: false,
        showProductDetail: false,
        showFreight: false,
        showWeights: false,
        showEntryExitTimes: false,
        showPermanence: false,
        showFinancial: false,
        showSignature: false,
        showVehicleDriver: false,
        showFooter: false
      }
    );

    expect(lines.filter((line) => line.includes(NON_FISCAL_SALE_LABEL))).toHaveLength(2);
  });
});

describe("modelo padrao x personalizado", () => {
  // "Padrao" precisa ser um estado, nao um ponto de partida: o operador que
  // experimentou a personalizacao e voltou ao padrao espera o cupom de sempre.
  it("ignora a personalizacao guardada quando o modelo e o padrao", () => {
    const resolved = resolveReceiptTemplateConfig({
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      mode: "default",
      showFinancial: false,
      fontSizePx: 18,
      customFooterText: "Texto que nao deve sair"
    });

    expect(resolved).toEqual(DEFAULT_RECEIPT_TEMPLATE_CONFIG);
  });

  it("aplica a personalizacao quando o modelo e personalizado", () => {
    const resolved = resolveReceiptTemplateConfig({
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      mode: "custom",
      showFinancial: false,
      numberFontSizePx: 20
    });

    expect(resolved.showFinancial).toBe(false);
    expect(resolved.numberFontSizePx).toBe(20);
  });

  it("mantem a aparencia padrao em configuracoes gravadas antes da personalizacao", () => {
    // Perfis salvos antes desta versao nao tem os campos de estilo no JSON.
    const normalized = normalizeReceiptTemplateConfig({ mode: "custom", showFooter: false });

    expect(normalized.fontFamily).toBe(DEFAULT_RECEIPT_STYLE.fontFamily);
    expect(normalized.fontSizePx).toBe(DEFAULT_RECEIPT_STYLE.fontSizePx);
    expect(normalized.showLogo).toBe(true);
  });

  it("prende os tamanhos na faixa que cabe no papel de 80 mm", () => {
    const normalized = normalizeReceiptTemplateConfig({
      mode: "custom",
      fontSizePx: 200,
      numberFontSizePx: 0,
      lineHeight: Number.NaN
    });

    expect(normalized.fontSizePx).toBe(20);
    expect(normalized.numberFontSizePx).toBe(7);
    expect(normalized.lineHeight).toBe(DEFAULT_RECEIPT_STYLE.lineHeight);
  });
});

describe("buildReceiptDocument", () => {
  it("separa o cabecalho do corpo sem perder nenhuma linha", () => {
    const input = buildSampleReceiptInput("2026-06-07T12:00:00.000Z");
    const document = buildReceiptDocument(input, DEFAULT_RECEIPT_TEMPLATE_CONFIG);

    expect(document.lines).toEqual(buildReceiptLines(input));
    expect(document.lines.slice(-document.bodyLines.length)).toEqual(document.bodyLines);
  });

  // O renderizador HTML descartava as 6 primeiras linhas por posicao fixa. Na operacao
  // interna o aviso "sem valor fiscal" ocupa 3 linhas no topo, entao o corte comia o
  // aviso e metade do cabecalho. Agora o aviso sai no bloco estruturado.
  it("leva o aviso da venda interna no cabecalho, nao no corpo", () => {
    const document = buildReceiptDocument(
      { ...buildSampleReceiptInput("2026-06-07T12:00:00.000Z"), operationType: "internal" },
      DEFAULT_RECEIPT_TEMPLATE_CONFIG
    );

    expect(document.header.nonFiscalLabel).toBe(NON_FISCAL_SALE_LABEL);
    expect(document.bodyLines.some((line) => line.includes(NON_FISCAL_SALE_LABEL))).toBe(true);
    expect(document.header.companyName).toBe("PEDREIRA TESTE LTDA");
  });

  it("zera o cabecalho grafico quando os blocos do topo estao desligados", () => {
    const document = buildReceiptDocument(buildSampleReceiptInput("2026-06-07T12:00:00.000Z"), {
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      mode: "custom",
      showCompanyHeader: false,
      showCopyInfo: false
    });

    expect(document.header.companyName).toBeNull();
    expect(document.header.receiptNumberLabel).toBeNull();
    expect(document.lines).toEqual(document.bodyLines);
  });

  it("devolve o estilo ja resolvido para a previa e para a impressao", () => {
    const document = buildReceiptDocument(buildSampleReceiptInput("2026-06-07T12:00:00.000Z"), {
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      mode: "custom",
      fontFamily: "condensed",
      numberFontSizePx: 16,
      showLogo: false
    });

    expect(document.style).toMatchObject({
      fontFamily: "condensed",
      numberFontSizePx: 16,
      showLogo: false
    });
  });
});

function baseInput(): Parameters<typeof buildReceiptLines>[0] {
  return {
    companyName: "Pedreira Principal LTDA",
    companyDocument: "00.000.000/0001-00",
    companyStateRegistration: "000.000.000.000",
    unitName: "Pedreira Principal",
    receiptNumber: 1,
    copyNumber: 1,
    printedAt: "2026-06-07T12:00:00.000Z",
    operationId: "operation-1",
    operationType: "invoice",
    customerName: "Cliente Teste",
    customerDocument: "11.111.111/0001-11",
    customerPhone: "(11) 99999-0000",
    customerZipCode: "00000-000",
    customerCity: "Ibiuna",
    customerState: "SP",
    productCode: "0028",
    productDescription: "Brita 1",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    paymentTermName: "A vista",
    paymentMethodName: "Dinheiro",
    entryCapturedAt: "2026-06-07T11:00:00.000Z",
    exitCapturedAt: "2026-06-07T12:00:00.000Z",
    permanenceLabel: "1h 0min",
    entryWeightKg: 10_000,
    exitWeightKg: 25_000,
    netWeightKg: 15_000,
    unitPriceCents: 10_000,
    productTotalCents: 150_000,
    freightTotalCents: 0,
    totalCents: 150_000
  };
}
