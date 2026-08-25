import { invoiceNumberLabel } from "../services/invoice-number-label";

/**
 * A celula "Nota fiscal" de uma pesagem, com a mesma leitura em todas as telas.
 *
 * O destaque vermelho vale para UM caso so: venda com nota que ainda esta sem numero. A
 * venda interna nao emite NF-e — ela sai neutra, com a explicacao no tooltip. Antes toda
 * carga sem numero saia em vermelho, e como a maioria do movimento e interna a tela vivia
 * cobrando um documento que nunca ia existir: o operador lia "Faturada / Sem nota" na
 * mesma linha e concluia, com razao, que o sistema estava errado.
 */
export function InvoiceNumberCell({
  invoiceNumber,
  operationType
}: {
  invoiceNumber: string | null;
  operationType: "invoice" | "internal";
}) {
  const label = invoiceNumberLabel(invoiceNumber, operationType);
  const color =
    label.state === "pending"
      ? "var(--kr-danger)"
      : label.state === "not_applicable"
        ? "var(--kr-muted)"
        : "inherit";

  return (
    <span
      title={label.title ?? undefined}
      style={{ color, fontWeight: label.state === "number" ? 700 : 400 }}
    >
      {label.text}
    </span>
  );
}
