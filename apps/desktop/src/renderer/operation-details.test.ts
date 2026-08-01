import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { WeighingOperationSummary } from "../services/weighing-operations";
import {
  buildOperationDetailSections,
  buildOperationEditForm,
  buildOperationUpdateInput,
  isOperationInProgress,
  operationStatusLabel,
  parseOperationFreight,
  validateOperationEditForm
} from "./operation-details";

const rendererDir = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return readFileSync(resolve(rendererDir, file), "utf8");
}

function createOperation(
  overrides: Partial<WeighingOperationSummary> = {}
): WeighingOperationSummary {
  return {
    id: "op-1",
    status: "loading_requested",
    operationType: "invoice",
    customerId: "customer-1",
    customerName: "Cliente Teste",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    productDescription: "Brita 1",
    productId: "product-1",
    vehicleId: "vehicle-1",
    driverId: "driver-1",
    carrierId: "carrier-1",
    carrierName: "Transportadora Teste",
    paymentTermId: "term-1",
    paymentMethodId: "method-1",
    paymentMethodName: "Boleto",
    paymentTermName: "3 parcelas",
    entryWeightKg: 12_000,
    exitWeightKg: null,
    netWeightKg: null,
    unitPriceCents: 12_000,
    baseUnitPriceCents: 15_000,
    appliedPriceTableId: null,
    appliedPriceTableName: null,
    appliedPriceTableItemId: null,
    priceUnit: "ton",
    priceSavingsPercent: 20,
    productTotalCents: null,
    freightTotalCents: 0,
    freightJson: null,
    freightModality: "none",
    totalCents: null,
    deductFreightFromCredit: false,
    productCreditDebitCents: 0,
    freightCreditDebitCents: 0,
    quotationId: null,
    omieSalesOrderId: null,
    omieServiceOrderId: null,
    omieBillingStatus: null,
    omieBillingMessage: null,
    omieBilledAt: null,
    omieDocumentUrl: null,
    cancelReason: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:30:00.000Z",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    deviceColor: null,
    loaderCompletedAt: null,
    ...overrides
  };
}

const FREIGHT_JSON = JSON.stringify({
  payer: "quarry",
  destination: "Obra do centro",
  rule: {
    id: "operation-freight",
    name: "Frete da operacao",
    type: "per_ton_km",
    baseValueCents: 250,
    minValueCents: 8_000,
    distanceKm: 35,
    unit: "ton"
  }
});

describe("ficha completa da operacao", () => {
  it("mostra todos os grupos de informacao da operacao", () => {
    const sections = buildOperationDetailSections(
      createOperation({ freightJson: FREIGHT_JSON, freightModality: "cif" })
    );
    const titles = sections.map((section) => section.title);

    expect(titles).toEqual([
      "Operacao",
      "Pesagem",
      "Precos e totais",
      "Pagamento",
      "Frete",
      "OMIE e sincronizacao"
    ]);

    const byLabel = new Map(
      sections.flatMap((section) => section.items.map((item) => [item.label, item.value]))
    );
    expect(byLabel.get("Placa")).toBe("ABC1D23");
    expect(byLabel.get("Transportadora")).toBe("Transportadora Teste");
    expect(byLabel.get("Forma de pagamento")).toBe("Boleto");
    expect(byLabel.get("Condicao")).toBe("3 parcelas");
    expect(byLabel.get("Status")).toBe("Aguardando carregamento");
    expect(byLabel.get("Tipo")).toBe("Com nota fiscal");
    expect(byLabel.get("Preco aplicado")?.startsWith("R$")).toBe(true);
    expect(byLabel.get("Distancia")).toBe("35 km");
    expect(byLabel.get("Destino/obs.")).toBe("Obra do centro");
    expect(byLabel.get("Responsavel")).toBe("Pedreira");
  });

  it("nunca esconde um campo vazio: exibe travessao", () => {
    const byLabel = new Map(
      buildOperationDetailSections(createOperation()).flatMap((section) =>
        section.items.map((item) => [item.label, item.value])
      )
    );

    expect(byLabel.get("Peso liquido")).toBe("—");
    expect(byLabel.get("Pedido de venda")).toBe("—");
    expect(byLabel.get("Valor lancado")).toBe("Nao");
  });

  it("traduz o status da operacao", () => {
    expect(operationStatusLabel("awaiting_exit")).toBe("Aguardando saida");
    expect(operationStatusLabel("desconhecido")).toBe("desconhecido");
  });

  it("so considera em andamento os status abertos", () => {
    expect(isOperationInProgress("loading_requested")).toBe(true);
    expect(isOperationInProgress("awaiting_exit")).toBe(true);
    expect(isOperationInProgress("closed_local")).toBe(false);
    expect(isOperationInProgress("cancelled")).toBe(false);
  });

  it("ignora um frete com JSON invalido em vez de quebrar a ficha", () => {
    expect(parseOperationFreight("{nao e json")).toBeNull();
    expect(parseOperationFreight(null)).toBeNull();
  });
});

describe("edicao completa da operacao", () => {
  it("carrega o formulario com o que ja esta gravado, inclusive o frete", () => {
    const form = buildOperationEditForm(
      createOperation({ freightJson: FREIGHT_JSON, freightModality: "cif" }),
      "7/14/21"
    );

    expect(form).toMatchObject({
      customerId: "customer-1",
      productId: "product-1",
      vehicleId: "vehicle-1",
      driverId: "driver-1",
      carrierId: "carrier-1",
      paymentMethodId: "method-1",
      conditionText: "7/14/21",
      unitPriceCents: 12_000,
      freightModality: "cif",
      chargeFreight: true,
      freightCalculationType: "per_ton_km",
      freightBaseValueCents: 250,
      freightMinValueCents: 8_000,
      freightDistanceKm: "35",
      freightDestination: "Obra do centro"
    });
  });

  it("monta o payload com o frete digitado", () => {
    const form = buildOperationEditForm(createOperation());
    const input = buildOperationUpdateInput("op-1", {
      ...form,
      unitPriceCents: 19_900,
      freightModality: "cif",
      chargeFreight: true,
      freightCalculationType: "per_ton",
      freightBaseValueCents: 4_500,
      freightDestination: "Obra do centro"
    });

    expect(input).toMatchObject({
      operationId: "op-1",
      unitPriceCents: 19_900,
      freightModality: "cif"
    });
    expect(input.freight).toMatchObject({
      payer: "quarry",
      destination: "Obra do centro",
      rule: { type: "per_ton", baseValueCents: 4_500 }
    });
    // Condicao intocada: nao viaja, para nao duplicar payment_terms a cada gravacao.
    expect("paymentTermId" in input).toBe(false);
  });

  it("manda a condicao apenas quando ela mudou (null limpa)", () => {
    const form = buildOperationEditForm(createOperation());

    expect(buildOperationUpdateInput("op-1", form, "term-2").paymentTermId).toBe("term-2");
    expect(buildOperationUpdateInput("op-1", form, null).paymentTermId).toBeNull();
  });

  it("nao manda frete quando a modalidade nao comporta valor", () => {
    const form = buildOperationEditForm(createOperation());
    const input = buildOperationUpdateInput("op-1", {
      ...form,
      freightModality: "none",
      chargeFreight: true,
      freightBaseValueCents: 4_500
    });

    expect(input.freight).toBeNull();
  });

  it("valida os campos obrigatorios antes de gravar", () => {
    const form = buildOperationEditForm(createOperation());

    expect(validateOperationEditForm(form)).toBeNull();
    expect(validateOperationEditForm({ ...form, customerId: "" })).toBe("Selecione o cliente.");
    expect(validateOperationEditForm({ ...form, productId: "" })).toBe("Selecione o produto.");
    expect(validateOperationEditForm({ ...form, vehicleId: "" })).toBe("Selecione a placa.");
    expect(validateOperationEditForm({ ...form, driverId: "" })).toBe("Selecione o motorista.");
    expect(validateOperationEditForm({ ...form, unitPriceCents: null })).toBe(
      "Informe o preco do produto."
    );
    expect(
      validateOperationEditForm({
        ...form,
        freightModality: "cif",
        chargeFreight: true,
        freightBaseValueCents: null,
        freightFixedValueCents: null
      })
    ).toBe("Informe o valor do frete.");
    expect(
      validateOperationEditForm({
        ...form,
        freightModality: "cif",
        chargeFreight: true,
        freightCalculationType: "per_ton_km",
        freightBaseValueCents: 250,
        freightDistanceKm: ""
      })
    ).toBe("Informe a distancia do frete em km.");
  });
});

describe("tela de Operacoes", () => {
  it("abre a ficha com duplo clique (e Enter) na linha das tres abas", () => {
    const app = read("App.tsx");

    expect(app).toContain("const operationRowOpenProps = useCallback");
    expect(app).toContain("isInteractiveTarget(event.target)");
    expect(app).toContain('event.key === "Enter"');
    expect(app).toContain("Duplo clique para ver todos os dados da operacao");
    // Uma linha por aba: abertas, canceladas e concluidas.
    expect(app.match(/\{\.\.\.operationRowOpenProps\(operation\)\}/g)).toHaveLength(3);
    expect(app).toContain("<OperationDetailsDialog");
  });

  it("a edicao completa pede a senha de preco e usa o IPC de atualizacao", () => {
    const app = read("App.tsx");

    expect(app).toContain("desktopApi.updateWeighingOperation(");
    expect(app).toContain("verifyPriceChangePassword(pricePassword)");
    expect(app).toContain("Confirmar alteracao de preco");
    // So a operacao em andamento ganha o botao de editar na ficha.
    expect(app).toContain("onEdit={canEdit ? () => setEditing(true) : undefined}");
  });
});
