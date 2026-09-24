import { describe, expect, it } from "vitest";

import {
  changesPrice,
  isExecutorOnline,
  isStaleOperationClaim,
  parseWeightKg,
  shouldTouchExecutor,
  validateOperationRequest
} from "./operation-requests";

const ENTRY = {
  customerId: "c1",
  vehicleId: "v1",
  driverId: "d1",
  productId: "p1",
  entryWeightKg: 15_420
};

describe("peso digitado", () => {
  it("aceita numero e texto com separador de milhar", () => {
    expect(parseWeightKg(15420)).toBe(15420);
    expect(parseWeightKg("15.420")).toBe(15420);
    expect(parseWeightKg("15420,4")).toBe(15420);
    expect(parseWeightKg(" 42 380 ")).toBe(42380);
  });

  it("recusa zero, negativo, vazio e peso absurdo", () => {
    expect(parseWeightKg(0)).toBeNull();
    expect(parseWeightKg(-10)).toBeNull();
    expect(parseWeightKg("")).toBeNull();
    expect(parseWeightKg("abc")).toBeNull();
    expect(parseWeightKg(900_000)).toBeNull();
  });
});

describe("entrada", () => {
  it("normaliza e assume venda com nota", () => {
    const result = validateOperationRequest("entry", {
      ...ENTRY,
      carrierId: " t1 ",
      paymentMethodId: ""
    });
    expect(result).toEqual({
      ok: true,
      value: { ...ENTRY, carrierId: "t1", operationType: "invoice" }
    });
  });

  it("exige cliente, veiculo, motorista, produto e peso", () => {
    for (const key of ["customerId", "vehicleId", "driverId", "productId", "entryWeightKg"]) {
      const payload: Record<string, unknown> = { ...ENTRY };
      delete payload[key];
      expect(validateOperationRequest("entry", payload).ok, key).toBe(false);
    }
  });

  it("recusa tipo de operacao desconhecido", () => {
    expect(validateOperationRequest("entry", { ...ENTRY, operationType: "doacao" }).ok).toBe(false);
  });
});

describe("saida, alteracao, cancelamento e reimpressao", () => {
  it("saida exige o peso", () => {
    expect(validateOperationRequest("exit", {}).ok).toBe(false);
    expect(validateOperationRequest("exit", { exitWeightKg: "38.100" })).toEqual({
      ok: true,
      value: { exitWeightKg: 38100 }
    });
  });

  it("alteracao: null tira a transportadora; vazio em cliente e erro; nada e erro", () => {
    expect(validateOperationRequest("update", { carrierId: null })).toEqual({
      ok: true,
      value: { carrierId: null }
    });
    expect(validateOperationRequest("update", { customerId: "" }).ok).toBe(false);
    expect(validateOperationRequest("update", {}).ok).toBe(false);
    expect(validateOperationRequest("update", { unitPriceCents: 0 }).ok).toBe(false);
  });

  it("so a alteracao de preco pede senha", () => {
    const price = validateOperationRequest("update", { unitPriceCents: 6500 });
    const product = validateOperationRequest("update", { productId: "p2" });
    expect(price.ok && changesPrice("update", price.value)).toBe(true);
    expect(product.ok && changesPrice("update", product.value)).toBe(false);
  });

  it("cancelamento exige motivo; reimpressao nao exige nada", () => {
    expect(validateOperationRequest("cancel", { reason: "" }).ok).toBe(false);
    expect(validateOperationRequest("cancel", { reason: "placa errada" }).ok).toBe(true);
    expect(validateOperationRequest("reprint", {}).ok).toBe(true);
  });
});

describe("executora e pedidos abandonados", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");

  it("executora conectada ate 90 s sem perguntar", () => {
    expect(isExecutorOnline("2026-09-25T11:59:00.000Z", now)).toBe(true);
    expect(isExecutorOnline("2026-09-25T11:58:00.000Z", now)).toBe(false);
    expect(isExecutorOnline(null, now)).toBe(false);
  });

  it("carimba no maximo a cada 20 s", () => {
    expect(shouldTouchExecutor("2026-09-25T11:59:50.000Z", now)).toBe(false);
    expect(shouldTouchExecutor("2026-09-25T11:59:30.000Z", now)).toBe(true);
    expect(shouldTouchExecutor(null, now)).toBe(true);
  });

  it("pedido pego ha mais de 5 min volta para a fila", () => {
    expect(isStaleOperationClaim("2026-09-25T11:57:00.000Z", now)).toBe(false);
    expect(isStaleOperationClaim("2026-09-25T11:54:00.000Z", now)).toBe(true);
    expect(isStaleOperationClaim(null, now)).toBe(true);
  });
});
