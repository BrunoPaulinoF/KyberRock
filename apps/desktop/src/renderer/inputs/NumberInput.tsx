import { Field, getInputStyle } from "./Field";

export interface NumberInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  minLength?: number;
  maxLength?: number;
  hint?: string;
}

export function NumberInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id,
  maxLength,
  minLength,
  hint
}: NumberInputProps) {
  const showError =
    value.trim().length > 0 && (() => {
      if (minLength && value.length < minLength) return true;
      return false;
    })();

  return (
    <Field
      label={label}
      required={required}
      error={showError ? `Informe ao menos ${minLength} digitos.` : null}
      hint={hint}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(maxLength ? digits.slice(0, maxLength) : digits);
        }}
        style={{
          ...getInputStyle(disabled),
          ...(showError ? { borderColor: "#b91c1c" } : {})
        }}
      />
    </Field>
  );
}

export interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  hint?: string;
  maxLength?: number;
  autoComplete?: string;
}

export function TextInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id,
  hint,
  maxLength,
  autoComplete
}: TextInputProps) {
  return (
    <Field label={label} required={required} hint={hint}>
      <input
        id={id}
        type="text"
        autoComplete={autoComplete ?? "off"}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
        style={getInputStyle(disabled)}
      />
    </Field>
  );
}
