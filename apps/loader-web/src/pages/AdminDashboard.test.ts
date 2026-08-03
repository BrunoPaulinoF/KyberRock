import { describe, expect, it } from "vitest";

import { buildDeleteConfirmationMessage, buildDeleteRequest } from "./AdminDashboard";

describe("buildDeleteConfirmationMessage", () => {
  it("avisa sobre a cascata ao excluir uma pedreira", () => {
    const message = buildDeleteConfirmationMessage({
      type: "company",
      id: "company-1",
      name: "Pedreira Sul"
    });

    expect(message).toContain('"Pedreira Sul"');
    expect(message).toContain("unidades");
  });

  it("avisa sobre a cascata ao excluir uma unidade", () => {
    const message = buildDeleteConfirmationMessage({
      type: "unit",
      id: "unit-1",
      name: "Unidade Centro"
    });

    expect(message).toContain('"Unidade Centro"');
    expect(message).toContain("dispositivos");
  });

  it("usa o papel do usuario na confirmacao", () => {
    const message = buildDeleteConfirmationMessage({
      type: "user",
      id: "user-1",
      name: "Joao",
      roleLabel: "Carregador"
    });

    expect(message).toContain("carregador");
    expect(message).toContain('"Joao"');
  });

  it("funciona sem o papel do usuario", () => {
    const message = buildDeleteConfirmationMessage({ type: "user", id: "user-1", name: "Maria" });

    expect(message).toContain('"Maria"');
  });

  it("nunca menciona senha do administrador", () => {
    const targets = [
      { type: "company" as const, id: "c", name: "C" },
      { type: "unit" as const, id: "u", name: "U" },
      { type: "user" as const, id: "x", name: "X", roleLabel: "Comercial" }
    ];

    for (const target of targets) {
      expect(buildDeleteConfirmationMessage(target).toLowerCase()).not.toContain("senha");
    }
  });
});

describe("buildDeleteRequest", () => {
  it("mapeia a pedreira para delete_company", () => {
    expect(buildDeleteRequest({ type: "company", id: "company-1", name: "Sul" })).toEqual({
      action: "delete_company",
      payload: { companyId: "company-1" }
    });
  });

  it("mapeia a unidade para delete_unit", () => {
    expect(buildDeleteRequest({ type: "unit", id: "unit-1", name: "Centro" })).toEqual({
      action: "delete_unit",
      payload: { unitId: "unit-1" }
    });
  });

  it("mapeia carregador e comercial para delete_loader", () => {
    expect(
      buildDeleteRequest({ type: "user", id: "user-1", name: "Joao", roleLabel: "Carregador" })
    ).toEqual({ action: "delete_loader", payload: { userId: "user-1" } });
    expect(
      buildDeleteRequest({ type: "user", id: "user-2", name: "Ana", roleLabel: "Comercial" })
    ).toEqual({ action: "delete_loader", payload: { userId: "user-2" } });
  });

  it("nao envia senha do administrador em nenhum payload", () => {
    const payloads = [
      buildDeleteRequest({ type: "company", id: "c", name: "C" }).payload,
      buildDeleteRequest({ type: "unit", id: "u", name: "U" }).payload,
      buildDeleteRequest({ type: "user", id: "x", name: "X" }).payload
    ];

    for (const payload of payloads) {
      expect(Object.keys(payload)).not.toContain("adminPassword");
    }
  });
});
