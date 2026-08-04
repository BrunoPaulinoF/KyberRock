import { describe, expect, it } from "vitest";

import {
  buildThermalDotMap,
  composeThermalLuminance,
  computeLogoRasterLayout,
  dotsToMm,
  isBlankDotRatio,
  isThermalBlackPixel,
  maxLogoWidthDots
} from "./receipt-logo-raster";

describe("computeLogoRasterLayout", () => {
  it("fits the whole logo inside the box without cropping (contain)", () => {
    const layout = computeLogoRasterLayout(400, 100, 192, 128, "contain");

    expect(layout).toEqual({
      resizeWidth: 192,
      resizeHeight: 48,
      cropWidth: 192,
      cropHeight: 48,
      cropX: 0,
      cropY: 0
    });
  });

  it("fills the box and crops the overflow from the center (cover)", () => {
    const layout = computeLogoRasterLayout(400, 100, 192, 128, "cover");

    expect(layout?.resizeWidth).toBe(512);
    expect(layout?.resizeHeight).toBe(128);
    expect(layout?.cropWidth).toBe(192);
    expect(layout?.cropHeight).toBe(128);
    expect(layout?.cropX).toBe(160);
    expect(layout?.cropY).toBe(0);
  });

  it("stretches to the exact box (fill)", () => {
    const layout = computeLogoRasterLayout(400, 100, 192, 128, "fill");

    expect(layout?.resizeWidth).toBe(192);
    expect(layout?.resizeHeight).toBe(128);
    expect(layout?.cropWidth).toBe(192);
    expect(layout?.cropHeight).toBe(128);
  });

  it("never returns a zero-sized layout for very wide logos", () => {
    const layout = computeLogoRasterLayout(4000, 2, 192, 128, "contain");

    expect(layout?.resizeWidth).toBeGreaterThan(0);
    expect(layout?.resizeHeight).toBeGreaterThan(0);
  });

  it("returns null when the image or the box has no area", () => {
    expect(computeLogoRasterLayout(0, 100, 192, 128, "contain")).toBeNull();
    expect(computeLogoRasterLayout(400, 100, 192, 0, "contain")).toBeNull();
  });
});

describe("maxLogoWidthDots", () => {
  it("uses the printable width of each paper size", () => {
    expect(maxLogoWidthDots(58)).toBe(384);
    expect(maxLogoWidthDots(80)).toBe(576);
  });
});

describe("dotsToMm", () => {
  it("converts printer dots back to the millimetres printed on paper", () => {
    expect(dotsToMm(192)).toBe(24);
    expect(dotsToMm(128)).toBe(16);
  });
});

describe("isThermalBlackPixel", () => {
  it("marks a dot for dark ink and leaves light ink unprinted", () => {
    expect(isThermalBlackPixel(0, 0, 0, 255)).toBe(true);
    expect(isThermalBlackPixel(255, 255, 255, 255)).toBe(false);
  });

  it("treats transparency as paper, so a transparent background never prints black", () => {
    expect(isThermalBlackPixel(0, 0, 0, 0)).toBe(false);
  });

  it("does not print a white logo made for dark backgrounds", () => {
    // Traco branco sobre fundo transparente: a previa colorida mostra a logo, o papel nao.
    expect(isThermalBlackPixel(255, 255, 255, 255)).toBe(false);
    expect(isThermalBlackPixel(200, 200, 200, 255)).toBe(false);
  });
});

describe("isBlankDotRatio", () => {
  it("flags a logo that would come out as an empty area", () => {
    expect(isBlankDotRatio(0, 24_576)).toBe(true);
    expect(isBlankDotRatio(50, 24_576)).toBe(true);
  });

  it("accepts a logo with real ink coverage", () => {
    expect(isBlankDotRatio(3_072, 24_576)).toBe(false);
  });

  it("treats an empty box as blank", () => {
    expect(isBlankDotRatio(0, 0)).toBe(true);
  });
});

/** Bloco RGBA de uma cor so, no formato do `getImageData` do canvas. */
function solidRgba(
  width: number,
  height: number,
  [red, green, blue, alpha]: [number, number, number, number]
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels.set([red, green, blue, alpha], index * 4);
  }
  return pixels;
}

function countDots(dots: Uint8Array | null): number {
  return dots ? dots.reduce((total, dot) => total + dot, 0) : 0;
}

describe("buildThermalDotMap", () => {
  it("prints a logo in a light brand colour instead of leaving the receipt blank", () => {
    // Laranja de marca (245,166,35): luminancia 0.69, acima do limiar de 50%. Com o
    // limiar direto que existia aqui, NENHUM ponto era marcado — a logo aparecia na
    // previa colorida da tela e o cupom saia sem logo nenhuma.
    const dots = buildThermalDotMap(solidRgba(16, 16, [245, 166, 35, 255]), 16, 16, {
      order: "rgba"
    });

    expect(countDots(dots)).toBe(256);
  });

  it("keeps a black logo solid and the paper around it clean", () => {
    const black = buildThermalDotMap(solidRgba(8, 8, [0, 0, 0, 255]), 8, 8, { order: "rgba" });
    const transparent = buildThermalDotMap(solidRgba(8, 8, [0, 0, 0, 0]), 8, 8, { order: "rgba" });

    expect(countDots(black)).toBe(64);
    expect(countDots(transparent)).toBe(0);
  });

  it("still refuses to invent ink for a white logo made for dark backgrounds", () => {
    // O aviso "esta logo sai em branco no cupom" depende disto: traco branco nao pode
    // ganhar contraste e virar uma silhueta preta.
    const dots = buildThermalDotMap(solidRgba(8, 8, [255, 255, 255, 255]), 8, 8, {
      order: "rgba"
    });

    expect(countDots(dots)).toBe(0);
  });

  it("halftones a gradient instead of losing half of it", () => {
    const width = 64;
    const height = 8;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tone = Math.round((x / (width - 1)) * 255);
        pixels.set([tone, tone, tone, 255], (y * width + x) * 4);
      }
    }

    const dots = buildThermalDotMap(pixels, width, height, { order: "rgba" });
    const marked = countDots(dots);

    // Meio-tom vira padrao de pontos: nem tudo preto, nem tudo branco.
    expect(marked).toBeGreaterThan(width * height * 0.2);
    expect(marked).toBeLessThan(width * height * 0.8);
  });

  it("reads premultiplied bitmaps without darkening the anti-aliased edges", () => {
    // `toBitmap()` do Electron entrega BGRA premultiplicado: branco a 50% chega como
    // (128,128,128,128). Lido como se fosse direto, o alfa era aplicado duas vezes e a
    // borda de uma logo branca virava tinta.
    expect(composeThermalLuminance(128, 128, 128, 128, true)).toBeCloseTo(1, 2);
    expect(composeThermalLuminance(128, 128, 128, 128)).toBeCloseTo(0.75, 2);

    const dots = buildThermalDotMap(solidRgba(8, 8, [128, 128, 128, 128]), 8, 8, {
      order: "rgba",
      premultiplied: true
    });

    expect(countDots(dots)).toBe(0);
  });

  it("rejects a pixel buffer that does not match the declared size", () => {
    expect(buildThermalDotMap(new Uint8Array(8), 16, 8)).toBeNull();
  });
});
