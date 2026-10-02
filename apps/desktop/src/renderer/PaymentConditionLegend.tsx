import type { CSSProperties } from "react";

import { describePaymentCondition } from "./payment-condition-helpers";

/**
 * Legenda do campo de condicao de pagamento: mostra o que o texto digitado gera
 * (previa) e como escrever cada formato aceito. Os prazos abaixo sao os mesmos que
 * seguem para o OMIE. Um periodo ("q+15") conta do FIM do periodo em que a venda caiu,
 * entao a previa mostra a data em que a venda de hoje venceria.
 *
 * A previa fica sempre a vista (e ela que responde ao que esta sendo digitado); a
 * tabela de formatos vive dentro de um "Como escrever" recolhido, para a legenda
 * inteira nao empurrar o formulario da Nova entrada para fora da tela.
 */
export interface PaymentConditionFormat {
  example: string;
  meaning: string;
}

export const PAYMENT_CONDITION_FORMATS: readonly PaymentConditionFormat[] = [
  { example: "30", meaning: "so o numero = 1 parcela 30 dias apos a venda" },
  { example: "7 14 21", meaning: "3 parcelas nesses prazos (igual a 7/14/21)" },
  { example: "3 parcelas", meaning: "3 parcelas mensais (30, 60 e 90 dias)" },
  { example: "q + 15", meaning: "fim da quinzena + 15 dias: venda de 01 a 15 vence dia 30" },
  { example: "m + 10", meaning: "fim do mes + 10 dias: vence dia 10 do mes seguinte" },
  { example: "d + 20", meaning: "fim da dezena (dia 10, 20 ou ultimo) + 20 dias" },
  { example: "s + 20", meaning: "fim da semana (domingo) + 20 dias" },
  { example: "2q", meaning: "fim da quinzena seguinte a da venda" },
  { example: "q/q+15", meaning: "periodos na lista = 2 parcelas" },
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
          margin: 0,
          fontWeight: 700,
          color: PREVIEW_COLOR[preview.status] ?? "var(--kr-muted)"
        }}
      >
        {preview.message}
      </p>
      <details>
        <summary
          style={{
            cursor: "pointer",
            marginTop: "4px",
            fontWeight: 700,
            color: "var(--kr-text-strong)"
          }}
        >
          Como escrever
        </summary>
        <ul
          style={{
            margin: "4px 0 0 0",
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: "2px"
          }}
        >
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
          Periodos: <strong>s</strong> = semana (segunda a domingo), <strong>d</strong> = dezena
          (1-10, 11-20, 21-fim), <strong>q</strong> = quinzena (1-15, 16-fim), <strong>m</strong> =
          mes. O prazo conta do fim do periodo em que a venda caiu, e a data vai assim para o OMIE.
        </p>
      </details>
    </div>
  );
}
