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
 * Quantas cargas cabem em UMA pergunta.
 *
 * Era vinte porque cada numero custava uma consulta dirigida ao documento (~3s na fila
 * serializada) e o edge tinha teto para isso: mandar 300 ids numa pergunta so devolvia os
 * do teto e marcava os outros 290 como "ja perguntados" sem nunca te-los consultado. Era
 * assim que um relatorio de 326 cargas ganhava dez numeros e parava.
 *
 * Agora o edge procura a nota na LISTAGEM DE NOTAS do OMIE, e ali uma chamada devolve cem
 * notas ja apontando para o pedido que as gerou. O custo deixou de ser por carga e passou
 * a ser por leva — e uma leva de vinte gastaria a mesma varredura para trazer um quinto do
 * proveito. Cem e o tamanho de uma pagina da listagem: a leva inteira cabe no que uma
 * chamada ja traz, e o fechamento de uma quinzena se preenche em tres levas em vez de
 * dezessete.
 *
 * A leva seguinte sai quando esta volta (ver `useOmieInvoiceNumbers`).
 */
export const OMIE_INVOICE_NUMBER_ASK_CHUNK = 100;

/**
 * Teto de cargas que UMA tela pergunta enquanto esta aberta.
 *
 * As levas se sucedem sozinhas, entao sem teto um relatorio anual perguntaria por milhares
 * de cargas seguidas, ocupando a fila que tambem envia os fechamentos. Trezentas cobrem a
 * quinzena de uma pedreira movimentada; o que sobra nao se perde — cai na proxima abertura
 * da tela e na conferencia de fundo.
 */
export const OMIE_INVOICE_NUMBER_ASK_LIMIT = 300;

/**
 * Quantas levas o botao "Conferir notas no OMIE" encadeia numa apertada so.
 *
 * O botao existe para quem vai MANDAR o relatorio agora, e o operador fica esperando ele
 * terminar. Cinco levas de cem cobrem 500 cargas — um periodo inteiro —, e cada leva custa
 * a varredura da listagem de notas, nao uma chamada por carga. O laco para sozinho assim
 * que nao sobra carga sem numero, entao na pratica quase sempre acaba antes da quinta.
 * Mais levas que isso so serviriam para deixar o botao girando com a fila do OMIE — a
 * mesma que envia os fechamentos — ocupada atras dele.
 *
 * O que nao couber nao se perde: a propria tela continua perguntando sozinha enquanto
 * estiver aberta, a conferencia de fundo cobre o resto, e apertar de novo continua de onde
 * parou — a resposta do botao diz quantas ainda estao sem numero.
 */
export const OMIE_INVOICE_NUMBER_ASK_ROUNDS = 5;

/** Contagem de uma passada da conferencia, do ponto de vista do numero da nota. */
export interface OmieInvoiceNumberReconcileResult {
  /** Pesagens conferidas no OMIE. */
  checked: number;
  /** Quantas passaram a constar faturadas. */
  billed: number;
  /** Quantas ganharam o numero da nota. */
  invoiceNumbers: number;
  /** Quantas continuam faturadas sem numero. */
  stillWithoutInvoiceNumber: number;
  errors: string[];
}

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
 *
 * A mesma memoria e o que faz as levas ANDAREM: cada leva marca os seus ids, e a chamada
 * seguinte pega a leva de baixo em vez de repetir a de cima. E assim que uma tela de
 * centenas de cargas se preenche inteira, e nao so ate o teto de uma pergunta.
 */
export function selectInvoiceNumbersToAsk(
  rows: readonly OmieInvoiceNumberRow[],
  alreadyAsked: ReadonlySet<string>,
  limit: number = OMIE_INVOICE_NUMBER_ASK_CHUNK
): string[] {
  const missing = selectOperationsMissingInvoiceNumber(rows).filter(
    (operationId) => !alreadyAsked.has(operationId)
  );
  return limit >= 0 ? missing.slice(0, limit) : missing;
}
