import { useEffect, useRef, useState, type FormEvent } from "react";

/**
 * A senha e o codigo rotativo de 6 digitos que so o comercial ve no site (tela "Senha de preco")
 * e que troca a cada 45 s — ver `services/price-code.ts`. O aviso vai em toda confirmacao, porque
 * e a mesma senha para preco, limpeza do historico e relatorio financeiro.
 */
export const PRICE_CODE_NOTE =
  "A senha troca a cada 45 segundos. Peca ao comercial a senha que esta na tela dele agora.";

/** Mensagem de senha recusada: errada ou ja vencida. */
export const PRICE_CODE_REJECTED = "Senha incorreta ou vencida. Peca ao comercial a senha atual.";

/** Liberacao sem senha dada pelo comercial no site (`getPriceUnlockStatus`). */
export interface PriceUnlockView {
  indefinite: boolean;
  until: string | null;
}

/** "Liberada pelo comercial ate 15:30" / "... sem prazo": o que a janela diz no lugar da senha. */
export function priceUnlockMessage(unlock: PriceUnlockView, now: Date = new Date()): string {
  if (unlock.indefinite || !unlock.until) {
    return "Balanca liberada pelo comercial, sem prazo. Nao precisa de senha.";
  }
  const until = new Date(unlock.until);
  const time = until.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = until.toDateString() === now.toDateString();
  const when = sameDay
    ? time
    : `${until.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} as ${time}`;
  return `Balanca liberada pelo comercial ate ${when}. Nao precisa de senha.`;
}

/**
 * A descricao de quem abre a janela costuma terminar com "Digite a senha..." / "Peca a senha...".
 * Liberada, essas frases mentem: saem, e o resto (o que a acao faz) fica.
 */
export function withoutPasswordHint(description: string): string {
  return description
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/^(digite|peca) a senha/i.test(sentence.trim()))
    .join(" ")
    .trim();
}

interface PriceChangePasswordDialogProps {
  title?: string;
  description?: string;
  error: string | null;
  submitting?: boolean;
  onCancel: () => void;
  /** Liberada pelo comercial, chega `""`: o processo principal aceita sem senha. */
  onSubmit: (password: string) => void;
}

export function PriceChangePasswordDialog({
  title = "Confirmar alteracao de preco",
  description = "Digite a senha de preco para alterar precos.",
  error,
  submitting = false,
  onCancel,
  onSubmit
}: PriceChangePasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [unlock, setUnlock] = useState<PriceUnlockView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPassword("");
  }, []);

  // O comercial pode ter liberado a balanca no site: primeiro o que esta gravado (na hora), depois
  // a nuvem (o "liberei agora" vale sem esperar o ping de 30 s). Recusa da senha tambem confere de
  // novo — a liberacao pode ter vencido com a janela aberta.
  useEffect(() => {
    const api = typeof window === "undefined" ? undefined : window.kyberrockDesktop;
    if (!api?.getPriceUnlockStatus) return;
    let active = true;
    let refreshed = false;
    void api
      .getPriceUnlockStatus(false)
      .then((next) => {
        if (active && !refreshed) setUnlock(next);
      })
      .catch(() => undefined);
    if (!error) {
      void api
        .getPriceUnlockStatus(true)
        .then((next) => {
          refreshed = true;
          if (active) setUnlock(next);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [error]);

  // Liberada: o foco vai para o Confirmar (Enter confirma). Voltou a pedir senha (venceu ou o
  // comercial tirou): o campo aparece e recebe o foco.
  useEffect(() => {
    window.setTimeout(() => (unlock ? confirmRef.current : inputRef.current)?.focus(), 0);
  }, [unlock]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;
    if (unlock) {
      onSubmit("");
      return;
    }
    const trimmedPassword = password.trim();
    if (!trimmedPassword) return;
    onSubmit(trimmedPassword);
  }

  const shownDescription = unlock ? withoutPasswordHint(description) : description;

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-password-title"
    >
      <form style={styles.modal} onSubmit={handleSubmit}>
        <h2 id="price-password-title" style={styles.title}>
          {title}
        </h2>
        {shownDescription ? <p style={styles.text}>{shownDescription}</p> : null}
        {unlock ? (
          <p style={styles.unlocked} role="status">
            {priceUnlockMessage(unlock)}
          </p>
        ) : (
          <>
            <p style={styles.note}>{PRICE_CODE_NOTE}</p>
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={7}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={styles.input}
              disabled={submitting}
            />
          </>
        )}
        {error ? <p style={styles.error}>{error}</p> : null}
        <div style={styles.actions}>
          <button
            type="button"
            onClick={onCancel}
            style={styles.secondaryButton}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            ref={confirmRef}
            type="submit"
            style={styles.primaryButton}
            disabled={submitting || (!unlock && !password.trim())}
          >
            {submitting ? "Validando..." : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(15, 23, 42, 0.48)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    zIndex: 2000
  },
  modal: {
    width: "100%",
    maxWidth: "380px",
    background: "var(--kr-surface)",
    color: "var(--kr-text)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    boxShadow: "var(--kr-shadow)",
    padding: "16px",
    display: "grid",
    gap: "10px"
  },
  title: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "16px"
  },
  text: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "13px"
  },
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    border: "1px solid var(--kr-input-border)",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "14px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  note: {
    margin: 0,
    color: "var(--kr-text)",
    fontSize: "12px",
    fontWeight: 600
  },
  unlocked: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid var(--kr-success-border)",
    background: "var(--kr-success-soft)",
    color: "var(--kr-success)",
    fontSize: "13px",
    fontWeight: 700
  },
  error: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "12px",
    fontWeight: 700
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "4px"
  },
  primaryButton: {
    border: "none",
    background: "#0f172a",
    color: "#fff",
    borderRadius: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  secondaryButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  }
} as const;
