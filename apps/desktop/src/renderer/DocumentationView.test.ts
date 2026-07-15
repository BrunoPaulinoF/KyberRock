import { describe, expect, it } from "vitest";

import {
  buildSupportClipboardText,
  documentationFaqCategories,
  documentationFaqs,
  documentationSections,
  filterDocumentationContent,
  filterFaqsByCategory,
  filterTroubleshootingFlows,
  operationFlowStages,
  quickStartTasks,
  troubleshootingFlows
} from "./DocumentationView";

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
    const result = filterDocumentationContent("sincronização omie");

    expect(result.sections.some((section) => section.id === "cloud")).toBe(true);
  });

  it("finds troubleshooting flows by symptom keywords", () => {
    const flows = filterTroubleshootingFlows("peso oscilando");

    expect(flows.some((flow) => flow.id === "scale-unstable")).toBe(true);
  });

  it("returns every flow when the query is empty", () => {
    expect(filterTroubleshootingFlows("  ")).toHaveLength(troubleshootingFlows.length);
  });
});

describe("DocumentationView faq categories", () => {
  it("assigns every faq to a known category", () => {
    const knownCategories = documentationFaqCategories
      .map((category) => category.id)
      .filter((id) => id !== "all");

    for (const faq of documentationFaqs) {
      expect(knownCategories).toContain(faq.category);
    }
  });

  it("returns all faqs for the all category", () => {
    expect(filterFaqsByCategory("all")).toHaveLength(documentationFaqs.length);
  });

  it("filters faqs by a specific category", () => {
    const printingFaqs = filterFaqsByCategory("impressao");

    expect(printingFaqs.length).toBeGreaterThan(0);
    expect(printingFaqs.every((faq) => faq.category === "impressao")).toBe(true);
  });
});

describe("DocumentationView cross-links", () => {
  it("links every quick start task to an existing guide", () => {
    const sectionIds = documentationSections.map((section) => section.id);

    for (const task of quickStartTasks) {
      expect(sectionIds).toContain(task.sectionId);
    }
  });

  it("links every operation flow stage to an existing guide", () => {
    const sectionIds = documentationSections.map((section) => section.id);

    for (const stage of operationFlowStages) {
      expect(sectionIds).toContain(stage.sectionId);
    }
  });
});

describe("DocumentationView support template", () => {
  it("builds a fill-in template with the key diagnostic fields", () => {
    const template = buildSupportClipboardText();

    expect(template).toContain("CHAMADO DE SUPORTE");
    expect(template).toContain("Empresa / unidade:");
    expect(template).toContain("Placa da operacao");
    expect(template).toContain("Ultima acao antes da falha:");
  });
});
