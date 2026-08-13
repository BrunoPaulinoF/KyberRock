import {
  DEFAULT_RECEIPT_STYLE,
  receiptEscPosLayout,
  receiptEscPosRenderLine,
  splitReceiptNumbers,
  type ReceiptEscPosLayout,
  type ReceiptEscPosRenderedLine
} from "@kyberrock/print-templates";

import {
  buildThermalDotMap,
  isBlankDotRatio,
  type ThermalDotMapOptions
} from "./receipt-logo-raster.js";

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
 * Tamanho do caractere no comando `GS ! n`: os 4 bits altos multiplicam a largura e os 4
 * baixos a altura (0 = 1x, 1 = 2x). Quem decide os multiplicadores e `receiptEscPosLayout`,
 * em print-templates — aqui so viram bytes.
 */
function characterSize(widthScale: number, heightScale: number): number {
  return ((widthScale - 1) << 4) | (heightScale - 1);
}

const ALIGN_LEFT = 0x00;
const ALIGN_CENTER = 0x01;
const ALIGN_RIGHT = 0x02;

function alignByte(alignment: "left" | "center" | "right"): number {
  if (alignment === "center") return ALIGN_CENTER;
  return alignment === "right" ? ALIGN_RIGHT : ALIGN_LEFT;
}

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
  logo?: EscPosRasterImage | null,
  layout: ReceiptEscPosLayout = receiptEscPosLayout(DEFAULT_RECEIPT_STYLE, paperWidthMm),
  /**
   * Indice em que o CORPO do cupom comeca (o resto, antes, e cabecalho). So no corpo os
   * numeros saem em destaque — ver `receiptBodyStartIndex`. Sem ele, tudo e corpo.
   */
  bodyStartIndex = 0
): Buffer {
  const buffers: Buffer[] = [];

  buffers.push(Buffer.from([ESC, 0x40]));
  // Fonte embutida (ESC M) e entrelinha (ESC 3): a personalizacao da tela vira ISTO na
  // termica, que nao tem fonte em px nem entrelinha fracionaria.
  buffers.push(Buffer.from([ESC, 0x4d, layout.font === "B" ? 0x01 : 0x00]));
  buffers.push(Buffer.from([ESC, 0x33, layout.lineSpacingDots]));

  // A logo entra antes de qualquer texto, como bit image, no alinhamento configurado — o
  // cupom da impressora de rede sai igual ao da impressora do Windows em modo texto direto.
  const rasterLogo = logo ? encodeRasterImage(logo, layout.logoAlignment) : null;
  if (rasterLogo) {
    buffers.push(rasterLogo);
  }

  lines.forEach((line, index) => {
    buffers.push(
      encodeLine(receiptEscPosRenderLine(line, layout, index >= bodyStartIndex), layout)
    );
  });

  buffers.push(Buffer.from([ESC, 0x64, 0x03]));
  buffers.push(Buffer.from([GS, 0x56, 0x00]));

  return Buffer.concat(buffers);
}

/**
 * Uma linha ja resolvida vira bytes: alinhamento, tamanho do caractere, negrito e o texto.
 *
 * O recuo que a linha trazia (o cupom em texto puro centraliza com espacos, para o ESC/POS e o
 * HTML lerem a mesma linha) ja foi removido em `receiptEscPosRenderLine`: somado ao ESC a 1 da
 * impressora, ele empurrava o "COD 000123" para a borda do papel.
 */
function encodeLine(line: ReceiptEscPosRenderedLine, layout: ReceiptEscPosLayout): Buffer {
  const buffers: Buffer[] = [
    Buffer.from([ESC, 0x61, alignByte(line.align)]),
    Buffer.from([ESC, 0x45, line.bold ? 0x01 : 0x00]),
    Buffer.from([GS, 0x21, characterSize(line.widthScale, line.heightScale)])
  ];

  if (line.emphasizeNumbers) {
    // Os numeros do cupom (pesos, valores) saem mais altos que o texto, o mesmo recorte que o
    // HTML faz com `<span class="num">`. So a ALTURA muda: mexer na largura desalinharia o
    // bloco Quantidade/Unitario/Total, que e montado com colunas fixas.
    for (const part of splitReceiptNumbers(line.text)) {
      if (part.isNumber) {
        buffers.push(
          Buffer.from([GS, 0x21, characterSize(line.widthScale, layout.numberHeightScale)])
        );
      }
      buffers.push(Buffer.from(toAsciiSafe(part.text), "ascii"));
      if (part.isNumber) {
        buffers.push(Buffer.from([GS, 0x21, characterSize(line.widthScale, line.heightScale)]));
      }
    }
    buffers.push(Buffer.from("\n", "ascii"));
  } else {
    buffers.push(Buffer.from(toAsciiSafe(line.text) + "\n", "ascii"));
  }

  // Volta ao normal: a proxima linha declara o que precisa, e nenhum estado vaza para ela.
  buffers.push(Buffer.from([GS, 0x21, characterSize(1, 1)]));
  buffers.push(Buffer.from([ESC, 0x45, 0x00]));
  buffers.push(Buffer.from([ESC, 0x61, ALIGN_LEFT]));

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

function encodeRasterImage(
  image: EscPosRasterImage,
  alignment: "left" | "center" | "right" = "center"
): Buffer | null {
  const bytesPerRow = Math.ceil(image.widthPx / 8);

  if (bytesPerRow <= 0 || image.heightPx <= 0 || image.bits.length < bytesPerRow * image.heightPx) {
    return null;
  }

  const buffers: Buffer[] = [Buffer.from([ESC, 0x61, alignByte(alignment)])];

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
