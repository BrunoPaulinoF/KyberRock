import { describe, expect, it } from "vitest";

import {
  buildReceiptDocument,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  type ReceiptTemplateConfig
} from "@kyberrock/print-templates";

import { buildReceiptHtml } from "./receipt-html";
import type { ReceiptLogoConfig, ReceiptPrintPayload } from "./printing";

const LOGO_DATA_URL = "data:image/png;base64,AAAA";

describe("buildReceiptHtml", () => {
  it("prints the configured logo at the top of the receipt", () => {
    const html = buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL }));

    expect(html).toContain(`<img src="${LOGO_DATA_URL}" alt="Logo" />`);
    expect(html).not.toContain('<div class="logo-fallback">');
  });

  it("falls back to the unit name when no logo is configured", () => {
    const html = buildReceiptHtml(payload({ dataUrl: null }));

    expect(html).toContain('<div class="logo-fallback">Pedreira Teste</div>');
    expect(html).not.toContain("<img");
  });

  it("uses the configured box and object-fit for the original image", () => {
    const html = buildReceiptHtml(
      payload({ dataUrl: LOGO_DATA_URL, widthMm: 30, heightMm: 20, fit: "cover" })
    );

    expect(html).toContain("width: 30mm; max-width: 100%; height: 20mm;");
    expect(html).toContain("object-fit: cover;");
  });

  it("prints the pre-rasterized logo at its exact printed size", () => {
    // O raster ja saiu enquadrado da conversao: a caixa vira o tamanho da propria imagem e
    // o object-fit volta a "contain", senao o cupom estica/corta a logo uma segunda vez.
    const html = buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL, fit: "fill" }), {
      dataUrl: "data:image/png;base64,MONO",
      widthMm: 16,
      heightMm: 16
    });

    expect(html).toContain('<img src="data:image/png;base64,MONO" alt="Logo"');
    // A original nao e o que se IMPRIME — fica so como reserva, se o raster nao carregar.
    expect(html).not.toContain(`<img src="${LOGO_DATA_URL}"`);
    expect(html).toContain("width: 16mm; max-width: 100%; height: 16mm;");
    expect(html).toContain("object-fit: contain;");
    // Imagem de 1 bit ja no tamanho final: sem suavizacao, os pontos saem nitidos.
    expect(html).toContain("image-rendering: pixelated;");
  });

  it("escapes receipt text so a quote in the company name cannot break the markup", () => {
    const html = buildReceiptHtml(
      payload({ dataUrl: null }, { companyName: 'Pedreira "A" & Cia <LTDA>' })
    );

    // O cabecalho ja sai em caixa alta do construtor do cupom (o mesmo texto do ESC/POS).
    expect(html).toContain("PEDREIRA &quot;A&quot; &amp; CIA &lt;LTDA&gt;");
  });

  // O corpo era recortado com `lines.slice(6)`, um deslocamento fixo: bastava desligar um
  // bloco do topo ou fechar uma operacao interna (que insere 3 linhas de aviso) para o
  // corte cair no lugar errado e picar o cupom.
  it("monta o corpo a partir do bloco estruturado, nao de um deslocamento fixo", () => {
    const html = buildReceiptHtml(payload({ dataUrl: null }, { operationType: "internal" }));

    expect(html).toContain("VENDA SEM VALOR FISCAL");
    expect(html).toContain("Cliente: Cliente Exemplo");
    // O cabecalho grafico nao pode aparecer duplicado dentro do corpo.
    expect(html.match(/COPIA NRO/g)).toHaveLength(1);
  });

  it("respeita o interruptor e o alinhamento da logo", () => {
    const semLogo = buildReceiptHtml(
      payload({ dataUrl: LOGO_DATA_URL }, { config: { mode: "custom", showLogo: false } })
    );
    expect(semLogo).not.toContain('<div class="logo-row">');
    expect(semLogo).not.toContain("<img");

    const aEsquerda = buildReceiptHtml(
      payload(
        { dataUrl: LOGO_DATA_URL },
        { config: { mode: "custom", showLogo: true, logoAlignment: "left" } }
      )
    );
    expect(aEsquerda).toContain("justify-content: flex-start;");
  });

  it("aplica a fonte, os tamanhos e o destaque dos numeros configurados", () => {
    const html = buildReceiptHtml(
      payload(
        { dataUrl: null },
        {
          config: {
            mode: "custom",
            fontFamily: "condensed",
            fontSizePx: 13,
            numberFontSizePx: 19,
            boldBody: true
          }
        }
      )
    );

    expect(html).toContain("font-size: 13px");
    expect(html).toContain(".num { font-size: 19px;");
    expect(html).toContain("font-weight: 700;");
    expect(html).toContain('<span class="num">');
    expect(html).toContain("Arial Narrow");
  });

  it("nao marca os numeros quando o tamanho e o mesmo do corpo", () => {
    expect(buildReceiptHtml(payload({ dataUrl: null }))).not.toContain('<span class="num">');
  });

  // O raster monocromatico vem do `nativeImage` do Electron, um decodificador diferente do
  // Chromium que desenha a previa: quando ele devolve imagem vazia, o `<img>` quebra e o
  // cupom saia sem logo nenhuma. O endereco de reserva deixa a impressao voltar para a
  // imagem original do perfil em vez de desistir da logo.
  it("guarda a logo original como reserva do raster monocromatico", () => {
    const html = buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL, fit: "cover" }), {
      dataUrl: "data:image/png;base64,MONO",
      widthMm: 16,
      heightMm: 16
    });

    expect(html).toContain(`data-fallback-src="${LOGO_DATA_URL}"`);
    expect(html).toContain('data-fallback-fit="cover"');
  });

  it("nao repete a reserva quando o cupom ja usa a imagem original", () => {
    expect(buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL }))).not.toContain(
      "data-fallback-src"
    );
  });

  // O codigo da operacao e o que liga o papel na mao do operador a venda no sistema, e sai
  // como "COD 000001" — nao confundir com "COPIA NRO", que conta impressoes.
  it("abre o cupom com o codigo da operacao", () => {
    const html = buildReceiptHtml(payload({ dataUrl: null }));

    expect(html).toContain('<div class="operation-code">COD 000001</div>');
    expect(html).not.toContain("OPERACAO 000001");
  });

  /**
   * O cupom saia sem logo e sem numero porque `@page { size: 80mm auto }` e CSS invalido:
   * o navegador jogava a regra fora, diagramava numa pagina A4/Carta e tudo que e
   * centralizado (logo, COD, COPIA NRO) ia parar no meio de 210 mm — fora do papel de 80.
   */
  describe("largura do cupom", () => {
    it("desenha o cupom na faixa util do papel, e nao na largura da pagina", () => {
      const html = buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL }));

      expect(html).toContain(".receipt { width: 72mm; max-width: 100%;");
      expect(html).not.toContain(".receipt { width: 100%; }");
    });

    it("acompanha o papel configurado", () => {
      expect(buildReceiptHtml(payload({ dataUrl: null }, { paperWidthMm: 58 }))).toContain(
        ".receipt { width: 50mm;"
      );
    });

    it("nao deixa a regra de pagina invalida voltar", () => {
      const html = buildReceiptHtml(payload({ dataUrl: null }));

      // `size` so aceita `auto` sozinho ou medidas: `80mm auto` derruba a regra inteira.
      expect(html).not.toMatch(/size:\s*\d+mm auto/);
      expect(html).toContain("@page { margin: 4mm; }");
    });

    it("mantem a logo dentro do papel quando a caixa e maior que a faixa util", () => {
      const html = buildReceiptHtml(
        payload({ dataUrl: LOGO_DATA_URL, widthMm: 60 }, { paperWidthMm: 58 })
      );

      expect(html).toContain("width: 60mm; max-width: 100%;");
    });

    // Divisor e linha de assinatura ocupam as 48 colunas ate o fim: sao as unicas linhas
    // que estouravam a faixa util e deixavam um toco de tracos na linha de baixo.
    it("imprime as linhas decorativas inteiras, sem quebrar", () => {
      const html = buildReceiptHtml(payload({ dataUrl: null }));

      expect(html).toContain(`<span class="rule-line">${"-".repeat(48)}</span>`);
      expect(html).toContain(`<span class="rule-line">${"_".repeat(48)}</span>`);
      expect(html).toMatch(/\.rule-line \{ font-size: [\d.]+px; white-space: pre; \}/);
    });

    it("nao mexe no tamanho do texto escolhido pelo operador", () => {
      const html = buildReceiptHtml(
        payload({ dataUrl: null }, { config: { mode: "custom", fontSizePx: 14 } })
      );

      expect(html).toContain("font-size: 14px");
    });
  });

  it("imprime o telefone da pedreira configurado no rodape", () => {
    const html = buildReceiptHtml(
      payload({ dataUrl: null }, { config: { companyPhone: "(11) 3333-4444" } })
    );

    expect(html).toContain("CONTATO: (11) 3333-4444");
    expect(buildReceiptHtml(payload({ dataUrl: null }))).not.toContain("CONTATO:");
  });
});

function payload(
  logo: Partial<ReceiptLogoConfig>,
  overrides: {
    companyName?: string;
    paperWidthMm?: number;
    operationType?: "invoice" | "internal";
    config?: Partial<ReceiptTemplateConfig>;
  } = {}
): ReceiptPrintPayload {
  const receiptLogo: ReceiptLogoConfig = {
    dataUrl: null,
    widthMm: 24,
    heightMm: 16,
    fit: "contain",
    ...logo
  };
  const templateConfig: ReceiptTemplateConfig = {
    ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
    ...overrides.config
  };
  const templateInput = {
    ...buildSampleReceiptInput("2026-01-01T13:00:00.000Z"),
    companyName: overrides.companyName ?? "Pedreira Teste LTDA",
    unitName: "Pedreira Teste",
    receiptNumber: 1,
    copyNumber: 1,
    operationType: overrides.operationType ?? ("invoice" as const)
  };
  // O snapshot vem do mesmo construtor usado na impressao real: assim o teste nunca
  // valida um cabecalho que a producao nao produziria.
  const document = buildReceiptDocument(templateInput, templateConfig);

  return {
    printerName: "Impressora",
    printerType: "windows",
    networkHost: null,
    networkPort: null,
    paperWidthMm: overrides.paperWidthMm ?? 80,
    lines: document.lines,
    contentText: document.lines.join("\n"),
    snapshot: {
      ...templateInput,
      lines: document.lines,
      receiptLogo,
      templateConfig,
      header: document.header,
      bodyLines: document.bodyLines,
      style: document.style
    }
  };
}
