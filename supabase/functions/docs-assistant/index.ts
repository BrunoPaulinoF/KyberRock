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
// A chave da Anthropic vive so aqui, como toda credencial sensivel do projeto.
// ---------------------------------------------------------------------------

type DeviceRow = {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
};

/** Ver AGENTS.md ("Secrets & security"): configurado como secret da Edge Function. */
const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ASSISTANT_MODEL = "claude-opus-5";
const ANTHROPIC_TIMEOUT_MS = 45_000;

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  model?: string;
}

function extractText(response: AnthropicMessageResponse): string {
  return (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

async function askAnthropic(
  apiKey: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AssistantAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        // Teto do turno inteiro (raciocinio + resposta). Folgado de proposito:
        // uma resposta cortada no meio e pior do que uma resposta um pouco mais
        // cara, e o `effort: low` ja mantem o raciocinio curto.
        max_tokens: 4_000,
        system: ASSISTANT_SYSTEM_PROMPT,
        // Duvida de documentacao nao precisa de raciocinio profundo, e o
        // operador esta esperando na tela: `low` responde rapido sem perder a
        // ancoragem, que aqui vem do contexto e nao do raciocinio.
        output_config: {
          effort: "low",
          // Formato garantido: sem isso a deteccao de "nao sei" viraria
          // comparacao de string, que quebra a cada mudanca de redacao.
          format: { type: "json_schema", schema: ASSISTANT_OUTPUT_SCHEMA }
        },
        messages
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Anthropic respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as AnthropicMessageResponse;

  // Classificador de seguranca recusou a requisicao: `content` vem vazio ou
  // parcial. Nao ha o que ler — devolve o caminho do suporte.
  //
  // Sem `fallbacks` de proposito: aqui a recusa nao e uma falha a recuperar. O
  // valor deste assistente e responder ancorado na documentacao, e mandar a
  // pergunta para outro modelo so trocaria "nao sei" por um palpite. Encaminhar
  // ao suporte E a resposta certa neste caso.
  if (payload.stop_reason === "refusal") {
    return {
      answer:
        "Nao consigo responder essa pergunta por aqui. Fale diretamente com o suporte do KyberRock.",
      grounded: false,
      sources: []
    };
  }

  return parseAssistantAnswer(extractText(payload));
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

  const apiKey = Deno.env.get(ANTHROPIC_API_KEY_ENV) ?? "";
  if (!apiKey) {
    // Assistente de nuvem nao configurado. 503 e proposital: o desktop
    // reconhece isso e cai na resposta local, sem mostrar erro ao operador.
    return jsonResponse({ error: "Assistente de IA nao configurado nesta instalacao." }, 503);
  }

  const passages = sanitizePassages(body.passages);
  const history = sanitizeHistory(body.history);

  try {
    const answer = await askAnthropic(apiKey, buildMessages(question, passages, history));
    return jsonResponse({ ok: true, ...answer, model: ASSISTANT_MODEL });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar o assistente.";
    console.error("docs-assistant: falha ao consultar a IA", message);
    return jsonResponse({ error: message }, 502);
  }
});
