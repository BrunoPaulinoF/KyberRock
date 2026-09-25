import { describe, expect, it } from "vitest";

import {
  canSee,
  capabilitiesFor,
  homeFor,
  isRole,
  requiresPricePasswordFor,
  ROLES,
  SCREENS,
  SCREENS_BY_ROLE,
  usesSidebar
} from "./permissions";

describe("telas de cada perfil", () => {
  it("monitoramento ve so o painel de vendas", () => {
    expect(SCREENS_BY_ROLE.monitoramento).toEqual(["monitoramento"]);
    expect(usesSidebar("monitoramento")).toBe(false);
  });

  it("comercial ve a aba Comercial, as cinco telas de analise e os cadastros", () => {
    expect([...SCREENS_BY_ROLE.comercial].sort()).toEqual(
      [
        "cadastros",
        "comercial",
        "conferencia-faturamento",
        "controle-caminhoes",
        "insights",
        "relatorio-cliente",
        "relatorios"
      ].sort()
    );
    expect(canSee("comercial", "configuracoes")).toBe(false);
    expect(canSee("comercial", "nova-entrada")).toBe(false);
  });

  it("gestor ve tudo menos a Nova entrada (e os logs)", () => {
    const hidden = SCREENS.filter((screen) => !canSee("gestor", screen));
    expect(hidden.sort()).toEqual(["carregamento", "nova-entrada", "suporte"]);
  });

  it("operacao ve tudo menos os logs; administrador ve tambem os logs", () => {
    expect(SCREENS.filter((screen) => !canSee("operacao", screen)).sort()).toEqual([
      "carregamento",
      "suporte"
    ]);
    expect(SCREENS.filter((screen) => !canSee("administrador", screen))).toEqual(["carregamento"]);
  });

  it("configuracoes: gestor, operacao e administrador", () => {
    expect(ROLES.filter((role) => capabilitiesFor(role).hasSettings)).toEqual([
      "gestor",
      "operacao",
      "administrador"
    ]);
  });

  it("a tela inicial de cada perfil e uma tela que ele ve", () => {
    for (const role of ROLES) {
      const screen = homeFor(role).slice(1).split("?")[0];
      expect(canSee(role, screen as (typeof SCREENS)[number]), role).toBe(true);
    }
  });
});

describe("o que cada perfil faz", () => {
  it("carregador e monitoramento so consultam", () => {
    for (const role of ["loader", "monitoramento"] as const) {
      expect(capabilitiesFor(role)).toMatchObject({
        canEditCustomers: false,
        canEditFleet: false,
        canManagePrices: false,
        canEditPrices: false,
        canOperate: false,
        canCreateEntry: false
      });
    }
  });

  it("comercial cadastra tudo e mexe em preco, mas nao pesa nem fecha", () => {
    expect(capabilitiesFor("comercial")).toMatchObject({
      canEditCustomers: true,
      canEditFleet: true,
      canEditPrices: true,
      canManagePrices: false,
      canOperate: false,
      canCreateEntry: false
    });
  });

  it("gestor faz tudo menos a Nova entrada", () => {
    expect(capabilitiesFor("gestor")).toMatchObject({
      canEditCustomers: true,
      canEditPrices: true,
      canManagePrices: true,
      canOperate: true,
      canCreateEntry: false
    });
  });

  it("operacao e administrador fazem tudo", () => {
    for (const role of ["operacao", "administrador"] as const) {
      expect(capabilitiesFor(role)).toMatchObject({
        canEditCustomers: true,
        canEditPrices: true,
        canOperate: true,
        canCreateEntry: true
      });
    }
  });

  it("senha de preco: operacao sempre, administrador e comercial nunca, gestor pela marca", () => {
    expect(requiresPricePasswordFor("operacao", false)).toBe(true);
    expect(requiresPricePasswordFor("administrador", true)).toBe(false);
    expect(requiresPricePasswordFor("comercial", true)).toBe(false);
    expect(requiresPricePasswordFor("gestor", true)).toBe(true);
    expect(requiresPricePasswordFor("gestor", false)).toBe(false);
  });

  it("reconhece so os seis perfis", () => {
    expect(ROLES.every(isRole)).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
