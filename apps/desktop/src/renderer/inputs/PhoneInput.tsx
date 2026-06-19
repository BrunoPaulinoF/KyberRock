import { useState } from "react";

import { formatPhone, normalizePhone } from "@kyberrock/shared";

import { Field, getInputStyle } from "./Field";

export interface PhoneInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

export function PhoneInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id
}: PhoneInputProps) {
  const [touched, setTouched] = useState(false);
  const digits = normalizePhone(value);
  const showError =
    touched && value.trim().length > 0 && digits.length !== 10 && digits.length !== 11;

  return (
    <Field
      label={label}
      required={required}
      error={showError ? "Telefone invalido. Informe com DDD (10 ou 11 digitos)." : null}
    >
      <input
        id={id}
        type="text"
        inputMode="tel"
        autoComplete="tel"
        disabled={disabled}
        value={formatPhone(value)}
        placeholder={placeholder ?? "(11) 91234-5678"}
        onChange={(e) => onChange(normalizePhone(e.target.value))}
        onBlur={() => setTouched(true)}
        style={{
          ...getInputStyle(disabled),
          ...(showError ? { borderColor: "#b91c1c" } : {})
        }}
      />
    </Field>
  );
}
