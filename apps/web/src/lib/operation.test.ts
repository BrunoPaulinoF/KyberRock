import { describe, expect, it } from "vitest";

import {
  changedFields,
  estimateClose,
  formatDuration,
  matchesSearch,
  parsePriceCents,
  parseWeight,
  printWarning,
  requestStatusText,
  type EditableFields
} from "./operation";

const BASE: EditableFields = {
  customerId: "c1",
  productId: "p1",
  vehicleId: "v1",
  driverId: "d1",
  carrierId: "t1",
  paymentMethodId: "pm1",
  paymentTermId: "",
  operationType: "invoice",
  unitPriceCents: 6500
};

describe("pesagem pelo site: regras de tela", () => {
  it("le o peso digitado de varios jeitos", () => {
    expect(parseWeight("42.380")).toBe(42380);
    expect(parseWeight("42380")).toBe(42380);
    expect(parseWeight("42 380")).toBe(42380);
    expect(parseWeight("0")).toBeNull();
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("abc")).toBeNull();
  });

  it("previa do fechamento: liquido e valor do produto", () => {
    expect(estimateClose(15000, 40120, 6500)).toEqual({ netKg: 25120, productTotalCents: 163280 });
    expect(estimateClose(15000, null, 6500)).toBeNull();
    expect(estimateClose(15000, 40000, null)).toEqual({ netKg: 25000, productTotalCents: null });
  });

  it("alteracao manda so o que mudou; vazio tira a transportadora", () => {
    expect(changedFields(BASE, { ...BASE })).toEqual({});
    expect(changedFields(BASE, { ...BASE, productId: "p2", carrierId: "" })).toEqual({
      productId: "p2",
      carrierId: null
    });
    expect(changedFields(BASE, { ...BASE, unitPriceCents: 7000 })).toEqual({
      unitPriceCents: 7000
    });
  });

  it("pesagem concluida: ignora o que nao pode mudar", () => {
    expect(
      changedFields(BASE, { ...BASE, productId: "p2", vehicleId: "v2" }, [
        "customerId",
        "productId",
        "carrierId"
      ])
    ).toEqual({ productId: "p2" });
  });

  it("preco digitado em reais", () => {
    expect(parsePriceCents("65,00")).toBe(6500);
    expect(parsePriceCents("R$ 1.065,50")).toBe(106550);
    expect(parsePriceCents("0")).toBeNull();
  });

  it("textos do acompanhamento e do cupom", () => {
    expect(requestStatusText({ status: "pending" })).toContain("Enviando");
    expect(requestStatusText({ status: "processing" })).toContain("registrando");
    expect(printWarning({ print_status: "failed", print_message: "Sem papel" })).toBe(
      "Pesagem registrada, mas o cupom nao imprimiu: Sem papel"
    );
    expect(printWarning({ print_status: "printed", print_message: null })).toBeNull();
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(135)).toBe("2 h 15 min");
  });

  it("busca sem acento, sem caixa e placa sem traco", () => {
    expect(matchesSearch("Construtora São João", "sao joao")).toBe(true);
    expect(matchesSearch("ABC-1D23", "abc1d")).toBe(true);
    expect(matchesSearch("Brita 1", "areia")).toBe(false);
    expect(matchesSearch("qualquer", "")).toBe(true);
  });
});
