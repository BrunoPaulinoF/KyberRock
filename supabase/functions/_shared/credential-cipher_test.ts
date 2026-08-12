import { describe, expect, it } from "vitest";

import {
  CredentialCipherError,
  decryptCredential,
  encryptCredential,
  isCipherConfigured
} from "./credential-cipher.ts";

const KEY = "chave-de-teste-com-tamanho-suficiente";
const OTHER_KEY = "outra-chave-de-teste-igualmente-longa";

describe("encryptCredential / decryptCredential", () => {
  it("faz a volta completa", async () => {
    const stored = await encryptCredential("senha-do-carregador", KEY);
    expect(await decryptCredential(stored, KEY)).toBe("senha-do-carregador");
  });

  it("preserva acento, espaco e simbolo", async () => {
    const senha = "Ação #42 çãõ /\\ ~";
    expect(await decryptCredential(await encryptCredential(senha, KEY), KEY)).toBe(senha);
  });

  it("nao deixa a senha legivel no valor guardado", async () => {
    const stored = await encryptCredential("senha-do-carregador", KEY);
    expect(stored).not.toContain("senha-do-carregador");
    expect(stored.startsWith("v1.")).toBe(true);
  });

  it("cifra o mesmo texto em saidas diferentes", async () => {
    // IV aleatorio por gravacao: sem isso, duas linhas iguais na tabela
    // denunciariam quem usou a mesma senha.
    const a = await encryptCredential("repetida", KEY);
    const b = await encryptCredential("repetida", KEY);
    expect(a).not.toBe(b);
    expect(await decryptCredential(a, KEY)).toBe("repetida");
    expect(await decryptCredential(b, KEY)).toBe("repetida");
  });

  it("devolve null com a chave errada, em vez de lancar", async () => {
    const stored = await encryptCredential("senha", KEY);
    expect(await decryptCredential(stored, OTHER_KEY)).toBeNull();
  });

  it("devolve null para valor vazio, truncado ou de formato desconhecido", async () => {
    expect(await decryptCredential(null, KEY)).toBeNull();
    expect(await decryptCredential("", KEY)).toBeNull();
    expect(await decryptCredential("   ", KEY)).toBeNull();
    expect(await decryptCredential("v1.somente-iv", KEY)).toBeNull();
    expect(await decryptCredential("v2.aaaa.bbbb", KEY)).toBeNull();
    expect(await decryptCredential("texto solto", KEY)).toBeNull();
  });

  it("devolve null quando o ciphertext foi adulterado", async () => {
    const stored = await encryptCredential("senha", KEY);
    const [version, iv, payload] = stored.split(".");
    const flipped = payload.startsWith("A") ? `B${payload.slice(1)}` : `A${payload.slice(1)}`;
    expect(await decryptCredential(`${version}.${iv}.${flipped}`, KEY)).toBeNull();
  });

  it("recusa chave curta demais para valer alguma coisa", async () => {
    await expect(encryptCredential("senha", "curta")).rejects.toThrow(CredentialCipherError);
    await expect(encryptCredential("senha", "")).rejects.toThrow(CredentialCipherError);
  });
});

describe("isCipherConfigured", () => {
  it("exige uma chave de tamanho minimo", () => {
    expect(isCipherConfigured(KEY)).toBe(true);
    expect(isCipherConfigured("curta")).toBe(false);
    expect(isCipherConfigured("")).toBe(false);
    expect(isCipherConfigured(null)).toBe(false);
    expect(isCipherConfigured(undefined)).toBe(false);
  });
});
