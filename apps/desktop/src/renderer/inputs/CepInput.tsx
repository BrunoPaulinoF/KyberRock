import { useState } from "react";

import { Field, getInputStyle } from "./Field";

export interface CepLookupResult {
  zipcode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface CepInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  onAddressFound?: (address: CepLookupResult) => void;
  onLookup?: (digits: string) => Promise<CepLookupResult | null>;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

export function CepInput({
  label,
  value,
  onChange,
  onAddressFound,
  onLookup,
  disabled,
  required,
  id
}: CepInputProps) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(
    null
  );

  const digits = value.replace(/\D/g, "");
  const canLookup = digits.length === 8 && !disabled && !loading;

  async function handleLookup() {
    if (!onLookup) return;
    if (digits.length !== 8) {
      setFeedback({ kind: "error", text: "Informe 8 digitos." });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const result = await onLookup(digits);
      if (!result) {
        setFeedback({ kind: "error", text: "CEP nao encontrado." });
        return;
      }
      onAddressFound?.(result);
      setFeedback({ kind: "success", text: "Endereco preenchido." });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Falha ao buscar CEP."
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Field
      label={label}
      required={required}
      error={feedback?.kind === "error" ? feedback.text : null}
      hint={feedback?.kind === "success" ? feedback.text : undefined}
    >
      <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          disabled={disabled}
          value={formatCepInput(value)}
          placeholder="00000-000"
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
          style={{ ...getInputStyle(disabled), flex: 1, minWidth: 0 }}
        />
        {onLookup ? (
          <button
            type="button"
            onClick={handleLookup}
            disabled={!canLookup}
            style={{
              border: "1px solid var(--kr-input-border)",
              borderRadius: "8px",
              padding: "8px 12px",
              background: canLookup ? "#0f172a" : "#cbd5e1",
              color: "#ffffff",
              cursor: canLookup ? "pointer" : "not-allowed",
              fontWeight: 700,
              fontSize: "12px",
              whiteSpace: "nowrap"
            }}
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function formatCepInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
