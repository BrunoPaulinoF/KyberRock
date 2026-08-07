import { answerFromDocumentation, retrieveDocumentationPassages } from "./documentation-search";

// ---------------------------------------------------------------------------
// Regras do assistente, separadas da tela para poderem ser testadas.
//
// Quem responde e a IA. Ela recebe a pergunta e os trechos que a busca local
// encontrou na documentacao instalada, e responde declarando DE ONDE tirou a
// resposta:
//
//   documentacao — os trechos cobriram; as fontes viram links para os guias.
//   conhecimento — os trechos nao cobriram, mas a IA sabe como o KyberRock e a
//                  integracao com o OMIE funcionam (briefing no prompt) e
//                  responde a partir dai, avisando que nao esta na documentacao.
//   desconhecido — nem uma coisa nem outra: encaminha ao suporte.
//
// A busca local nao e mais um portao: mesmo sem nenhum trecho a IA e chamada,
// porque a pergunta que a documentacao nao antecipou e justamente onde ela
// agrega. A resposta montada so com o texto local ficou como PISO — o que
// aparece quando nao ha internet ou a nuvem nao responde, que e quando o
// operador mais precisa de ajuda.
// ---------------------------------------------------------------------------

export interface AssistantSource {
  title: string;
  sectionId?: string;
}

export type AssistantOrigin = "cloud" | "local";
export type AssistantAnswerSource = "documentacao" | "conhecimento" | "desconhecido";

export interface AssistantReply {
  answer: string;
  /** De onde a resposta saiu — governa fontes, aviso e botao de suporte na tela. */
  answerSource: AssistantAnswerSource;
  sources: AssistantSource[];
  /** `cloud` = respondido pela IA; `local` = montado com a documentacao instalada. */
  origin: AssistantOrigin;
  /** `true` quando a IA nao respondeu e a documentacao local cobriu o lugar dela. */
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
    answerSource: string;
    sources: string[];
    reason?: string;
  }>;
}

/** Quantos turnos anteriores viajam junto. Curto de proposito: duvida de balanca e pontual. */
export const ASSISTANT_HISTORY_TURNS = 6;

/** Quantos trechos da documentacao acompanham a pergunta. */
export const ASSISTANT_PASSAGE_LIMIT = 6;

export const ASSISTANT_GREETING =
  "Ola! Sou o assistente do KyberRock. Pergunte com suas palavras — por exemplo " +
  '"como emito a nota fiscal?" ou "a balanca nao conecta". Respondo com base na documentacao ' +
  "deste sistema e no funcionamento dele com o OMIE; o que eu nao souber, te oriento a falar " +
  "com o suporte.";

/**
 * Encerramento acrescentado quando a resposta nao veio da documentacao. Curto e
 * complementar de proposito: o texto longo de "nao encontrei" contradiria a
 * parte que a IA conseguiu responder.
 */
export const SUPPORT_ESCALATION_NOTE =
  "Se isso nao resolver, fale diretamente com o suporte — a aba Suporte aqui da documentacao " +
  "tem o modelo de chamado pronto para copiar.";

export const ASSISTANT_SUGGESTIONS = [
  "Como emito a nota fiscal no OMIE?",
  "A balanca nao conecta, o que faco?",
  "Como tiro a segunda via do cupom?",
  "O cliente esta bloqueado por credito",
  "Estou sem internet, posso operar?",
  "Como fecho a carteira de um cliente?"
];

function toAnswerSource(value: unknown): AssistantAnswerSource {
  return value === "documentacao" || value === "conhecimento" ? value : "desconhecido";
}

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
 * Garante que uma resposta fora da documentacao sempre termine oferecendo o
 * suporte — inclusive quando a IA respondeu bem pelo conhecimento do sistema.
 * A parte util fica; ela so nao pode terminar como se fosse palavra final.
 */
export function withSupportEscalation(answer: string, answerSource: AssistantAnswerSource): string {
  if (answerSource === "documentacao") return answer;
  // A propria resposta ja pode ter oferecido o suporte; repetir soaria como erro.
  if (answer.toLowerCase().includes("suporte")) return answer;
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
  const passages = retrieveDocumentationPassages(question, ASSISTANT_PASSAGE_LIMIT);

  if (bridge) {
    try {
      const response = await bridge.docsAssistantAsk({
        question,
        passages: passages.map((passage) => ({ source: passage.source, text: passage.text })),
        history: buildAssistantHistory(history)
      });

      if (response?.available && typeof response.answer === "string" && response.answer.trim()) {
        const answerSource = toAnswerSource(response.answerSource);
        return {
          answer: withSupportEscalation(response.answer.trim(), answerSource),
          answerSource,
          sources:
            answerSource === "documentacao" ? matchSources(response.sources ?? [], passages) : [],
          origin: "cloud",
          offlineFallback: false
        };
      }
    } catch {
      // Cai para o local logo abaixo.
    }
  }

  const local = answerFromDocumentation(question);
  return {
    answer: local.answer,
    answerSource: local.grounded ? "documentacao" : "desconhecido",
    sources: local.sources,
    origin: "local",
    // Sem ponte (fora do Electron) nao houve nuvem a perder; com ponte, houve.
    offlineFallback: bridge !== null
  };
}
