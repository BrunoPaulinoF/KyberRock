import {
  computeLogoRasterLayout,
  isBlankDotRatio,
  isThermalBlackPixel,
  maxLogoWidthDots,
  RECEIPT_PRINTER_DOTS_PER_MM
} from "../services/receipt-logo-raster.js";
import type { ReceiptLogoFit } from "../services/printing.js";

/**
 * Maior lado guardado da logo. A logo sai no maximo com 60 mm (480 pontos a 203 dpi), entao
 * 1024 px ja e o dobro do necessario — o resto so inchava o perfil salvo no SQLite.
 */
export const RECEIPT_LOGO_MAX_SIDE_PX = 1024;

export function computeNormalizedLogoSize(
  width: number,
  height: number,
  maxSide: number = RECEIPT_LOGO_MAX_SIDE_PX
): { width: number; height: number } {
  const largest = Math.max(width, height);
  if (largest <= 0) return { width: 0, height: 0 };
  if (largest <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxSide / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/**
 * Converte a logo escolhida pelo operador em PNG.
 *
 * Motivo: a previa da tela e o cupom da impressora do Windows usam o Chromium, que abre
 * WebP, GIF, BMP, SVG e AVIF; mas a rasterizacao da logo no processo principal usa o
 * `nativeImage` do Electron, que so le PNG e JPEG. Uma logo em WebP (o formato que o
 * navegador salva por padrao) aparecia perfeita na previa e simplesmente nao saia no papel.
 * Guardando sempre PNG, os dois caminhos leem a mesma imagem.
 */
export async function readReceiptLogoAsPngDataUrl(file: File): Promise<string> {
  const image = await loadImageFromFile(file);
  const size = computeNormalizedLogoSize(image.naturalWidth, image.naturalHeight);

  if (size.width <= 0 || size.height <= 0) {
    throw new Error("Imagem sem dimensoes.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Nao foi possivel processar a imagem.");
  }

  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL("image/png");
}

export interface ThermalLogoPreview {
  /** PNG preto-e-branco no tamanho de pontos que a impressora usa. */
  dataUrl: string;
  /** Sai praticamente em branco no papel. */
  blank: boolean;
  widthPx: number;
  heightPx: number;
}

/**
 * Previa de como a logo sai no cupom: a impressora termica marca ponto ou nao marca, sem
 * tons de cinza. Repete o enquadramento e o limiar usados na impressao, para o operador
 * conferir na tela antes de gastar papel.
 */
export async function renderThermalLogoPreview(
  dataUrl: string,
  widthMm: number,
  heightMm: number,
  fit: ReceiptLogoFit,
  paperWidthMm = 80
): Promise<ThermalLogoPreview | null> {
  const image = await loadImageFromSource(dataUrl);
  const layout = computeLogoRasterLayout(
    image.naturalWidth,
    image.naturalHeight,
    Math.min(Math.round(widthMm * RECEIPT_PRINTER_DOTS_PER_MM), maxLogoWidthDots(paperWidthMm)),
    Math.round(heightMm * RECEIPT_PRINTER_DOTS_PER_MM),
    fit
  );

  if (!layout) return null;

  const canvas = document.createElement("canvas");
  canvas.width = layout.cropWidth;
  canvas.height = layout.cropHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) return null;

  context.drawImage(image, -layout.cropX, -layout.cropY, layout.resizeWidth, layout.resizeHeight);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let blackDots = 0;

  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const black = isThermalBlackPixel(
      pixels.data[offset],
      pixels.data[offset + 1],
      pixels.data[offset + 2],
      pixels.data[offset + 3]
    );
    const channel = black ? 0 : 255;
    if (black) blackDots += 1;
    pixels.data[offset] = channel;
    pixels.data[offset + 1] = channel;
    pixels.data[offset + 2] = channel;
    pixels.data[offset + 3] = 255;
  }

  context.putImageData(pixels, 0, 0);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    blank: isBlankDotRatio(blackDots, canvas.width * canvas.height),
    widthPx: canvas.width,
    heightPx: canvas.height
  };
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  return loadImageFromSource(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
}

function loadImageFromSource(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error("Formato de imagem nao suportado. Use PNG ou JPG."))
    );
    image.src = source;
  });
}
