import { describe, expect, it } from "vitest";

import {
  App,
  buildFreightInput,
  createCacheSelectOptions,
  filterCacheSelectOptions,
  formatElapsedSince,
  isTransportReady,
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
    freightEnabled: true,
    freightPayer: "quarry",
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
      chargeFreight: false,
      freightEnabled: false
    });

    expect(buildFreightInput(form)).toBeNull();
  });

  it("uses the quarry as the freight payer when charging freight (CIF)", () => {
    const freight = buildFreightInput(createWeighingForm());
    expect(freight?.payer).toBe("quarry");
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
