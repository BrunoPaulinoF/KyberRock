import { describe, expect, it } from "vitest";

import {
  buildDeleteConfirmationMessage,
  buildDeleteRequest,
  matchesCadastroSearch,
  toDeviceUpdateChannel
} from "./AdminDashboard";

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

  it("avisa que o desktop tera de ser ativado de novo", () => {
    const message = buildDeleteConfirmationMessage({
      type: "device",
      id: "device-1",
      name: "Balanca 01"
    });

    expect(message).toContain('"Balanca 01"');
    expect(message).toContain("ativa");
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

  it("mapeia o dispositivo para delete_device", () => {
    expect(buildDeleteRequest({ type: "device", id: "device-1", name: "Balanca 01" })).toEqual({
      action: "delete_device",
      payload: { deviceId: "device-1" }
    });
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

describe("matchesCadastroSearch", () => {
  it("aceita tudo quando a busca esta vazia", () => {
    expect(matchesCadastroSearch("", ["Pedreira Sul"])).toBe(true);
    expect(matchesCadastroSearch("   ", ["Pedreira Sul"])).toBe(true);
  });

  it("casa em qualquer um dos campos, sem diferenciar maiuscula", () => {
    const fields = ["Pedreira Sul", "Sul Mineracao LTDA", "12345678000199"];
    expect(matchesCadastroSearch("sul", fields)).toBe(true);
    expect(matchesCadastroSearch("MINERACAO", fields)).toBe(true);
    expect(matchesCadastroSearch("000199", fields)).toBe(true);
    expect(matchesCadastroSearch("norte", fields)).toBe(false);
  });

  it("exige todos os termos, em qualquer ordem", () => {
    const fields = ["Joao Silva", "joao@sul.com", "Pedreira Sul"];
    expect(matchesCadastroSearch("joao sul", fields)).toBe(true);
    expect(matchesCadastroSearch("sul joao", fields)).toBe(true);
    expect(matchesCadastroSearch("joao norte", fields)).toBe(false);
  });

  it("ignora campo vazio ou ausente", () => {
    expect(matchesCadastroSearch("sul", [null, undefined, "Pedreira Sul"])).toBe(true);
    expect(matchesCadastroSearch("sul", [null, undefined])).toBe(false);
  });
});

describe("toDeviceUpdateChannel", () => {
  it("reconhece o anel de teste", () => {
    expect(toDeviceUpdateChannel("beta")).toBe("beta");
    expect(toDeviceUpdateChannel(" BETA ")).toBe("beta");
  });

  it("mostra como producao tudo que nao for beta", () => {
    // A tela nunca pode sugerir que uma balanca de cliente esta recebendo
    // versao em avaliacao quando nao se sabe se esta: nuvem sem a migracao
    // omite o campo, e omissao tem que aparecer como producao.
    for (const value of ["latest", "", "   ", "Beta2", null, undefined, 1, {}]) {
      expect(toDeviceUpdateChannel(value)).toBe("latest");
    }
  });
});
