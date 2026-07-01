import { useState } from "react";

import { formatDocument, isValidDocument, normalizeDocument } from "@kyberrock/shared";

import { Field, getInputStyle } from "./Field";

export interface DocumentInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  onBlur?: () => void;
}

export function DocumentInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id,
  onBlur
}: DocumentInputProps) {
  const [touched, setTouched] = useState(false);
  const showError = touched && value.trim().length > 0 && !isValidDocument(value);

  return (
    <Field label={label} required={required} error={showError ? "CPF/CNPJ invalido." : null}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={formatDocument(value)}
        placeholder={placeholder ?? "000.000.000-00 ou 00.000.000/0000-00"}
        onChange={(e) => onChange(normalizeDocument(e.target.value))}
        onBlur={() => {
          setTouched(true);
          onBlur?.();
        }}
        style={{
          ...getInputStyle(disabled),
          ...(showError ? { borderColor: "#b91c1c" } : {})
        }}
      />
    </Field>
  );
}
