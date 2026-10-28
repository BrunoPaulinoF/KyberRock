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
 * Isto e o INSTANTE (UTC), bom para ordenar e exibir hora. Para recortar o periodo ou
 * mostrar o dia use `operationSaleDaySql`: `date()` em cima disto daria o dia de UTC.
 *
 * @param alias prefixo da tabela na consulta (`"o"`, `"wo"`); vazio quando nao ha alias.
 */
export function operationSaleDateSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE(${prefix}exit_weight_captured_at, ${prefix}created_at)`;
}

/**
 * Fuso do DIA da venda: o de Sao Paulo (UTC-3; o Brasil nao tem horario de verao desde
 * 2019), o mesmo `REPORT_UTC_OFFSET` dos relatorios da nuvem e o `localDay` do site.
 *
 * O horario e gravado em UTC (`toISOString`), e cortar o texto (`slice(0, 10)`, ou `date()`
 * no SQLite) dava o dia de UTC: o caminhao que fecha as 22h de 20/10 virava pedido do OMIE
 * de 21/10, todo vencimento caia um dia depois, e o cupom mostrava "Saida: 20/10" com
 * VENCTO contado de 21/10. Das 21h a meia-noite, todo dia.
 *
 * Deslocamento fixo, e nao `America/Sao_Paulo` pelo Intl, porque o SQLite nao tem tabela de
 * fusos: a conta do JS (emissao do OMIE, VENCTO do cupom) e a do SQL (recorte dos
 * relatorios) tem de dar o MESMO dia, senao o relatorio volta a discordar do OMIE
 * justamente na pesagem da noite.
 */
const SALE_DAY_UTC_OFFSET_HOURS = -3;

/**
 * Dia da venda (yyyy-mm-dd) em SQL: `operationSaleDateSql` no calendario de Sao Paulo. E
 * o recorte de periodo de todo relatorio de dinheiro da balanca — o mesmo dia que
 * `operationSaleDay` manda ao OMIE como emissao. Valor so com a data (sem hora) ja e o dia
 * do calendario e nao desloca: para o SQLite ele seria meia-noite UTC, e voltaria um dia.
 */
export function operationSaleDaySql(alias = ""): string {
  const at = operationSaleDateSql(alias);
  return `CASE WHEN length(${at}) <= 10 THEN date(${at}) ELSE date(${at}, '${SALE_DAY_UTC_OFFSET_HOURS} hours') END`;
}

/**
 * Dia da venda (yyyy-mm-dd) de um horario gravado (`exit_weight_captured_at`, com
 * `created_at` de reserva), no calendario de Sao Paulo. Espelho de `operationSaleDaySql`:
 * horario sem fuso vale como UTC, como no SQLite, e so a data volta como veio. Vazio quando
 * nao ha horario.
 */
export function operationSaleDay(capturedAt: string | null | undefined): string {
  if (!capturedAt) return "";
  if (capturedAt.length <= 10) return capturedAt;
  const hasZone = /(?:z|[+-]\d{2}:\d{2})$/i.test(capturedAt);
  const instant = Date.parse(hasZone ? capturedAt : `${capturedAt.replace(" ", "T")}Z`);
  if (!Number.isFinite(instant)) return capturedAt.slice(0, 10);
  return new Date(instant + SALE_DAY_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}
