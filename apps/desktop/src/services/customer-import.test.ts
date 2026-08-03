import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import type { DesktopDatabase } from "../database/sqlite";
import { openDesktopDatabase } from "../database/sqlite";
import type { CustomerImportRecord } from "./customer-import-sheet";
import { importCustomers, resolveCompanyId } from "./customer-import";
import type { CustomerRow } from "./customers";

describe("customer-import", () => {
  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
      )
      .run();

    for (const [id, code, description] of [
      ["product-brita1", "BR1", "Brita 1"],
      ["product-po", "PO", "Po de pedra"],
      ["product-areia", "AR", "Areia"]
    ]) {
      database
        .prepare(
          `INSERT INTO products (id, company_id, code, description, unit, is_active, created_at, updated_at)
           VALUES (?, 'company-1', ?, ?, 'ton', 1, datetime('now'), datetime('now'))`
        )
        .run(id, code, description);
    }

    return database;
  }

  function record(overrides: Partial<CustomerImportRecord> = {}): CustomerImportRecord {
    return {
      sourceLine: 2,
      tradeName: "Pedreira Sul",
      legalName: "Pedreira Sul LTDA",
      document: "19131243000197",
      phone: "11912345678",
      email: "nf@sul.com",
      zipcode: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      neighborhood: null,
      city: null,
      state: null,
      observations: null,
      creditLimitCents: null,
      nfRequired: null,
      prices: [{ product: "Brita 1", unitPriceCents: 4590 }],
      ...overrides
    };
  }

  function readCustomer(database: DesktopDatabase, document: string): CustomerRow | undefined {
    return database.prepare("SELECT * FROM customers WHERE document = ?").get(document) as
      | CustomerRow
      | undefined;
  }

  it("cria o cliente que ainda nao existe, com preco, e ja marca para o OMIE", () => {
    const database = createDatabase();
    try {
      const report = importCustomers(database, [record()], { companyId: "company-1" });

      expect(report.created).toBe(1);
      expect(report.pricesApplied).toBe(1);

      const customer = readCustomer(database, "19131243000197");
      expect(customer).toMatchObject({
        trade_name: "Pedreira Sul",
        legal_name: "Pedreira Sul LTDA",
        email: "nf@sul.com",
        source: "local",
        needs_push: 1,
        sync_status: "pending"
      });

      const price = database
        .prepare(
          "SELECT unit_price_cents, unit FROM customer_special_prices WHERE customer_id = ? AND product_id = 'product-brita1'"
        )
        .get(customer?.id) as { unit_price_cents: number; unit: string };
      expect(price).toEqual({ unit_price_cents: 4590, unit: "ton" });
    } finally {
      database.close();
    }
  });

  it("substitui os dados do cliente que ja existe, mesmo vindo do OMIE", () => {
    const database = createDatabase();
    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, omie_customer_id, source, legal_name, trade_name, document, phone, email, city, is_active, needs_push, created_at, updated_at)
           VALUES ('customer-omie', 'company-1', 555, 'omie', 'Nome Antigo', 'Antigo', '19.131.243/0001-97', '1130000000', 'antigo@sul.com', 'Sorocaba', 1, 0, datetime('now'), datetime('now'))`
        )
        .run();

      const report = importCustomers(database, [record()], { companyId: "company-1" });

      expect(report.created).toBe(0);
      expect(report.updated).toBe(1);

      const customer = database
        .prepare("SELECT * FROM customers WHERE id = 'customer-omie'")
        .get() as CustomerRow;
      expect(customer).toMatchObject({
        trade_name: "Pedreira Sul",
        legal_name: "Pedreira Sul LTDA",
        phone: "11912345678",
        email: "nf@sul.com",
        // Vira hibrido para o push ao OMIE aceitar os campos vindos da planilha.
        source: "hybrid",
        needs_push: 1
      });
      // Celula vazia nao apaga o que ja estava no cadastro.
      expect(customer.city).toBe("Sorocaba");
      expect(database.prepare("SELECT COUNT(*) AS total FROM customers").get()).toEqual({
        total: 1
      });
    } finally {
      database.close();
    }
  });

  it("com --limpar-vazios a celula vazia apaga o valor atual", () => {
    const database = createDatabase();
    try {
      importCustomers(database, [record({ city: "Sorocaba" })], { companyId: "company-1" });
      importCustomers(database, [record({ city: null })], {
        companyId: "company-1",
        clearEmpty: true
      });

      expect(readCustomer(database, "19131243000197")?.city).toBeNull();
    } finally {
      database.close();
    }
  });

  it("rodar de novo com a mesma planilha nao suja o cadastro nem reenvia ao OMIE", () => {
    const database = createDatabase();
    try {
      importCustomers(database, [record()], { companyId: "company-1" });
      database.prepare("UPDATE customers SET needs_push = 0, sync_status = 'synced'").run();

      const report = importCustomers(database, [record()], { companyId: "company-1" });

      expect(report.unchanged).toBe(1);
      expect(report.updated).toBe(0);
      expect(report.pricesApplied).toBe(0);
      expect(readCustomer(database, "19131243000197")?.needs_push).toBe(0);
    } finally {
      database.close();
    }
  });

  it("dry-run mostra o relatorio e desfaz tudo", () => {
    const database = createDatabase();
    try {
      const report = importCustomers(database, [record()], {
        companyId: "company-1",
        dryRun: true
      });

      expect(report.dryRun).toBe(true);
      expect(report.created).toBe(1);
      expect(report.pricesApplied).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS total FROM customers").get()).toEqual({
        total: 0
      });
      expect(
        database.prepare("SELECT COUNT(*) AS total FROM customer_special_prices").get()
      ).toEqual({ total: 0 });
    } finally {
      database.close();
    }
  });

  it("resolve produto por descricao, codigo e alias, e reporta o que nao existe", () => {
    const database = createDatabase();
    try {
      const report = importCustomers(
        database,
        [
          record({
            prices: [
              { product: "brita 1", unitPriceCents: 4590 },
              { product: "PO", unitPriceCents: 3800 },
              { product: "Areia media", unitPriceCents: 7000 },
              { product: "Pedrisco", unitPriceCents: 4000 }
            ]
          })
        ],
        { companyId: "company-1", productAliases: { "Areia media": "Areia" } }
      );

      expect(report.pricesApplied).toBe(3);
      expect(report.unresolvedProducts).toEqual(["Pedrisco"]);
    } finally {
      database.close();
    }
  });

  it("com --substituir-precos apaga o preco especial que saiu da planilha", () => {
    const database = createDatabase();
    try {
      importCustomers(
        database,
        [
          record({
            prices: [
              { product: "Brita 1", unitPriceCents: 4590 },
              { product: "Po de pedra", unitPriceCents: 3800 }
            ]
          })
        ],
        { companyId: "company-1" }
      );

      const report = importCustomers(
        database,
        [record({ prices: [{ product: "Brita 1", unitPriceCents: 4590 }] })],
        { companyId: "company-1", replacePrices: true }
      );

      expect(report.pricesRemoved).toBe(1);
      const active = database
        .prepare(
          "SELECT product_id FROM customer_special_prices WHERE deleted_at IS NULL AND is_active = 1"
        )
        .all() as Array<{ product_id: string }>;
      expect(active.map((row) => row.product_id)).toEqual(["product-brita1"]);
    } finally {
      database.close();
    }
  });

  it("sem CNPJ casa pelo nome e avisa; nome repetido vira erro em vez de escolher um", () => {
    const database = createDatabase();
    try {
      importCustomers(database, [record()], { companyId: "company-1" });

      const byName = importCustomers(database, [record({ document: null, phone: "11955554444" })], {
        companyId: "company-1"
      });
      expect(byName.updated).toBe(1);
      expect(byName.entries[0].message).toMatch(/OMIE/);
      expect(readCustomer(database, "19131243000197")?.phone).toBe("11955554444");

      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
           VALUES ('customer-clone', 'company-1', 'local', 'Pedreira Sul', 'Pedreira Sul', '45997418000153', 1, datetime('now'), datetime('now'))`
        )
        .run();

      const ambiguous = importCustomers(database, [record({ document: null })], {
        companyId: "company-1"
      });
      expect(ambiguous.failed).toBe(1);
      expect(ambiguous.entries[0].message).toMatch(/CNPJ\/CPF/);
    } finally {
      database.close();
    }
  });

  it("com --somente-com-cnpj pula quem ficou sem documento", () => {
    const database = createDatabase();
    try {
      const report = importCustomers(database, [record({ document: null })], {
        companyId: "company-1",
        requireDocument: true
      });

      expect(report.skipped).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS total FROM customers").get()).toEqual({
        total: 0
      });
    } finally {
      database.close();
    }
  });

  it("um erro em uma linha nao derruba as outras", () => {
    const database = createDatabase();
    try {
      for (const [id, document] of [
        ["customer-a", "19131243000197"],
        ["customer-b", "45997418000153"]
      ]) {
        database
          .prepare(
            `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
             VALUES (?, 'company-1', 'local', 'Pedreira Sul', 'Pedreira Sul', ?, 1, datetime('now'), datetime('now'))`
          )
          .run(id, document);
      }

      const report = importCustomers(
        database,
        [
          // Sem CNPJ e com dois cadastros de mesmo nome -> erro, mas so nesta linha.
          record({ document: null }),
          record({
            tradeName: "Novo Cliente",
            legalName: "Novo Cliente",
            document: "11222333000181"
          })
        ],
        { companyId: "company-1" }
      );

      expect(report.failed).toBe(1);
      expect(report.created).toBe(1);
      expect(readCustomer(database, "11222333000181")?.trade_name).toBe("Novo Cliente");
    } finally {
      database.close();
    }
  });

  describe("resolveCompanyId", () => {
    it("usa a unica empresa do banco e exige --empresa quando ha mais de uma", () => {
      const database = createDatabase();
      try {
        expect(resolveCompanyId(database)).toBe("company-1");

        database
          .prepare(
            `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
             VALUES ('company-2', 'Outra', 'Outra', datetime('now'), datetime('now'))`
          )
          .run();

        expect(() => resolveCompanyId(database)).toThrow(/--empresa/);
        expect(resolveCompanyId(database, "company-2")).toBe("company-2");
        expect(() => resolveCompanyId(database, "company-9")).toThrow(/nao existe/);
      } finally {
        database.close();
      }
    });
  });
});
