import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import {
  FALLBACK_OMIE_CATEGORY_CODE,
  getDefaultOmieCategory,
  listOmieCategories,
  resolveOrderCategoryCode,
  setDefaultOmieCategory,
  setProductOmieCategory
} from "./omie-categories";

describe("omie categories", () => {
  it("lists only categories that can be posted to", () => {
    const database = createDatabase();

    try {
      insertCategory(database, "1.01.01", "Clientes - Rachao");
      insertCategory(database, "1.01.02", "Clientes - Aterro");
      // Totalizadora/inativa no OMIE: recusada como categoria de um pedido.
      insertCategory(database, "1.01", "Receitas", { isActive: false });

      expect(listOmieCategories(database, "company-1").map((c) => c.code)).toEqual([
        "1.01.01",
        "1.01.02"
      ]);
    } finally {
      database.close();
    }
  });

  it("uses the product category, then the unit default, then the historic code", () => {
    // O bug relatado: o pedido ia sempre com "1.01.01", entao uma venda de material de
    // aterro era classificada como rachao no OMIE.
    expect(resolveOrderCategoryCode("1.01.02", "1.01.05")).toBe("1.01.02");
    expect(resolveOrderCategoryCode(null, "1.01.05")).toBe("1.01.05");
    expect(resolveOrderCategoryCode("  ", "  ")).toBe(FALLBACK_OMIE_CATEGORY_CODE);
    expect(resolveOrderCategoryCode(undefined, undefined)).toBe("1.01.01");
  });

  it("stores and clears the product category", () => {
    const database = createDatabase();

    try {
      insertCategory(database, "1.01.02", "Clientes - Aterro");
      insertProduct(database, "product-1");

      setProductOmieCategory(database, "company-1", "product-1", "1.01.02");
      expect(productCategory(database, "product-1")).toBe("1.01.02");

      setProductOmieCategory(database, "company-1", "product-1", "");
      expect(productCategory(database, "product-1")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("refuses a category that is not in the OMIE mirror", () => {
    const database = createDatabase();

    try {
      insertProduct(database, "product-1");
      // Gravar um codigo desconhecido so quebraria na hora de enviar o pedido ao OMIE.
      expect(() => setProductOmieCategory(database, "company-1", "product-1", "9.99.99")).toThrow(
        "nao encontrada"
      );
      expect(() => setDefaultOmieCategory(database, "company-1", "9.99.99")).toThrow(
        "nao encontrada"
      );
    } finally {
      database.close();
    }
  });

  it("keeps the unit default category", () => {
    const database = createDatabase();

    try {
      insertCategory(database, "1.01.05", "Clientes - Diversos");
      expect(getDefaultOmieCategory(database)).toBeNull();

      setDefaultOmieCategory(database, "company-1", "1.01.05");
      expect(getDefaultOmieCategory(database)).toBe("1.01.05");

      setDefaultOmieCategory(database, "company-1", null);
      expect(getDefaultOmieCategory(database)).toBeNull();
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return database;
}

function insertCategory(
  database: DesktopDatabase,
  code: string,
  description: string,
  options: { isActive?: boolean } = {}
): void {
  const now = "2026-07-30T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO omie_categories (
        id, company_id, code, description, category_type, parent_code, is_active, created_at, updated_at
      ) VALUES (?, 'company-1', ?, ?, 'R', NULL, ?, ?, ?)`
    )
    .run(`cat-${code}`, code, description, options.isActive === false ? 0 : 1, now, now);
}

function insertProduct(database: DesktopDatabase, id: string): void {
  const now = "2026-07-30T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
       VALUES (?, 'company-1', 'ATERRO', 'Material de aterro', 'ton', ?, ?)`
    )
    .run(id, now, now);
}

function productCategory(database: DesktopDatabase, productId: string): string | null {
  return (
    (database
      .prepare("SELECT omie_category_code FROM products WHERE id = ?")
      .pluck()
      .get(productId) as string | null) ?? null
  );
}
