import { describe, expect, it } from "vitest";
import { OFFLINE_FALLBACK_VIEW, isViewBlockedOffline } from "./offline-lock";

describe("isViewBlockedOffline", () => {
  it("nao bloqueia nada com internet", () => {
    for (const view of ["dashboard", "open-operations", "registrations", "reports"]) {
      expect(isViewBlockedOffline(view, true)).toBe(false);
    }
  });

  it("sem internet libera so nova entrada, insights e configuracoes", () => {
    for (const view of ["new-weighing", "insights", "scale", "printing", "cloud"]) {
      expect(isViewBlockedOffline(view, false)).toBe(false);
    }
  });

  it("sem internet bloqueia as demais telas", () => {
    for (const view of [
      "dashboard",
      "open-operations",
      "wallet",
      "registrations",
      "truck-control",
      "customer-report",
      "billing-conference",
      "invoice-closing",
      "reports",
      "documentation"
    ]) {
      expect(isViewBlockedOffline(view, false)).toBe(true);
    }
  });

  it("a tela de volta e sempre liberada", () => {
    expect(isViewBlockedOffline(OFFLINE_FALLBACK_VIEW, false)).toBe(false);
  });
});
