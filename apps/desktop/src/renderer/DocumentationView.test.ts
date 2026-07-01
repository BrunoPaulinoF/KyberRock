import { describe, expect, it } from "vitest";

import { filterDocumentationContent } from "./DocumentationView";

describe("DocumentationView search", () => {
  it("finds scale integration guidance by keyword", () => {
    const result = filterDocumentationContent("balanca tcp");

    expect(result.sections.some((section) => section.id === "scale")).toBe(true);
  });

  it("finds printer troubleshooting in faq", () => {
    const result = filterDocumentationContent("impressora falhou");

    expect(result.faqs.some((faq) => faq.question.includes("impressao falhou"))).toBe(true);
  });

  it("normalizes accents while searching cloud content", () => {
    const result = filterDocumentationContent("sincroniza\u00e7\u00e3o omie");

    expect(result.sections.some((section) => section.id === "cloud")).toBe(true);
  });
});
