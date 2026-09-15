/**
 * Vocabulario dos status de uma pesagem: quais contam como CONCLUIDA, quais contam como
 * EM ANDAMENTO, e as duas listas ja prontas para um `IN (...)` de SQL.
 *
 * Mora fora de `weighing-operations.ts` pelo mesmo motivo de
 * `weighing-billing-situation.ts`: `weighing-operations.ts` importa `customers.ts` (para o
 * e-mail padrao de NF-e), entao o cadastro nao pode importar de volta de la sem fechar um
 * ciclo de modulos. Este arquivo nao depende de banco nem de Node — os dois lados leem
 * daqui, e a definicao continua sendo uma so.
 *
 * `weighing-operations.ts` reexporta tudo, entao quem ja importava de la nao muda nada.
 */

import type { OperationStatus } from "@kyberrock/shared";

/**
 * Status de uma operacao ja concluida (fechada localmente), em qualquer estagio da
 * sincronizacao. Uma operacao "concluida" nasce em `closed_local` e caminha por
 * `pending_cloud`/`pending_omie` ate `synced` — ou para em `sync_error`. Em todos esses
 * estados a pesagem ja terminou (peso de saida capturado, cupom emitido), entao ela
 * continua sendo uma operacao concluida: precisa aparecer na lista de Concluidas, entrar
 * nos relatorios e permitir reimpressao/exclusao. Apenas `cancelled` sai desse conjunto.
 *
 * Antes, varias consultas filtravam so por `closed_local`, e a operacao sumia da lista de
 * Concluidas assim que a sincronizacao com a nuvem/OMIE mudava o status para `synced`.
 */
export const CLOSED_OPERATION_STATUSES = [
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error"
] as const satisfies readonly OperationStatus[];

/** Lista de status concluidos ja formatada para interpolar num `IN (...)` de SQL. */
export const CLOSED_OPERATION_STATUS_SQL_LIST = CLOSED_OPERATION_STATUSES.map(
  (status) => `'${status}'`
).join(", ");

/** True quando o status representa uma operacao concluida (fechada, em qualquer estagio de sync). */
export function isClosedOperationStatus(status: string): boolean {
  return (CLOSED_OPERATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Status em que a operacao ainda esta EM ANDAMENTO (nasceu, mas nao fechou). Sao os
 * unicos em que os dados comerciais podem ser alterados — depois do fechamento o pedido
 * / OS ja foi montado para o OMIE e a correcao passa a ser cancelar e refazer.
 */
export const OPEN_OPERATION_STATUSES = [
  "draft",
  "entry_registered",
  "loading_requested",
  "awaiting_exit"
] as const satisfies readonly OperationStatus[];

/** Lista de status em andamento ja formatada para interpolar num `IN (...)` de SQL. */
export const OPEN_OPERATION_STATUS_SQL_LIST = OPEN_OPERATION_STATUSES.map(
  (status) => `'${status}'`
).join(", ");

/** True quando a operacao ainda esta aberta (em andamento). */
export function isOpenOperationStatus(status: string): boolean {
  return (OPEN_OPERATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Data CONTABIL de uma pesagem — o dia em que ela FECHOU (peso de saida capturado), nao o
 * dia em que o caminhao entrou na pedreira.
 *
 * Esta e a data que o KyberRock manda para o OMIE como emissao do pedido/OS
 * (`issueDate` em `buildOmieBillingJob`, alimentado por `exit_weight_captured_at`), e e
 * dela que nascem a NF-e, a conta a receber e o vencimento das parcelas. Os relatorios
 * filtravam por `date(created_at)` — a ENTRADA —, e as duas datas so coincidem quando o
 * caminhao entra e sai no mesmo dia. Um caminhao que entrou na quarta e so fechou na
 * sexta caia na quarta no KyberRock e na sexta no OMIE: a conferencia acusava pesagem
 * "sobrando no OMIE" num dia e "faltando" no outro, sem nada de errado ter acontecido.
 * (Caso real: 11/09/2026 fechou 50 lancamentos / R$ 60.971,18 no OMIE contra 45 /
 * R$ 53.556,22 no relatorio — as 5 diferencas eram pesagens abertas em 09 e 10/09 e
 * fechadas em 11/09.)
 *
 * O `COALESCE` cuida das operacoes antigas, gravadas antes de a coluna existir: sem
 * horario de saida a data de criacao continua valendo, entao nenhuma pesagem historica
 * some do relatorio.
 *
 * Vale para dinheiro (faturamento, fatura de fiado, vencimento, conferencia com o OMIE).
 * O patio continua sendo contado pela ENTRADA — `getTruckControlReport` e
 * `getAverageQuarryMinutes` medem tempo dentro da pedreira e nao mudam de base.
 *
 * @param alias prefixo da tabela na consulta (`"o"`, `"wo"`); vazio quando nao ha alias.
 */
export function operationSaleDateSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE(${prefix}exit_weight_captured_at, ${prefix}created_at)`;
}
