import type { InvoiceClosingLine } from "./invoice-closing.js";

/**
 * "Fazer fechamento": mandar para o OMIE a fatura de TODAS as pesagens do periodo.
 *
 * Ate aqui, fechar uma quinzena era faturar pesagem por pesagem — no OMIE, na coluna
 * "Faturar", uma de cada vez. Com quatro caminhoes por dia isso e uma tarde inteira de
 * cliques, e o que escapa nao e cobrado de ninguem. Este modulo e a passada unica: pega as
 * pesagens que estao na tela (o periodo, o cliente e os filtros que a atendente escolheu) e
 * fatura cada uma no OMIE, que emite a nota do cliente daquela pesagem.
 *
 * Tres cuidados sao a razao do modulo existir separado da tela:
 *
 *  1. **Nao refatura o que ja tem nota.** Uma pesagem ja faturada e PULADA, nunca reenviada:
 *     refaturar duplicaria a NF-e do cliente, que e um problema fiscal, nao um retrabalho.
 *     A idempotencia do OMIE (`kyberrock:{unitId}:{operationId}:{action}`) e a segunda
 *     defesa; esta e a primeira.
 *  2. **Uma falha nao derruba a passada.** A pesagem com cadastro incompleto trava o
 *     faturamento dela e so dela — as outras vinte continuam. Fechar dezenove de vinte e
 *     ver a que faltou vale muito mais que abortar tudo na terceira.
 *  3. **A conta volta linha a linha.** Cada pesagem devolve o que aconteceu com ela, para a
 *     tela dizer exatamente quais faltaram e por que — um "12 de 20" sem lista deixaria a
 *     atendente procurando as oito no OMIE.
 *
 * A venda INTERNA nao entra: ela nao gera NF-e, e sim ordem de servico, e faturar OS e
 * outra decisao (ela sai da pedreira sem cobranca ao cliente). Ela aparece no resultado
 * como pulada, com o motivo — some-la em silencio faria o total do fechamento nao bater
 * com o da tela.
 */

/** O que aconteceu com uma pesagem na passada do fechamento. */
export type InvoiceClosingRunStatus =
  /** Faturada agora: o OMIE emitiu a nota nesta passada. */
  | "billed"
  /** Ja tinha nota antes da passada — nao foi reenviada. */
  | "already_billed"
  /** Fora do escopo do fechamento (venda interna). */
  | "skipped"
  /** O OMIE recusou por cadastro/regra: precisa de correcao antes de tentar de novo. */
  | "blocked"
  /** Falhou por erro momentaneo (internet, indisponibilidade): pode tentar de novo. */
  | "failed";

/** Uma pesagem candidata ao fechamento, ja com o que decide o que fazer com ela. */
export interface InvoiceClosingRunCandidate {
  operationId: string;
  couponNumber: number | null;
  customerName: string;
  operationType: "invoice" | "internal";
  /** Numero da nota ja emitida, quando ha — o sinal de "nao mexa nesta". */
  invoiceNumber: string | null;
  /** `billed` = o OMIE ja faturou (pelo app ou pela reconciliacao). */
  alreadyBilled: boolean;
  /** Falso na carga antiga que ficou sem cliente: nao ha para quem emitir nota. */
  hasCustomer: boolean;
  totalCents: number;
}

export interface InvoiceClosingRunItem {
  operationId: string;
  couponNumber: number | null;
  customerName: string;
  status: InvoiceClosingRunStatus;
  message: string;
  totalCents: number;
}

export interface InvoiceClosingRunResult {
  /** Pesagens que estavam na tela quando o botao foi apertado. */
  requested: number;
  billed: number;
  alreadyBilled: number;
  skipped: number;
  blocked: number;
  failed: number;
  /** Valor que ESTA passada faturou (so as `billed`). */
  billedTotalCents: number;
  items: InvoiceClosingRunItem[];
}

/** Andamento da passada, para a tela nao ficar num spinner mudo por dezenas de pesagens. */
export interface InvoiceClosingRunProgress {
  done: number;
  /** Quantas pesagens esta passada vai mandar ao OMIE (sem as ja faturadas e as internas). */
  total: number;
  customerName: string;
  couponNumber: number | null;
}

/** O resultado de faturar UMA pesagem — o mesmo contrato de `processFiscalBillingNow`. */
export interface InvoiceClosingBillOutcome {
  billed: boolean;
  blocked?: boolean;
  blockReason?: string | null;
  /** O OMIE respondeu que o pedido ja estava faturado la — conciliado, nao faturado agora. */
  alreadyBilledInOmie?: boolean;
  billingStatusMessage: string | null;
}

/**
 * As pesagens da tela que o fechamento vai tentar faturar.
 *
 * Sai das MESMAS linhas que o relatorio mostra (`report.rows`), e nao de uma consulta
 * propria: o botao tem de fechar exatamente o que esta na tela — periodo, cliente, placa e
 * busca —, senao ele fatura algo que a atendente nao viu.
 */
export function selectInvoiceClosingCandidates(
  lines: readonly InvoiceClosingLine[]
): InvoiceClosingRunCandidate[] {
  return lines.map((line) => ({
    operationId: line.operationId,
    couponNumber: line.couponNumber,
    customerName: line.customerName,
    operationType: line.operationType,
    invoiceNumber: line.invoiceNumber,
    alreadyBilled: line.situation === "billed" || Boolean(line.invoiceNumber),
    hasCustomer: Boolean(line.customerId),
    totalCents: line.totalCents
  }));
}

/** Quantas pesagens da lista o fechamento de fato mandaria para o OMIE. */
export function countBillableCandidates(candidates: readonly InvoiceClosingRunCandidate[]): number {
  return candidates.filter(
    (candidate) =>
      candidate.operationType === "invoice" && !candidate.alreadyBilled && candidate.hasCustomer
  ).length;
}

/**
 * As pesagens do periodo cuja nota precisa ser perguntada ao OMIE.
 *
 * Sao as que ja tem documento la (pedido de venda OU ordem de servico) e ainda estao sem o
 * numero da nota aqui. A nota nasce DENTRO do OMIE — quem faturou pela tela de la, ou o
 * proprio app faturando por outra balanca, nao avisa esta instalacao —, entao o numero so
 * aparece quando alguem pergunta.
 *
 * A ordem de servico entra junto do pedido de venda de proposito: a venda interna vira OS
 * no OMIE e a nota dela e uma NFS-e, emitida la do mesmo jeito. Perguntar so pelos pedidos
 * deixava a coluna "Nota fiscal" do relatorio vazia justamente nas internas — que sao a
 * maioria do movimento em alguns dias, e o cliente recebia um relatorio sem o numero que
 * ele usa para conferir.
 */
export function selectOperationsMissingInvoiceNumber(
  lines: readonly InvoiceClosingLine[]
): string[] {
  return lines
    .filter(
      (line) =>
        !line.invoiceNumber && (line.omieSalesOrderId !== null || line.omieServiceOrderId !== null)
    )
    .map((line) => line.operationId);
}

/**
 * Fatura no OMIE, uma a uma, as pesagens do fechamento.
 *
 * SEQUENCIAL de proposito: cada faturamento e uma chamada ao OMIE que cria documento
 * fiscal, e disparar vinte de uma vez esbarra no limite de requisicoes de la — com a
 * agravante de que uma recusa por excesso de chamadas e indistinguivel, para quem le a
 * tela, de uma recusa por cadastro.
 */
export async function runInvoiceClosing(
  candidates: readonly InvoiceClosingRunCandidate[],
  bill: (operationId: string) => Promise<InvoiceClosingBillOutcome>,
  onProgress?: (progress: InvoiceClosingRunProgress) => void
): Promise<InvoiceClosingRunResult> {
  const items: InvoiceClosingRunItem[] = [];
  // O andamento conta so o que de fato vai ao OMIE: "3 de 20" num periodo em que 15 ja
  // tinham nota faria a tela parecer travada nas primeiras.
  const total = countBillableCandidates(candidates);
  let done = 0;

  for (const candidate of candidates) {
    const base = {
      operationId: candidate.operationId,
      couponNumber: candidate.couponNumber,
      customerName: candidate.customerName,
      totalCents: candidate.totalCents
    };

    if (candidate.operationType !== "invoice") {
      items.push({
        ...base,
        status: "skipped",
        message: "Venda interna: nao gera nota fiscal, e sim ordem de servico no OMIE."
      });
      continue;
    }

    // Carga sem cliente nao tem para quem emitir nota. Ela aparece na lista do periodo (e
    // precisa aparecer — e carga que saiu da pedreira sem cobranca), mas o fechamento nao
    // tem o que tentar: o conserto e vincular o cliente na operacao.
    if (!candidate.hasCustomer) {
      items.push({
        ...base,
        status: "blocked",
        message:
          "Carga sem cliente vinculado: nao ha para quem emitir a nota. Vincule o cliente na operacao e refaca o fechamento."
      });
      continue;
    }

    if (candidate.alreadyBilled) {
      items.push({
        ...base,
        status: "already_billed",
        message: candidate.invoiceNumber
          ? `Ja faturada no OMIE (nota ${candidate.invoiceNumber}).`
          : "Ja faturada no OMIE."
      });
      continue;
    }

    done += 1;
    onProgress?.({
      done,
      total,
      customerName: candidate.customerName,
      couponNumber: candidate.couponNumber
    });

    try {
      const outcome = await bill(candidate.operationId);
      if (outcome.blocked) {
        items.push({
          ...base,
          status: "blocked",
          message: outcome.blockReason || "O OMIE recusou o faturamento desta pesagem."
        });
        continue;
      }
      if (!outcome.billed) {
        items.push({
          ...base,
          status: "failed",
          message: outcome.billingStatusMessage || "O OMIE nao confirmou o faturamento."
        });
        continue;
      }
      items.push({
        ...base,
        // O OMIE respondeu "esse pedido ja foi autorizado": a nota daquela carga ja existe.
        // Conta como ja faturada, e nao como faturada AGORA, senao o total desta passada
        // somaria dinheiro que ela nao faturou.
        status: outcome.alreadyBilledInOmie ? "already_billed" : "billed",
        message: outcome.billingStatusMessage || "Faturada no OMIE."
      });
    } catch (error) {
      // Nunca propaga: uma pesagem que estourou nao pode cancelar o fechamento das outras.
      items.push({
        ...base,
        status: "failed",
        message: error instanceof Error ? error.message : "Erro ao faturar no OMIE."
      });
    }
  }

  return summarizeInvoiceClosingRun(candidates.length, items);
}

/** O resumo que a tela mostra em cima da lista. */
export function summarizeInvoiceClosingRun(
  requested: number,
  items: readonly InvoiceClosingRunItem[]
): InvoiceClosingRunResult {
  const count = (status: InvoiceClosingRunStatus): number =>
    items.filter((item) => item.status === status).length;

  return {
    requested,
    billed: count("billed"),
    alreadyBilled: count("already_billed"),
    skipped: count("skipped"),
    blocked: count("blocked"),
    failed: count("failed"),
    billedTotalCents: items
      .filter((item) => item.status === "billed")
      .reduce((total, item) => total + item.totalCents, 0),
    items: [...items]
  };
}
