import type { ReceiptLogoFit } from "./printing.js";

/**
 * Impressoras termicas de cupom trabalham a 203 dpi, ou seja, 8 pontos por milimetro.
 * A logo e configurada em milimetros na tela de impressao, entao a conversao para
 * pontos usa essa densidade.
 */
export const RECEIPT_PRINTER_DOTS_PER_MM = 8;

export interface LogoRasterLayout {
  /** Tamanho do redimensionamento da imagem original (pode ultrapassar a caixa no modo "cover"). */
  resizeWidth: number;
  resizeHeight: number;
  /** Recorte centralizado aplicado depois do resize (igual ao resize quando nao ha corte). */
  cropWidth: number;
  cropHeight: number;
  cropX: number;
  cropY: number;
}

/**
 * Largura util em pontos do papel: 384 pontos (48 mm) no papel de 58 mm e
 * 576 pontos (72 mm) no de 80 mm. Passar disso faz a impressora truncar a imagem.
 */
export function maxLogoWidthDots(paperWidthMm: number): number {
  return paperWidthMm <= 58 ? 384 : 576;
}

/**
 * Reproduz em pontos de impressao o mesmo enquadramento que o `object-fit` do CSS faz na
 * previa da tela: "contain" cabe inteira dentro da caixa, "cover" preenche e corta as sobras
 * pelo centro, "fill" estica ate a caixa exata.
 */
export function computeLogoRasterLayout(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: ReceiptLogoFit
): LogoRasterLayout | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return null;
  }

  if (fit === "fill") {
    return {
      resizeWidth: boxWidth,
      resizeHeight: boxHeight,
      cropWidth: boxWidth,
      cropHeight: boxHeight,
      cropX: 0,
      cropY: 0
    };
  }

  const scale =
    fit === "cover"
      ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const resizeWidth = Math.max(1, Math.round(sourceWidth * scale));
  const resizeHeight = Math.max(1, Math.round(sourceHeight * scale));

  if (fit === "cover") {
    const cropWidth = Math.min(boxWidth, resizeWidth);
    const cropHeight = Math.min(boxHeight, resizeHeight);
    return {
      resizeWidth,
      resizeHeight,
      cropWidth,
      cropHeight,
      cropX: Math.floor((resizeWidth - cropWidth) / 2),
      cropY: Math.floor((resizeHeight - cropHeight) / 2)
    };
  }

  return {
    resizeWidth,
    resizeHeight,
    cropWidth: resizeWidth,
    cropHeight: resizeHeight,
    cropX: 0,
    cropY: 0
  };
}
