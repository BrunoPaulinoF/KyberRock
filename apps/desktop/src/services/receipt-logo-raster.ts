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

/** Converte pontos de impressao (203 dpi) de volta para milimetros. */
export function dotsToMm(dots: number): number {
  return dots / RECEIPT_PRINTER_DOTS_PER_MM;
}

/** Luminancia (0..1) abaixo da qual o ponto vira preto na impressora termica. */
export const RECEIPT_LOGO_LUMINANCE_THRESHOLD = 0.5;

/**
 * Decide se um pixel RGBA vira um ponto marcado no papel. O alfa e composto sobre branco
 * (a cor do papel), entao logo com fundo transparente nao vira um bloco preto — e uma logo
 * de traco branco, feita para fundo escuro, corretamente nao marca ponto nenhum.
 *
 * A mesma regra vale para o raster enviado a impressora e para a previa termica da tela:
 * o que o operador ve na previa e exatamente o que a impressora marca.
 */
export function isThermalBlackPixel(
  red: number,
  green: number,
  blue: number,
  alpha255: number,
  threshold: number = RECEIPT_LOGO_LUMINANCE_THRESHOLD
): boolean {
  const alpha = alpha255 / 255;
  const composedRed = red * alpha + 255 * (1 - alpha);
  const composedGreen = green * alpha + 255 * (1 - alpha);
  const composedBlue = blue * alpha + 255 * (1 - alpha);
  const luminance = (0.299 * composedRed + 0.587 * composedGreen + 0.114 * composedBlue) / 255;
  return luminance <= threshold;
}

/**
 * Fracao minima de pontos pretos para a logo aparecer no papel. Abaixo disso o que sai e
 * praticamente uma area em branco — o caso classico da logo clara (ou branca sobre fundo
 * transparente), que fica perfeita na previa colorida da tela e some no cupom.
 */
export const BLANK_LOGO_MAX_DOT_RATIO = 0.005;

/** Logo que sairia praticamente em branco na impressora termica (1 bit, sem tons). */
export function isBlankDotRatio(blackDots: number, totalDots: number): boolean {
  if (totalDots <= 0) return true;
  return blackDots / totalDots <= BLANK_LOGO_MAX_DOT_RATIO;
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
