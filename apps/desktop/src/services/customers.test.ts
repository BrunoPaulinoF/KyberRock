import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { CacheStore } from "./cache-store";
import {
  applyDefaultNfeEmailToAllCustomers,
  createCustomer,
  getDefaultNfeEmail,
  updateCustomer
} from "./customers";

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

  it("blocks OMIE-owned field edits by default but allows them with overrideOmieFields", () => {
    const database = createDatabase();
    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
           VALUES ('omie-c', 'company-1', 'omie', 'Cliente OMIE', 'Cliente OMIE', '19131243000197', 1, datetime('now'), datetime('now'))`
        )
        .run();

      expect(() => updateCustomer(database, "omie-c", { email: "x@y.com" })).toThrow(/OMIE/i);

      const updated = updateCustomer(
        database,
        "omie-c",
        { email: "nf@empresa.com", addressNumber: "100" },
        new Date(),
        { overrideOmieFields: true }
      );
      expect(updated.email).toBe("nf@empresa.com");
      expect(updated.address_number).toBe("100");
      // Vira 'hybrid' + needs_push para empurrar ao OMIE.
      expect(updated.source).toBe("hybrid");
      expect(updated.needs_push).toBe(1);
    } finally {
      database.close();
    }
  });

  it("applies the default NF-e email to all customers and marks them for push", () => {
    const database = createDatabase();
    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, email, is_active, needs_push, created_at, updated_at)
           VALUES
             ('local-1', 'company-1', 'local', 'Local 1', 'Local 1', NULL, 1, 0, datetime('now'), datetime('now')),
             ('omie-1', 'company-1', 'omie', 'OMIE 1', 'OMIE 1', 'antigo@x.com', 1, 0, datetime('now'), datetime('now'))`
        )
        .run();

      const count = applyDefaultNfeEmailToAllCustomers(database, "company-1", " NF@Empresa.com ");
      expect(count).toBe(2);
      expect(getDefaultNfeEmail(database)).toBe("nf@empresa.com");

      const rows = database
        .prepare("SELECT id, email, source, needs_push FROM customers WHERE company_id = 'company-1' ORDER BY id")
        .all() as Array<{ id: string; email: string; source: string; needs_push: number }>;
      expect(rows.every((r) => r.email === "nf@empresa.com")).toBe(true);
      expect(rows.every((r) => r.needs_push === 1)).toBe(true);
      // Cliente OMIE promovido a hybrid para o push funcionar.
      expect(rows.find((r) => r.id === "omie-1")?.source).toBe("hybrid");

      // Idempotente: reaplicar nao conta ninguem (todos ja com o e-mail).
      expect(applyDefaultNfeEmailToAllCustomers(database, "company-1", "nf@empresa.com")).toBe(0);
    } finally {
      database.close();
    }
  });

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
