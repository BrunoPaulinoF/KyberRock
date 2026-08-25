/**
 * O cartao de numero grande do topo das telas de faturamento.
 *
 * Vive fora delas pelo mesmo motivo do `SituationPill`: a Conferencia de faturamento e o
 * Fechamento de faturas mostram o mesmo cartao, e mantinham cada uma a sua copia — igual
 * ate no tom de cor. Um KPI com aparencia diferente entre as duas telas seria lido como
 * dois indicadores diferentes.
 */
export function Kpi({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "success";
}) {
  const valueStyle =
    tone === "danger"
      ? { ...styles.kpiValue, color: "var(--kr-danger)" }
      : tone === "success"
        ? { ...styles.kpiValue, color: "var(--kr-success)" }
        : styles.kpiValue;
  return (
    <div style={styles.card}>
      <p style={styles.kpiLabel}>{label}</p>
      <p style={valueStyle}>{value}</p>
      {hint ? <p style={styles.hint}>{hint}</p> : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--kr-card-bg)",
    border: "1px solid var(--kr-card-border)",
    borderRadius: "12px",
    padding: "12px",
    boxShadow: "var(--kr-shadow)",
    minWidth: 0
  },
  kpiLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--kr-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0
  },
  kpiValue: {
    fontSize: "21px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: "4px 0 2px 0"
  },
  hint: {
    fontSize: "12px",
    color: "var(--kr-muted)",
    margin: 0,
    whiteSpace: "pre-line"
  }
};
