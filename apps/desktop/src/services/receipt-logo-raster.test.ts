import { describe, expect, it } from "vitest";

import {
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
