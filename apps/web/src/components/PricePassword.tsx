import { useState } from "react";

import { PRICE_CODE_HINT } from "../lib/price-code";
import { Alert, Field, Modal } from "./ui";

/** O campo da senha de preco: o codigo rotativo de 6 digitos que o comercial ve na tela dele. */
export function PricePasswordField({
  value,
  onChange,
  autoFocus
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <Field label="Senha de preco (do comercial)" hint={PRICE_CODE_HINT}>
      <input
        className="input"
        type="password"
        autoComplete="off"
        inputMode="numeric"
        maxLength={7}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/**
 * Confirmacao de exclusao de cadastro. Quem tem `requiresPricePassword` (a operacao sempre, o
 * gestor conforme o login) digita a senha rotativa; o comercial e o administrador so confirmam —
 * a mesma regra da mudanca de preco, conferida de novo na `web-api`.
 */
export function DeleteDialog({
  title,
  description,
  askPassword,
  onClose,
  onConfirm
}: {
  title: string;
  description: string;
  askPassword: boolean;
  onClose: () => void;
  /** Devolve `null` quando excluiu (quem abriu fecha o dialogo) ou a mensagem do erro. */
  onConfirm: (pricePassword?: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              if (askPassword && !password.trim()) {
                setError("Digite a senha de preco que o comercial passou.");
                return;
              }
              setBusy(true);
              const failure = await onConfirm(askPassword ? password.trim() : undefined);
              setBusy(false);
              if (failure) setError(failure);
            }}
          >
            {busy ? "Excluindo..." : "Excluir"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {askPassword ? (
        <PricePasswordField value={password} onChange={setPassword} autoFocus />
      ) : (
        <p className="desk-muted" style={{ margin: 0 }}>
          Esta acao nao pode ser desfeita pelo site.
        </p>
      )}
    </Modal>
  );
}
