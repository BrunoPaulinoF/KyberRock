import { describe, expect, it } from "vitest";

import { computeLogoRasterLayout, maxLogoWidthDots } from "./receipt-logo-raster";

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
