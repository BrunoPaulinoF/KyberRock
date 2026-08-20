import type { WeighingBillingSituation } from "../services/weighing-billing-situation";

/**
 * A etiqueta colorida da situacao de faturamento de uma pesagem.
 *
 * Vive fora das telas porque a Conferencia de faturamento e o Fechamento de faturas mostram
 * a MESMA pesagem: se cada uma pintasse a etiqueta por conta propria, a mesma carga poderia
 * aparecer verde numa tela e amarela na outra — e quem confere pararia de confiar na cor.
 *
 * O verde e o unico "acabou": os dois amarelos travam dinheiro por falta de cadastro ou de
 * envio, o azul diz que a pesagem ja esta no OMIE esperando a emissao la, e o vermelho e a
 * recusa — a unica que exige alguem ir mexer.
 */
const SITUATION_TONE: Record<WeighingBillingSituation, "success" | "warning" | "danger" | "info"> =
  {
    billed: "success",
    sent: "info",
    pending: "warning",
    cadastro_incompleto: "warning",
    failed: "danger"
  };

export function SituationPill({
  situation,
  label,
  title
}: {
  situation: WeighingBillingSituation;
  label: string;
  title?: string;
}) {
  const tone = SITUATION_TONE[situation];
  const palette =
    tone === "success"
      ? { background: "var(--kr-success-soft)", color: "var(--kr-success)" }
      : tone === "danger"
        ? { background: "var(--kr-danger-soft)", color: "var(--kr-danger)" }
        : tone === "warning"
          ? { background: "var(--kr-warning-soft)", color: "var(--kr-warning)" }
          : { background: "var(--kr-info-bg)", color: "var(--kr-info-text)" };
  return (
    <span style={{ ...pillStyle, ...palette }} title={title}>
      {label}
    </span>
  );
}

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  whiteSpace: "nowrap"
};
