import { useEffect, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  AI_MODEL_CUSTOM,
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  findAiModelHint,
  isKnownAiModel
} from "../lib/ai-models";
import { Button, Field, Note, PageHead, Panel } from "../components/admin";

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
    return (
      <Panel>
        <p className="adm-empty">Carregando configuracao da IA...</p>
      </Panel>
    );
  }

  return (
    <>
      <PageHead
        title="Assistente de IA"
        description="Credencial unica usada por todas as pedreiras. Alimenta o chat da tela de Documentacao do desktop, que responde com base na documentacao instalada e no funcionamento do sistema com o OMIE. Sem chave, o chat continua funcionando apenas com a documentacao local."
      />

      {feedback && <Note tone={feedback.tone === "ok" ? "ok" : "danger"}>{feedback.text}</Note>}

      <Panel
        title="Credencial e modelo"
        description={
          settings?.updatedAt
            ? `Ultima alteracao: ${new Date(settings.updatedAt).toLocaleString("pt-BR")}`
            : undefined
        }
        actions={
          <>
            <Button variant="primary" onClick={() => void save()} disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar configuracao"}
            </Button>
            {settings?.hasApiKey && (
              <Button variant="danger" onClick={() => void removeKey()} disabled={isSaving}>
                Remover chave
              </Button>
            )}
          </>
        }
      >
        <div className="adm-form">
          <Field
            label="Chave da API (OpenAI)"
            hint="A chave fica somente no servidor: ela nunca volta para esta tela e nunca vai para o computador da balanca. Deixe em branco para manter a que ja esta gravada."
          >
            <input
              id="ai-api-key"
              className="adm-input adm-input-mono"
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder={
                settings?.hasApiKey
                  ? `Chave configurada (${settings.apiKeyPreview}) — deixe em branco para manter`
                  : "sk-..."
              }
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Field>

          <Field
            label="Modelo"
            hint={modelChoice === AI_MODEL_CUSTOM ? undefined : findAiModelHint(modelChoice)}
          >
            <select
              id="ai-model"
              className="adm-select"
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
          </Field>

          {modelChoice === AI_MODEL_CUSTOM && (
            <Field label="Nome do modelo" hint="Nome exato do modelo na API da OpenAI.">
              <input
                className="adm-input adm-input-mono"
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
              />
            </Field>
          )}

          <label className="adm-check">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(event) => setIsEnabled(event.target.checked)}
            />
            <span>
              <strong>Assistente ativo</strong>
              <span className="adm-field-hint" style={{ display: "block" }}>
                Desmarque para pausar a IA em todas as pedreiras sem apagar a chave. O chat continua
                respondendo com a documentacao instalada.
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Como o assistente usa isto">
        <ul className="adm-list">
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
      </Panel>
    </>
  );
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado";
}
