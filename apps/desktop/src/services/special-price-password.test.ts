import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { writeLocalSetting } from "./local-settings";
import { priceCodeForStep, priceCodeStep } from "./price-code";
import { DesktopRuntime, SPECIAL_PRICE_PASSWORD_REJECTED } from "./runtime";

/**
 * Preco especial de cliente (adicionar, trocar, excluir) pede a senha rotativa que o comercial
 * ve no site — conferida no processo principal, nao so na tela — e cada alteracao entra no
 * historico que sobe para a nuvem e aparece para o comercial.
 */
describe("Preco especial com a senha do comercial", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("sem senha, ou com senha errada, nada e gravado", () => {
    const { runtime, database } = createRuntime(tempDirectories);
    try {
      const input = { customerId: "customer-1", productId: "product-1", unitPriceCents: 6500 };
      expect(() => runtime.setCustomerSpecialPrice(input)).toThrow(SPECIAL_PRICE_PASSWORD_REJECTED);
      expect(() => runtime.setCustomerSpecialPrice({ ...input, password: "000000" })).toThrow(
        SPECIAL_PRICE_PASSWORD_REJECTED
      );
      expect(specialPrices(database)).toEqual([]);
      expect(history(database)).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it("com a senha da janela atual grava e registra adicionar, trocar e excluir", () => {
    const { runtime, database, code } = createRuntime(tempDirectories);
    try {
      const base = { customerId: "customer-1", productId: "product-1" };
      runtime.setCustomerSpecialPrice({ ...base, unitPriceCents: 6500, password: code() });
      runtime.setCustomerSpecialPrice({ ...base, unitPriceCents: 7000, password: code() });
      // O mesmo valor de novo nao e alteracao.
      runtime.setCustomerSpecialPrice({ ...base, unitPriceCents: 7000, password: code() });

      expect(() => runtime.removeCustomerSpecialPrice("customer-1", "product-1")).toThrow(
        SPECIAL_PRICE_PASSWORD_REJECTED
      );
      expect(specialPrices(database)).toEqual([7000]);

      runtime.removeCustomerSpecialPrice("customer-1", "product-1", code());
      expect(specialPrices(database)).toEqual([]);

      expect(history(database)).toEqual([
        {
          action: "adicionado",
          customer_name: "Cliente Teste",
          product_description: "Brita 1",
          old_price_cents: null,
          new_price_cents: 6500
        },
        {
          action: "alterado",
          customer_name: "Cliente Teste",
          product_description: "Brita 1",
          old_price_cents: 6500,
          new_price_cents: 7000
        },
        {
          action: "removido",
          customer_name: "Cliente Teste",
          product_description: "Brita 1",
          old_price_cents: 7000,
          new_price_cents: null
        }
      ]);
    } finally {
      runtime.close();
    }
  });

  it("a senha vencida (janela anterior) e recusada", () => {
    const { runtime, database, codeAt } = createRuntime(tempDirectories);
    try {
      const expired = codeAt(Date.now() - 60_000);
      expect(() =>
        runtime.setCustomerSpecialPrice({
          customerId: "customer-1",
          productId: "product-1",
          unitPriceCents: 6500,
          password: expired
        })
      ).toThrow(SPECIAL_PRICE_PASSWORD_REJECTED);
      expect(specialPrices(database)).toEqual([]);
    } finally {
      runtime.close();
    }
  });
});

const SECRET = "chave-de-teste-da-pedreira-123456";

interface RuntimeInternals {
  database: DesktopDatabase;
  pushCadastroToCloud: () => Promise<void>;
}

function createRuntime(tempDirectories: string[]): {
  runtime: DesktopRuntime;
  database: DesktopDatabase;
  code: () => string;
  codeAt: (ms: number) => string;
} {
  // Relogio parado no meio de uma janela de 45 s: a senha gerada e a conferida sao a mesma.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T12:00:10.000Z"));
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-special-price-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const internals = runtime as unknown as RuntimeInternals;
  const database = internals.database;
  writeLocalSetting(database, "cloud_company_id", "company-1");
  writeLocalSetting(database, "cloud_unit_id", "unit-1");
  writeLocalSetting(database, "cloud_device_id", "device-1");
  writeLocalSetting(database, "cloud_device_token", "token-1");
  writeLocalSetting(database, "cloud_configured", true);
  writeLocalSetting(database, "last_license_check_at", new Date().toISOString());
  // A chave da senha rotativa, como o `desktop-status` entrega.
  writeLocalSetting(database, "price_code_secret", SECRET);
  // O envio (HTTP) fica de fora: aqui importa o que e gravado.
  internals.pushCadastroToCloud = vi.fn(async () => {});
  seedCatalog(database);

  const codeAt = (ms: number) => priceCodeForStep(SECRET, priceCodeStep(ms));
  return { runtime, database, code: () => codeAt(Date.now()), codeAt };
}

function seedCatalog(database: DesktopDatabase): void {
  const at = "2026-09-28T09:00:00.000Z";
  database
    .prepare(
      `INSERT OR IGNORE INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'KyberRock', 'KyberRock', ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, created_at, updated_at)
       VALUES ('customer-1', 'company-1', 'local', 'Cliente Teste LTDA', 'Cliente Teste', ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
       VALUES ('product-1', 'company-1', 'BRITA1', 'Brita 1', 'ton', ?, ?)`
    )
    .run(at, at);
}

function specialPrices(database: DesktopDatabase): number[] {
  return (
    database
      .prepare(
        `SELECT unit_price_cents FROM customer_special_prices
         WHERE deleted_at IS NULL AND is_active = 1`
      )
      .all() as Array<{ unit_price_cents: number }>
  ).map((row) => row.unit_price_cents);
}

function history(database: DesktopDatabase): Array<Record<string, unknown>> {
  return database
    .prepare(
      `SELECT action, customer_name, product_description, old_price_cents, new_price_cents
       FROM price_change_log ORDER BY created_at, rowid`
    )
    .all() as Array<Record<string, unknown>>;
}
