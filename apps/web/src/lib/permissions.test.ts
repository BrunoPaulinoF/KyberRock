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

  it("so o monitoramento e o comercial veem a tela Monitoramento", () => {
    expect(ROLES.filter((role) => canSee(role, "monitoramento"))).toEqual([
      "monitoramento",
      "comercial"
    ]);
  });

  it("so o perfil comercial ve a aba Comercial", () => {
    expect(ROLES.filter((role) => canSee(role, "comercial"))).toEqual(["comercial"]);
  });

  it("comercial ve a aba Comercial, as telas de analise, o monitoramento, os cadastros e a senha de preco", () => {
    expect([...SCREENS_BY_ROLE.comercial].sort()).toEqual(
      [
        "cadastros",
        "senha-preco",
        "cupons",
        "comercial",
        "conferencia-faturamento",
        "controle-caminhoes",
        "insights",
        "monitoramento",
        "relatorio-cliente",
        "relatorios"
      ].sort()
    );
    // Ele tem o menu lateral: o Monitoramento abre em tela cheia, com "Voltar ao sistema".
    expect(usesSidebar("comercial")).toBe(true);
    expect(canSee("comercial", "configuracoes")).toBe(false);
  });

  it("Nova entrada nao e tela do site: a entrada so nasce no KyberRock Desktop", () => {
    expect((SCREENS as readonly string[]).includes("nova-entrada")).toBe(false);
  });

  it("gestor ve tudo menos os logs, a aba Comercial e o monitoramento", () => {
    const hidden = SCREENS.filter((screen) => !canSee("gestor", screen));
    expect(hidden.sort()).toEqual([
      "carregamento",
      "comercial",
      "monitoramento",
      "senha-preco",
      "suporte"
    ]);
  });

  it("operacao ve tudo menos os logs; administrador ve tambem os logs", () => {
    expect(SCREENS.filter((screen) => !canSee("operacao", screen)).sort()).toEqual([
      "carregamento",
      "comercial",
      "monitoramento",
      "senha-preco",
      "suporte"
    ]);
    expect(SCREENS.filter((screen) => !canSee("administrador", screen)).sort()).toEqual([
      "carregamento",
      "comercial",
      "monitoramento"
    ]);
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
        canOperate: false
      });
    }
  });

  it("comercial cadastra tudo e mexe em preco, mas nao pesa nem fecha", () => {
    expect(capabilitiesFor("comercial")).toMatchObject({
      canEditCustomers: true,
      canEditFleet: true,
      canEditPrices: true,
      canManagePrices: false,
      canOperate: false
    });
  });

  it("gestor, operacao e administrador fazem tudo", () => {
    for (const role of ["gestor", "operacao", "administrador"] as const) {
      expect(capabilitiesFor(role)).toMatchObject({
        canEditCustomers: true,
        canEditPrices: true,
        canManagePrices: true,
        canOperate: true
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

  it("so o comercial e o administrador veem a senha de preco (quem digita nunca ve)", () => {
    expect(ROLES.filter((role) => capabilitiesFor(role).canSeePriceCode)).toEqual([
      "comercial",
      "administrador"
    ]);
    for (const role of ROLES) {
      if (requiresPricePasswordFor(role, true)) {
        expect(capabilitiesFor(role).canSeePriceCode, role).toBe(false);
      }
    }
  });

  it("reconhece so os seis perfis", () => {
    expect(ROLES.every(isRole)).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
