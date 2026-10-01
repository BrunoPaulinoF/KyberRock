import { describe, expect, it } from "vitest";

import { COMERCIAL_SHORTCUTS, comercialShortcuts } from "./comercial-shortcuts";
import { ROLES, canSee } from "./permissions";

describe("atalhos da aba Comercial", () => {
  it("o comercial ve os cinco, na ordem da fileira", () => {
    expect(comercialShortcuts("comercial").map((shortcut) => shortcut.label)).toEqual([
      "Clientes",
      "Preços",
      "Senha de preço",
      "Ranking de clientes",
      "Relatório por cliente"
    ]);
  });

  it("cada perfil so ve atalho para tela que ele pode abrir", () => {
    for (const role of ROLES) {
      for (const shortcut of comercialShortcuts(role)) {
        expect(canSee(role, shortcut.screen)).toBe(true);
      }
    }
    // O gestor nao ve a senha de preco nem o ranking; o carregador e o monitoramento, nada.
    expect(comercialShortcuts("gestor").map((shortcut) => shortcut.id)).toEqual([
      "clientes",
      "precos",
      "relatorio-cliente"
    ]);
    expect(comercialShortcuts("loader")).toEqual([]);
    expect(comercialShortcuts("monitoramento")).toEqual([]);
  });

  it("o endereco do atalho e da tela que ele confere", () => {
    for (const shortcut of COMERCIAL_SHORTCUTS) {
      expect(shortcut.to.startsWith(`/${shortcut.screen}`)).toBe(true);
    }
    expect(COMERCIAL_SHORTCUTS.find((shortcut) => shortcut.id === "precos")?.to).toBe(
      "/cadastros/produtos"
    );
    expect(COMERCIAL_SHORTCUTS.find((shortcut) => shortcut.id === "clientes")?.to).toBe(
      "/cadastros/clientes"
    );
  });
});
