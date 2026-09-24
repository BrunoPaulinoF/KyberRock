import { describe, expect, it } from "vitest";

import {
  INITIAL_ENTRY_FREIGHT,
  applyFreightGroup,
  applyFreightInvoiceChoice,
  describePaymentCondition,
  entryFreightPayload,
  freightGoesToCustomerInvoice,
  isCarrierRequired,
  resolveCustomerFreight,
  validateEntryFreight
} from "./entry-freight";

describe("frete da Nova entrada do site", () => {
  it("comeca sem frete, com o transportador na nota, e troca de grupo como o desktop", () => {
    expect(INITIAL_ENTRY_FREIGHT.freightModality).toBe("third_party");
    const withFreight = applyFreightGroup(INITIAL_ENTRY_FREIGHT, "with_freight");
    expect(withFreight.freightModality).toBe("fob");
    expect(applyFreightInvoiceChoice(withFreight, false).freightModality).toBe("cif");
    const without = applyFreightGroup(withFreight, "without_freight");
    expect(applyFreightInvoiceChoice(without, false).freightModality).toBe("none");
  });

  it("transportadora so e obrigatoria quando vai na nota", () => {
    expect(isCarrierRequired("fob")).toBe(true);
    expect(isCarrierRequired("third_party")).toBe(true);
    expect(isCarrierRequired("none")).toBe(false);
  });

  it("frete da Pedreira no credito do cliente entra na fatura", () => {
    expect(freightGoesToCustomerInvoice({ freightModality: "cif" }, true)).toBe(true);
    expect(freightGoesToCustomerInvoice({ freightModality: "fob" }, true)).toBe(false);
    expect(freightGoesToCustomerInvoice({ freightModality: "cif" }, false)).toBe(false);
  });

  it("exige valor e distancia com as mensagens do desktop", () => {
    const withFreight = applyFreightGroup(INITIAL_ENTRY_FREIGHT, "with_freight");
    expect(validateEntryFreight(withFreight, "")).toBe("Informe o valor do frete.");
    expect(
      validateEntryFreight(
        { ...withFreight, freightCalculationType: "per_ton_km", freightBaseValueCents: 100 },
        ""
      )
    ).toBe("Informe a distancia do frete em km.");
    expect(validateEntryFreight(INITIAL_ENTRY_FREIGHT, "quando der")).toContain(
      "Condicao personalizada invalida"
    );
    expect(validateEntryFreight(INITIAL_ENTRY_FREIGHT, "7 14 21")).toBeNull();
  });

  it("monta o pedido so com o que a situacao usa", () => {
    expect(entryFreightPayload(INITIAL_ENTRY_FREIGHT)).toEqual({ freightModality: "third_party" });
    expect(
      entryFreightPayload({
        ...applyFreightGroup(INITIAL_ENTRY_FREIGHT, "with_freight"),
        freightCalculationType: "per_ton_km",
        freightBaseValueCents: 120,
        freightFixedValueCents: 999,
        freightDistanceKm: "35,5",
        freightDestination: " obra "
      })
    ).toEqual({
      freightModality: "fob",
      freight: {
        calculationType: "per_ton_km",
        baseValueCents: 120,
        distanceKm: 35.5,
        destination: "obra"
      },
      deductFreightFromCredit: false
    });
  });

  it("puxa o frete do cliente: cadastro vence memoria, produto vence padrao", () => {
    const rows = [
      {
        customer_id: "c1",
        product_id: null,
        is_active: true,
        deleted_at: null,
        rule_json: {
          type: "per_ton",
          baseValueCents: 0,
          modalities: {
            cif: { type: "per_ton", baseValueCents: 900, source: "last_used", showOnReceipt: false }
          }
        }
      },
      {
        customer_id: "c1",
        product_id: "p1",
        is_active: true,
        deleted_at: null,
        rule_json: JSON.stringify({
          type: "per_ton",
          baseValueCents: 0,
          modalities: {
            fob: { type: "per_ton_km", baseValueCents: 150, distanceKm: 20, source: "manual" }
          }
        })
      }
    ];
    expect(resolveCustomerFreight(rows, "c1", "p1")).toMatchObject({
      calculationType: "per_ton_km",
      baseValueCents: 150,
      distanceKm: 20,
      showOnReceipt: true
    });
    expect(resolveCustomerFreight(rows, "c1", "p2")).toMatchObject({
      baseValueCents: 900,
      showOnReceipt: false
    });
    expect(resolveCustomerFreight(rows, "c2", "p1")).toBeNull();
  });

  it("previa da condicao igual a legenda do desktop", () => {
    expect(describePaymentCondition("").status).toBe("empty");
    expect(describePaymentCondition("30").message).toBe("1 parcela em 30 dias apos a venda.");
    expect(describePaymentCondition("7 14 21").message).toBe(
      "3 parcelas: 7, 14 e 21 dias apos a venda."
    );
    expect(describePaymentCondition("xyz").status).toBe("invalid");
  });
});
