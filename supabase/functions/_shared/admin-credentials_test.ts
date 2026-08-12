import { describe, expect, it } from "vitest";

import {
  buildCompanyCredentials,
  buildDeviceCredentials,
  buildUserCredentials,
  hasSensitiveValue
} from "./admin-credentials.ts";

const FULL_COMPANY = {
  name: "Pedreira Serra Azul",
  legal_name: "Serra Azul Mineracao LTDA",
  omie_app_key: "1234567890123",
  omie_app_secret: "abcdef0123456789abcdef0123456789",
  price_change_password: "4271",
  desktop_activation_code: "830192"
};

describe("buildCompanyCredentials", () => {
  it("mostra as credenciais que a pedreira guarda em texto", () => {
    const bundle = buildCompanyCredentials(FULL_COMPANY);
    expect(bundle.title).toBe("Pedreira Serra Azul");
    expect(bundle.subtitle).toBe("Serra Azul Mineracao LTDA");
    expect(bundle.credentials.map((credential) => credential.value)).toEqual([
      "1234567890123",
      "abcdef0123456789abcdef0123456789",
      "4271",
      "830192"
    ]);
    expect(bundle.credentials.every((credential) => credential.unavailable === undefined)).toBe(
      true
    );
  });

  it("diz o que fazer quando o campo esta vazio, em vez de so mostrar em branco", () => {
    const bundle = buildCompanyCredentials({ name: "Pedreira X" });
    for (const credential of bundle.credentials) {
      expect(credential.value).toBeNull();
      expect(credential.unavailable).toBeTruthy();
    }
    expect(bundle.credentials[0].unavailable).toContain("Integracao OMIE");
    expect(bundle.credentials[3].unavailable).toContain("Codigos de ativacao");
  });

  it("marca como sensivel quando ha ao menos um valor de verdade", () => {
    expect(hasSensitiveValue(buildCompanyCredentials(FULL_COMPANY))).toBe(true);
    expect(hasSensitiveValue(buildCompanyCredentials({ name: "Pedreira X" }))).toBe(false);
  });
});

describe("buildUserCredentials", () => {
  const user = {
    name: "Joao Silva",
    email: "joao@serraazul.com.br",
    role: "loader",
    is_active: true
  };

  it("mostra o e-mail e NUNCA um valor de senha", () => {
    const bundle = buildUserCredentials(user);
    expect(bundle.title).toBe("Joao Silva");
    expect(bundle.subtitle).toBe("Carregador");

    const email = bundle.credentials[0];
    expect(email.value).toBe("joao@serraazul.com.br");

    const password = bundle.credentials[1];
    expect(password.label).toBe("Senha");
    expect(password.value).toBeNull();
    // O motivo e o caminho que resolve precisam estar no texto: sem eles, o
    // administrador sai procurando a senha em outro lugar.
    expect(password.unavailable).toContain("bcrypt");
    expect(password.unavailable).toContain("definir uma nova");
  });

  it("nao existe combinacao de entrada que produza uma senha visivel", () => {
    const variants = [
      user,
      { ...user, role: "comercial" },
      { ...user, is_active: false },
      {},
      { name: "", email: "", role: "", is_active: null }
    ];
    for (const variant of variants) {
      const bundle = buildUserCredentials(variant);
      const password = bundle.credentials.find((credential) => credential.label === "Senha");
      expect(password?.value).toBeNull();
      expect(hasSensitiveValue(bundle)).toBe(false);
    }
  });

  it("marca o papel e o bloqueio no subtitulo", () => {
    expect(buildUserCredentials({ ...user, role: "comercial" }).subtitle).toBe("Comercial");
    expect(buildUserCredentials({ ...user, is_active: false }).subtitle).toContain(
      "acesso bloqueado"
    );
  });
});

describe("buildDeviceCredentials", () => {
  const device = { id: "device-abc-123", name: "Balanca 01", is_active: true };

  it("mostra o id e o codigo de ativacao da pedreira, nunca o token", () => {
    const bundle = buildDeviceCredentials(device, FULL_COMPANY);
    expect(bundle.title).toBe("Balanca 01");
    expect(bundle.subtitle).toBe("Pedreira Serra Azul");
    expect(bundle.credentials[0].value).toBe("device-abc-123");

    const token = bundle.credentials[1];
    expect(token.label).toBe("Token do dispositivo");
    expect(token.value).toBeNull();
    expect(token.unavailable).toContain("SHA-256");
    expect(token.unavailable).toContain("codigo de ativacao");

    expect(bundle.credentials[2].value).toBe("830192");
  });

  it("nunca revela o token, com pedreira configurada ou nao", () => {
    for (const company of [FULL_COMPANY, {}, { name: "X" }]) {
      const bundle = buildDeviceCredentials(device, company);
      const token = bundle.credentials.find(
        (credential) => credential.label === "Token do dispositivo"
      );
      expect(token?.value).toBeNull();
    }
  });
});
