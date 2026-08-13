import { describe, expect, it } from "vitest";

import {
  buildReceiptDocument,
  buildReceiptLines,
  buildReceiptLinesWithConfig,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_STYLE,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  fitReceiptBodyFontSizePx,
  isReceiptRuleLine,
  NON_FISCAL_SALE_LABEL,
  normalizeReceiptTemplateConfig,
  receiptContentWidthMm,
  receiptHighlightLines,
  RECEIPT_LINE_WIDTH,
  resolveReceiptTemplateConfig
} from "./receipt-template";

describe("buildReceiptLines", () => {
  it("includes freight when it exists", () => {
    const lines = buildReceiptLines({
      ...baseInput(),
      freightTotalCents: 25_000,
      totalCents: 175_000
    });

    const freightLine = lines.find((line) => line.startsWith("FRETE"));

    expect(freightLine).toBe("FRETE R$ 250,00");
    expect(lines).toContain("TOTAL DA VENDA - Itens (1) R$ 1.500,00");
    expect(lines.at(-1)).toBe("------------------------------------------------");
  });

  it("keeps the freight out of the document when the value stays in the system", () => {
    // Situacao 2 do frete: o valor fica no KyberRock para controle e nao entra na nota.
    const lines = buildReceiptLines({
      ...baseInput(),
      freightTotalCents: 25_000,
      showFreightValue: false,
      totalCents: 175_000
    });

    expect(lines.find((line) => line.startsWith("FRETE"))).toBeUndefined();
    // O total impresso desconta o frete: e o que a nota cobra do cliente.
    expect(lines).toContain("VENCTO: 07/06/2026 - VALOR R$ 1.500,00");
  });

  it("prints the freight note written on the entry", () => {
    const lines = buildReceiptLines({
      ...baseInput(),
      freightNote: "Entregar na obra do centro"
    });

    expect(lines).toContain("OBS.: Entregar na obra do centro");
  });

  it("prints the freight note even when the freight value stays in the system", () => {
    // A observacao e recado para quem recebe a carga, nao dinheiro: sai no papel mesmo
    // na situacao 2 do frete, em que o valor nao entra na nota.
    const lines = buildReceiptLines({
      ...baseInput(),
      freightTotalCents: 25_000,
      showFreightValue: false,
      freightNote: "Portao dos fundos",
      totalCents: 175_000
    });

    expect(lines.find((line) => line.startsWith("FRETE R$"))).toBeUndefined();
    expect(lines).toContain("OBS.: Portao dos fundos");
  });

  it("breaks a long freight note into lines that fit the paper", () => {
    const lines = buildReceiptLines({
      ...baseInput(),
      freightNote:
        "Entregar no canteiro da rodovia BR-101 km 42, portao dos fundos, procurar o encarregado"
    });

    const noteIndex = lines.findIndex((line) => line.startsWith("OBS.:"));
    expect(noteIndex).toBeGreaterThanOrEqual(0);
    const noteLines = lines.slice(noteIndex, noteIndex + 3);
    expect(noteLines.length).toBeGreaterThan(1);
    for (const line of noteLines) {
      expect(line.length).toBeLessThanOrEqual(48);
    }
    expect(noteLines.join(" ")).toContain("procurar o encarregado");
  });

  it("leaves the note line out when the entry had no observation", () => {
    expect(buildReceiptLines({ ...baseInput(), freightNote: "   " }).join("\n")).not.toContain(
      "OBS.:"
    );
    expect(buildReceiptLines(baseInput()).join("\n")).not.toContain("OBS.:");
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

  // O codigo da operacao e o que o operador usa para achar a venda depois; por isso sai
  // na primeira linha, antes de qualquer bloco do cabecalho.
  it("imprime o codigo da operacao com seis digitos no topo do cupom", () => {
    const lines = buildReceiptLines({ ...baseInput(), operationCode: 42 });

    expect(lines[0]?.trim()).toBe("COD 000042");
  });

  it("nao imprime a linha do codigo nos cupons anteriores ao campo existir", () => {
    const lines = buildReceiptLines({ ...baseInput(), operationCode: null });

    expect(lines.some((line) => line.includes("COD 0"))).toBe(false);
  });

  // Duas vias da MESMA operacao: o codigo repete (e a mesma venda), o numero do cupom nao.
  it("mantem o codigo da operacao entre as vias, com numeros de cupom diferentes", () => {
    const first = buildReceiptDocument(
      { ...baseInput(), operationCode: 7, receiptNumber: 101, copyNumber: 1 },
      DEFAULT_RECEIPT_TEMPLATE_CONFIG
    );
    const second = buildReceiptDocument(
      { ...baseInput(), operationCode: 7, receiptNumber: 102, copyNumber: 2 },
      DEFAULT_RECEIPT_TEMPLATE_CONFIG
    );

    expect(first.header.operationCodeLabel).toBe("000007");
    expect(second.header.operationCodeLabel).toBe("000007");
    expect(first.header.receiptNumberLabel).not.toBe(second.header.receiptNumberLabel);
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
    // O codigo da operacao nao e um bloco opcional: identifica a venda e sai sempre.
    expect(document.header.operationCodeLabel).toBe("000001");
    expect(document.lines.slice(2)).toEqual(document.bodyLines);
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

describe("telefone da pedreira no cupom", () => {
  it("imprime o contato no rodape quando o numero esta preenchido", () => {
    const lines = buildReceiptLinesWithConfig(baseInput(), {
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      companyPhone: "(11) 3333-4444"
    });

    expect(lines).toContain("CONTATO: (11) 3333-4444");
    // Depois da mensagem de rodape: e a ultima coisa que o cliente le no papel.
    expect(lines.indexOf("CONTATO: (11) 3333-4444")).toBeGreaterThan(
      lines.findIndex((line) => line.includes("AGRADECEMOS"))
    );
  });

  it("nao deixa rastro no cupom quando o numero esta vazio", () => {
    const lines = buildReceiptLinesWithConfig(baseInput(), DEFAULT_RECEIPT_TEMPLATE_CONFIG);

    expect(lines.some((line) => line.includes("CONTATO"))).toBe(false);
  });

  // O telefone e dado da pedreira, nao escolha de layout: quem digitou o numero quer o
  // numero no papel, mesmo com o modelo em "Padrao" (que zera o resto da personalizacao).
  it("continua saindo no modelo padrao", () => {
    const resolved = resolveReceiptTemplateConfig({
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      mode: "default",
      companyPhone: "(11) 3333-4444",
      customFooterText: "Texto que nao deve sair"
    });

    expect(resolved.companyPhone).toBe("(11) 3333-4444");
    expect(resolved.customFooterText).toBe("");
    expect(buildReceiptLinesWithConfig(baseInput(), resolved)).toContain("CONTATO: (11) 3333-4444");
  });

  it("separa o contato do corpo mesmo com a mensagem de rodape desligada", () => {
    const lines = buildReceiptLinesWithConfig(baseInput(), {
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      mode: "custom",
      showFooter: false,
      companyPhone: "(11) 3333-4444"
    });
    const contactIndex = lines.indexOf("CONTATO: (11) 3333-4444");

    expect(contactIndex).toBeGreaterThan(0);
    expect(lines[contactIndex - 1]).toMatch(/^-+$/);
  });

  it("guarda o numero em uma linha so e com teto de tamanho", () => {
    const normalized = normalizeReceiptTemplateConfig({
      mode: "custom",
      companyPhone: `  (11) 3333-4444 \n / WhatsApp ${"9".repeat(80)}  `
    });

    expect(normalized.companyPhone.includes("\n")).toBe(false);
    expect(normalized.companyPhone.length).toBeLessThanOrEqual(60);
    expect(normalized.companyPhone.startsWith("(11) 3333-4444 / WhatsApp")).toBe(true);
  });

  it("nao quebra o cupom com um contato mais longo que a linha", () => {
    const lines = buildReceiptLinesWithConfig(baseInput(), {
      ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      companyPhone: "(11) 3333-4444 / (11) 98888-7777 / 0800 123456"
    });

    // Quebrado em palavras, nunca uma linha maior que o papel (que a impressora cortaria).
    expect(lines.every((line) => line.length <= RECEIPT_LINE_WIDTH)).toBe(true);
    expect(lines.join(" ")).toContain("0800 123456");
  });
});

describe("destaque do codigo e do numero do cupom", () => {
  it("marca as duas linhas que a termica imprime em corpo dobrado", () => {
    const document = buildReceiptDocument(
      { ...baseInput(), operationCode: 42, receiptNumber: 101 },
      DEFAULT_RECEIPT_TEMPLATE_CONFIG
    );

    expect(receiptHighlightLines(document.header)).toEqual(["COD 000042", "COPIA NRO 000000101"]);
    // As linhas destacadas existem no cupom exatamente com esse texto (o ESC/POS compara
    // sem os espacos das pontas), senao o destaque cairia em nenhuma linha.
    for (const line of receiptHighlightLines(document.header)) {
      expect(document.lines.map((each) => each.trim())).toContain(line);
    }
  });

  it("nao destaca o que o cupom nao imprime", () => {
    const semCabecalho = buildReceiptDocument(
      { ...baseInput(), operationCode: null },
      { ...DEFAULT_RECEIPT_TEMPLATE_CONFIG, mode: "custom", showCopyInfo: false }
    );

    expect(receiptHighlightLines(semCabecalho.header)).toEqual([]);
    expect(receiptHighlightLines(null)).toEqual([]);
  });
});

/**
 * A largura do cupom impresso nao pode depender do tamanho de pagina que o driver informa
 * — foi o que fez a logo e o numero do cupom sumirem do papel (ver `buildReceiptHtml`).
 */
describe("geometria do papel", () => {
  it("desconta as duas margens da faixa util", () => {
    expect(receiptContentWidthMm(80)).toBe(72);
    expect(receiptContentWidthMm(58)).toBe(50);
  });

  it("reconhece as linhas decorativas que ocupam a largura inteira", () => {
    expect(isReceiptRuleLine("-".repeat(RECEIPT_LINE_WIDTH))).toBe(true);
    expect(isReceiptRuleLine("_".repeat(RECEIPT_LINE_WIDTH))).toBe(true);
    expect(isReceiptRuleLine("Cliente: Cliente Teste")).toBe(false);
    expect(isReceiptRuleLine("-".repeat(10))).toBe(false);
  });

  it("reduz o corpo monoespacado ate as 48 colunas caberem no papel", () => {
    const fitted = fitReceiptBodyFontSizePx(11, "monospace", receiptContentWidthMm(80));

    expect(fitted).toBeLessThan(11);
    // 48 colunas da fonte do cupom (Consolas, 0,55 em) dentro dos 72 mm uteis.
    expect(fitted * RECEIPT_LINE_WIDTH * 0.55).toBeLessThanOrEqual((72 * 96) / 25.4);
  });

  it("nao aumenta um corpo que ja cabe, nem some no papel estreito", () => {
    expect(fitReceiptBodyFontSizePx(7, "monospace", receiptContentWidthMm(80))).toBe(7);
    expect(
      fitReceiptBodyFontSizePx(11, "monospace", receiptContentWidthMm(58))
    ).toBeGreaterThanOrEqual(6);
  });

  it("nao mexe nas fontes proporcionais, que nao tem grade de colunas", () => {
    expect(fitReceiptBodyFontSizePx(16, "sans", receiptContentWidthMm(80))).toBe(16);
    expect(fitReceiptBodyFontSizePx(16, "condensed", receiptContentWidthMm(80))).toBe(16);
  });
});

function baseInput(): Parameters<typeof buildReceiptLines>[0] {
  return {
    companyName: "Pedreira Principal LTDA",
    companyDocument: "00.000.000/0001-00",
    companyStateRegistration: "000.000.000.000",
    unitName: "Pedreira Principal",
    operationCode: 1,
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
