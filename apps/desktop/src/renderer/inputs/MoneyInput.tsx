import { formatMoneyInput, parseMoneyInputToCents } from "@kyberrock/shared";

import { Field, getInputStyle } from "./Field";

export interface MoneyInputProps {
  label: string;
  value: string;
  onChange: (formatted: string, cents: number | null) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  hint?: string;
  allowZero?: boolean;
}

export function MoneyInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id,
  hint,
  allowZero = true
}: MoneyInputProps) {
  const showError =
    value.trim().length > 0 &&
    (() => {
      const cents = parseMoneyInputToCents(value);
      if (cents === null) return true;
      if (!allowZero && cents === 0) return true;
      return false;
    })();

  return (
    <Field
      label={label}
      required={required}
      hint={hint ?? "Use virgula para centavos (ex: 1.250,75)."}
      error={showError ? "Valor invalido." : null}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        value={formatMoneyInput(value)}
        placeholder={placeholder ?? "0,00"}
        onChange={(e) => {
          const raw = e.target.value;
          const formatted = formatMoneyInput(raw);
          const cents = parseMoneyInputToCents(formatted);
          onChange(formatted, cents);
        }}
        style={{
          ...getInputStyle(disabled),
          ...(showError ? { borderColor: "#b91c1c" } : {})
        }}
      />
    </Field>
  );
}

export interface MoneyCentsInputProps {
  label: string;
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  hint?: string;
  allowZero?: boolean;
}

export function MoneyCentsInput({
  label,
  valueCents,
  onChange,
  required,
  disabled,
  placeholder,
  id,
  hint,
  allowZero = true
}: MoneyCentsInputProps) {
  const display = valueCents === null ? "" : formatMoneyInput(String(valueCents / 100));
  return (
    <MoneyInput
      label={label}
      value={display}
      onChange={(_, cents) => {
        if (cents === null) {
          onChange(null);
          return;
        }
        if (!allowZero && cents === 0) {
          return;
        }
        onChange(cents);
      }}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      id={id}
      hint={hint}
      allowZero={allowZero}
    />
  );
}
