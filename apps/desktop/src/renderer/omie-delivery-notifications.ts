import type { WeighingOperationSummary } from "../services/weighing-operations";

/**
 * Acompanhamento do envio das operacoes concluidas ao OMIE. O envio acontece em
 * background (fila + sincronizacao), entao o operador nao ficava sabendo do resultado:
 * ele precisava abrir a tela Concluidas e comparar a coluna fiscal. Aqui a transicao de
 * estado de cada operacao vira um evento — que a tela transforma em som + aviso no canto
 * superior direito, dizendo qual operacao deu certo e qual falhou.
 */
export type OmieDeliveryState = "pending" | "delivered" | "failed";

export type OmieDeliveryEventKind = "success" | "error";

export interface OmieDeliveryEvent {
  operationId: string;
  kind: OmieDeliveryEventKind;
  /** Titulo curto do aviso ("Enviada ao OMIE" / "Falha ao enviar ao OMIE"). */
  title: string;
  /** Identificacao da operacao: placa + cliente. */
  operationLabel: string;
  /** Numero do pedido/OS no sucesso, motivo da recusa no erro. */
  detail: string;
}

type DeliveryOperation = Pick<
  WeighingOperationSummary,
  | "id"
  | "plate"
  | "customerName"
  | "operationType"
  | "omieSalesOrderId"
  | "omieServiceOrderId"
  | "omieBillingStatus"
  | "omieBillingMessage"
>;

/**
 * Em que ponto do envio ao OMIE a operacao esta. `delivered` cobre os dois caminhos
 * (pedido de venda da fiscal e ordem de servico da interna) e tambem a operacao ja
 * faturada; `failed` cobre recusa do OMIE e cadastro incompleto — os dois casos em que
 * a operacao para de andar sozinha e precisa do operador.
 */
export function getOmieDeliveryState(operation: DeliveryOperation): OmieDeliveryState {
  if (
    operation.omieSalesOrderId != null ||
    operation.omieServiceOrderId != null ||
    operation.omieBillingStatus === "billed"
  ) {
    return "delivered";
  }
  if (
    operation.omieBillingStatus === "failed" ||
    operation.omieBillingStatus === "service_order_failed" ||
    operation.omieBillingStatus === "cadastro_incompleto"
  ) {
    return "failed";
  }
  return "pending";
}

export function buildOmieDeliveryStates(
  operations: DeliveryOperation[]
): Map<string, OmieDeliveryState> {
  return new Map(operations.map((operation) => [operation.id, getOmieDeliveryState(operation)]));
}

function describeOperation(operation: DeliveryOperation): string {
  const plate = operation.plate?.trim();
  const customer = operation.customerName?.trim() || "cliente nao informado";
  return plate ? `${plate} - ${customer}` : customer;
}

function describeSuccess(operation: DeliveryOperation): string {
  if (operation.omieSalesOrderId != null) {
    return `Pedido OMIE ${operation.omieSalesOrderId} criado.`;
  }
  if (operation.omieServiceOrderId != null) {
    return `Ordem de servico OMIE ${operation.omieServiceOrderId} criada.`;
  }
  return "Operacao faturada no OMIE.";
}

function describeFailure(operation: DeliveryOperation): string {
  if (operation.omieBillingMessage?.trim()) {
    return operation.omieBillingMessage.trim();
  }
  if (operation.omieBillingStatus === "cadastro_incompleto") {
    return "Cadastro do cliente incompleto para o envio ao OMIE.";
  }
  return operation.operationType === "invoice"
    ? "O OMIE recusou o pedido desta operacao."
    : "O OMIE recusou a ordem de servico desta operacao.";
}

/**
 * Compara o estado anterior (id -> estado) com a lista recem-carregada e devolve so as
 * transicoes que merecem aviso: pendente -> enviada (som suave de sucesso) e
 * pendente/enviada -> falha (som de alerta). Operacoes que ja estavam no estado final
 * quando a tela abriu nao geram evento — quem faz isso e o `seed` inicial do mapa.
 */
export function diffOmieDeliveryEvents(
  previous: Map<string, OmieDeliveryState>,
  operations: DeliveryOperation[]
): OmieDeliveryEvent[] {
  const events: OmieDeliveryEvent[] = [];

  for (const operation of operations) {
    const before = previous.get(operation.id);
    if (before === undefined) continue;
    const after = getOmieDeliveryState(operation);
    if (after === before || after === "pending") continue;

    events.push(
      after === "delivered"
        ? {
            operationId: operation.id,
            kind: "success",
            title: "Enviada ao OMIE",
            operationLabel: describeOperation(operation),
            detail: describeSuccess(operation)
          }
        : {
            operationId: operation.id,
            kind: "error",
            title: "Falha ao enviar ao OMIE",
            operationLabel: describeOperation(operation),
            detail: describeFailure(operation)
          }
    );
  }

  return events;
}
