import {
  buildThermalDotMap,
  isBlankDotRatio,
  type ThermalDotMapOptions
} from "./receipt-logo-raster.js";

export interface EscPosLine {
  text: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
}

/** Imagem monocromatica pronta para o comando de bit image da impressora. */
export interface EscPosRasterImage {
  widthPx: number;
  heightPx: number;
  /** 1 bit por pixel, MSB primeiro, cada linha alinhada em byte. Bit 1 = ponto preto. */
  bits: Buffer;
}

export type PackRasterOptions = ThermalDotMapOptions;

const ESC = 0x1b;
const GS = 0x1d;

/** Linhas por comando GS v 0: impressoras baratas travam com imagens grandes de uma vez so. */
const RASTER_BAND_HEIGHT = 128;

/**
 * Transforma o texto em ASCII imprimivel preservando a legibilidade. A codificacao "ascii" e
 * 7-bit e transformava qualquer acento (ã, ç, é, Á — comuns em razao social, cidade, endereco)
 * em bytes corrompidos ("IRMAOS ACUCAR" saia como "IRM?OS A??CAR"). Como a code page real da
 * impressora de rede e desconhecida, transliteramos acentos para a base ASCII (via NFD + remocao
 * dos diacriticos combinantes), o que imprime corretamente em qualquer code page.
 */
function toAsciiSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/º/g, "o")
    .replace(/ª/g, "a")
    .replace(/[^\x20-\x7e]/g, " ");
}

export function encodeEscPos(
  lines: string[],
  paperWidthMm: number,
  logo?: EscPosRasterImage | null
): Buffer {
  const buffers: Buffer[] = [];
  const maxChars = paperWidthMm <= 58 ? 32 : 48;

  buffers.push(Buffer.from([ESC, 0x40]));

  // A logo entra antes de qualquer texto, centralizada, como bit image — o cupom impresso
  // na impressora de rede sai igual ao da impressora do Windows (que renderiza a logo em HTML).
  const rasterLogo = logo ? encodeRasterImage(logo) : null;
  if (rasterLogo) {
    buffers.push(rasterLogo);
  }

  for (const line of lines) {
    const trimmed = line.replace(/\s+$/, "");
    if (isDivider(trimmed)) {
      buffers.push(Buffer.from([ESC, 0x45, 0x00]));
      buffers.push(Buffer.from("-".repeat(maxChars) + "\n", "ascii"));
      continue;
    }

    // A impressora centraliza pelo comando (ESC a 1), entao o recuo que o texto ja trazia
    // (o cupom em texto puro centraliza com espacos, para o ESC/POS e o HTML lerem a mesma
    // linha) seria somado ao dela e empurraria a linha para a direita — era assim que o
    // "COD 000123" saia deslocado, encostando na borda do papel.
    const centeredText = trimmed.trimStart();
    if (isCenterCandidate(centeredText)) {
      buffers.push(Buffer.from([ESC, 0x61, 0x01]));
      buffers.push(Buffer.from(toAsciiSafe(centeredText.slice(0, maxChars)) + "\n", "ascii"));
      buffers.push(Buffer.from([ESC, 0x61, 0x00]));
      continue;
    }

    buffers.push(Buffer.from([ESC, 0x61, 0x00]));
    buffers.push(Buffer.from(toAsciiSafe(trimmed.slice(0, maxChars)) + "\n", "ascii"));
  }

  buffers.push(Buffer.from([ESC, 0x64, 0x03]));
  buffers.push(Buffer.from([GS, 0x56, 0x00]));

  return Buffer.concat(buffers);
}

/**
 * Converte pixels RGBA/BGRA nos bits da impressora (1 = ponto preto). A regra de cor ->
 * ponto (alfa sobre o branco do papel, contraste da tinta e pontilhado) e a mesma da
 * previa da tela: ver `buildThermalDotMap`.
 */
export function packRasterImage(
  pixels: Uint8Array,
  widthPx: number,
  heightPx: number,
  options: PackRasterOptions = {}
): EscPosRasterImage | null {
  const dots = buildThermalDotMap(pixels, widthPx, heightPx, options);
  if (!dots) return null;

  const bytesPerRow = Math.ceil(widthPx / 8);
  const bits = Buffer.alloc(bytesPerRow * heightPx);

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      if (dots[y * widthPx + x]) {
        bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { widthPx, heightPx, bits };
}

/**
 * Reconstroi a imagem preto-e-branco a partir dos bits 1 bpp, em BGRA opaco — o formato que
 * `nativeImage.createFromBitmap` aceita. E assim que o cupom da impressora do Windows recebe
 * exatamente a mesma imagem que vai para a impressora de rede: o HTML nao leva mais a imagem
 * original (colorida, em qualquer formato), e sim o mesmo raster de 1 bit ja no tamanho final.
 */
export function rasterToBgraBitmap(raster: EscPosRasterImage): Buffer {
  const bytesPerRow = Math.ceil(raster.widthPx / 8);
  const bitmap = Buffer.alloc(raster.widthPx * raster.heightPx * 4);

  for (let y = 0; y < raster.heightPx; y += 1) {
    for (let x = 0; x < raster.widthPx; x += 1) {
      const isBlack = (raster.bits[y * bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      const channel = isBlack ? 0 : 255;
      const offset = (y * raster.widthPx + x) * 4;
      bitmap[offset] = channel;
      bitmap[offset + 1] = channel;
      bitmap[offset + 2] = channel;
      bitmap[offset + 3] = 255;
    }
  }

  return bitmap;
}

/** Quantidade de pontos que a impressora vai marcar (bits em 1). */
export function countRasterBlackDots(raster: EscPosRasterImage): number {
  let total = 0;
  for (const byte of raster.bits) {
    let value = byte;
    while (value !== 0) {
      total += value & 1;
      value >>= 1;
    }
  }
  return total;
}

/** Logo que sairia praticamente em branco na impressora termica (1 bit, sem tons). */
export function isRasterBlank(raster: EscPosRasterImage): boolean {
  return isBlankDotRatio(countRasterBlackDots(raster), raster.widthPx * raster.heightPx);
}

function encodeRasterImage(image: EscPosRasterImage): Buffer | null {
  const bytesPerRow = Math.ceil(image.widthPx / 8);

  if (bytesPerRow <= 0 || image.heightPx <= 0 || image.bits.length < bytesPerRow * image.heightPx) {
    return null;
  }

  const buffers: Buffer[] = [Buffer.from([ESC, 0x61, 0x01])];

  for (let row = 0; row < image.heightPx; row += RASTER_BAND_HEIGHT) {
    const bandHeight = Math.min(RASTER_BAND_HEIGHT, image.heightPx - row);
    buffers.push(
      Buffer.from([
        GS,
        0x76,
        0x30,
        0x00,
        bytesPerRow & 0xff,
        (bytesPerRow >> 8) & 0xff,
        bandHeight & 0xff,
        (bandHeight >> 8) & 0xff
      ])
    );
    buffers.push(
      Buffer.from(image.bits.subarray(row * bytesPerRow, (row + bandHeight) * bytesPerRow))
    );
  }

  buffers.push(Buffer.from([ESC, 0x61, 0x00]));
  buffers.push(Buffer.from("\n", "ascii"));

  return Buffer.concat(buffers);
}

function isDivider(line: string): boolean {
  return line.length > 10 && /^[=-]+$/.test(line);
}

function isCenterCandidate(line: string): boolean {
  if (line.length === 0) return false;
  const upper = line.toUpperCase();
  return (
    upper.includes("AGRADECEMOS") ||
    upper.includes("CUPOM DE TESTE") ||
    (line.length < 32 && /^[A-Z0-9 ./-]+$/.test(line) && !line.includes(":"))
  );
}
