import { describe, expect, it } from "vitest";

import {
  DOCUMENTATION_STYLE_ELEMENT_ID,
  buildSupportClipboardText,
  ensureDocumentationStyles,
  documentationFaqCategories,
  documentationFaqs,
  documentationGlossary,
  documentationSections,
  filterDocumentationContent,
  filterFaqsByCategory,
  filterTroubleshootingFlows,
  operationFlowStages,
  quickStartTasks,
  searchDocumentation,
  supportChecklist,
  troubleshootingFlows
} from "./DocumentationView";

describe("DocumentationView search", () => {
  it("finds scale integration guidance by keyword", () => {
    const result = filterDocumentationContent("balanca conexao");

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

  it("exposes the global search across every content type", () => {
    const kinds = new Set(
      [
        ...searchDocumentation("balanca"),
        ...searchDocumentation("danfe"),
        ...searchDocumentation("cliente bloqueado")
      ].map((result) => result.kind)
    );

    expect(kinds.has("section")).toBe(true);
    expect(kinds.has("faq")).toBe(true);
    expect(kinds.has("flow")).toBe(true);
    expect(kinds.has("glossary")).toBe(true);
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

  it("has at least one faq in every offered category", () => {
    for (const category of documentationFaqCategories) {
      if (category.id === "all") continue;
      expect(
        filterFaqsByCategory(category.id).length,
        `categoria vazia: ${category.id}`
      ).toBeGreaterThan(0);
    }
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

  it("covers the OMIE billing guide asked for by the operation", () => {
    const omie = documentationSections.find((section) => section.id === "omie-billing");

    expect(omie).toBeDefined();
    expect(omie?.steps.length).toBeGreaterThan(3);
    expect(omie?.details.join(" ")).toContain("NF-e");
  });

  it("keeps a glossary entry for the terms the guides rely on", () => {
    const terms = documentationGlossary.map((entry) => entry.term.toLowerCase());

    expect(terms.some((term) => term.includes("danfe"))).toBe(true);
    expect(terms.some((term) => term.includes("faturar"))).toBe(true);
    expect(terms.some((term) => term.includes("peso liquido"))).toBe(true);
  });
});

describe("DocumentationView stylesheet injection", () => {
  interface FakeStyleElement {
    id: string;
    textContent: string;
  }

  function withFakeDocument(run: () => void): FakeStyleElement[] {
    const appended: FakeStyleElement[] = [];
    const fakeDocument = {
      getElementById: (id: string) => appended.find((element) => element.id === id) ?? null,
      createElement: (): FakeStyleElement => ({ id: "", textContent: "" }),
      head: {
        appendChild: (element: FakeStyleElement) => appended.push(element)
      }
    };

    const globalWithDocument = globalThis as { document?: unknown };
    const previous = globalWithDocument.document;
    globalWithDocument.document = fakeDocument;
    try {
      run();
    } finally {
      if (previous === undefined) delete globalWithDocument.document;
      else globalWithDocument.document = previous;
    }
    return appended;
  }

  it("injects the stylesheet once, even when the screen is reopened", () => {
    const appended = withFakeDocument(() => {
      ensureDocumentationStyles();
      ensureDocumentationStyles();
      ensureDocumentationStyles();
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.id).toBe(DOCUMENTATION_STYLE_ELEMENT_ID);
    expect(appended[0]?.textContent).toContain(".krdoc-tab");
  });

  it("does nothing when there is no DOM available", () => {
    expect(() => ensureDocumentationStyles()).not.toThrow();
  });
});

describe("DocumentationView support template", () => {
  it("builds a fill-in template with the key diagnostic fields", () => {
    const template = buildSupportClipboardText();

    expect(template).toContain("CHAMADO DE SUPORTE");
    expect(template).toContain("Empresa / unidade:");
    expect(template).toContain("Codigo (COD) ou placa da operacao:");
    expect(template).toContain("Ultima acao antes da falha:");
  });

  it("keeps the on-screen checklist and the copied template aligned", () => {
    expect(supportChecklist.length).toBeGreaterThan(0);
    expect(buildSupportClipboardText().split("\n").length).toBeGreaterThan(supportChecklist.length);
  });
});
