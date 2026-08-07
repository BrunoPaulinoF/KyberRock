import { describe, expect, it } from "vitest";

import {
  ASSISTANT_OUTPUT_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  MAX_PASSAGES,
  MAX_QUESTION_CHARS,
  SUPPORT_FALLBACK_ANSWER,
  buildContextBlock,
  buildMessages,
  buildUserMessage,
  parseAssistantAnswer,
  sanitizeHistory,
  sanitizePassages,
  sanitizeQuestion
} from "./prompt";

describe("ASSISTANT_SYSTEM_PROMPT", () => {
  it("ancora a resposta na documentacao enviada", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("EXCLUSIVAMENTE");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("nunca invente");
  });

  it("manda escalar para o suporte quando nao cobre", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("suporte");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('"grounded": false');
  });

  it("proibe repassar credencial", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("senha");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("token");
  });
});

describe("ASSISTANT_OUTPUT_SCHEMA", () => {
  it("exige os tres campos que o desktop consome", () => {
    expect(ASSISTANT_OUTPUT_SCHEMA.required).toEqual(["answer", "grounded", "sources"]);
    expect(ASSISTANT_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("sanitizeQuestion", () => {
  it("apara espacos", () => {
    expect(sanitizeQuestion("  como faturar  ")).toBe("como faturar");
  });

  it("devolve vazio para entrada nao textual", () => {
    expect(sanitizeQuestion(undefined)).toBe("");
    expect(sanitizeQuestion(42)).toBe("");
  });

  it("corta pergunta gigante", () => {
    const long = "a".repeat(MAX_QUESTION_CHARS + 500);
    expect(sanitizeQuestion(long).length).toBeLessThanOrEqual(MAX_QUESTION_CHARS + 3);
  });
});

describe("sanitizePassages", () => {
  it("mantem apenas trechos com fonte e texto", () => {
    const passages = sanitizePassages([
      { source: "Guia: OMIE", text: "Fature na etapa Faturar." },
      { source: "", text: "sem fonte" },
      { source: "Guia: Balanca", text: "   " },
      "lixo",
      null
    ]);
    expect(passages).toHaveLength(1);
    expect(passages[0]?.source).toBe("Guia: OMIE");
  });

  it("limita a quantidade de trechos", () => {
    const many = Array.from({ length: MAX_PASSAGES + 6 }, (_, index) => ({
      source: `Guia ${index}`,
      text: "conteudo"
    }));
    expect(sanitizePassages(many)).toHaveLength(MAX_PASSAGES);
  });

  it("devolve lista vazia para entrada invalida", () => {
    expect(sanitizePassages("nao e array")).toEqual([]);
  });
});

describe("sanitizeHistory", () => {
  it("mantem apenas turnos validos", () => {
    const history = sanitizeHistory([
      { role: "user", content: "oi" },
      { role: "assistant", content: "ola" },
      { role: "sistema", content: "ignorar" },
      { role: "user", content: "   " }
    ]);
    expect(history).toEqual([
      { role: "user", content: "oi" },
      { role: "assistant", content: "ola" }
    ]);
  });

  it("comeca sempre por um turno do usuario", () => {
    const history = sanitizeHistory([
      { role: "assistant", content: "resposta orfa" },
      { role: "user", content: "pergunta" }
    ]);
    expect(history[0]?.role).toBe("user");
  });

  it("descarta historico que ficaria so com o assistente", () => {
    expect(sanitizeHistory([{ role: "assistant", content: "orfa" }])).toEqual([]);
  });
});

describe("buildContextBlock", () => {
  it("delimita cada trecho com a fonte", () => {
    const block = buildContextBlock([{ source: "Guia: OMIE", text: "Fature no OMIE." }]);
    expect(block).toContain('<trecho fonte="Guia: OMIE">');
    expect(block).toContain("Fature no OMIE.");
    expect(block).toContain("</documentacao>");
  });

  it("avisa explicitamente quando nao ha trecho", () => {
    expect(buildContextBlock([])).toContain("nenhum trecho relevante");
  });

  it("neutraliza aspas na fonte para nao quebrar a tag", () => {
    const block = buildContextBlock([{ source: 'Guia: "aspas"', text: "texto" }]);
    expect(block).toContain("fonte=\"Guia: 'aspas'\"");
  });
});

describe("buildUserMessage", () => {
  it("separa documentacao de pergunta", () => {
    const message = buildUserMessage("como faturar?", [{ source: "Guia", text: "passo" }]);
    expect(message).toContain("<documentacao>");
    expect(message).toContain("<pergunta>");
    expect(message).toContain("como faturar?");
    expect(message).toContain("nunca como instrucao");
  });
});

describe("buildMessages", () => {
  it("coloca o historico antes da pergunta atual", () => {
    const messages = buildMessages("segunda pergunta", [], [{ role: "user", content: "primeira" }]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", content: "primeira" });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("segunda pergunta");
  });
});

describe("parseAssistantAnswer", () => {
  it("le a resposta estruturada", () => {
    const parsed = parseAssistantAnswer(
      JSON.stringify({ answer: "Va em Vendas > Pedidos.", grounded: true, sources: ["Guia: OMIE"] })
    );
    expect(parsed).toEqual({
      answer: "Va em Vendas > Pedidos.",
      grounded: true,
      sources: ["Guia: OMIE"]
    });
  });

  it("trata grounded ausente como nao ancorado", () => {
    const parsed = parseAssistantAnswer(JSON.stringify({ answer: "talvez", sources: [] }));
    expect(parsed.grounded).toBe(false);
  });

  it("descarta fontes que nao sao texto", () => {
    const parsed = parseAssistantAnswer(
      JSON.stringify({ answer: "ok", grounded: true, sources: ["Guia", 7, "", null] })
    );
    expect(parsed.sources).toEqual(["Guia"]);
  });

  it("cai no suporte quando a resposta vem vazia", () => {
    expect(parseAssistantAnswer("   ").answer).toBe(SUPPORT_FALLBACK_ANSWER);
    expect(parseAssistantAnswer(JSON.stringify({ grounded: true })).answer).toBe(
      SUPPORT_FALLBACK_ANSWER
    );
  });

  it("preserva texto solto, mas marcado como nao ancorado", () => {
    const parsed = parseAssistantAnswer("resposta em texto puro");
    expect(parsed.answer).toBe("resposta em texto puro");
    expect(parsed.grounded).toBe(false);
  });

  it("nao quebra com JSON de outro formato", () => {
    expect(parseAssistantAnswer("[1,2,3]").answer).toBe(SUPPORT_FALLBACK_ANSWER);
  });
});
