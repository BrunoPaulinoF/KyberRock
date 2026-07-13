import { describe, expect, it } from "vitest";

import {
  App,
  appendAvailableId,
  buildFreightInput,
  carrierSelectorFilterIds,
  createCacheSelectOptions,
  filterCacheSelectOptions,
  formatElapsedSince,
  isTransportReady,
  omieQueueActionLabel,
  omieQueueStatusLabel,
  readStoredThemeMode,
  shouldLinkCreatedDriverToCarrier
} from "./App";

type WeighingFormForTest = Parameters<typeof buildFreightInput>[0];

function createWeighingForm(overrides: Partial<WeighingFormForTest> = {}): WeighingFormForTest {
  return {
    operationType: "invoice",
    vehicleId: "vehicle-1",
    carrierId: "carrier-1",
    customerId: "customer-1",
    driverId: "driver-1",
    productId: "product-1",
    paymentMethodId: "",
    paymentMethodIsCredit: false,
    paymentTermId: "",
    paymentMode: "registered",
    manualInstallments: "",
    manualDownPaymentEnabled: false,
    manualDownPaymentCents: null,
    quotationId: "",
    deductFreightFromCredit: false,
    freightModality: "cif",
    chargeFreight: true,
    freightCalculationType: "per_ton",
    freightBaseValueCents: 12_500,
    freightFixedValueCents: null,
    freightMinValueCents: null,
    freightDistanceKm: "",
    freightDestination: "",
    ...overrides
  };
}

describe("App", () => {
  it("creates the desktop component tree without requiring Electron", () => {
    const element = <App desktopApi={undefined} />;

    expect(element.type).toBe(App);
  });

  it("does not build freight input when freight is not being charged (FOB)", () => {
    const form = createWeighingForm({
      freightModality: "fob",
      chargeFreight: false
    });

    expect(buildFreightInput(form)).toBeNull();
  });

  it("does not build freight input for the client's own transport", () => {
    const form = createWeighingForm({ freightModality: "own_recipient", chargeFreight: true });

    expect(buildFreightInput(form)).toBeNull();
  });

  it("uses the quarry as the freight payer when charging freight (CIF)", () => {
    const freight = buildFreightInput(createWeighingForm());
    expect(freight?.payer).toBe("quarry");
  });

  it("uses the customer as the freight payer for FOB", () => {
    const freight = buildFreightInput(createWeighingForm({ freightModality: "fob" }));
    expect(freight?.payer).toBe("customer");
  });

  it("links a newly created driver to the selected carrier", () => {
    expect(shouldLinkCreatedDriverToCarrier(createWeighingForm({ carrierId: "carrier-1" }))).toBe(
      "carrier-1"
    );
    expect(shouldLinkCreatedDriverToCarrier(createWeighingForm({ carrierId: "" }))).toBeNull();
  });

  it("is transport ready only when a carrier is selected", () => {
    expect(isTransportReady(createWeighingForm({ carrierId: "carrier-1" }))).toBe(true);
    expect(isTransportReady(createWeighingForm({ carrierId: "" }))).toBe(false);
  });

  it("restores the last valid theme mode from storage", () => {
    expect(readStoredThemeMode({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredThemeMode({ getItem: () => "light" })).toBe("light");
    expect(readStoredThemeMode({ getItem: () => "invalid" })).toBe("light");
    expect(readStoredThemeMode(null)).toBe("light");
  });

  it("formats how long ago the truck entered", () => {
    const now = new Date("2026-07-06T12:00:00Z");
    expect(formatElapsedSince("2026-07-06T11:59:30Z", now)).toBe("agora mesmo");
    expect(formatElapsedSince("2026-07-06T11:48:00Z", now)).toBe("ha 12 min");
    expect(formatElapsedSince("2026-07-06T09:55:00Z", now)).toBe("ha 2 h 05 min");
    expect(formatElapsedSince("2026-07-04T10:00:00Z", now)).toBe("ha 2 d 2 h");
    expect(formatElapsedSince(null, now)).toBe("-");
    expect(formatElapsedSince("not-a-date", now)).toBe("-");
  });

  it("shows a newly created carrier in the customer-filtered list right away", () => {
    // Lista filtrada por vinculo: a recem-criada entra otimisticamente.
    expect(appendAvailableId(["carrier-1"], "carrier-2")).toEqual(["carrier-1", "carrier-2"]);
    // Ja presente (releitura chegou antes): nao duplica.
    expect(appendAvailableId(["carrier-1", "carrier-2"], "carrier-2")).toEqual([
      "carrier-1",
      "carrier-2"
    ]);
    // Sem filtro ativo (nenhum cliente selecionado): continua sem filtro.
    expect(appendAvailableId(undefined, "carrier-2")).toBeUndefined();
  });

  it("falls back to all carriers when the customer has none linked", () => {
    // Cliente com transportadoras vinculadas: restringe a lista a elas.
    expect(carrierSelectorFilterIds(["carrier-1", "carrier-2"])).toEqual([
      "carrier-1",
      "carrier-2"
    ]);
    // Cliente selecionado sem nenhum vinculo: nao filtra, exibe todas as cadastradas.
    expect(carrierSelectorFilterIds([])).toBeUndefined();
    // Nenhum cliente selecionado ainda: continua sem filtro.
    expect(carrierSelectorFilterIds(undefined)).toBeUndefined();
  });

  it("labels OMIE queue items in plain portuguese for the cloud screen", () => {
    expect(omieQueueActionLabel("create_order", "invoice")).toBe("Criar pedido (com nota)");
    expect(omieQueueActionLabel("create_order", "internal")).toBe("Criar OS (interno)");
    expect(omieQueueActionLabel("create_and_bill_order", "invoice")).toBe(
      "Criar e faturar pedido"
    );
    expect(omieQueueActionLabel("cancel_order", null)).toBe("Cancelar pedido no OMIE");
    expect(omieQueueStatusLabel("pending")).toBe("aguardando envio");
    expect(omieQueueStatusLabel("failed")).toBe("falhou (re-tenta sozinho)");
    expect(omieQueueStatusLabel("dead_letter")).toBe("parado apos varias falhas");
  });

  it("builds and filters cache select modal options", () => {
    const options = createCacheSelectOptions([
      { id: "customer-1", tradeName: "Cliente A" },
      { id: "vehicle-1", plate: "ABC1D23" },
      { omieCode: "term-1", name: "A prazo" }
    ]);

    expect(options.map((option) => option.label)).toEqual(["Cliente A", "ABC1D23", "A prazo"]);
    expect(filterCacheSelectOptions(options, ["vehicle-1"])).toEqual([options[1]]);
    expect(filterCacheSelectOptions(options, undefined)).toEqual(options);
  });
});
