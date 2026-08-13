import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");
const previewSource = readFileSync(resolve(rendererDir, "ReceiptPreviewCard.tsx"), "utf8");
const receiptHtmlSource = readFileSync(resolve(rendererDir, "../services/receipt-html.ts"), "utf8");

describe("cupom impresso pela impressora do Windows", () => {
  // O bug: o HTML montava o corpo com `snapshot.lines.slice(6)`, um deslocamento fixo.
  // Bastava desligar um bloco do cabecalho ou fechar uma operacao interna (que insere o
  // aviso "sem valor fiscal" no topo) para o cupom sair picado.
  it("nao corta as linhas do topo por posicao fixa", () => {
    expect(receiptHtmlSource).not.toContain("snapshot.lines.slice(6)");
    expect(receiptHtmlSource).toContain("renderReceiptBody(snapshot.bodyLines");
    expect(receiptHtmlSource).toContain("const header = snapshot.header;");
  });

  it("imprime a logo respeitando o interruptor e o alinhamento configurados", () => {
    expect(receiptHtmlSource).toContain("style.showLogo");
    expect(receiptHtmlSource).toContain("logo-row");
    expect(receiptHtmlSource).toContain("style.logoAlignment");
  });

  it("aplica fonte, tamanhos e destaque dos numeros escolhidos", () => {
    expect(receiptHtmlSource).toContain("RECEIPT_FONT_STACKS[style.fontFamily]");
    expect(receiptHtmlSource).toContain("font-size: ${style.fontSizePx}px");
    expect(receiptHtmlSource).toContain("highlightReceiptNumbers(");
  });

  // A logo e o numero do cupom sumiam do papel porque o cupom ocupava a largura da PAGINA
  // (A4/Carta, ja que a regra `@page` era invalida): tudo que e centralizado caia fora do
  // papel de 80 mm. A largura do cupom nao pode voltar a depender da pagina.
  it("desenha o cupom na faixa util do papel, e nao na largura da pagina", () => {
    expect(receiptHtmlSource).toContain("receiptContentWidthMm(payload.paperWidthMm)");
    expect(receiptHtmlSource).toContain(".receipt { width: ${contentWidthMm}mm;");
    expect(receiptHtmlSource).not.toContain(".receipt { width: 100%; }");
    expect(receiptHtmlSource).not.toMatch(/size: \$\{payload\.paperWidthMm\}mm auto/);
  });
});

describe("tela de impressao", () => {
  it("carrega o formulario do perfil ativo deste computador", () => {
    // listPrintProfiles() devolve perfis de outros computadores e do relatorio A4:
    // carregar o primeiro da lista abria o formulario sem a logo salva e o proximo
    // "Salvar perfil" gravava logo nula no perfil que imprime.
    expect(appSource).toContain("desktopApi.getActiveReceiptProfile()");
    expect(appSource).toContain("applyReceiptProfileForm(activeProfile ?? undefined");
    // O ciclo automatico nao pode mais ler o primeiro perfil da lista.
    expect(appSource).not.toContain("applyReceiptProfileForm(nextProfiles[0])");
  });

  // O ciclo automatico de 15 s reaplicava o perfil salvo por cima do formulario: quem
  // trocava para "Personalizado" e demorava a salvar via a escolha voltar para "Padrao"
  // sozinha, junto com os tamanhos e a logo em edicao.
  it("hidrata o formulario uma unica vez e so reescreve depois de salvar", () => {
    expect(appSource).toContain("receiptFormHydratedRef");
    expect(appSource).toContain("if (receiptFormHydratedRef.current && !options.force)");
    expect(appSource).toContain("refreshPrintData({ syncForm: true })");

    // Reimpressao, impressao de teste e fechamento de operacao recarregam as listas,
    // mas nao podem tocar no formulario em edicao.
    expect(appSource.match(/await refreshPrintData\(\);/g)?.length).toBeGreaterThan(0);
    expect(appSource.match(/refreshPrintData\(\{ syncForm: true \}\)/g)).toHaveLength(1);
  });

  it("mostra a previa do cupom ao lado do editor", () => {
    expect(appSource).toContain("<ReceiptPreviewCard");
    expect(appSource).toContain("config={receiptTemplateConfig}");
  });

  it("oferece os controles de fonte, tamanhos e logo no modo personalizado", () => {
    expect(appSource).toContain("receiptFontFamilyOptions");
    expect(appSource).toContain("receiptStyleSliders");
    expect(appSource).toContain("Imprimir a logo");
    expect(appSource).toContain("Posicao da logo");
    expect(appSource).toContain("Restaurar aparencia padrao");
  });

  /**
   * A termica da pedreira e ESC/POS: mandar o cupom direto para ela tira do meio o driver
   * do Windows — que e quem decidia tamanho de pagina, margem e se a imagem seria impressa,
   * e foi quem engoliu a logo e o numero do cupom no papel.
   */
  it("oferece a termica em ESC/POS direto como caminho recomendado", () => {
    expect(appSource).toContain('<option value="windows_escpos">');
    expect(appSource).toContain("recomendado");
    // O formulario da impressora do Windows vale para os dois modos.
    expect(appSource).toContain("isWindowsPrinterType(printerType)");
    // Instalacao nova ja comeca no caminho que nao depende do driver.
    expect(appSource).toContain('useState<PrinterType>("windows_escpos")');
  });

  it("mostra no perfil ativo por onde o cupom esta saindo", () => {
    expect(appSource).toContain("describePrinterType(printProfiles[0].printerType)");
  });

  // Quando a pedreira diz "a correcao nao chegou", a primeira coisa a conferir e a versao
  // instalada: a atualizacao so e aplicada quando o app e fechado.
  it("mostra a versao instalada junto do botao de atualizacao", () => {
    expect(appSource).toContain("getAppVersion");
    expect(appSource).toContain("v{appVersion}");
  });

  // O telefone e dado da pedreira (como a logo), nao um enfeite do modelo: fica fora do
  // editor visual, senao quem usa o modelo "Padrao" nem veria o campo.
  it("tem o campo de telefone da pedreira fora do editor visual", () => {
    expect(appSource).toContain("Telefone da pedreira no cupom");
    expect(appSource).toContain(
      "updateReceiptTemplateConfig({ companyPhone: event.target.value })"
    );

    const campo = appSource.indexOf("Telefone da pedreira no cupom");
    const editor = appSource.indexOf("Editor visual do cupom");
    expect(campo).toBeGreaterThan(0);
    expect(campo).toBeLessThan(editor);
  });
});

describe("previa do cupom", () => {
  it("usa o mesmo construtor e a mesma pilha de fontes da impressao", () => {
    expect(previewSource).toContain("buildReceiptDocument(");
    expect(previewSource).toContain("buildSampleReceiptInput(");
    expect(previewSource).toContain("RECEIPT_FONT_STACKS[style.fontFamily]");
  });

  it("permite comparar o modelo selecionado com o padrao", () => {
    expect(previewSource).toContain("Comparar com o padrao");
    expect(previewSource).toContain("DEFAULT_RECEIPT_TEMPLATE_CONFIG");
  });

  // A previa foi escrita antes de o codigo da operacao existir e nunca ganhou a linha: a
  // tela de impressao mostrava so "COPIA NRO 000000000" e parecia que o cupom saia sem
  // codigo. Os tres renderizadores (ESC/POS, HTML e previa) montam a linha pela MESMA
  // funcao, para nao voltarem a divergir.
  it("mostra o codigo da operacao no topo, como o cupom impresso", () => {
    expect(previewSource).toContain("header.operationCodeLabel");
    expect(previewSource).toContain("receiptOperationCodeLine(header.operationCodeLabel)");
    expect(receiptHtmlSource).toContain("receiptOperationCodeLine(header.operationCodeLabel)");
  });

  // Num container flex que rola, o papel ficava com a altura da caixa (align-items:
  // stretch) e o texto vazava para fora do branco — o cupom aparecia cortado no meio.
  it("deixa o papel crescer com o conteudo em vez de esticar num flex", () => {
    const paper = previewSource.slice(previewSource.indexOf("function ReceiptPaper("));

    expect(paper).toContain('margin: "0 auto"');
    expect(previewSource).not.toContain('overflowY: "auto",\n          display: "flex"');
  });

  it("acompanha a rolagem da tela para configurar e visualizar ao mesmo tempo", () => {
    expect(previewSource).toContain('position: "sticky"');
  });

  // A previa so vale se quebrar (ou nao quebrar) a linha no mesmo ponto que o papel: as duas
  // telas medem a faixa util e o tamanho das linhas decorativas pelas MESMAS funcoes.
  it("mede o papel com as mesmas funcoes do cupom impresso", () => {
    for (const source of [previewSource, receiptHtmlSource]) {
      expect(source).toContain("receiptContentWidthMm(");
      expect(source).toContain("fitReceiptBodyFontSizePx(");
      expect(source).toContain("isReceiptRuleLine(");
    }
  });
});

describe("tela de nova entrada", () => {
  it("tem botao de editar no seletor de cliente e no de transportadora", () => {
    expect(appSource).toContain("onEditSelected?: () => void;");
    expect(appSource).toContain("setEditingCustomerId(form.customerId)");
    expect(appSource).toContain("setEditingCarrierId(form.carrierId)");
  });

  it("abre o cadastro ja na ficha do item selecionado", () => {
    expect(appSource).toContain("editId: editingCustomerId ?? undefined");
    expect(appSource).toContain("editId: editingCarrierId ?? undefined");
  });
});
