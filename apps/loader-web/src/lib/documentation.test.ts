import { describe, expect, it } from "vitest";

import { documentationFileName, documentationUrl } from "./documentation";

describe("documentation link", () => {
  it("serves the guide PDF from the site root", () => {
    expect(documentationUrl).toBe(`/${documentationFileName}`);
    expect(documentationUrl.startsWith("/")).toBe(true);
  });

  it("points to a .pdf asset", () => {
    expect(documentationFileName.endsWith(".pdf")).toBe(true);
  });
});
