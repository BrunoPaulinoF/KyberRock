import { describe, expect, it } from "vitest";

import { computeNormalizedLogoSize, RECEIPT_LOGO_MAX_SIDE_PX } from "./receipt-logo-file";

describe("computeNormalizedLogoSize", () => {
  it("keeps small logos untouched", () => {
    expect(computeNormalizedLogoSize(500, 300)).toEqual({ width: 500, height: 300 });
  });

  it("shrinks oversized logos by the largest side, preserving the aspect ratio", () => {
    const size = computeNormalizedLogoSize(4000, 2000);

    expect(size.width).toBe(RECEIPT_LOGO_MAX_SIDE_PX);
    expect(size.height).toBe(RECEIPT_LOGO_MAX_SIDE_PX / 2);
  });

  it("never collapses a very thin logo to zero pixels", () => {
    expect(computeNormalizedLogoSize(4000, 1).height).toBe(1);
  });

  it("returns an empty size for an image without dimensions", () => {
    expect(computeNormalizedLogoSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
