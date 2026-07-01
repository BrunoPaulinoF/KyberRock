import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopDir = dirname(fileURLToPath(import.meta.url));

describe("desktop index document", () => {
  it("resets browser margins so the app fills the Electron window", () => {
    const html = readFileSync(resolve(desktopDir, "index.html"), "utf8");

    expect(html).toMatch(/html,\s*body,\s*#root\s*{/);
    expect(html).toContain("margin: 0");
    expect(html).toContain("min-height: 100%");
  });
});
