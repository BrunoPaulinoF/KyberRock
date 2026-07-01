import { formatPlate, isValidPlate, normalizePlate } from "@kyberrock/shared";

import { Field, getInputStyle } from "./Field";

export interface PlateInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

export function PlateInput({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  id
}: PlateInputProps) {
  const showError = value.trim().length > 0 && !isValidPlate(value);
  return (
    <Field
      label={label}
      required={required}
      error={showError ? "Placa invalida. Use ABC1234 ou ABC1D23." : null}
    >
      <input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        value={formatPlate(value)}
        placeholder={placeholder ?? "ABC1234 ou ABC1D23"}
        onChange={(e) => onChange(normalizePlate(e.target.value).slice(0, 7))}
        style={{
          ...getInputStyle(disabled),
          textTransform: "uppercase",
          ...(showError ? { borderColor: "#b91c1c" } : {})
        }}
        maxLength={8}
      />
    </Field>
  );
}
