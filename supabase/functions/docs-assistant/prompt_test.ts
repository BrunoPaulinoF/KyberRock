import { describe, expect, it } from "vitest";

import {
  ASSISTANT_OUTPUT_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  KYBERROCK_BRIEFING,
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

describe("KYBERROCK_BRIEFING", () => {
  it("descreve o que o assistente precisa saber para raciocinar sem os trechos", () => {
    for (const topic of [
      "offline-first",
      "peso liquido",
      "PEDIDO DE VENDA",
      "ORDEM DE SERVICO",
      "NUMERO DO ENDERECO",
      "idempotencia",
      "Em carteira",
      "bloqueio financeiro"
    ]) {
      expect(KYBERROCK_BRIEFING.toLowerCase(), `briefing sem "${topic}"`).toContain(
        topic.toLowerCase()
      );
    }
  });

  // O briefing e conhecimento ESTAVEL. Caminho de menu e nome de botao mudam a
  // cada versao e devem vir dos trechos da documentacao instalada — no briefing
  // eles viram instrucao errada para quem tem outra versao.
  it("nao congela caminho de menu nem nome de botao", () => {
    // Padrao de caminho de menu ("Vendas > Pedidos"); a seta de fluxo "->" das
    // etapas da operacao e outra coisa e continua permitida.
    expect(KYBERROCK_BRIEFING).not.toMatch(/[A-Za-z]\s>\s[A-Za-z]/);
    expect(KYBERROCK_BRIEFING.toLowerCase()).not.toContain("clique em");
  });
});

describe("ASSISTANT_SYSTEM_PROMPT", () => {
  it("carrega o briefing do sistema", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(KYBERROCK_BRIEFING);
  });

  it("define a ordem de decisao entre as tres origens", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('"documentacao"');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('"conhecimento"');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('"desconhecido"');
    // A documentacao instalada precisa vir antes do conhecimento geral.
    expect(ASSISTANT_SYSTEM_PROMPT.indexOf('"documentacao"')).toBeLessThan(
      ASSISTANT_SYSTEM_PROMPT.indexOf('"conhecimento"')
    );
  });

  it("proibe inventar tela, botao e caminho de menu", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("NUNCA invente nome de tela");
  });

  it("manda escalar para o suporte quando nao alcanca", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("suporte");
  });

  it("proibe repassar credencial", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("senha");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("token");
  });

  it("manda avisar do risco antes de acao destrutiva", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("diga o risco");
  });
});

describe("ASSISTANT_OUTPUT_SCHEMA", () => {
  it("exige os tres campos que o desktop consome", () => {
    expect(ASSISTANT_OUTPUT_SCHEMA.required).toEqual(["answer", "answerSource", "sources"]);
    expect(ASSISTANT_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it("restringe a origem as tres conhecidas", () => {
    expect(ASSISTANT_OUTPUT_SCHEMA.properties.answerSource.enum).toEqual([
      "documentacao",
      "conhecimento",
      "desconhecido"
    ]);
  });

  // O `strict: true` da OpenAI exige que TODA propriedade esteja em `required`
  // e `additionalProperties: false`. Quem esquecer disso ao adicionar um campo
  // nao ve erro no build: a API rejeita com 400 em producao e o chat degrada em
  // silencio para a resposta local. Este teste e a rede desse caso.
  it("continua compativel com o modo estrito de structured outputs", () => {
    const properties = Object.keys(ASSISTANT_OUTPUT_SCHEMA.properties);
    expect([...ASSISTANT_OUTPUT_SCHEMA.required].sort()).toEqual([...properties].sort());
    expect(ASSISTANT_OUTPUT_SCHEMA.type).toBe("object");
  });

  it("nao usa palavras-chave que o modo estrito recusa", () => {
    const unsupported = ["minLength", "maxLength", "pattern", "format", "minimum", "maximum"];
    const serialized = JSON.stringify(ASSISTANT_OUTPUT_SCHEMA);
    for (const keyword of unsupported) {
      expect(serialized, `schema usa "${keyword}"`).not.toContain(`"${keyword}"`);
    }
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

  // Sem trecho a IA nao para: ela e instruida a tentar pelo briefing. Este teste
  // trava esse contrato — trocar o texto por um "nao ha nada" seco faria o
  // modelo encerrar em "desconhecido" toda pergunta que a busca nao antecipou.
  it("orienta a responder pelo briefing quando nao ha trecho", () => {
    const block = buildContextBlock([]);
    expect(block).toContain("briefing");
    expect(block).toContain("suporte");
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
    expect(message).toContain("nunca como");
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
  it("le a resposta ancorada na documentacao", () => {
    const parsed = parseAssistantAnswer(
      JSON.stringify({
        answer: "Va em Vendas > Pedidos.",
        answerSource: "documentacao",
        sources: ["Guia: OMIE"]
      })
    );
    expect(parsed).toEqual({
      answer: "Va em Vendas > Pedidos.",
      answerSource: "documentacao",
      sources: ["Guia: OMIE"]
    });
  });

  it("le a resposta vinda do conhecimento do sistema", () => {
    const parsed = parseAssistantAnswer(
      JSON.stringify({
        answer: "O pedido nasce na etapa Faturar.",
        answerSource: "conhecimento",
        sources: []
      })
    );
    expect(parsed.answerSource).toBe("conhecimento");
    expect(parsed.answer).toContain("Faturar");
  });

  // Fonte so faz sentido quando a resposta veio dos trechos. Citar um guia numa
  // resposta de conhecimento geral daria ao operador uma confianca que o texto
  // nao sustenta — ele abriria o guia e nao acharia aquilo la.
  it("descarta fontes quando a resposta nao veio da documentacao", () => {
    const parsed = parseAssistantAnswer(
      JSON.stringify({ answer: "resposta", answerSource: "conhecimento", sources: ["Guia: OMIE"] })
    );
    expect(parsed.sources).toEqual([]);
  });

  it("trata origem ausente ou desconhecida como desconhecido", () => {
    expect(
      parseAssistantAnswer(JSON.stringify({ answer: "talvez", sources: [] })).answerSource
    ).toBe("desconhecido");
    expect(
      parseAssistantAnswer(JSON.stringify({ answer: "x", answerSource: "chute", sources: [] }))
        .answerSource
    ).toBe("desconhecido");
  });

  it("descarta fontes que nao sao texto", () => {
    const parsed = parseAssistantAnswer(
      JSON.stringify({
        answer: "ok",
        answerSource: "documentacao",
        sources: ["Guia", 7, "", null]
      })
    );
    expect(parsed.sources).toEqual(["Guia"]);
  });

  it("cai no suporte quando a resposta vem vazia", () => {
    expect(parseAssistantAnswer("   ").answer).toBe(SUPPORT_FALLBACK_ANSWER);
    expect(parseAssistantAnswer(JSON.stringify({ answerSource: "documentacao" })).answer).toBe(
      SUPPORT_FALLBACK_ANSWER
    );
  });

  it("preserva texto solto, mas sem creditar origem", () => {
    const parsed = parseAssistantAnswer("resposta em texto puro");
    expect(parsed.answer).toBe("resposta em texto puro");
    expect(parsed.answerSource).toBe("desconhecido");
  });

  it("nao quebra com JSON de outro formato", () => {
    expect(parseAssistantAnswer("[1,2,3]").answer).toBe(SUPPORT_FALLBACK_ANSWER);
  });
});
