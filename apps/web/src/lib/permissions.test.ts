import { describe, expect, it } from "vitest";

import { capabilitiesFor, isRole, ROLES } from "./permissions";

describe("perfis de acesso", () => {
  it("cada perfil pode o do anterior e mais um pouco", () => {
    expect(capabilitiesFor("loader")).toEqual({
      isLoader: true,
      canEditCustomers: false,
      canEditFleet: false,
      canManagePrices: false
    });
    expect(capabilitiesFor("monitoramento")).toEqual({
      isLoader: false,
      canEditCustomers: false,
      canEditFleet: false,
      canManagePrices: false
    });
    expect(capabilitiesFor("operacao")).toMatchObject({
      canEditCustomers: false,
      canEditFleet: true
    });
    expect(capabilitiesFor("comercial")).toMatchObject({
      canEditCustomers: true,
      canEditFleet: true,
      canManagePrices: false
    });
    expect(capabilitiesFor("gestor")).toMatchObject({
      canEditCustomers: true,
      canEditFleet: true,
      canManagePrices: true
    });
  });

  it("reconhece so os cinco perfis", () => {
    expect(ROLES.every(isRole)).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
