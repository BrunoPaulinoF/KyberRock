// Gerador generico de PDF tabular (A4, retrato) para relatorios enviados por
// e-mail/WhatsApp a partir de Edge Functions. Deno Deploy nao tem um
// Chromium equivalente ao printToPDF do Electron (usado pelo desktop em
// apps/desktop/src/main/main.ts), entao aqui o PDF e desenhado diretamente
// com pdf-lib (puro JS, sem dependencias nativas/fontes externas).
import { type PDFFont, PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

export interface PdfTableColumn {
  header: string;
  /** Largura da coluna em pontos (A4 util = 595.28 - 2*margem). */
  width: number;
  align?: "left" | "right";
}

export interface PdfTableReportInput {
  title: string;
  subtitle?: string;
  generatedAtLabel: string;
  columns: PdfTableColumn[];
  rows: string[][];
  emptyMessage?: string;
  footerNote?: string;
}

const PAGE_WIDTH = 595.28; // A4 em pontos
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const ROW_HEIGHT = 16;
const HEADER_ROW_HEIGHT = 20;
const TITLE_SIZE = 14;
const SUBTITLE_SIZE = 10;
const META_SIZE = 8;
const BODY_SIZE = 8.5;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.4, 0.45, 0.5);
const HEADER_BG = rgb(0.12, 0.16, 0.24);
const HEADER_TEXT = rgb(1, 1, 1);
const STRIPE_BG = rgb(0.95, 0.96, 0.97);

/** Constroi um PDF A4 com titulo + tabela paginada. Colunas ficam alinhadas em todas as paginas. */
export async function buildTablePdf(input: PdfTableReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawTableHeader = (): void => {
    page.drawRectangle({
      x: MARGIN,
      y: y - HEADER_ROW_HEIGHT + 4,
      width: CONTENT_WIDTH,
      height: HEADER_ROW_HEIGHT,
      color: HEADER_BG
    });
    let x = MARGIN;
    for (const column of input.columns) {
      page.drawText(column.header, {
        x: x + 4,
        y: y - HEADER_ROW_HEIGHT + 8,
        size: BODY_SIZE,
        font: boldFont,
        color: HEADER_TEXT
      });
      x += column.width;
    }
    y -= HEADER_ROW_HEIGHT;
  };

  page.drawText(input.title, { x: MARGIN, y, size: TITLE_SIZE, font: boldFont, color: INK });
  y -= TITLE_SIZE + 6;
  if (input.subtitle) {
    page.drawText(input.subtitle, { x: MARGIN, y, size: SUBTITLE_SIZE, font, color: MUTED });
    y -= SUBTITLE_SIZE + 6;
  }
  page.drawText(`Gerado em ${input.generatedAtLabel}`, {
    x: MARGIN,
    y,
    size: META_SIZE,
    font,
    color: MUTED
  });
  y -= META_SIZE + 10;

  drawTableHeader();

  for (let i = 0; i < input.rows.length; i++) {
    if (y - ROW_HEIGHT < MARGIN + 20) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawTableHeader();
    }

    const row = input.rows[i];
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: y - ROW_HEIGHT + 4,
        width: CONTENT_WIDTH,
        height: ROW_HEIGHT,
        color: STRIPE_BG
      });
    }

    let x = MARGIN;
    for (let c = 0; c < input.columns.length; c++) {
      const column = input.columns[c];
      const text = truncateToWidth(row[c] ?? "", font, BODY_SIZE, column.width - 8);
      const textWidth = font.widthOfTextAtSize(text, BODY_SIZE);
      const textX = column.align === "right" ? x + column.width - textWidth - 6 : x + 4;
      page.drawText(text, { x: textX, y: y - ROW_HEIGHT + 8, size: BODY_SIZE, font, color: INK });
      x += column.width;
    }
    y -= ROW_HEIGHT;
  }

  if (input.rows.length === 0) {
    page.drawText(input.emptyMessage ?? "Nenhum registro no periodo.", {
      x: MARGIN,
      y: y - 8,
      size: BODY_SIZE,
      font,
      color: MUTED
    });
  }

  if (input.footerNote) {
    const lastPage = doc.getPage(doc.getPageCount() - 1);
    lastPage.drawText(input.footerNote, { x: MARGIN, y: 18, size: META_SIZE, font, color: MUTED });
  }

  return doc.save();
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (maxWidth <= 0 || font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
