import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";
import {
  ASSISTANT_OUTPUT_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  buildMessages,
  parseAssistantAnswer,
  sanitizeHistory,
  sanitizePassages,
  sanitizeQuestion,
  type AssistantAnswer
} from "./prompt.ts";

// ---------------------------------------------------------------------------
// Assistente da documentacao (botao de chat flutuante do desktop).
//
// O desktop e quem faz a recuperacao: ele varre a documentacao que veio no
// proprio instalador e manda so os trechos relevantes + a pergunta. Duas
// consequencias de proposito:
//
//   - a documentacao usada e SEMPRE a da versao instalada, sem espelho a
//     manter aqui e sem risco de o assistente citar uma tela que o operador
//     nao tem;
//   - nenhum dado de operacao, cliente ou peso sai do computador da balanca —
//     o que sobe e a nossa propria documentacao e a frase digitada.
//
// A chave da OpenAI vive so aqui, como toda credencial sensivel do projeto.
// ---------------------------------------------------------------------------

type DeviceRow = {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
};

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * A chave e o modelo vem da tabela `ai_assistant_settings`, cadastrada uma
 * unica vez no painel administrativo do loader-web e compartilhada por todas as
 * pedreiras. As envs abaixo sao so o caminho de emergencia (instalacao local,
 * ou o painel ainda nao configurado) — a fonte de verdade e a tabela, para que
 * trocar a chave nao dependa de acesso ao projeto Supabase.
 */
const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const OPENAI_MODEL_ENV = "OPENAI_MODEL";
const AI_SETTINGS_TABLE = "ai_assistant_settings";

const DEFAULT_MODEL = "gpt-4.1-mini";

interface AiSettings {
  apiKey: string;
  model: string;
  isEnabled: boolean;
}

/**
 * Le a configuracao da nuvem e completa com as envs. Falha de leitura nao
 * derruba nada: cai para as envs e, se nem elas existirem, o chamador responde
 * 503 e o desktop usa a documentacao local.
 */
async function readAiSettings(supabase: ReturnType<typeof createClient>): Promise<AiSettings> {
  const envKey = (Deno.env.get(OPENAI_API_KEY_ENV) ?? "").trim();
  const envModel = (Deno.env.get(OPENAI_MODEL_ENV) ?? "").trim();

  try {
    const { data, error } = await supabase
      .from(AI_SETTINGS_TABLE)
      .select("api_key, model, is_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    const row = (data ?? null) as {
      api_key?: string | null;
      model?: string | null;
      is_enabled?: boolean | null;
    } | null;

    return {
      apiKey: String(row?.api_key ?? "").trim() || envKey,
      model: String(row?.model ?? "").trim() || envModel || DEFAULT_MODEL,
      // `is_enabled` desliga o assistente de nuvem para todas as pedreiras sem
      // apagar a chave — util para cortar custo ou pausar durante um incidente.
      isEnabled: row?.is_enabled !== false
    };
  } catch (error) {
    console.error(
      "docs-assistant: nao consegui ler ai_assistant_settings, usando as envs",
      error instanceof Error ? error.message : error
    );
    return { apiKey: envKey, model: envModel || DEFAULT_MODEL, isEnabled: true };
  }
}

/**
 * Teto da resposta. Folgado de proposito: uma resposta cortada no meio vira
 * JSON invalido, e um JSON invalido custa mais (vira "fale com o suporte" sem
 * necessidade) do que os tokens economizados.
 */
const MAX_COMPLETION_TOKENS = 1_200;
const REQUEST_TIMEOUT_MS = 45_000;

interface OpenAiChoice {
  message?: {
    content?: string | null;
    /** Preenchido quando o modelo recusa sob structured outputs. */
    refusal?: string | null;
  };
  finish_reason?: string;
}

interface OpenAiChatResponse {
  choices?: OpenAiChoice[];
  error?: { message?: string; type?: string; code?: string };
}

const SUPPORT_ON_REFUSAL: AssistantAnswer = {
  answer:
    "Nao consigo responder essa pergunta por aqui. Fale diretamente com o suporte do KyberRock.",
  answerSource: "desconhecido",
  sources: []
};

async function askOpenAi(
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<AssistantAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        // `max_completion_tokens` em vez de `max_tokens`: e o campo aceito
        // tambem pelos modelos de raciocinio, entao trocar o modelo no
        // painel nunca exige mexer no codigo.
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // Sem `temperature` de proposito: varios modelos so aceitam o valor
        // padrao e rejeitam a requisicao com qualquer outro. Omitir mantem a
        // funcao compativel com qualquer modelo escolhido no painel.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "resposta_do_assistente",
            // Formato garantido pelo servidor: sem isso a deteccao de
            // "nao sei" viraria comparacao de string, que quebra a cada
            // mudanca de redacao.
            strict: true,
            schema: ASSISTANT_OUTPUT_SCHEMA
          }
        }
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as OpenAiChatResponse | null;

  if (!response.ok) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`OpenAI respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }

  const choice = payload?.choices?.[0];

  // Recusa do modelo sob structured outputs: `content` vem nulo e o motivo vai
  // em `refusal`. Nao ha resposta a ler — devolve o caminho do suporte.
  //
  // Sem tentar outro modelo de proposito: aqui a recusa nao e uma falha a
  // recuperar. O valor deste assistente e responder ancorado na documentacao,
  // e reenviar a pergunta so trocaria "nao sei" por um palpite.
  if (choice?.message?.refusal) {
    return SUPPORT_ON_REFUSAL;
  }
  if (choice?.finish_reason === "content_filter") {
    return SUPPORT_ON_REFUSAL;
  }

  // Resposta truncada: o JSON esta pela metade e nao da para confiar na origem
  // que ele declara. Melhor encaminhar do que entregar meia instrucao fiscal.
  if (choice?.finish_reason === "length") {
    console.error("docs-assistant: resposta truncada pelo limite de tokens");
    return SUPPORT_ON_REFUSAL;
  }

  return parseAssistantAnswer(choice?.message?.content ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");

  const { data: device, error: deviceError } = await supabase
    .from("device_registrations")
    .select("id, company_id, unit_id, token_hash, is_active")
    .eq("id", deviceId)
    .single();
  if (deviceError || !device) {
    return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
  }
  const typedDevice = device as DeviceRow;
  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, typedDevice.token_hash)) {
    return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
  }
  if (!typedDevice.is_active) {
    return jsonResponse({ error: "Dispositivo bloqueado" }, 401);
  }

  const question = sanitizeQuestion(body.question);
  if (question.length < 2) {
    return jsonResponse({ error: "Pergunta vazia." }, 400);
  }

  const settings = await readAiSettings(supabase);
  if (!settings.apiKey || !settings.isEnabled) {
    // Assistente de nuvem nao configurado ou desligado no painel. 503 e
    // proposital: o desktop reconhece isso e cai na resposta local, sem mostrar
    // erro ao operador.
    return jsonResponse({ error: "Assistente de IA nao configurado nesta instalacao." }, 503);
  }

  const passages = sanitizePassages(body.passages);
  const history = sanitizeHistory(body.history);

  try {
    const answer = await askOpenAi(settings.apiKey, settings.model, [
      { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
      ...buildMessages(question, passages, history)
    ]);
    return jsonResponse({ ok: true, ...answer, model: settings.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar o assistente.";
    console.error("docs-assistant: falha ao consultar a IA", message);
    return jsonResponse({ error: message }, 502);
  }
});
