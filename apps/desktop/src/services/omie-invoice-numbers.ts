/**
 * Quais cargas da tela ainda precisam ter o numero da nota perguntado ao OMIE.
 *
 * A nota nasce DENTRO do OMIE: o KyberRock cria o pedido (ou a ordem de servico) na etapa
 * "Faturar" e para por ali — quem emite e uma pessoa, na tela de la, e nada disso volta
 * sozinho para a balanca. Enquanto ninguem pergunta, a coluna "Nota fiscal" sai com "-"
 * mesmo em carga cuja nota existe ha semanas, e o relatorio chega ao cliente sem o unico
 * numero que ele usa para conferir.
 *
 * A conferencia de fundo pergunta por rodizio, e o rodizio tem um vies conhecido: o
 * movimento dos ultimos dois dias entra em toda passada (a cada 3 min), e o resto — o
 * acervo — so na passada completa, de hora em hora e em lote. Fechar a quinzena do dia 1
 * ao 15 e justamente olhar para o acervo: as cargas que a atendente precisa AGORA sao as
 * que o rodizio deixa para depois.
 *
 * Por isso a tela que mostra o numero pergunta pelo que ESTA nela. Estas funcoes decidem
 * por quais cargas perguntar; a pergunta em si e a reconciliacao dirigida do
 * `supabase-sync` (somente leitura: nao fatura, nao emite, nao muda documento no OMIE).
 */

/** O minimo que uma linha de tela precisa expor para se saber se falta perguntar por ela. */
export interface OmieInvoiceNumberRow {
  operationId: string;
  /** Numero da nota ja conhecido aqui. Null enquanto ninguem perguntou — ou nao saiu. */
  invoiceNumber: string | null;
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
}

/**
 * Teto de uma pergunta so, igual ao lote da conferencia de fundo.
 *
 * Um periodo longo pode ter milhares de cargas, e a pergunta vira chamada ao OMIE pela
 * MESMA fila que envia os pedidos: sem teto, abrir um relatorio anual atrasaria o
 * faturamento de quem esta fechando ao lado. O que sobra nao se perde — cai na proxima
 * abertura da tela e na conferencia de fundo.
 */
export const OMIE_INVOICE_NUMBER_ASK_LIMIT = 300;

/**
 * As cargas que ja tem documento no OMIE e ainda estao sem o numero da nota aqui.
 *
 * A ordem de servico entra junto do pedido de venda de proposito: a venda interna vira OS
 * no OMIE e a nota dela e uma NFS-e, emitida la do mesmo jeito. Perguntar so pelos pedidos
 * deixava a coluna "Nota fiscal" vazia justamente nas internas — que em alguns dias sao a
 * maioria do movimento.
 */
export function selectOperationsMissingInvoiceNumber(
  rows: readonly OmieInvoiceNumberRow[]
): string[] {
  return rows
    .filter(
      (row) =>
        !row.invoiceNumber && (row.omieSalesOrderId !== null || row.omieServiceOrderId !== null)
    )
    .map((row) => row.operationId);
}

/**
 * O que perguntar ao abrir a tela: o que falta, menos o que ja foi perguntado.
 *
 * `alreadyAsked` e a memoria da sessao, e existe para a tela nao repetir a pergunta a cada
 * redesenho — filtrar por placa ou digitar na busca refaz a lista, e sem essa memoria cada
 * tecla viraria uma chamada ao OMIE. Uma carga que ainda nao foi faturada la continua sem
 * numero de proposito: ela sera perguntada de novo quando a tela for aberta outra vez, que
 * e quando faz sentido perguntar.
 */
export function selectInvoiceNumbersToAsk(
  rows: readonly OmieInvoiceNumberRow[],
  alreadyAsked: ReadonlySet<string>,
  limit: number = OMIE_INVOICE_NUMBER_ASK_LIMIT
): string[] {
  const missing = selectOperationsMissingInvoiceNumber(rows).filter(
    (operationId) => !alreadyAsked.has(operationId)
  );
  return limit >= 0 ? missing.slice(0, limit) : missing;
}
