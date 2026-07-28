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

export interface PackRasterOptions {
  /** Ordem dos canais do buffer de pixels. `toBitmap()` do Electron entrega BGRA. */
  order?: "bgra" | "rgba";
  /** Luminancia (0..1) abaixo da qual o ponto vira preto. */
  threshold?: number;
}

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

    if (isCenterCandidate(trimmed)) {
      buffers.push(Buffer.from([ESC, 0x61, 0x01]));
      buffers.push(Buffer.from(toAsciiSafe(trimmed.slice(0, maxChars)) + "\n", "ascii"));
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
 * Converte pixels RGBA/BGRA em bits 1 = preto. O canal alfa e composto sobre branco (papel),
 * entao logo com fundo transparente nao vira um bloco preto.
 */
export function packRasterImage(
  pixels: Uint8Array,
  widthPx: number,
  heightPx: number,
  options: PackRasterOptions = {}
): EscPosRasterImage | null {
  if (widthPx <= 0 || heightPx <= 0 || pixels.length < widthPx * heightPx * 4) {
    return null;
  }

  const redOffset = options.order === "rgba" ? 0 : 2;
  const blueOffset = options.order === "rgba" ? 2 : 0;
  const threshold = options.threshold ?? 0.5;
  const bytesPerRow = Math.ceil(widthPx / 8);
  const bits = Buffer.alloc(bytesPerRow * heightPx);

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const pixel = (y * widthPx + x) * 4;
      const alpha = pixels[pixel + 3] / 255;
      const red = pixels[pixel + redOffset] * alpha + 255 * (1 - alpha);
      const green = pixels[pixel + 1] * alpha + 255 * (1 - alpha);
      const blue = pixels[pixel + blueOffset] * alpha + 255 * (1 - alpha);
      const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

      if (luminance <= threshold) {
        bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { widthPx, heightPx, bits };
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
