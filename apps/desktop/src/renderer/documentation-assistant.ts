import { answerFromDocumentation, retrieveDocumentationPassages } from "./documentation-search";

// ---------------------------------------------------------------------------
// Regras do assistente, separadas da tela para poderem ser testadas.
//
// O assistente tem dois niveis, nesta ordem de preferencia:
//
//   1. NUVEM — a IA reescreve, em linguagem natural, a resposta a partir dos
//      trechos da documentacao que este computador enviou. Ancorada por
//      construcao: ela so ve os trechos.
//   2. LOCAL — a propria documentacao instalada, recuperada aqui. E o piso:
//      funciona sem internet, que e exatamente quando o operador mais precisa
//      de ajuda.
//
// Em qualquer nivel, o que nao esta na documentacao vira "fale com o suporte".
// Nao existe caminho em que o assistente responda de cabeca.
// ---------------------------------------------------------------------------

export interface AssistantSource {
  title: string;
  sectionId?: string;
}

export type AssistantOrigin = "cloud" | "local";

export interface AssistantReply {
  answer: string;
  /** `false` = a documentacao nao cobre; a tela oferece o caminho do suporte. */
  grounded: boolean;
  sources: AssistantSource[];
  origin: AssistantOrigin;
  /** `true` quando a nuvem nao respondeu e a resposta veio da documentacao local. */
  offlineFallback: boolean;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DocsAssistantBridge {
  docsAssistantAsk: (request: {
    question: string;
    passages: Array<{ source: string; text: string }>;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<{
    available: boolean;
    answer: string;
    grounded: boolean;
    sources: string[];
    reason?: string;
  }>;
}

/** Quantos turnos anteriores viajam junto. Curto de proposito: duvida de balanca e pontual. */
export const ASSISTANT_HISTORY_TURNS = 6;

export const ASSISTANT_GREETING =
  "Ola! Sou o assistente da documentacao do KyberRock. Pergunte com suas palavras — " +
  'por exemplo "como emito a nota fiscal?" ou "a balanca nao conecta". Respondo com base ' +
  "na documentacao deste sistema e, quando ela nao cobrir, te oriento a falar com o suporte.";

/**
 * Encerramento acrescentado quando a IA responde so em parte. Curto e
 * complementar de proposito: o texto longo de "nao encontrei" contradiria a
 * parte que ela conseguiu responder.
 */
export const SUPPORT_ESCALATION_NOTE =
  "Para o que ficou de fora, fale diretamente com o suporte — a aba Suporte aqui da documentacao " +
  "tem o modelo de chamado pronto para copiar.";

export const ASSISTANT_SUGGESTIONS = [
  "Como emito a nota fiscal no OMIE?",
  "A balanca nao conecta, o que faco?",
  "Como tiro a segunda via do cupom?",
  "O cliente esta bloqueado por credito",
  "Estou sem internet, posso operar?",
  "Como fecho a carteira de um cliente?"
];

/**
 * Casa o rotulo da fonte devolvido pela IA ("Guia: Faturar e emitir a nota no
 * OMIE") com o trecho local correspondente, para poder abrir o guia com um
 * clique. Rotulo desconhecido vira fonte sem link em vez de sumir: perder a
 * citacao seria pior do que perder o link.
 */
export function matchSources(
  labels: string[],
  passages: Array<{ source: string; title: string; sectionId?: string }>
): AssistantSource[] {
  const byLabel = new Map(passages.map((passage) => [passage.source, passage]));
  const seen = new Set<string>();
  const sources: AssistantSource[] = [];

  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const passage = byLabel.get(trimmed);
    sources.push(
      passage
        ? { title: passage.title, sectionId: passage.sectionId }
        : { title: trimmed.replace(/^[^:]+:\s*/, "") }
    );
  }

  return sources;
}

export function buildAssistantHistory(turns: AssistantTurn[]): AssistantTurn[] {
  return turns.slice(-ASSISTANT_HISTORY_TURNS);
}

/**
 * Garante que uma resposta nao ancorada sempre termine mandando falar com o
 * suporte — mesmo quando a IA respondeu parte da pergunta. A parte util fica;
 * so nao pode terminar como se fosse resposta completa.
 */
export function withSupportEscalation(answer: string, grounded: boolean): string {
  if (grounded) return answer;
  const normalized = answer.toLowerCase();
  // A propria funcao na nuvem ja pode ter devolvido o texto completo de
  // escalonamento; nesse caso repetir soaria como erro.
  if (normalized.includes("suporte")) return answer;
  return `${answer}\n\n${SUPPORT_ESCALATION_NOTE}`;
}

/**
 * Responde uma pergunta. Nunca lanca: erro de rede, IPC ausente ou resposta
 * malformada caem para a documentacao local. Uma tela de ajuda que quebra
 * quando algo da errado e inutil justamente na hora em que e necessaria.
 */
export async function askAssistant(
  question: string,
  history: AssistantTurn[],
  bridge: DocsAssistantBridge | null
): Promise<AssistantReply> {
  const local = answerFromDocumentation(question);
  const passages = retrieveDocumentationPassages(question, 6);

  if (!bridge || passages.length === 0) {
    // Sem ponte com a nuvem, ou sem nada na documentacao para embasar a
    // resposta: nao ha o que a IA possa fazer melhor do que o texto local.
    return {
      answer: local.answer,
      grounded: local.grounded,
      sources: local.sources,
      origin: "local",
      offlineFallback: false
    };
  }

  try {
    const response = await bridge.docsAssistantAsk({
      question,
      passages: passages.map((passage) => ({ source: passage.source, text: passage.text })),
      history: buildAssistantHistory(history)
    });

    if (response?.available && typeof response.answer === "string" && response.answer.trim()) {
      const grounded = response.grounded === true;
      return {
        answer: withSupportEscalation(response.answer.trim(), grounded),
        grounded,
        sources: grounded ? matchSources(response.sources ?? [], passages) : [],
        origin: "cloud",
        offlineFallback: false
      };
    }
  } catch {
    // Cai para o local logo abaixo.
  }

  return {
    answer: local.answer,
    grounded: local.grounded,
    sources: local.sources,
    origin: "local",
    offlineFallback: true
  };
}
