import type { CSSProperties } from "react";

export interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  style?: CSSProperties;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Field({ label, required, hint, error, style, children, disabled }: FieldProps) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginBottom: "8px",
        fontWeight: 700,
        fontSize: "12px",
        color: "var(--kr-text-strong)",
        opacity: disabled ? 0.6 : 1,
        minWidth: 0,
        ...style
      }}
    >
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {error ? (
        <span style={{ fontSize: "11px", color: "#b91c1c", fontWeight: 600 }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: "11px", color: "var(--kr-muted)", fontWeight: 500 }}>{hint}</span>
      ) : null}
    </label>
  );
}

export const baseInputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--kr-input-border)",
  borderRadius: "8px",
  padding: "8px 10px",
  font: "inherit",
  fontSize: "13px",
  background: "var(--kr-input-bg)",
  color: "var(--kr-text-strong)",
  minWidth: 0
};

export const inputDisabledStyle: CSSProperties = {
  ...baseInputStyle,
  background: "#f1f5f9",
  color: "#64748b",
  cursor: "not-allowed"
};

export function getInputStyle(disabled?: boolean): CSSProperties {
  return disabled ? inputDisabledStyle : baseInputStyle;
}
