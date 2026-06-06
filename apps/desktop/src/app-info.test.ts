import { describe, expect, it } from "vitest";

import { desktopAppInfo, getDesktopFoundationCapabilities } from "./app-info";

describe("desktopAppInfo", () => {
  it("marks the desktop app as offline-first", () => {
    expect(desktopAppInfo.offlineFirst).toBe(true);
  });
});

describe("getDesktopFoundationCapabilities", () => {
  it("includes scale adapters", () => {
    expect(getDesktopFoundationCapabilities()).toContain("scale-adapters");
  });
});
