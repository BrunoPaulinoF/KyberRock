import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAdminSessionToken, setAdminSessionToken } from "./admin-api";
import { hasAdminSession } from "./admin-session";

/** Token no formato do `admin-auth`: payload base64url + assinatura (nao conferida no navegador). */
function sessionToken(expiresInSeconds: number): string {
  const payload = {
    sub: "admin",
    role: "platform_admin",
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${encoded}.assinatura`;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value))
  };
}

describe("hasAdminSession", () => {
  const original = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage(),
      configurable: true
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("sem token nao ha sessao", () => {
    expect(hasAdminSession()).toBe(false);
  });

  it("token dentro do prazo abre o painel", () => {
    setAdminSessionToken(sessionToken(3600));
    expect(hasAdminSession()).toBe(true);
  });

  it("token vencido nao abre e e apagado, para o proximo carregamento nao tentar usa-lo", () => {
    setAdminSessionToken(sessionToken(-60));
    expect(hasAdminSession()).toBe(false);
    expect(getAdminSessionToken()).toBeNull();
  });

  it("token ilegivel vale como vencido", () => {
    setAdminSessionToken("isto-nao-e-um-token");
    expect(hasAdminSession()).toBe(false);
  });
});
