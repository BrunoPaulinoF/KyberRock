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
 * O numero da nota nao vem de graca com a conferencia: a listagem do OMIE reconhece o
 * faturamento pela etapa do kanban e nao carrega a NF-e, entao cada numero custa uma
 * consulta dirigida ao documento — ~3s na fila serializada. O edge tem teto para isso, e
 * mandar 300 ids numa pergunta so nao fazia 300 numeros chegarem: chegavam os do teto, e
 * os outros 290 voltavam marcados como "ja perguntados" sem nunca terem sido consultados.
 * Era assim que um relatorio de 326 cargas ganhava dez numeros e parava.
 *
 * Por isso a leva e do TAMANHO do teto do edge: tudo que vai numa pergunta e de fato
 * consultado, e a leva seguinte sai quando esta volta (ver `useOmieInvoiceNumbers`).
 */
export const OMIE_INVOICE_NUMBER_ASK_CHUNK = 20;

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
 * terminar: cinco levas de vinte sao ~100 cargas, e cada consulta e uma chamada de ~3s na
 * fila serializada do OMIE — a mesma que envia os fechamentos. Mais que isso viraria um
 * botao que fica minutos girando e uma fila de faturamento parada atras dele.
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
