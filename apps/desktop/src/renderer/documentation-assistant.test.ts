import { describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_HISTORY_TURNS,
  ASSISTANT_PASSAGE_LIMIT,
  ASSISTANT_SUGGESTIONS,
  SUPPORT_ESCALATION_NOTE,
  askAssistant,
  buildAssistantHistory,
  matchSources,
  withSupportEscalation,
  type AssistantTurn,
  type DocsAssistantBridge
} from "./documentation-assistant";
import { SUPPORT_FALLBACK_ANSWER, searchDocumentation } from "./documentation-search";

function bridgeReturning(
  response: Awaited<ReturnType<DocsAssistantBridge["docsAssistantAsk"]>>
): DocsAssistantBridge & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    docsAssistantAsk: (request) => {
      calls.push(request);
      return Promise.resolve(response);
    }
  };
}

describe("matchSources", () => {
  const passages = [
    {
      source: "Guia: Faturar e emitir a nota no OMIE",
      title: "Faturar",
      sectionId: "omie-billing"
    },
    { source: "Duvida frequente: Como fecho uma pesagem?", title: "Como fecho uma pesagem?" }
  ];

  it("liga o rotulo da IA ao guia correspondente", () => {
    const sources = matchSources(["Guia: Faturar e emitir a nota no OMIE"], passages);
    expect(sources).toEqual([{ title: "Faturar", sectionId: "omie-billing" }]);
  });

  it("mantem a citacao mesmo quando o rotulo nao casa", () => {
    const sources = matchSources(["Guia: Alguma coisa que nao existe"], passages);
    expect(sources).toEqual([{ title: "Alguma coisa que nao existe" }]);
  });

  it("descarta rotulos repetidos e vazios", () => {
    const sources = matchSources(
      ["Guia: Faturar e emitir a nota no OMIE", "Guia: Faturar e emitir a nota no OMIE", "  "],
      passages
    );
    expect(sources).toHaveLength(1);
  });
});

describe("buildAssistantHistory", () => {
  it("mantem apenas os ultimos turnos", () => {
    const turns: AssistantTurn[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turno ${index}`
    }));
    const history = buildAssistantHistory(turns);
    expect(history).toHaveLength(ASSISTANT_HISTORY_TURNS);
    expect(history.at(-1)?.content).toBe("turno 19");
  });
});

describe("withSupportEscalation", () => {
  it("nao mexe na resposta vinda da documentacao", () => {
    expect(withSupportEscalation("Va em Vendas > Pedidos.", "documentacao")).toBe(
      "Va em Vendas > Pedidos."
    );
  });

  it("oferece o suporte na resposta vinda do conhecimento do sistema", () => {
    const result = withSupportEscalation("O pedido nasce na etapa Faturar.", "conhecimento");
    expect(result).toContain("O pedido nasce na etapa Faturar.");
    expect(result).toContain(SUPPORT_ESCALATION_NOTE);
  });

  it("oferece o suporte quando a origem e desconhecida", () => {
    expect(withSupportEscalation("Nao sei.", "desconhecido")).toContain(SUPPORT_ESCALATION_NOTE);
  });

  it("nao repete quando a resposta ja fala do suporte", () => {
    expect(withSupportEscalation(SUPPORT_FALLBACK_ANSWER, "desconhecido")).toBe(
      SUPPORT_FALLBACK_ANSWER
    );
  });
});

describe("askAssistant", () => {
  it("usa a resposta da nuvem quando ela vem da documentacao", async () => {
    const bridge = bridgeReturning({
      available: true,
      answer: "Abra Vendas > Pedidos de Venda e clique em Faturar.",
      answerSource: "documentacao",
      sources: ["Guia: Faturar e emitir a nota no OMIE"]
    });

    const reply = await askAssistant("como emito a nota fiscal?", [], bridge);

    expect(reply.origin).toBe("cloud");
    expect(reply.answerSource).toBe("documentacao");
    expect(reply.answer).toContain("Faturar");
    expect(reply.offlineFallback).toBe(false);
    expect(reply.sources.some((source) => source.sectionId === "omie-billing")).toBe(true);
  });

  it("aceita a resposta vinda do conhecimento do sistema, sem citar fonte", async () => {
    const bridge = bridgeReturning({
      available: true,
      answer: "O pedido de venda nasce no OMIE ja na etapa Faturar.",
      answerSource: "conhecimento",
      // Mesmo que a IA mande fonte, ela nao e exibida: a resposta nao veio dali.
      sources: ["Guia: Faturar e emitir a nota no OMIE"]
    });

    const reply = await askAssistant("como emito a nota fiscal?", [], bridge);

    expect(reply.origin).toBe("cloud");
    expect(reply.answerSource).toBe("conhecimento");
    expect(reply.sources).toHaveLength(0);
    expect(reply.answer).toContain(SUPPORT_ESCALATION_NOTE);
  });

  it("envia a documentacao local como contexto, e nada alem da pergunta", async () => {
    const bridge = bridgeReturning({
      available: true,
      answer: "ok",
      answerSource: "documentacao",
      sources: []
    });

    await askAssistant("como emito a nota fiscal?", [], bridge);

    const request = bridge.calls[0] as {
      question: string;
      passages: Array<{ source: string; text: string }>;
    };
    expect(request.question).toBe("como emito a nota fiscal?");
    expect(request.passages.length).toBeGreaterThan(0);
    expect(request.passages.length).toBeLessThanOrEqual(ASSISTANT_PASSAGE_LIMIT);
    for (const passage of request.passages) {
      expect(passage.source).not.toHaveLength(0);
      expect(passage.text).not.toHaveLength(0);
    }
  });

  // O ponto do assistente: a pergunta que a documentacao nao antecipou e
  // exatamente onde ele agrega. Curto-circuitar a nuvem quando a busca nao acha
  // nada o deixaria mudo justamente ali.
  it("chama a nuvem mesmo sem nenhum trecho da documentacao", async () => {
    const bridge = bridgeReturning({
      available: true,
      answer: "O KyberRock e offline-first: a pesagem fecha no computador da balanca.",
      answerSource: "conhecimento",
      sources: []
    });

    const reply = await askAssistant("posso usar em outro ramo?", [], bridge);

    expect(bridge.calls).toHaveLength(1);
    expect((bridge.calls[0] as { passages: unknown[] }).passages).toEqual([]);
    expect(reply.origin).toBe("cloud");
    expect(reply.answerSource).toBe("conhecimento");
  });

  it("limita o historico enviado a nuvem", async () => {
    const bridge = bridgeReturning({
      available: true,
      answer: "ok",
      answerSource: "documentacao",
      sources: []
    });
    const history: AssistantTurn[] = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turno ${index}`
    }));

    await askAssistant("como emito a nota fiscal?", history, bridge);

    const request = bridge.calls[0] as { history: AssistantTurn[] };
    expect(request.history).toHaveLength(ASSISTANT_HISTORY_TURNS);
  });

  it("trata origem desconhecida devolvida pela nuvem", async () => {
    const bridge = bridgeReturning({
      available: true,
      answer: "Nao alcanco essa.",
      answerSource: "desconhecido",
      sources: []
    });

    const reply = await askAssistant("como emito a nota fiscal?", [], bridge);

    expect(reply.answerSource).toBe("desconhecido");
    expect(reply.answer).toContain(SUPPORT_ESCALATION_NOTE);
    expect(reply.sources).toHaveLength(0);
  });

  it("cai para a documentacao local quando a nuvem esta indisponivel", async () => {
    const bridge = bridgeReturning({
      available: false,
      answer: "",
      answerSource: "desconhecido",
      sources: [],
      reason: "sem internet"
    });

    const reply = await askAssistant("como emito a nota fiscal?", [], bridge);

    expect(reply.origin).toBe("local");
    expect(reply.offlineFallback).toBe(true);
    expect(reply.answerSource).toBe("documentacao");
    expect(reply.answer.length).toBeGreaterThan(0);
  });

  it("cai para a documentacao local quando a ponte lanca", async () => {
    const bridge: DocsAssistantBridge = {
      docsAssistantAsk: () => Promise.reject(new Error("falha de rede"))
    };

    const reply = await askAssistant("como emito a nota fiscal?", [], bridge);

    expect(reply.origin).toBe("local");
    expect(reply.offlineFallback).toBe(true);
    expect(reply.answer.length).toBeGreaterThan(0);
  });

  it("responde localmente quando nao ha ponte (fora do Electron)", async () => {
    const reply = await askAssistant("como emito a nota fiscal?", [], null);

    expect(reply.origin).toBe("local");
    expect(reply.offlineFallback).toBe(false);
    expect(reply.answerSource).toBe("documentacao");
  });

  it("manda falar com o suporte quando nem a nuvem nem a documentacao alcancam", async () => {
    const reply = await askAssistant("qual a cotacao do dolar hoje?", [], null);

    expect(reply.answerSource).toBe("desconhecido");
    expect(reply.answer).toBe(SUPPORT_FALLBACK_ANSWER);
  });

  it("nunca lanca, mesmo com ponte que devolve lixo", async () => {
    const bridge = {
      docsAssistantAsk: vi.fn().mockResolvedValue(undefined)
    } as unknown as DocsAssistantBridge;

    await expect(askAssistant("como emito a nota fiscal?", [], bridge)).resolves.toMatchObject({
      origin: "local"
    });
  });
});

describe("sugestoes do chat", () => {
  it("toda sugestao encontra resposta na documentacao", () => {
    for (const suggestion of ASSISTANT_SUGGESTIONS) {
      expect(
        searchDocumentation(suggestion, { limit: 1 }),
        `sugestao sem resposta: "${suggestion}"`
      ).toHaveLength(1);
    }
  });
});
