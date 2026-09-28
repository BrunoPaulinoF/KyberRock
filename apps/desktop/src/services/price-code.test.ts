import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  applyPriceCodeFromCloud,
  priceCodeForStep,
  priceCodeStep,
  verifyPriceCode,
  verifyStoredPriceCode
} from "./price-code";

// Chave e resultados do apendice D da RFC 4226. A nuvem testa os MESMOS valores em
// `supabase/functions/_shared/price-code_test.ts`: e o que prova que o codigo lido pelo
// comercial no site abre esta balanca.
const RFC_SECRET = "12345678901234567890";
const RFC_CODES = ["755224", "287082", "359152", "969429", "338314", "254676"];

const temporaryDirectories: string[] = [];

function openTemporaryDatabase(): DesktopDatabase {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-price-code-"));
  temporaryDirectories.push(directory);
  const database = openDesktopDatabase({
    databasePath: path.join(directory, "data", "kyberrock.sqlite3")
  });
  runDesktopMigrations(database);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

describe("senha rotativa de preco (conta)", () => {
  it("segue a RFC 4226, igual a nuvem", () => {
    for (const [step, code] of RFC_CODES.entries()) {
      expect(priceCodeForStep(RFC_SECRET, step)).toBe(code);
    }
  });

  it("aceita so o codigo da janela atual de 45 s", () => {
    expect(priceCodeStep(44_999)).toBe(0);
    expect(priceCodeStep(45_000)).toBe(1);
    expect(verifyPriceCode(RFC_SECRET, "287082", 60_000)).toBe(true);
    expect(verifyPriceCode(RFC_SECRET, "755224", 60_000)).toBe(false);
    expect(verifyPriceCode(RFC_SECRET, "359152", 60_000)).toBe(false);
    expect(verifyPriceCode(RFC_SECRET, "0000", 60_000)).toBe(false);
  });
});

describe("senha rotativa de preco (balanca)", () => {
  it("sem a chave da nuvem, nao decide (a balanca usa a senha antiga)", () => {
    const database = openTemporaryDatabase();
    expect(verifyStoredPriceCode(database, "287082", 60_000)).toBeNull();
    applyPriceCodeFromCloud(database, { secret: undefined, receivedAtMs: 0 });
    expect(verifyStoredPriceCode(database, "287082", 60_000)).toBeNull();
    database.close();
  });

  it("com a chave, confere o codigo pelo relogio da nuvem", () => {
    const database = openTemporaryDatabase();
    // Este computador esta 50 s atrasado: para ele sao 10 s, para a nuvem 60 s (janela 1).
    applyPriceCodeFromCloud(database, {
      secret: RFC_SECRET,
      serverTime: new Date(60_000).toISOString(),
      receivedAtMs: 10_000
    });
    expect(verifyStoredPriceCode(database, "287082", 10_000)).toBe(true);
    expect(verifyStoredPriceCode(database, "755224", 10_000)).toBe(false);
    // 40 s depois (100 s na nuvem, janela 2) o codigo anterior venceu.
    expect(verifyStoredPriceCode(database, "287082", 50_000)).toBe(false);
    expect(verifyStoredPriceCode(database, "359152", 50_000)).toBe(true);
    database.close();
  });

  it("resposta sem chave nao apaga a chave que a balanca ja tem", () => {
    const database = openTemporaryDatabase();
    applyPriceCodeFromCloud(database, { secret: RFC_SECRET, receivedAtMs: 60_000 });
    applyPriceCodeFromCloud(database, { secret: null, receivedAtMs: 60_000 });
    expect(verifyStoredPriceCode(database, "287082", 60_000)).toBe(true);
    database.close();
  });
});
