import { describe, expect, it } from "vitest";

import {
  changedFields,
  countByProduct,
  estimateClose,
  fiscalStatus,
  formatDuration,
  formatElapsedSince,
  formatWeightNumber,
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

describe("tela Operacoes no molde do desktop", () => {
  const now = Date.parse("2026-09-24T15:00:00.000Z");

  it("tempo no patio com o mesmo texto do desktop", () => {
    expect(formatElapsedSince("2026-09-24T14:59:40.000Z", now)).toBe("agora mesmo");
    expect(formatElapsedSince("2026-09-24T14:48:00.000Z", now)).toBe("ha 12 min");
    expect(formatElapsedSince("2026-09-24T12:55:00.000Z", now)).toBe("ha 2 h 05 min");
    expect(formatElapsedSince("2026-09-23T12:00:00.000Z", now)).toBe("ha 1 d 3 h");
    expect(formatElapsedSince(null, now)).toBe("-");
  });

  it("peso so com o numero", () => {
    expect(formatWeightNumber(15420)).toBe("15.420");
    expect(formatWeightNumber(null)).toBe("0");
  });

  it("contadores por produto, o mais cheio primeiro", () => {
    expect(
      countByProduct([
        { product_description: "BRITA 1" },
        { product_description: "PEDRISCO" },
        { product_description: "PEDRISCO" },
        { product_description: null }
      ])
    ).toEqual([
      { label: "PEDRISCO", count: 2 },
      { label: "BRITA 1", count: 1 },
      { label: "Sem produto", count: 1 }
    ]);
  });

  it("coluna Fiscal OMIE com as regras do desktop", () => {
    const base = {
      operation_type: "invoice",
      omie_billing_status: null,
      omie_billing_message: null,
      omie_sales_order_id: null,
      omie_service_order_id: null,
      omie_invoice_number: null
    };
    expect(fiscalStatus(base)).toMatchObject({ label: "Enviando ao OMIE", tone: "neutral" });
    expect(fiscalStatus({ ...base, omie_sales_order_id: 42 })).toMatchObject({
      label: "Enviada ao OMIE",
      tone: "success"
    });
    expect(
      fiscalStatus({ ...base, omie_billing_status: "billed", omie_invoice_number: "4521" })
    ).toMatchObject({ label: "Faturada", detail: "NF 4521" });
    expect(fiscalStatus({ ...base, omie_billing_status: "failed" })).toMatchObject({
      label: "Falhou",
      tone: "danger"
    });
    expect(fiscalStatus({ ...base, operation_type: "internal" })).toMatchObject({
      label: "Enviando OS"
    });
    expect(fiscalStatus({ ...base, omie_billing_message: "OMIE fora do ar" }).detail).toContain(
      "nova tentativa automatica"
    );
  });
});
