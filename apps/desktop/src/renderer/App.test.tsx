import { describe, expect, it } from "vitest";

import {
  App,
  buildFreightInput,
  createCacheSelectOptions,
  filterCacheSelectOptions,
  getDriverFilterIds,
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
    paymentTermId: "",
    paymentMode: "registered",
    manualInstallments: "",
    manualDownPaymentEnabled: false,
    manualDownPaymentCents: null,
    quotationId: "",
    deductFreightFromCredit: false,
    freightEnabled: true,
    freightPayer: "customer",
    freightCalculationType: "per_ton",
    freightBaseValueCents: 12_500,
    freightFixedValueCents: null,
    freightMinValueCents: null,
    freightDistanceKm: "",
    freightDestination: "",
    customerOwnTransport: false,
    driverIsIndependent: false,
    ...overrides
  };
}

describe("App", () => {
  it("creates the desktop component tree without requiring Electron", () => {
    const element = <App desktopApi={undefined} />;

    expect(element.type).toBe(App);
  });

  it("does not build freight input when the customer uses its own carrier", () => {
    const form = createWeighingForm({ customerOwnTransport: true });

    expect(buildFreightInput(form)).toBeNull();
  });

  it("links a newly created non-independent driver to the selected carrier", () => {
    const form = createWeighingForm({ carrierId: "carrier-1", customerOwnTransport: false });

    expect(shouldLinkCreatedDriverToCarrier(form, false)).toBe("carrier-1");
    expect(shouldLinkCreatedDriverToCarrier(form, true)).toBeNull();
    expect(shouldLinkCreatedDriverToCarrier({ ...form, customerOwnTransport: true }, false)).toBeNull();
    expect(shouldLinkCreatedDriverToCarrier({ ...form, driverIsIndependent: true }, false)).toBeNull();
  });

  it("uses only independent drivers when independent driver mode is active", () => {
    const form = createWeighingForm({ driverIsIndependent: true, customerOwnTransport: false });

    expect(getDriverFilterIds(form, ["linked-driver"], ["independent-driver"])).toEqual([
      "independent-driver"
    ]);
    expect(isTransportReady(form)).toBe(true);
  });

  it("restores the last valid theme mode from storage", () => {
    expect(readStoredThemeMode({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredThemeMode({ getItem: () => "light" })).toBe("light");
    expect(readStoredThemeMode({ getItem: () => "invalid" })).toBe("light");
    expect(readStoredThemeMode(null)).toBe("light");
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
