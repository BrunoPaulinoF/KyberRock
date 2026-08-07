import type { DesktopDatabase } from "../database/sqlite.js";
import { readStringLocalSetting } from "./local-settings.js";
import {
  getSupabaseClient,
  initializeSupabaseFromSettings,
  isSupabaseInitialized
} from "./supabase-sync.js";

// ---------------------------------------------------------------------------
// Ponte do desktop com o assistente da documentacao (Edge Function
// `docs-assistant`).
//
// A recuperacao dos trechos acontece no renderer, em cima da documentacao que
// veio junto com o instalador. Este servico so faz o transporte: ele nao sabe
// nada sobre o conteudo, e nao pode saber — assim a documentacao continua
// versionada com o app, sem espelho na nuvem para manter em dia.
//
// Nenhuma falha aqui e fatal: quando a nuvem nao responde, o renderer usa a
// resposta local. Por isso o retorno separa `unavailable` (cai para o local,
// em silencio) de erro de verdade.
// ---------------------------------------------------------------------------

export interface DocsAssistantPassageInput {
  source: string;
  text: string;
}

export interface DocsAssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DocsAssistantRequest {
  question: string;
  passages: DocsAssistantPassageInput[];
  history: DocsAssistantTurn[];
}

export interface DocsAssistantResult {
  /** `true` quando a nuvem respondeu; `false` manda o renderer usar a resposta local. */
  available: boolean;
  answer: string;
  /** "documentacao" | "conhecimento" | "desconhecido" — validado no renderer. */
  answerSource: string;
  sources: string[];
  /** Motivo da indisponibilidade, para o log — nunca exibido cru ao operador. */
  reason?: string;
}

const CLOUD_DEVICE_ID_KEY = "cloud_device_id";
const CLOUD_DEVICE_TOKEN_KEY = "cloud_device_token";

function unavailable(reason: string): DocsAssistantResult {
  return { available: false, answer: "", answerSource: "desconhecido", sources: [], reason };
}

interface DocsAssistantResponseBody {
  ok?: boolean;
  answer?: unknown;
  answerSource?: unknown;
  sources?: unknown;
  error?: unknown;
}

function readAnswer(data: DocsAssistantResponseBody | null): DocsAssistantResult | null {
  if (!data || typeof data.answer !== "string" || !data.answer.trim()) return null;
  return {
    available: true,
    answer: data.answer.trim(),
    answerSource: typeof data.answerSource === "string" ? data.answerSource : "desconhecido",
    sources: Array.isArray(data.sources)
      ? data.sources.filter((item): item is string => typeof item === "string")
      : []
  };
}

/**
 * Pergunta ao assistente na nuvem. Devolve `available: false` sempre que a
 * consulta nao pode acontecer (sem internet, sem nuvem configurada, IA nao
 * habilitada na instalacao) — nunca lanca por isso, porque o chat precisa
 * continuar funcionando offline.
 */
export async function askDocsAssistant(
  database: DesktopDatabase,
  request: DocsAssistantRequest
): Promise<DocsAssistantResult> {
  const question = String(request?.question ?? "").trim();
  if (question.length < 2) {
    return unavailable("Pergunta vazia.");
  }

  // Tudo dentro do try, incluindo a leitura das configuracoes: nenhuma falha
  // daqui pode virar excecao. Uma tela de ajuda que quebra e inutil justamente
  // quando o operador precisa dela.
  try {
    const deviceId = readStringLocalSetting(database, CLOUD_DEVICE_ID_KEY);
    const deviceToken = readStringLocalSetting(database, CLOUD_DEVICE_TOKEN_KEY);
    if (!deviceId || !deviceToken) {
      return unavailable("Dispositivo ainda nao ativado na nuvem.");
    }

    initializeSupabaseFromSettings(database);
    if (!isSupabaseInitialized()) {
      return unavailable("Nuvem nao configurada neste computador.");
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke<DocsAssistantResponseBody>(
      "docs-assistant",
      {
        body: {
          deviceId,
          deviceToken,
          question,
          passages: Array.isArray(request.passages) ? request.passages : [],
          history: Array.isArray(request.history) ? request.history : []
        }
      }
    );

    if (error) {
      return unavailable(error instanceof Error ? error.message : "Assistente indisponivel.");
    }

    const answer = readAnswer(data ?? null);
    if (!answer) {
      const message = typeof data?.error === "string" ? data.error : "Resposta vazia da nuvem.";
      return unavailable(message);
    }
    return answer;
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Falha ao falar com a nuvem.");
  }
}
