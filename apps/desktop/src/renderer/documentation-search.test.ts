import { describe, expect, it } from "vitest";

import {
  documentationFaqs,
  documentationGlossary,
  documentationSections,
  troubleshootingFlows
} from "./documentation-content";
import {
  SUPPORT_FALLBACK_ANSWER,
  answerFromDocumentation,
  expandQueryTerms,
  filterDocumentationContent,
  filterTroubleshootingFlows,
  normalizeSearchText,
  retrieveDocumentationPassages,
  searchDocumentation
} from "./documentation-search";

/** Um resultado esta entre os `n` primeiros? Usado para checar a ordenacao. */
function ranksWithin(
  query: string,
  predicate: (result: { kind: string; id: string }) => boolean,
  n: number
): boolean {
  return searchDocumentation(query, { limit: n }).some(predicate);
}

describe("normalizeSearchText", () => {
  it("remove acentos, pontuacao e caixa", () => {
    expect(normalizeSearchText("Sincronização, NÃO fez!")).toBe("sincronizacao nao fez");
  });

  it("devolve string vazia para entrada so de simbolos", () => {
    expect(normalizeSearchText("  ???  ")).toBe("");
  });
});

describe("expandQueryTerms", () => {
  it("descarta palavras vazias do portugues", () => {
    const { terms } = expandQueryTerms("como eu faco para emitir a nota");
    expect(terms).toContain("emitir");
    expect(terms).toContain("nota");
    expect(terms).not.toContain("como");
    expect(terms).not.toContain("para");
  });

  it("expande para o vocabulario do sistema", () => {
    const { expanded } = expandQueryTerms("nota");
    expect(expanded).toContain("nfe");
    expect(expanded).toContain("danfe");
  });

  it("mantem os termos originais quando a frase e so de palavras vazias", () => {
    const { terms } = expandQueryTerms("como que faz");
    expect(terms.length).toBeGreaterThan(0);
  });
});

describe("searchDocumentation", () => {
  it("devolve vazio para consulta em branco", () => {
    expect(searchDocumentation("   ")).toHaveLength(0);
  });

  it("acha o guia do OMIE por frase completa", () => {
    expect(
      ranksWithin(
        "como emitir nota fiscal",
        (result) => result.kind === "section" && result.id === "omie-billing",
        3
      )
    ).toBe(true);
  });

  it("acha o guia do OMIE mesmo com acentos digitados", () => {
    expect(
      ranksWithin(
        "como faço para emitir a nota fiscal no OMIE?",
        (result) => result.kind === "section" && result.id === "omie-billing",
        3
      )
    ).toBe(true);
  });

  it("acha o diagnostico certo pela frase do operador", () => {
    expect(
      ranksWithin(
        "o carregador nao ve a operacao",
        (result) => result.kind === "flow" && result.id === "loader-missing",
        3
      )
    ).toBe(true);
  });

  it("acha o bloqueio de credito pela frase completa", () => {
    expect(
      ranksWithin(
        "cliente bloqueado por credito",
        (result) => result.id === "credit-blocked" || result.id === "credit",
        3
      )
    ).toBe(true);
  });

  it("resolve sinonimo: quem digita 'ticket' acha o cupom", () => {
    const results = searchDocumentation("ticket nao saiu");
    expect(results.some((result) => result.id === "printing" || result.kind === "faq")).toBe(true);
  });

  it("resolve sinonimo: 'fiado' acha o guia de credito", () => {
    expect(ranksWithin("fiado", (result) => result.id === "credit", 5)).toBe(true);
  });

  it("acha a carteira pelo jeito que o operador fala do pagamento adiantado", () => {
    // "o cliente deixou pago e depois vem retirar" e a frase da pedreira, nao
    // "adiantamento de clientes" — as duas precisam cair no mesmo guia.
    expect(ranksWithin("cliente pagou adiantado", (result) => result.id === "wallet", 5)).toBe(
      true
    );
    expect(ranksWithin("abater do adiantamento", (result) => result.id === "wallet", 5)).toBe(true);
  });

  it("casa prefixo a partir de quatro letras", () => {
    expect(searchDocumentation("sincroniz").length).toBeGreaterThan(0);
  });

  it("nao devolve o corpus inteiro por causa de uma palavra comum", () => {
    const results = searchDocumentation("cliente bloqueado por credito no omie");
    const total =
      documentationSections.length +
      documentationFaqs.length +
      troubleshootingFlows.length +
      documentationGlossary.length;
    expect(results.length).toBeLessThan(total / 2);
  });

  it("ordena por relevancia decrescente", () => {
    const scores = searchDocumentation("faturar no omie").map((result) => result.score);
    const sorted = [...scores].sort((left, right) => right - left);
    expect(scores).toEqual(sorted);
  });

  it("respeita o limite pedido", () => {
    expect(searchDocumentation("omie", { limit: 2 })).toHaveLength(2);
  });

  it("filtra por tipo quando pedido", () => {
    const results = searchDocumentation("balanca", { kinds: ["flow"] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.kind === "flow")).toBe(true);
  });

  it("encontra o glossario por termo tecnico", () => {
    expect(ranksWithin("danfe", (result) => result.kind === "glossary", 6)).toBe(true);
  });

  it("nao inventa resultado para pergunta fora do escopo", () => {
    expect(searchDocumentation("qual a receita de bolo de cenoura")).toHaveLength(0);
  });
});

describe("filtros das abas", () => {
  it("devolve tudo quando a busca esta vazia", () => {
    const result = filterDocumentationContent("");
    expect(result.sections).toHaveLength(documentationSections.length);
    expect(result.faqs).toHaveLength(documentationFaqs.length);
  });

  it("filtra guias e duvidas pela consulta", () => {
    const result = filterDocumentationContent("balanca nao conecta");
    expect(result.sections.some((section) => section.id === "scale")).toBe(true);
    expect(result.faqs.length).toBeGreaterThan(0);
  });

  it("devolve todos os diagnosticos quando a consulta esta vazia", () => {
    expect(filterTroubleshootingFlows("  ")).toHaveLength(troubleshootingFlows.length);
  });

  it("filtra diagnosticos pelo sintoma", () => {
    const flows = filterTroubleshootingFlows("peso oscilando");
    expect(flows.some((flow) => flow.id === "scale-unstable")).toBe(true);
  });
});

describe("recuperacao para o assistente", () => {
  it("devolve trechos com fonte identificada", () => {
    const passages = retrieveDocumentationPassages("como emitir nota fiscal", 3);
    expect(passages.length).toBeGreaterThan(0);
    for (const passage of passages) {
      expect(passage.source).not.toHaveLength(0);
      expect(passage.text.trim()).not.toHaveLength(0);
    }
  });

  it("respeita o limite de trechos", () => {
    expect(retrieveDocumentationPassages("omie", 2)).toHaveLength(2);
  });

  it("responde localmente quando a documentacao cobre o assunto", () => {
    const answer = answerFromDocumentation("como faturar no omie");
    expect(answer.grounded).toBe(true);
    expect(answer.sources.length).toBeGreaterThan(0);
    expect(answer.answer).not.toBe(SUPPORT_FALLBACK_ANSWER);
  });

  it("manda falar com o suporte quando nao ha resposta na documentacao", () => {
    const answer = answerFromDocumentation("qual a cotacao do dolar hoje");
    expect(answer.grounded).toBe(false);
    expect(answer.answer).toBe(SUPPORT_FALLBACK_ANSWER);
    expect(answer.sources).toHaveLength(0);
  });
});

describe("integridade do conteudo", () => {
  it("todo guia tem passos, pontos importantes e palavras-chave", () => {
    for (const section of documentationSections) {
      expect(section.steps.length).toBeGreaterThan(0);
      expect(section.details.length).toBeGreaterThan(0);
      expect(section.keywords.length).toBeGreaterThan(0);
    }
  });

  it("toda duvida aponta para um guia existente quando declara um", () => {
    const ids = new Set(documentationSections.map((section) => section.id));
    for (const faq of documentationFaqs) {
      if (faq.sectionId) expect(ids).toContain(faq.sectionId);
    }
  });

  it("todo termo do glossario aponta para um guia existente quando declara um", () => {
    const ids = new Set(documentationSections.map((section) => section.id));
    for (const entry of documentationGlossary) {
      if (entry.sectionId) expect(ids).toContain(entry.sectionId);
    }
  });

  it("nao ha ids de guia repetidos", () => {
    const ids = documentationSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nao ha perguntas repetidas no FAQ", () => {
    const questions = documentationFaqs.map((faq) => faq.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("cobre os assuntos que o operador mais pergunta", () => {
    const mustFind = [
      "como emitir nota fiscal",
      "balanca nao conecta",
      "impressora nao imprime",
      "cliente bloqueado",
      "estou sem internet",
      "como cancelar uma pesagem",
      "segunda via do cupom",
      "fechar carteira",
      "como cobrar frete",
      "atalhos do teclado",
      "trocar de computador",
      "operacao pendente no omie"
    ];
    for (const query of mustFind) {
      expect(
        searchDocumentation(query, { limit: 1 }),
        `sem resultado para "${query}"`
      ).toHaveLength(1);
    }
  });
});
