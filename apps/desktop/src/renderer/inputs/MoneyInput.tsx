import { useEffect, useRef, useState } from "react";

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

// Durante a digitacao o texto fica exatamente como o usuario digitou (apenas
// filtrando caracteres invalidos). Reformatar a cada tecla fazia o valor "pular"
// de casa decimal (ex.: "1.000" + "0" virava "1,00") e engolia a virgula.
function sanitizeMoneyTyping(value: string): string {
  return value.replace(/[^\d.,]/g, "");
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
        value={value}
        placeholder={placeholder ?? "0,00"}
        onChange={(e) => {
          const raw = sanitizeMoneyTyping(e.target.value);
          onChange(raw, parseMoneyInputToCents(raw));
        }}
        onBlur={() => {
          // Separador de milhar e zeros dos centavos entram apenas ao sair do campo.
          const formatted = formatMoneyInput(value);
          if (formatted !== value) {
            onChange(formatted, parseMoneyInputToCents(formatted));
          }
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

function centsToText(cents: number | null): string {
  return cents === null ? "" : formatMoneyInput(String(cents / 100));
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
  // Guarda o texto digitado localmente: derivar o texto de valueCents a cada tecla
  // apagava a virgula/decimal em andamento e deslocava o valor.
  const [text, setText] = useState(() => centsToText(valueCents));
  const lastCentsRef = useRef(valueCents);

  useEffect(() => {
    // Mudanca externa do valor (prefill de frete, reset do formulario): re-sincroniza.
    if (valueCents !== lastCentsRef.current) {
      lastCentsRef.current = valueCents;
      setText(centsToText(valueCents));
    }
  }, [valueCents]);

  return (
    <MoneyInput
      label={label}
      value={text}
      onChange={(formatted, cents) => {
        setText(formatted);
        if (cents === null) {
          lastCentsRef.current = null;
          onChange(null);
          return;
        }
        if (!allowZero && cents === 0) {
          return;
        }
        lastCentsRef.current = cents;
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
