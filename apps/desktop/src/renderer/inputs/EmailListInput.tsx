import { useState } from "react";

import { invalidEmailsInList, isValidEmail, parseEmailList } from "@kyberrock/shared";

import { Field, getInputStyle } from "./Field";

export interface EmailListInputProps {
  label: string;
  /** Lista guardada no cadastro: enderecos separados por virgula. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  id?: string;
}

/**
 * Campo de lista de e-mails: o operador adiciona quantos quiser e eles ficam guardados
 * separados por virgula. Usado nos dois campos do cadastro do cliente, que sao coisas
 * distintas: o e-mail de CONTATO (aba Contato) e os destinatarios da NF-e e do boleto
 * (aba Fiscal, que alimenta o "Utilizar os seguintes enderecos de e-mail" do OMIE).
 *
 * Aceita colar uma lista pronta ("a@x.com; b@y.com"), que entra ja separada em varios itens.
 */
export function EmailListInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  hint,
  id
}: EmailListInputProps) {
  const [draft, setDraft] = useState("");
  const emails = parseEmailList(value);
  const draftInvalid = draft.trim().length > 0 && invalidEmailsInList(draft).length > 0;
  const storedInvalid = invalidEmailsInList(value);

  function commitDraft(): void {
    const added = parseEmailList(draft);
    if (added.length === 0) return;
    if (invalidEmailsInList(draft).length > 0) return;

    const merged = [...emails];
    for (const email of added) {
      if (!merged.includes(email)) merged.push(email);
    }
    onChange(merged.join(", "));
    setDraft("");
  }

  function removeEmail(email: string): void {
    onChange(emails.filter((item) => item !== email).join(", "));
  }

  return (
    <Field
      label={label}
      required={required}
      hint={hint ?? "Adicione quantos e-mails quiser."}
      error={
        draftInvalid
          ? "Email invalido."
          : storedInvalid.length > 0
            ? `Email invalido: ${storedInvalid.join(", ")}.`
            : null
      }
    >
      <div style={{ display: "flex", gap: "6px", minWidth: 0 }}>
        <input
          id={id}
          type="text"
          inputMode="email"
          autoComplete="email"
          disabled={disabled}
          value={draft}
          placeholder={placeholder ?? "cliente@exemplo.com"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "," || event.key === ";") {
              event.preventDefault();
              commitDraft();
            }
          }}
          // Sair do campo sem clicar em "Adicionar" nao pode perder o e-mail digitado.
          onBlur={commitDraft}
          style={{
            ...getInputStyle(disabled),
            ...(draftInvalid ? { borderColor: "#b91c1c" } : {})
          }}
        />
        <button
          type="button"
          disabled={disabled || draft.trim().length === 0 || draftInvalid}
          onClick={commitDraft}
          style={{
            border: "1px solid var(--kr-input-border)",
            borderRadius: "10px",
            padding: "8px 12px",
            background: "var(--kr-input-bg)",
            color: "var(--kr-text-strong)",
            font: "inherit",
            fontSize: "13px",
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap"
          }}
        >
          Adicionar
        </button>
      </div>
      {emails.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
          {emails.map((email) => (
            <span
              key={email}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                border: "1px solid var(--kr-border)",
                borderRadius: "999px",
                padding: "3px 6px 3px 10px",
                fontSize: "12px",
                fontWeight: 600,
                color: isValidEmail(email) ? "var(--kr-text-strong)" : "#b91c1c",
                maxWidth: "100%"
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{email}</span>
              <button
                type="button"
                aria-label={`Remover ${email}`}
                title={`Remover ${email}`}
                disabled={disabled}
                onClick={() => removeEmail(email)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: disabled ? "not-allowed" : "pointer",
                  font: "inherit",
                  fontSize: "14px",
                  lineHeight: 1,
                  padding: "0 2px"
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </Field>
  );
}
