import { useEffect, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  AI_MODEL_CUSTOM,
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  findAiModelHint,
  isKnownAiModel
} from "../lib/ai-models";

// ---------------------------------------------------------------------------
// Configuracao da IA do assistente da documentacao.
//
// A credencial e GLOBAL: cadastrada uma vez aqui e usada por todas as pedreiras.
// Por isso esta aba nao respeita o filtro de empresa do dashboard — deixar um
// seletor de pedreira ao lado sugeriria que cada uma tem a sua chave, que e o
// contrario da decisao de produto.
//
// A chave nunca volta do servidor: o painel recebe apenas os quatro ultimos
// caracteres, para o administrador reconhecer qual esta gravada. Salvar sem
// tocar no campo mantem a chave atual.
// ---------------------------------------------------------------------------

interface AiSettingsView {
  provider: string;
  model: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string;
  updatedAt: string | null;
}

const CARD: React.CSSProperties = {
  background: "#fff",
  padding: "24px",
  borderRadius: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "16px"
};

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 700,
  color: "#0f172a",
  marginBottom: "6px"
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  fontSize: "14px",
  background: "#fff",
  color: "#0f172a"
};

const HINT: React.CSSProperties = {
  margin: "6px 0 0 0",
  fontSize: "12px",
  color: "#64748b",
  lineHeight: 1.5
};

export function AiAssistantSettings({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [modelChoice, setModelChoice] = useState<string>(DEFAULT_AI_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);

  // Carrega uma vez ao abrir a aba; depois de salvar, o proprio `save` recarrega.
  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    try {
      const data = await callAdminFunction<{ settings: AiSettingsView }>("admin-api", {
        action: "get_ai_settings"
      });
      const loaded = data.settings;
      setSettings(loaded);
      setIsEnabled(loaded.isEnabled);
      const model = loaded.model || DEFAULT_AI_MODEL;
      if (isKnownAiModel(model)) {
        setModelChoice(model);
        setCustomModel("");
      } else {
        setModelChoice(AI_MODEL_CUSTOM);
        setCustomModel(model);
      }
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "error", text: getMessage(error) });
    } finally {
      setIsLoading(false);
    }
  }

  const effectiveModel = modelChoice === AI_MODEL_CUSTOM ? customModel.trim() : modelChoice;

  async function save() {
    if (!effectiveModel) {
      setFeedback({ tone: "error", text: "Escolha ou digite o modelo de IA." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      await callAdminFunction("admin-api", {
        action: "update_ai_settings",
        payload: {
          provider: "openai",
          model: effectiveModel,
          isEnabled,
          // Campo em branco = manter a chave gravada. Apagar de verdade e o
          // botao dedicado abaixo, para ninguem desligar a IA sem querer ao
          // salvar so uma troca de modelo.
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
        }
      });
      setApiKey("");
      setFeedback({ tone: "ok", text: "Configuracao salva. Vale para todas as pedreiras." });
      await load();
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "error", text: getMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  async function removeKey() {
    if (!window.confirm("Remover a chave? O assistente volta a responder so com a documentacao.")) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      await callAdminFunction("admin-api", {
        action: "update_ai_settings",
        payload: {
          provider: "openai",
          model: effectiveModel || DEFAULT_AI_MODEL,
          isEnabled,
          apiKey: ""
        }
      });
      setApiKey("");
      setFeedback({ tone: "ok", text: "Chave removida." });
      await load();
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "error", text: getMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p style={{ color: "#64748b" }}>Carregando configuracao da IA...</p>;
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "720px" }}>
      <article style={CARD}>
        <div>
          <h2 style={{ margin: "0 0 6px 0" }}>Assistente de IA</h2>
          <p style={{ margin: 0, color: "#64748b", fontSize: "14px", lineHeight: 1.55 }}>
            Credencial unica usada por <strong>todas as pedreiras</strong>. Ela alimenta o chat da
            tela de Documentacao do desktop, que responde com base na documentacao instalada e no
            funcionamento do sistema com o OMIE. Sem chave, o chat continua funcionando apenas com a
            documentacao local.
          </p>
        </div>

        {feedback ? (
          <p
            role="status"
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: "8px",
              fontSize: "13px",
              background: feedback.tone === "ok" ? "#dcfce7" : "#fee2e2",
              color: feedback.tone === "ok" ? "#166534" : "#b91c1c"
            }}
          >
            {feedback.text}
          </p>
        ) : null}

        <div>
          <label style={FIELD_LABEL} htmlFor="ai-api-key">
            Chave da API (OpenAI)
          </label>
          <input
            id="ai-api-key"
            type="password"
            style={INPUT}
            value={apiKey}
            autoComplete="off"
            placeholder={
              settings?.hasApiKey
                ? `Chave configurada (${settings.apiKeyPreview}) — deixe em branco para manter`
                : "sk-..."
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
          <p style={HINT}>
            A chave fica somente no servidor: ela nunca volta para esta tela e nunca vai para o
            computador da balanca. Deixe o campo em branco para manter a que ja esta gravada.
          </p>
        </div>

        <div>
          <label style={FIELD_LABEL} htmlFor="ai-model">
            Modelo
          </label>
          <select
            id="ai-model"
            style={INPUT}
            value={modelChoice}
            onChange={(event) => setModelChoice(event.target.value)}
          >
            {AI_MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value={AI_MODEL_CUSTOM}>Outro (digitar o nome)</option>
          </select>
          {modelChoice === AI_MODEL_CUSTOM ? (
            <input
              style={{ ...INPUT, marginTop: "8px" }}
              value={customModel}
              placeholder="Nome exato do modelo na API"
              onChange={(event) => setCustomModel(event.target.value)}
            />
          ) : (
            <p style={HINT}>{findAiModelHint(modelChoice)}</p>
          )}
        </div>

        <label
          style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={isEnabled}
            style={{ marginTop: "3px" }}
            onChange={(event) => setIsEnabled(event.target.checked)}
          />
          <span>
            <strong style={{ display: "block", fontSize: "14px" }}>Assistente ativo</strong>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              Desmarque para pausar a IA em todas as pedreiras sem apagar a chave. O chat continua
              respondendo com a documentacao instalada.
            </span>
          </span>
        </label>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              border: "none",
              background: isSaving ? "#94a3b8" : "#0f172a",
              color: "#fff",
              fontWeight: 700,
              fontSize: "14px",
              cursor: isSaving ? "default" : "pointer"
            }}
          >
            {isSaving ? "Salvando..." : "Salvar configuracao"}
          </button>
          {settings?.hasApiKey ? (
            <button
              type="button"
              onClick={() => void removeKey()}
              disabled={isSaving}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                border: "1px solid #b91c1c",
                background: "#fff",
                color: "#b91c1c",
                fontWeight: 700,
                fontSize: "14px",
                cursor: isSaving ? "default" : "pointer"
              }}
            >
              Remover chave
            </button>
          ) : null}
        </div>

        {settings?.updatedAt ? (
          <p style={{ ...HINT, marginTop: 0 }}>
            Ultima alteracao: {new Date(settings.updatedAt).toLocaleString("pt-BR")}
          </p>
        ) : null}
      </article>

      <article style={{ ...CARD, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Como o assistente usa isto</h3>
        <ul
          style={{
            margin: 0,
            paddingLeft: "18px",
            color: "#475569",
            fontSize: "13px",
            lineHeight: 1.7
          }}
        >
          <li>
            O desktop procura na documentacao instalada e manda so os trechos relevantes junto com a
            pergunta. Nenhum dado de operacao, cliente ou peso sai do computador da balanca.
          </li>
          <li>
            Quando a documentacao cobre a duvida, a resposta cita as fontes e o operador abre o guia
            com um clique.
          </li>
          <li>
            Quando nao cobre, a IA responde pelo funcionamento do KyberRock e da integracao com o
            OMIE, avisando que aquilo nao esta na documentacao.
          </li>
          <li>O que ela nao souber vira orientacao para falar com o suporte, nunca um palpite.</li>
        </ul>
      </article>
    </section>
  );
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado";
}
