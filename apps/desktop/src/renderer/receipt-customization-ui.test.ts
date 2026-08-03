import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");
const previewSource = readFileSync(resolve(rendererDir, "ReceiptPreviewCard.tsx"), "utf8");
const mainSource = readFileSync(resolve(rendererDir, "../main/main.ts"), "utf8");

describe("cupom impresso pela impressora do Windows", () => {
  // O bug: o HTML montava o corpo com `snapshot.lines.slice(6)`, um deslocamento fixo.
  // Bastava desligar um bloco do cabecalho ou fechar uma operacao interna (que insere o
  // aviso "sem valor fiscal" no topo) para o cupom sair picado.
  it("nao corta as linhas do topo por posicao fixa", () => {
    expect(mainSource).not.toContain("snapshot.lines.slice(6)");
    expect(mainSource).toContain("snapshot.bodyLines.join");
    expect(mainSource).toContain("const header = snapshot.header;");
  });

  it("imprime a logo respeitando o interruptor e o alinhamento configurados", () => {
    expect(mainSource).toContain("const showLogo = style.showLogo;");
    expect(mainSource).toContain("logo-row");
    expect(mainSource).toContain("style.logoAlignment");
  });

  it("aplica fonte, tamanhos e destaque dos numeros escolhidos", () => {
    expect(mainSource).toContain("RECEIPT_FONT_STACKS[style.fontFamily]");
    expect(mainSource).toContain("font-size: ${style.fontSizePx}px");
    expect(mainSource).toContain("highlightReceiptNumbers(");
  });
});

describe("tela de impressao", () => {
  it("carrega o formulario do perfil ativo deste computador", () => {
    // listPrintProfiles() devolve perfis de outros computadores e do relatorio A4:
    // carregar o primeiro da lista abria o formulario sem a logo salva e o proximo
    // "Salvar perfil" gravava logo nula no perfil que imprime.
    expect(appSource).toContain("desktopApi.getActiveReceiptProfile()");
    expect(appSource).toContain("applyReceiptProfileForm(activeProfile ?? undefined)");
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
});
