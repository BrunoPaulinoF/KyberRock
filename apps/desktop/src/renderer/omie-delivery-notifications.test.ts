import { describe, expect, it } from "vitest";

import {
  buildOmieDeliveryStates,
  diffOmieDeliveryEvents,
  getOmieDeliveryState
} from "./omie-delivery-notifications";

type DeliveryOperation = Parameters<typeof getOmieDeliveryState>[0];

function operation(overrides: Partial<DeliveryOperation> = {}): DeliveryOperation {
  return {
    id: "op-1",
    plate: "ABC1D23",
    customerName: "Construtora Sao Joao",
    operationType: "invoice",
    omieSalesOrderId: null,
    omieServiceOrderId: null,
    omieBillingStatus: null,
    omieBillingMessage: null,
    ...overrides
  };
}

describe("estado de envio ao OMIE", () => {
  it("considera enviada a operacao com pedido, com OS ou ja faturada", () => {
    expect(getOmieDeliveryState(operation({ omieSalesOrderId: 4321 }))).toBe("delivered");
    expect(
      getOmieDeliveryState(operation({ operationType: "internal", omieServiceOrderId: 99 }))
    ).toBe("delivered");
    expect(getOmieDeliveryState(operation({ omieBillingStatus: "billed" }))).toBe("delivered");
  });

  it("considera falha tanto a recusa do OMIE quanto o cadastro incompleto", () => {
    expect(getOmieDeliveryState(operation({ omieBillingStatus: "failed" }))).toBe("failed");
    expect(getOmieDeliveryState(operation({ omieBillingStatus: "service_order_failed" }))).toBe(
      "failed"
    );
    expect(getOmieDeliveryState(operation({ omieBillingStatus: "cadastro_incompleto" }))).toBe(
      "failed"
    );
  });

  it("considera pendente a operacao que ainda esta na fila", () => {
    expect(getOmieDeliveryState(operation())).toBe("pending");
  });
});

describe("avisos de envio ao OMIE", () => {
  it("avisa o sucesso com a placa, o cliente e o numero do pedido", () => {
    const before = buildOmieDeliveryStates([operation()]);

    const events = diffOmieDeliveryEvents(before, [operation({ omieSalesOrderId: 4321 })]);

    expect(events).toEqual([
      {
        operationId: "op-1",
        kind: "success",
        title: "Enviada ao OMIE",
        operationLabel: "ABC1D23 - Construtora Sao Joao",
        detail: "Pedido OMIE 4321 criado."
      }
    ]);
  });

  it("avisa a falha com o motivo devolvido pelo OMIE", () => {
    const before = buildOmieDeliveryStates([operation()]);

    const events = diffOmieDeliveryEvents(before, [
      operation({
        omieBillingStatus: "failed",
        omieBillingMessage: "Cliente sem inscricao estadual."
      })
    ]);

    expect(events).toEqual([
      {
        operationId: "op-1",
        kind: "error",
        title: "Falha ao enviar ao OMIE",
        operationLabel: "ABC1D23 - Construtora Sao Joao",
        detail: "Cliente sem inscricao estadual."
      }
    ]);
  });

  it("nao repete o aviso enquanto o estado nao muda", () => {
    const delivered = operation({ omieSalesOrderId: 4321 });
    const before = buildOmieDeliveryStates([delivered]);

    expect(diffOmieDeliveryEvents(before, [delivered])).toEqual([]);
  });

  // A tela abre com operacoes que ja estao ha dias no estado final: elas nao podem
  // disparar som nem aviso — so as transicoes vistas com a tela aberta.
  it("ignora operacoes que ainda nao estavam no mapa anterior", () => {
    expect(diffOmieDeliveryEvents(new Map(), [operation({ omieSalesOrderId: 4321 })])).toEqual([]);
  });

  it("avisa quando uma operacao ja enviada volta a falhar", () => {
    const before = buildOmieDeliveryStates([operation({ omieSalesOrderId: 4321 })]);

    const events = diffOmieDeliveryEvents(before, [
      operation({ omieBillingStatus: "cadastro_incompleto" })
    ]);

    expect(events).toMatchObject([
      { kind: "error", detail: "Cadastro do cliente incompleto para o envio ao OMIE." }
    ]);
  });

  it("descreve a interna pela ordem de servico", () => {
    const before = buildOmieDeliveryStates([operation({ operationType: "internal" })]);

    const events = diffOmieDeliveryEvents(before, [
      operation({ operationType: "internal", omieServiceOrderId: 77 })
    ]);

    expect(events).toMatchObject([{ detail: "Ordem de servico OMIE 77 criada." }]);
  });
});
