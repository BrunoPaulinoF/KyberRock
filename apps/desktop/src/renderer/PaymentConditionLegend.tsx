import type { CSSProperties } from "react";

import { describePaymentCondition } from "./payment-condition-helpers";

/**
 * Legenda do campo de condicao de pagamento: mostra o que o texto digitado gera
 * (previa) e como escrever cada formato aceito. Os prazos abaixo sao os mesmos que
 * seguem para o OMIE — um periodo ("s+20") e so uma forma curta de escrever o prazo
 * em dias, e a parcela cai exatamente no mesmo dia.
 */
export interface PaymentConditionFormat {
  example: string;
  meaning: string;
}

export const PAYMENT_CONDITION_FORMATS: readonly PaymentConditionFormat[] = [
  { example: "30", meaning: "so o numero = 1 parcela 30 dias apos a venda" },
  { example: "7 14 21", meaning: "3 parcelas nesses prazos (igual a 7/14/21)" },
  { example: "3 parcelas", meaning: "3 parcelas mensais (30, 60 e 90 dias)" },
  { example: "s + 20", meaning: "semana (7) + 20 dias = 1 parcela em 27 dias" },
  { example: "q + 20", meaning: "quinzena (15) + 20 dias = 1 parcela em 35 dias" },
  { example: "m + 20", meaning: "mes (30) + 20 dias = 1 parcela em 50 dias" },
  { example: "2s / 3m", meaning: "multiplo do periodo: 2 semanas (14) e 3 meses (90)" },
  { example: "s+20/m+10", meaning: "periodos na lista = 2 parcelas (27 e 40 dias)" },
  { example: "A Vista", meaning: "sem prazo; o campo vazio tambem vale a vista" }
];

export interface PaymentConditionLegendProps {
  /** Texto atual do campo, usado na previa do parcelamento. */
  value: string;
  style?: CSSProperties;
}

const PREVIEW_COLOR: Record<string, string> = {
  ok: "var(--kr-text-strong)",
  invalid: "var(--kr-danger)",
  empty: "var(--kr-muted)"
};

export function PaymentConditionLegend({ value, style }: PaymentConditionLegendProps) {
  const preview = describePaymentCondition(value);

  return (
    <div
      style={{
        border: "1px solid var(--kr-border)",
        borderRadius: "10px",
        background: "var(--kr-surface-soft)",
        padding: "8px 10px",
        fontSize: "11px",
        fontWeight: 500,
        color: "var(--kr-muted)",
        lineHeight: 1.45,
        ...style
      }}
    >
      <p
        style={{
          margin: "0 0 6px 0",
          fontWeight: 700,
          color: PREVIEW_COLOR[preview.status] ?? "var(--kr-muted)"
        }}
      >
        {preview.message}
      </p>
      <p style={{ margin: "0 0 4px 0", fontWeight: 700, color: "var(--kr-text-strong)" }}>
        Como escrever
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "2px" }}>
        {PAYMENT_CONDITION_FORMATS.map((format) => (
          <li
            key={format.example}
            style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px" }}
          >
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 700,
                color: "var(--kr-text-strong)",
                whiteSpace: "nowrap"
              }}
            >
              {format.example}
            </code>
            <span>{format.meaning}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: "6px 0 0 0" }}>
        Periodos: <strong>s</strong> = semana (7 dias), <strong>q</strong> = quinzena (15 dias),{" "}
        <strong>m</strong> = mes (30 dias). As parcelas vao para o OMIE nos mesmos dias.
      </p>
    </div>
  );
}
