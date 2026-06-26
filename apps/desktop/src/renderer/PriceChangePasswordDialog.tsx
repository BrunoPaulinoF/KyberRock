import { useEffect, useRef, useState, type FormEvent } from "react";

interface PriceChangePasswordDialogProps {
  error: string | null;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}

export function PriceChangePasswordDialog({
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
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="price-password-title">
      <form style={styles.modal} onSubmit={handleSubmit}>
        <h2 id="price-password-title" style={styles.title}>
          Confirmar alteracao de preco
        </h2>
        <p style={styles.text}>Digite a senha de 4 digitos para alterar precos.</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={styles.input}
          disabled={submitting}
        />
        {error ? <p style={styles.error}>{error}</p> : null}
        <div style={styles.actions}>
          <button type="button" onClick={onCancel} style={styles.secondaryButton} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" style={styles.primaryButton} disabled={submitting || !password.trim()}>
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
