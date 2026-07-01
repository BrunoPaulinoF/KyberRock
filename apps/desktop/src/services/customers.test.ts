import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { CacheStore } from "./cache-store";
import { createCustomer, updateCustomer } from "./customers";

describe("customers", () => {
  function createDatabase() {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z')`
      )
      .run();
    return database;
  }

  it("updates billing blocked to false", () => {
    const database = createDatabase();

    try {
      const customer = createCustomer(database, {
        companyId: "company-1",
        tradeName: "Cliente Teste",
        legalName: "Cliente Teste LTDA",
        omieBillingBlocked: true
      });

      const updated = updateCustomer(database, customer.id, { omieBillingBlocked: false });

      expect(updated.omie_billing_blocked).toBe(0);
    } finally {
      database.close();
    }
  });

  it("loads default carrier id into customer cache", () => {
    const database = createDatabase();

    try {
      const customer = createCustomer(database, {
        companyId: "company-1",
        tradeName: "Cliente Cache",
        legalName: "Cliente Cache LTDA"
      });
      const cacheStore = new CacheStore(database);

      cacheStore.loadAll("company-1");
      const result = cacheStore.query({ entityType: "customer", search: "Cliente Cache" });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe(customer.id);
      expect(result.rows[0].defaultCarrierId).toBe(customer.default_carrier_id);
    } finally {
      database.close();
    }
  });

  it("filters sellable products when requested by product selectors", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO products (
            id, company_id, omie_product_id, code, description, unit, item_type, is_active, created_at, updated_at
          ) VALUES
            ('product-finished', 'company-1', 101, 'P101', 'Produto Acabado', 'UN', '04 - Produtos Acabados', 1, datetime('now'), datetime('now')),
            ('product-service', 'company-1', 202, 'P202', 'Produto Sem Tipo Acabado', 'UN', '99', 1, datetime('now'), datetime('now'))`
        )
        .run();
      const cacheStore = new CacheStore(database);

      cacheStore.loadAll("company-1");

      expect(cacheStore.query({ entityType: "product", activeOnly: true }).total).toBe(2);
      expect(
        cacheStore.query({ entityType: "product", activeOnly: true, productFiscalType: "finished_goods" }).total
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
