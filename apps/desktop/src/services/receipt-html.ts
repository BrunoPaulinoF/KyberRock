import {
  fitReceiptBodyFontSizePx,
  isReceiptRuleLine,
  receiptContentWidthMm,
  receiptCopyNumberLine,
  receiptOperationCodeLine,
  RECEIPT_FONT_STACKS,
  RECEIPT_PAPER_MARGIN_MM
} from "@kyberrock/print-templates";

import type { ReceiptPrintPayload } from "./printing.js";

/**
 * Logo ja convertida para o preto-e-branco de 1 bit da impressora termica, no tamanho
 * exato em que sai no papel. E o que o HTML da impressora do Windows usa no lugar da
 * imagem original: a impressora de rede e a do Windows passam a imprimir a mesma coisa,
 * e o driver nao precisa mais decidir sozinho como converter tons de cinza em pontos.
 */
export interface PrintReadyReceiptLogo {
  /** PNG monocromatico em data URL. */
  dataUrl: string;
  /** Tamanho final no papel, ja com o enquadramento (contain/cover/fill) aplicado. */
  widthMm: number;
  heightMm: number;
}

/**
 * HTML do cupom impresso pela impressora do Windows. O cabecalho (logo, empresa, data e
 * numero do cupom) vem do bloco estruturado do snapshot — antes o corpo era recortado com
 * `lines.slice(6)`, um deslocamento fixo, entao qualquer bloco desligado na personalizacao
 * ou o aviso "sem valor fiscal" da operacao interna (3 linhas no topo) deslocava tudo e
 * picava o cupom. Fonte, tamanhos e posicao da logo saem do estilo ja resolvido, o mesmo
 * que a previa da tela de impressao usa.
 *
 * ## A largura do cupom nao depende mais do tamanho da pagina
 *
 * Este era o motivo de a LOGO e o NUMERO DO CUPOM nunca sairem no papel, mesmo com os dois
 * perfeitos na previa da tela:
 *
 * - `@page { size: 80mm auto }` e CSS invalido (a propriedade aceita `auto` sozinho ou uma/
 *   duas medidas, nunca uma medida + `auto`), entao o navegador DESCARTAVA a regra e
 *   diagramava o cupom na pagina padrao da impressora — A4/Carta na maioria dos drivers;
 * - o cupom ocupava `width: 100%` dessa pagina larga, e tudo que e centralizado (a logo, o
 *   "COD 000123", o "COPIA NRO", a data/hora e a via) ia para o MEIO de ~210 mm, ou seja,
 *   uns 30 mm depois da borda do papel de 80 mm: sumia. Sobrava exatamente o que e alinhado
 *   a esquerda — o corpo do cupom —, e ainda com o fim de cada linha cortado.
 *
 * Agora o cupom e uma coluna de largura fixa (a faixa util do papel), ancorada a esquerda:
 * o que e centralizado passa a se centralizar DENTRO do cupom. Assim o papel sai igual
 * independente do tamanho de pagina que o driver informar — nao ha mais o que configurar no
 * Windows para a logo aparecer.
 */
export function buildReceiptHtml(
  payload: ReceiptPrintPayload,
  printReadyLogo?: PrintReadyReceiptLogo | null
): string {
  const snapshot = payload.snapshot;
  const style = snapshot.style;
  const header = snapshot.header;
  const logo = snapshot.receiptLogo;
  // Com a logo ja rasterizada, o enquadramento foi feito na conversao: a caixa passa a ter o
  // tamanho da imagem e `contain` so mantem a proporcao (nao estica nem corta de novo).
  const slotWidthMm = printReadyLogo?.widthMm ?? logo.widthMm;
  const slotHeightMm = printReadyLogo?.heightMm ?? logo.heightMm;
  const logoFit = printReadyLogo ? "contain" : logo.fit;
  const logoSource = printReadyLogo?.dataUrl ?? logo.dataUrl;
  // Segunda fonte para a MESMA logo: a imagem original do perfil, usada quando o raster
  // monocromatico nao carrega no papel. O raster e gerado pelo `nativeImage` do Electron,
  // um decodificador diferente do Chromium que desenha a previa — quando ele devolve uma
  // imagem vazia, o `<img>` quebra e o cupom saia SEM logo nenhuma, mesmo com a logo
  // perfeita na tela. Com o endereco de reserva aqui, `waitForReceiptImages` troca a fonte
  // em vez de remover a imagem (ver `main.ts`).
  const logoFallbackSource =
    printReadyLogo && logo.dataUrl && logo.dataUrl !== printReadyLogo.dataUrl ? logo.dataUrl : null;
  const logoMarkup = logoSource
    ? `<img src="${escapeHtml(logoSource)}" alt="Logo"${
        logoFallbackSource
          ? ` data-fallback-src="${escapeHtml(logoFallbackSource)}" data-fallback-fit="${escapeHtml(logo.fit)}"`
          : ""
      } />`
    : `<div class="logo-fallback">${escapeHtml(snapshot.unitName)}</div>`;
  const logoJustify =
    style.logoAlignment === "left"
      ? "flex-start"
      : style.logoAlignment === "right"
        ? "flex-end"
        : "center";
  const contentWidthMm = receiptContentWidthMm(payload.paperWidthMm);
  // As linhas decorativas (divisor de 48 tracos, linha de assinatura) saem no tamanho que
  // faz as 48 colunas caberem na faixa util do papel — o mesmo calculo da previa. Sem isso
  // o divisor passava da borda e o papel imprimia um pedaco solto de tracos na linha
  // seguinte. O texto do cupom continua no tamanho escolhido pelo operador.
  const ruleFontSizePx = fitReceiptBodyFontSizePx(
    style.fontSizePx,
    style.fontFamily,
    contentWidthMm
  );

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      /*
        Sem \`size\`: a medida da pagina e a que o driver da impressora informa, e o cupom nao
        depende mais dela (ver o comentario da funcao). A regra que existia aqui misturava
        uma medida com \`auto\`, combinacao que o CSS nao aceita: ia embora inteira, junto com
        a largura que ela tentava fixar.
      */
      @page { margin: ${RECEIPT_PAPER_MARGIN_MM}mm; }
      body { margin: 0; font-family: ${RECEIPT_FONT_STACKS[style.fontFamily]}; font-size: ${style.fontSizePx}px; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      /*
        A faixa util do papel, ancorada a esquerda. \`max-width\` cobre a pagina mais estreita
        que o papel configurado; \`overflow-wrap\` garante que nada saia pela direita.
      */
      .receipt { width: ${contentWidthMm}mm; max-width: 100%; margin: 0; overflow-wrap: anywhere; }
      .operation-code { text-align: center; font-weight: 900; letter-spacing: 0.08em; font-size: ${Math.round(style.headerFontSizePx * 1.3)}px; margin-bottom: 4px; }
      .custom-header { text-align: center; font-weight: 800; margin-bottom: 4px; }
      .non-fiscal { text-align: center; font-weight: 900; letter-spacing: 0.06em; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 0; margin-bottom: 4px; }
      .top-company { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .rule { border-top: 1px solid #000; margin: 4px 0 8px; }
      .header { text-align: center; }
      .logo-row { display: flex; justify-content: ${logoJustify}; }
      /* \`max-width\` para a logo larga num papel estreito encolher em vez de vazar. */
      .logo-slot { width: ${slotWidthMm}mm; max-width: 100%; height: ${slotHeightMm}mm; margin-bottom: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .logo-slot img { width: 100%; height: 100%; object-fit: ${logoFit}; image-rendering: pixelated; }
      .logo-fallback { font-size: ${Math.round(style.headerFontSizePx * 1.3)}px; font-weight: 800; text-align: center; line-height: 1.05; }
      .datetime { text-align: center; font-size: ${style.headerFontSizePx}px; font-weight: 700; line-height: 1.35; }
      .copy { margin: 8px 0 2px; text-align: center; font-size: ${Math.round(style.headerFontSizePx * 1.2)}px; font-weight: 900; letter-spacing: 0.04em; }
      .via { text-align: center; font-weight: 800; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; line-height: ${style.lineHeight}; ${style.boldBody ? "font-weight: 700;" : ""} }
      .num { font-size: ${style.numberFontSizePx}px; ${style.numberFontSizePx > style.fontSizePx ? "font-weight: 700;" : ""} }
      /*
        Linha decorativa: nunca quebra (\`white-space: pre\`). Com a fonte da pilha que o
        Windows tem (Consolas) as 48 colunas caem exatas na faixa util; com uma fonte
        substituta mais larga sobra um pedaco, e sobrar e melhor que quebrar — o excesso de
        tracos morre na borda do papel, enquanto a quebra jogava um toco de tracos na linha
        de baixo. Nenhuma informacao corre esse risco: aqui so passam tracos.
      */
      .rule-line { font-size: ${ruleFontSizePx}px; white-space: pre; }
    </style>
  </head>
  <body>
    <div class="receipt">
      ${header.operationCodeLabel ? `<div class="operation-code">${escapeHtml(receiptOperationCodeLine(header.operationCodeLabel))}</div>` : ""}
      ${header.customHeaderText ? `<div class="custom-header">${escapeHtml(header.customHeaderText)}</div>` : ""}
      ${header.nonFiscalLabel ? `<div class="non-fiscal">${escapeHtml(header.nonFiscalLabel)}</div>` : ""}
      ${header.companyName ? `<div class="top-company">${escapeHtml(header.companyName)}</div><div class="rule"></div>` : ""}
      <div class="header">
        ${style.showLogo ? `<div class="logo-row"><div class="logo-slot">${logoMarkup}</div></div>` : ""}
        ${
          header.dateLabel
            ? `<div class="datetime">
          <div>DATA: ${escapeHtml(header.dateLabel)}</div>
          <div>HORA: ${escapeHtml(header.timeLabel ?? "")}</div>
        </div>`
            : ""
        }
      </div>
      ${header.receiptNumberLabel ? `<div class="copy">${escapeHtml(receiptCopyNumberLine(header.receiptNumberLabel))}</div>` : ""}
      ${header.copyLabel ? `<div class="via">${escapeHtml(header.copyLabel)}</div>` : ""}
      <pre>${renderReceiptBody(snapshot.bodyLines, style.numberFontSizePx !== style.fontSizePx)}</pre>
    </div>
  </body>
</html>`;
}

/**
 * Corpo do cupom, linha por linha. As linhas decorativas (divisor e linha de assinatura,
 * que tem exatamente a largura do papel em caracteres) saem com a classe `rule-line`, no
 * tamanho que as faz caber inteiras: elas eram as unicas que estouravam a faixa util e
 * deixavam um pedaco de tracos sobrando na linha de baixo.
 */
function renderReceiptBody(bodyLines: string[], highlightNumbers: boolean): string {
  return bodyLines
    .map((line) =>
      isReceiptRuleLine(line)
        ? `<span class="rule-line">${escapeHtml(line)}</span>`
        : highlightReceiptNumbers(line, highlightNumbers)
    )
    .join("\n");
}

/**
 * Envolve os numeros do corpo em `<span class="num">` para que o tamanho configurado
 * para numeros valha so neles. Quando numero e corpo tem o mesmo tamanho o texto sai
 * apenas escapado, sem marcacao extra.
 */
function highlightReceiptNumbers(text: string, enabled: boolean): string {
  const escaped = escapeHtml(text);
  if (!enabled) return escaped;
  // Sequencias de digitos com separadores de milhar/decimal; a regex roda depois do
  // escape, entao nunca casa dentro de uma entidade HTML (&amp; nao tem digitos).
  return escaped.replace(/\d[\d.,]*/g, (match) => `<span class="num">${match}</span>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
