/**
 * Vocabulario da situacao de faturamento de uma pesagem: os valores possiveis, os rotulos
 * e a regra que decide qual deles vale para uma operacao.
 *
 * Fica separado de `weighing-billing-report.ts` porque a TELA precisa dos rotulos para
 * montar os filtros, e o servico do relatorio depende do SQLite — importar valor (nao
 * tipo) de la levaria `node:crypto` para dentro do bundle do renderer, que roda no
 * navegador do Electron. Este modulo e puro de proposito: nao importa banco, nao importa
 * Node, e por isso os dois lados podem usar.
 */

/**
 * Em que pe esta o faturamento de uma pesagem. Espelha a classificacao que o operador ve
 * na tela de Concluidas (`getFiscalBillingStatus`, em `App.tsx`): as duas leem as MESMAS
 * colunas da operacao, entao uma pesagem nao pode aparecer verde la e pendente aqui.
 *
 * O desktop nao emite nota: quem fatura e o OMIE. `sent` significa que o pedido (ou a
 * ordem de servico, na venda interna) ja esta la e falta a etapa "Faturar" — nao e um
 * problema do KyberRock, mas continua sendo dinheiro nao faturado.
 */
export type WeighingBillingSituation =
  | "billed"
  | "sent"
  | "pending"
  | "cadastro_incompleto"
  | "failed";

export const WEIGHING_BILLING_SITUATIONS: readonly WeighingBillingSituation[] = [
  "billed",
  "sent",
  "pending",
  "cadastro_incompleto",
  "failed"
];

export const WEIGHING_BILLING_SITUATION_LABEL: Record<WeighingBillingSituation, string> = {
  billed: "Faturada",
  sent: "No OMIE, falta faturar",
  pending: "Nao enviada ao OMIE",
  cadastro_incompleto: "Cadastro incompleto",
  failed: "Recusada pelo OMIE"
};

export function isWeighingBillingSituation(value: unknown): value is WeighingBillingSituation {
  return (WEIGHING_BILLING_SITUATIONS as readonly unknown[]).includes(value);
}

/**
 * Ordem das situacoes no resumo: primeiro o que trava dinheiro (recusada, cadastro
 * incompleto, nao enviada), depois o que ja esta no OMIE e por ultimo o que ja fechou.
 * Quem abre o relatorio quer ver o problema no topo, nao o que deu certo.
 */
export const WEIGHING_BILLING_SITUATION_ORDER: Record<WeighingBillingSituation, number> = {
  failed: 0,
  cadastro_incompleto: 1,
  pending: 2,
  sent: 3,
  billed: 4
};

/** As colunas da operacao de que a classificacao depende — e so essas. */
export interface WeighingBillingSituationInput {
  operation_type: "invoice" | "internal";
  omie_sales_order_id: number | null;
  omie_service_order_id: number | null;
  omie_billing_status: string | null;
}

/**
 * Mesma leitura de `getFiscalBillingStatus` (renderer), reduzida ao que a conferencia
 * precisa saber. A venda INTERNA nao gera pedido de venda: ela vira ordem de servico, e
 * por isso e o `omie_service_order_id` que diz se ela chegou la — e por isso ela nunca
 * chega a `billed`, que e o estado do pedido faturado.
 */
export function resolveSituation(row: WeighingBillingSituationInput): WeighingBillingSituation {
  if (row.operation_type !== "invoice") {
    if (row.omie_service_order_id) return "sent";
    if (row.omie_billing_status === "cadastro_incompleto") return "cadastro_incompleto";
    if (row.omie_billing_status === "service_order_failed") return "failed";
    return "pending";
  }

  if (row.omie_billing_status === "billed") return "billed";
  // Pedido criado: o KyberRock fez a parte dele e a NF-e sai na coluna "Faturar" do OMIE.
  if (row.omie_sales_order_id) return "sent";
  if (row.omie_billing_status === "cadastro_incompleto") return "cadastro_incompleto";
  if (row.omie_billing_status === "failed") return "failed";
  return "pending";
}
