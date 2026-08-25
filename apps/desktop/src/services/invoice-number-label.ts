/**
 * O que a coluna "Nota fiscal" mostra numa pesagem — e por que.
 *
 * A tela dizia "Sem nota", em vermelho, em toda carga sem numero. So que a maioria das
 * cargas de uma pedreira e VENDA INTERNA, e venda interna **nao emite NF-e**: ela vira
 * ordem de servico no OMIE, para o controle interno e para o financeiro (esta na propria
 * Central de ajuda: "A operacao interna nao emite NF-e"). Marcar essas linhas como
 * pendencia era a tela cobrando um documento que nunca vai existir — o operador lia
 * "Faturada / Sem nota" na mesma linha e concluia, com razao, que o sistema estava errado.
 *
 * Sao tres estados, e nao dois:
 *
 *  - **numero** — a nota saiu e e este o numero que o cliente e o contador dele pedem;
 *  - **pendente** — venda COM NOTA que ja consta faturada e ainda esta sem numero aqui.
 *    Esta e a unica que merece destaque: ou a nota ainda nao foi emitida no OMIE, ou a
 *    conferencia ainda nao chegou nela;
 *  - **nao se aplica** — venda interna. Nao ha nota a esperar. Se a pedreira emitir NFS-e
 *    a partir da OS, o numero aparece e a linha volta a ser o primeiro caso.
 */

export type InvoiceNumberState = "number" | "pending" | "not_applicable";

export interface InvoiceNumberLabel {
  state: InvoiceNumberState;
  /** O que aparece na celula. */
  text: string;
  /** Explicacao no `title` da celula. Null quando o texto ja se explica. */
  title: string | null;
}

const NOT_APPLICABLE_TITLE =
  "Venda interna: vira ordem de servico no OMIE e nao emite NF-e. Se a pedreira emitir nota de servico a partir da OS, o numero aparece aqui.";

const PENDING_TITLE =
  "Venda com nota ainda sem numero: ou a NF-e nao foi emitida no OMIE, ou a conferencia ainda nao chegou nesta carga.";

/**
 * O rotulo da coluna "Nota fiscal" de uma pesagem.
 *
 * Um lugar so para a tela, o PDF e a planilha — antes cada um escolhia o seu, e a MESMA
 * carga saia como "Sem nota" na tela e "-" no arquivo exportado.
 */
export function invoiceNumberLabel(
  invoiceNumber: string | null,
  operationType: "invoice" | "internal"
): InvoiceNumberLabel {
  const number = (invoiceNumber ?? "").trim();
  if (number) return { state: "number", text: number, title: null };

  if (operationType === "internal") {
    return { state: "not_applicable", text: "—", title: NOT_APPLICABLE_TITLE };
  }

  return { state: "pending", text: "Sem nota", title: PENDING_TITLE };
}

/** O mesmo rotulo em texto puro, para PDF e planilha (que nao tem `title` nem cor). */
export function invoiceNumberText(
  invoiceNumber: string | null,
  operationType: "invoice" | "internal"
): string {
  const label = invoiceNumberLabel(invoiceNumber, operationType);
  // No arquivo, "—" sozinho nao se explica: quem abre o Excel nao tem o tooltip.
  return label.state === "not_applicable" ? "Interna (sem NF-e)" : label.text;
}
