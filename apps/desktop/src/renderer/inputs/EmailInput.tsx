import { useState } from "react";

import { isValidEmail, normalizeEmail } from "@kyberrock/shared";

import { Field, getInputStyle } from "./Field";

export interface EmailInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

export function EmailInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id
}: EmailInputProps) {
  const [touched, setTouched] = useState(false);
  const normalized = normalizeEmail(value);
  const showError = touched && value.trim().length > 0 && !isValidEmail(normalized);

  return (
    <Field label={label} required={required} error={showError ? "Email invalido." : null}>
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        disabled={disabled}
        value={value}
        placeholder={placeholder ?? "cliente@exemplo.com"}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        style={{
          ...getInputStyle(disabled),
          ...(showError ? { borderColor: "#b91c1c" } : {})
        }}
      />
    </Field>
  );
}
