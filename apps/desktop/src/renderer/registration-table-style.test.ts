import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));

describe("registration table styling", () => {
  it("keeps desktop registration tables aligned with the customer list pattern", () => {
    const source = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");

    expect(source).toContain("crudTableHeaderCell");
    expect(source).toContain("crudTableCell");
    expect(source).toContain("crudTableActionsCell");
    expect(source).toContain("gap: 0");
    expect(source).toContain('padding: "8px 12px"');
    expect(source).toContain('minHeight: "44px"');
  });

  it("keeps report recipient table aligned with the same surface treatment", () => {
    const source = readFileSync(resolve(rendererDir, "ReportsView.tsx"), "utf8");

    expect(source).toContain('borderRadius: "14px"');
    expect(source).toContain('boxShadow: "var(--kr-shadow)"');
    expect(source).toContain('padding: "8px 12px"');
    expect(source).toContain('minHeight: "44px"');
  });
});
