import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  ArrowRight,
  Bot,
  Info,
  LifeBuoy,
  Loader,
  MessageCircle,
  Send,
  Sparkles,
  WifiOff,
  X
} from "lucide-react";

import {
  ASSISTANT_GREETING,
  ASSISTANT_SUGGESTIONS,
  askAssistant,
  type AssistantReply,
  type AssistantAnswerSource,
  type AssistantSource,
  type AssistantTurn,
  type DocsAssistantBridge
} from "./documentation-assistant";

// ---------------------------------------------------------------------------
// Botao flutuante + painel de chat da documentacao.
//
// A regra de produto que este componente carrega: o assistente nunca finge
// saber, e sempre diz de onde a resposta veio.
//
//   documentacao — fontes clicaveis abaixo da resposta, que abrem o guia.
//   conhecimento — aviso de que aquilo nao esta na documentacao e veio do
//                  funcionamento do sistema, mais o caminho do suporte.
//   desconhecido — so o caminho do suporte.
//
// E por isso que a resposta fora da documentacao ganha um botao "Abrir
// checklist de suporte" em vez de so um texto pedindo desculpas.
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AssistantSource[];
  answerSource?: AssistantAnswerSource;
  offlineFallback?: boolean;
}

let messageSequence = 0;
function nextMessageId(prefix: string): string {
  messageSequence += 1;
  return `${prefix}-${messageSequence}`;
}

export function DocumentationAssistant({
  bridge,
  onOpenSection,
  onOpenSupport
}: {
  bridge: DocsAssistantBridge | null;
  onOpenSection: (sectionId: string) => void;
  onOpenSupport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "greeting", role: "assistant", content: ASSISTANT_GREETING, answerSource: "documentacao" }
  ]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Evita aplicar a resposta de uma pergunta ja abandonada (o operador fechou o
  // chat ou saiu da tela enquanto a nuvem respondia).
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Rola para a ultima mensagem e devolve o foco ao campo depois de responder.
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    if (!pending) inputRef.current?.focus();
  }, [open, messages, pending]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const submitQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || pending) return;

      const history: AssistantTurn[] = messages
        .filter((message) => message.id !== "greeting")
        .map((message) => ({ role: message.role, content: message.content }));

      setMessages((current) => [
        ...current,
        { id: nextMessageId("user"), role: "user", content: trimmed }
      ]);
      setDraft("");
      setPending(true);

      let reply: AssistantReply;
      try {
        reply = await askAssistant(trimmed, history, bridge);
      } finally {
        if (mountedRef.current) setPending(false);
      }

      if (!mountedRef.current) return;
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          content: reply.answer,
          sources: reply.sources,
          answerSource: reply.answerSource,
          offlineFallback: reply.offlineFallback
        }
      ]);
    },
    [bridge, messages, pending]
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitQuestion(draft);
  };

  useEffect(() => {
    ensureAssistantStyles();
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        className="krchat-launcher"
        aria-label="Abrir o assistente da documentacao"
        title="Tire duvidas com o assistente da documentacao"
        onClick={() => setOpen(true)}
      >
        <MessageCircle size={20} />
        <span className="krchat-launcher-label">Tirar duvida</span>
      </button>
    );
  }

  return (
    <section
      className="krchat-panel"
      role="dialog"
      aria-label="Assistente da documentacao"
      aria-modal="false"
    >
      <header style={styles.header}>
        <span style={styles.headerIcon}>
          <Sparkles size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={styles.headerTitle}>Assistente da documentacao</strong>
          <small style={styles.headerSubtitle}>Responde com base nesta documentacao</small>
        </div>
        <button
          type="button"
          className="krchat-icon-btn"
          aria-label="Fechar o assistente"
          onClick={() => setOpen(false)}
        >
          <X size={16} />
        </button>
      </header>

      <div ref={listRef} style={styles.messageList}>
        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            message={message}
            onOpenSection={onOpenSection}
            onOpenSupport={onOpenSupport}
          />
        ))}

        {pending ? (
          <div className="krchat-bubble krchat-bubble-assistant" aria-live="polite">
            <span style={styles.pendingRow}>
              <Loader size={14} className="krchat-spin" />
              Procurando na documentacao...
            </span>
          </div>
        ) : null}

        {messages.length === 1 && !pending ? (
          <div style={styles.suggestionBox}>
            <small style={styles.suggestionLabel}>Perguntas comuns</small>
            <div style={styles.suggestionRow}>
              {ASSISTANT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="krchat-suggestion"
                  onClick={() => void submitQuestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <form style={styles.composer} onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="krchat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Pergunte com suas palavras..."
          aria-label="Sua pergunta"
          disabled={pending}
        />
        <button
          type="submit"
          className="krchat-send"
          aria-label="Enviar pergunta"
          disabled={pending || draft.trim().length === 0}
        >
          <Send size={15} />
        </button>
      </form>
    </section>
  );
}

function ChatBubble({
  message,
  onOpenSection,
  onOpenSupport
}: {
  message: ChatMessage;
  onOpenSection: (sectionId: string) => void;
  onOpenSupport: () => void;
}) {
  if (message.role === "user") {
    return <div className="krchat-bubble krchat-bubble-user">{message.content}</div>;
  }

  // A resposta que veio da documentacao se basta. Tudo o mais — inclusive a que
  // a IA respondeu bem pelo conhecimento do sistema — oferece o caminho do
  // suporte, porque nao foi conferida contra o texto instalado.
  const showSupport = message.answerSource !== undefined && message.answerSource !== "documentacao";
  const fromKnowledge = message.answerSource === "conhecimento";

  return (
    <div className="krchat-bubble krchat-bubble-assistant">
      <span style={styles.assistantMark}>
        <Bot size={13} />
      </span>
      <div style={styles.assistantBody}>
        {message.content.split("\n").map((line, index) =>
          line.trim() ? (
            <p key={`${message.id}-line-${index}`} style={styles.assistantLine}>
              {line}
            </p>
          ) : null
        )}

        {message.sources && message.sources.length > 0 ? (
          <div style={styles.sourceRow}>
            <small style={styles.sourceLabel}>Fontes</small>
            {message.sources.map((source) =>
              source.sectionId ? (
                <button
                  key={source.title}
                  type="button"
                  className="krchat-source"
                  onClick={() => onOpenSection(source.sectionId as string)}
                >
                  {source.title}
                  <ArrowRight size={11} />
                </button>
              ) : (
                <span key={source.title} className="krchat-source krchat-source-static">
                  {source.title}
                </span>
              )
            )}
          </div>
        ) : null}

        {fromKnowledge ? (
          <span style={styles.offlineNote}>
            <Info size={12} />
            Isto nao esta na documentacao: veio do funcionamento do sistema. Vale confirmar.
          </span>
        ) : null}

        {message.offlineFallback ? (
          <span style={styles.offlineNote}>
            <WifiOff size={12} />
            Respondido com a documentacao instalada neste computador.
          </span>
        ) : null}

        {showSupport ? (
          <button type="button" className="krchat-support" onClick={onOpenSupport}>
            <LifeBuoy size={13} />
            Abrir checklist de suporte
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

export const ASSISTANT_STYLE_ELEMENT_ID = "kyberrock-documentation-assistant-styles";

/**
 * Injeta a folha de estilo do chat uma unica vez por sessao. Mesmo motivo da
 * folha da documentacao: inserir e remover um stylesheet a cada abertura obriga
 * o navegador a recalcular o estilo do app inteiro.
 */
export function ensureAssistantStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(ASSISTANT_STYLE_ELEMENT_ID)) return;

  const style = document.createElement("style");
  style.id = ASSISTANT_STYLE_ELEMENT_ID;
  style.textContent = assistantCss;
  document.head.appendChild(style);
}

// Camadas do app: 99/100 = menu da engrenagem, 1000 = modais, 9998 = toast,
// 9999 = tooltips. O chat fica acima do conteudo e do menu, e ABAIXO dos
// modais de proposito — um aviso de atualizacao ou a janela de logs precisa
// cobrir o chat, nao ficar espremido atras dele.
const assistantCss = `
  .krchat-launcher {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 300;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 999px;
    border: 1px solid var(--kr-primary-strong);
    background: var(--kr-primary-strong);
    color: var(--kr-primary-text);
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 12px 28px rgba(28, 25, 23, 0.28);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .krchat-launcher:hover {
    transform: translateY(-1px);
    box-shadow: 0 16px 34px rgba(28, 25, 23, 0.34);
  }
  .krchat-launcher:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--kr-focus-ring);
  }
  .krchat-launcher-label {
    white-space: nowrap;
  }
  @media (max-width: 900px) {
    .krchat-launcher-label { display: none; }
    .krchat-launcher { padding: 13px; }
  }
  .krchat-panel {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 301;
    display: flex;
    flex-direction: column;
    width: min(400px, calc(100vw - 44px));
    height: min(560px, calc(100vh - 120px));
    border-radius: 18px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    box-shadow: 0 22px 48px rgba(28, 25, 23, 0.3);
    overflow: hidden;
  }
  .krchat-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--kr-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .krchat-icon-btn:hover {
    background: var(--kr-card-hover);
    color: var(--kr-text-strong);
  }
  .krchat-bubble {
    max-width: 92%;
    padding: 10px 12px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .krchat-bubble-user {
    align-self: flex-end;
    background: var(--kr-primary-strong);
    color: var(--kr-primary-text);
    border-bottom-right-radius: 6px;
  }
  .krchat-bubble-assistant {
    align-self: flex-start;
    display: flex;
    gap: 8px;
    background: var(--kr-surface-soft);
    border: 1px solid var(--kr-border);
    color: var(--kr-text);
    border-bottom-left-radius: 6px;
  }
  .krchat-suggestion {
    padding: 7px 11px;
    border-radius: 999px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .krchat-suggestion:hover {
    border-color: var(--kr-accent);
    background: var(--kr-card-hover);
  }
  .krchat-source {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid var(--kr-accent-border);
    background: var(--kr-accent-soft);
    color: var(--kr-info-text);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .krchat-source:hover {
    filter: brightness(0.97);
  }
  .krchat-source-static {
    cursor: default;
    opacity: 0.85;
  }
  .krchat-support {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 7px 11px;
    border-radius: 10px;
    border: 1px solid var(--kr-warning-border);
    background: var(--kr-warning-soft);
    color: var(--kr-warning);
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }
  .krchat-support:hover {
    filter: brightness(0.97);
  }
  .krchat-input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--kr-input-border);
    border-radius: 10px;
    padding: 9px 11px;
    font: inherit;
    font-size: 13px;
    background: var(--kr-input-bg);
    color: var(--kr-text-strong);
  }
  .krchat-input:focus {
    outline: none;
    border-color: var(--kr-accent);
    box-shadow: 0 0 0 3px var(--kr-focus-ring);
  }
  .krchat-input:disabled {
    opacity: 0.6;
  }
  .krchat-send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    border: 1px solid var(--kr-primary-strong);
    background: var(--kr-primary-strong);
    color: var(--kr-primary-text);
    cursor: pointer;
  }
  .krchat-send:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .krchat-spin {
    animation: krchat-rotate 0.9s linear infinite;
  }
  @keyframes krchat-rotate {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .krchat-spin { animation: none; }
    .krchat-launcher { transition: none; }
  }
`;

const styles: Record<string, CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    padding: "12px 12px 12px 14px",
    borderBottom: "1px solid var(--kr-border)",
    background: "var(--kr-surface-elevated)"
  },
  headerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  headerTitle: {
    display: "block",
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  headerSubtitle: {
    display: "block",
    color: "var(--kr-muted)",
    fontSize: "11px"
  },
  messageList: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px"
  },
  assistantMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "7px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0,
    marginTop: "1px"
  },
  assistantBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column"
  },
  assistantLine: {
    margin: "0 0 6px 0"
  },
  sourceRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "5px",
    marginTop: "4px"
  },
  sourceLabel: {
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  },
  offlineNote: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    marginTop: "6px",
    color: "var(--kr-muted)",
    fontSize: "11px"
  },
  pendingRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  suggestionBox: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginTop: "2px"
  },
  suggestionLabel: {
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  },
  suggestionRow: {
    display: "flex",
    flexDirection: "column",
    gap: "5px"
  },
  composer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    borderTop: "1px solid var(--kr-border)",
    background: "var(--kr-surface-elevated)"
  }
};
