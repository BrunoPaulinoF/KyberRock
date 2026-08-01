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

export function buildReceiptHtml(
  payload: ReceiptPrintPayload,
  printReadyLogo?: PrintReadyReceiptLogo | null
): string {
  const snapshot = payload.snapshot;
  const logo = snapshot.receiptLogo;
  // Com a logo ja rasterizada, o enquadramento foi feito na conversao: a caixa passa a ter o
  // tamanho da imagem e `contain` so mantem a proporcao (nao estica nem corta de novo).
  const slotWidthMm = printReadyLogo?.widthMm ?? logo.widthMm;
  const slotHeightMm = printReadyLogo?.heightMm ?? logo.heightMm;
  const logoFit = printReadyLogo ? "contain" : logo.fit;
  const logoSource = printReadyLogo?.dataUrl ?? logo.dataUrl;
  const logoMarkup = logoSource
    ? `<img src="${escapeHtml(logoSource)}" alt="Logo" />`
    : `<div class="logo-fallback">${escapeHtml(snapshot.unitName)}</div>`;
  const bodyLines = snapshot.lines.slice(6).join("\n");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: ${payload.paperWidthMm}mm auto; margin: 4mm; }
      body { margin: 0; font-family: Consolas, "Courier New", monospace; font-size: 11px; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .receipt { width: 100%; }
      .top-company { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .rule { border-top: 1px solid #000; margin: 4px 0 8px; }
      .header { text-align: center; }
      .logo-slot { width: ${slotWidthMm}mm; height: ${slotHeightMm}mm; margin: 0 auto 4px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .logo-slot img { width: 100%; height: 100%; object-fit: ${logoFit}; image-rendering: pixelated; }
      .logo-fallback { font-size: 18px; font-weight: 800; text-align: center; line-height: 1.05; }
      .datetime { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.35; }
      .copy { margin: 8px 0 2px; text-align: center; font-size: 17px; font-weight: 900; letter-spacing: 0.04em; }
      .via { text-align: center; font-weight: 800; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; line-height: 1.28; }
    </style>
  </head>
  <body>
    <div class="receipt">
      <div class="top-company">${escapeHtml(snapshot.companyName)}</div>
      <div class="rule"></div>
      <div class="header">
        <div class="logo-slot">${logoMarkup}</div>
        <div class="datetime">
          <div>DATA: ${escapeHtml(formatReceiptDate(snapshot.printedAt))}</div>
          <div>HORA: ${escapeHtml(formatReceiptTime(snapshot.printedAt))}</div>
        </div>
      </div>
      <div class="copy">COPIA NRO ${snapshot.receiptNumber.toString().padStart(9, "0")}</div>
      <div class="via">${snapshot.copyNumber > 1 ? `${snapshot.copyNumber}a VIA` : "1a VIA"}</div>
      <pre>${escapeHtml(bodyLines)}</pre>
    </div>
  </body>
</html>`;
}

function formatReceiptDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatReceiptTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
