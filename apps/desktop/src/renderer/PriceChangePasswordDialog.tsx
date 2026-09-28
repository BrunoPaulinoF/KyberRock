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

interface PriceChangePasswordDialogProps {
  title?: string;
  description?: string;
  error: string | null;
  submitting?: boolean;
  onCancel: () => void;
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPassword("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedPassword = password.trim();
    if (!trimmedPassword || submitting) return;
    onSubmit(trimmedPassword);
  }

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
        <p style={styles.text}>{description}</p>
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
            type="submit"
            style={styles.primaryButton}
            disabled={submitting || !password.trim()}
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
