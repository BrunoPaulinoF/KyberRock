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
 * Luminancia a partir da qual o pixel e considerado PAPEL (fundo), e nao tinta. Fundo
 * transparente e branco ficam de fora da conversao: sem esse corte, o erro espalhado
 * pelo pontilhado sujaria a volta da logo com pontos soltos.
 */
export const RECEIPT_LOGO_PAPER_LUMINANCE = 0.97;

/**
 * A logo so ganha o esticamento de contraste quando tem tinta de verdade: pelo menos um
 * pixel mais escuro que isto. Sem esse piso, uma logo de traco BRANCO (feita para fundo
 * escuro) teria as bordas suavizadas — quase papel — esticadas ate o preto, e sairia como
 * um contorno fantasma, escondendo o aviso de "esta logo sai em branco no cupom".
 */
export const RECEIPT_LOGO_MIN_INK_LUMINANCE = 0.9;

/**
 * Luminancia do pixel (0 = preto, 1 = papel) com o alfa composto sobre branco — a cor do
 * papel. Logo com fundo transparente nao vira um bloco preto, e uma logo de traco branco,
 * feita para fundo escuro, corretamente nao marca ponto nenhum.
 *
 * `premultiplied` diz se os canais ja vem multiplicados pelo alfa. O `toBitmap()` do
 * Electron entrega BGRA PREMULTIPLICADO (branco a 50% chega como 128,128,128,128),
 * enquanto o `getImageData` do canvas entrega RGBA direto. Compor um buffer
 * premultiplicado como se fosse direto aplica o alfa duas vezes e escurece toda a borda
 * suavizada da logo — era o que fazia o contorno de uma logo branca virar tinta.
 */
export function composeThermalLuminance(
  red: number,
  green: number,
  blue: number,
  alpha255: number,
  premultiplied = false
): number {
  const alpha = alpha255 / 255;
  const paper = 255 * (1 - alpha);
  const scale = premultiplied ? 1 : alpha;
  const composedRed = red * scale + paper;
  const composedGreen = green * scale + paper;
  const composedBlue = blue * scale + paper;
  return (0.299 * composedRed + 0.587 * composedGreen + 0.114 * composedBlue) / 255;
}

/**
 * Decide se um pixel RGBA vira um ponto marcado no papel, pelo limiar simples. Continua
 * valendo para decisoes pixel a pixel; a conversao da logo inteira usa `buildThermalDotMap`,
 * que aplica contraste e pontilhado.
 */
export function isThermalBlackPixel(
  red: number,
  green: number,
  blue: number,
  alpha255: number,
  threshold: number = RECEIPT_LOGO_LUMINANCE_THRESHOLD
): boolean {
  return composeThermalLuminance(red, green, blue, alpha255) <= threshold;
}

export interface ThermalDotMapOptions {
  /** Ordem dos canais do buffer de pixels. `toBitmap()` do Electron entrega BGRA. */
  order?: "bgra" | "rgba";
  /** Canais ja multiplicados pelo alfa (o caso do `toBitmap()` do Electron). */
  premultiplied?: boolean;
  /** Luminancia (0..1) abaixo da qual o ponto vira preto. */
  threshold?: number;
}

/**
 * Converte os pixels da logo no mapa de pontos da impressora termica: 1 byte por pixel,
 * 1 = ponto marcado. E o unico lugar onde a regra "cor -> ponto" existe — o raster
 * ESC/POS, o PNG monocromatico do HTML e a previa da tela usam todos esta funcao, entao
 * a previa nunca mente sobre o que sai no papel.
 *
 * Duas correcoes em relacao ao limiar direto que existia aqui:
 *
 * 1. **Contraste sobre a tinta.** A impressora e de 1 bit: com limiar fixo em 50%, TODA
 *    logo em cor de marca mais clara que o cinza medio (laranja, amarelo, azul claro,
 *    verde) virava papel em branco — o cupom saia sem logo nenhuma, enquanto a previa
 *    colorida da tela mostrava a logo perfeita. Agora a faixa de luminancia da tinta e
 *    normalizada antes da conversao: o tom mais escuro da logo vira preto solido, e uma
 *    logo de cor unica sai como silhueta cheia, em qualquer cor.
 * 2. **Pontilhado (Floyd-Steinberg).** Os meios-tons viram padrao de pontos, como a
 *    impressora faz com foto, em vez de sumirem ou virarem um bloco chapado.
 */
export function buildThermalDotMap(
  pixels: Uint8Array | Uint8ClampedArray,
  widthPx: number,
  heightPx: number,
  options: ThermalDotMapOptions = {}
): Uint8Array | null {
  if (widthPx <= 0 || heightPx <= 0 || pixels.length < widthPx * heightPx * 4) {
    return null;
  }

  const redOffset = options.order === "rgba" ? 0 : 2;
  const blueOffset = options.order === "rgba" ? 2 : 0;
  const threshold = options.threshold ?? RECEIPT_LOGO_LUMINANCE_THRESHOLD;
  const total = widthPx * heightPx;
  const luminance = new Float32Array(total);
  const isPaper = new Uint8Array(total);
  let darkestInk = 1;

  for (let index = 0; index < total; index += 1) {
    const pixel = index * 4;
    const value = composeThermalLuminance(
      pixels[pixel + redOffset],
      pixels[pixel + 1],
      pixels[pixel + blueOffset],
      pixels[pixel + 3],
      options.premultiplied === true
    );
    luminance[index] = value;
    if (value >= RECEIPT_LOGO_PAPER_LUMINANCE) {
      isPaper[index] = 1;
      continue;
    }
    if (value < darkestInk) darkestInk = value;
  }

  // Estica a tinta ate o preto: uma logo de cor unica clara (o caso que sumia) passa a
  // marcar ponto, e uma logo que ja tem preto continua exatamente como estava.
  const inkRange = RECEIPT_LOGO_PAPER_LUMINANCE - darkestInk;
  if (inkRange > 0 && darkestInk <= RECEIPT_LOGO_MIN_INK_LUMINANCE) {
    for (let index = 0; index < total; index += 1) {
      if (isPaper[index]) {
        luminance[index] = 1;
        continue;
      }
      luminance[index] = Math.min(1, Math.max(0, (luminance[index] - darkestInk) / inkRange));
    }
  }

  const dots = new Uint8Array(total);
  const working = Float32Array.from(luminance);

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const index = y * widthPx + x;
      if (isPaper[index]) continue;

      const current = working[index];
      const black = current <= threshold;
      dots[index] = black ? 1 : 0;
      const error = current - (black ? 0 : 1);
      // Floyd-Steinberg: o erro do arredondamento vai para os vizinhos ainda nao
      // convertidos, o que transforma meio-tom em pontilhado em vez de bloco/vazio.
      diffuse(working, isPaper, widthPx, heightPx, x + 1, y, (error * 7) / 16);
      diffuse(working, isPaper, widthPx, heightPx, x - 1, y + 1, (error * 3) / 16);
      diffuse(working, isPaper, widthPx, heightPx, x, y + 1, (error * 5) / 16);
      diffuse(working, isPaper, widthPx, heightPx, x + 1, y + 1, error / 16);
    }
  }

  return dots;
}

/** Espalha o erro do pontilhado; o papel nunca recebe erro, para nao sujar o fundo. */
function diffuse(
  working: Float32Array,
  isPaper: Uint8Array,
  widthPx: number,
  heightPx: number,
  x: number,
  y: number,
  error: number
): void {
  if (x < 0 || x >= widthPx || y < 0 || y >= heightPx) return;
  const index = y * widthPx + x;
  if (isPaper[index]) return;
  working[index] += error;
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
