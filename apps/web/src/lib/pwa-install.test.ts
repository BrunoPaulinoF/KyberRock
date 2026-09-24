import { describe, expect, it } from "vitest";

import { isIosDevice } from "./pwa-install";

describe("isIosDevice", () => {
  it("detects iPhone and iPad user agents", () => {
    expect(
      isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
    ).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15")).toBe(
      true
    );
  });

  it("detects iPadOS 13+ pretending to be a Mac by the touch screen", () => {
    const ipadOsUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(isIosDevice(ipadOsUa, 5)).toBe(true);
    expect(isIosDevice(ipadOsUa, 0)).toBe(false);
  });

  it("does not flag Android or desktop browsers", () => {
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36", 5)).toBe(
      false
    );
    expect(isIosDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", 0)).toBe(
      false
    );
  });
});
