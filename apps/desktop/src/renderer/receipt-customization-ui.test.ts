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
    expect(receiptHtmlSource).toContain("snapshot.bodyLines.join");
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
