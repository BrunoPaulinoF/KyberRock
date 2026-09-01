import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { CacheStore } from "./cache-store";
import {
  applyDefaultNfeEmailToAllCustomers,
  createCustomer,
  findCustomerByDocument,
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
        .prepare(
          "SELECT id, email, source, needs_push FROM customers WHERE company_id = 'company-1' ORDER BY id"
        )
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

  it("keeps every email the operator informed, in the format OMIE expects", () => {
    const database = createDatabase();

    try {
      const customer = createCustomer(database, {
        companyId: "company-1",
        tradeName: "Cliente Multi",
        legalName: "Cliente Multi LTDA",
        email: " Fiscal@Cliente.com ; financeiro@cliente.com , fiscal@cliente.com "
      });

      // Virgula simples e o separador do cadastro do OMIE; repetidos saem da lista.
      expect(customer.email).toBe("fiscal@cliente.com, financeiro@cliente.com");

      const updated = updateCustomer(database, customer.id, {
        email: "compras@cliente.com\nnota@cliente.com"
      });
      expect(updated.email).toBe("compras@cliente.com, nota@cliente.com");

      const cleared = updateCustomer(database, customer.id, { email: "  " });
      expect(cleared.email).toBeNull();
    } finally {
      database.close();
    }
  });

  // Aba Fiscal: quem recebe a NF-e. Dado proprio, que nao se mistura com o contato.
  it("guarda os e-mails da NF-e separados do e-mail de contato", () => {
    const database = createDatabase();

    try {
      const customer = createCustomer(database, {
        companyId: "company-1",
        tradeName: "Cliente Fiscal",
        legalName: "Cliente Fiscal LTDA",
        email: "contato@cliente.com",
        fiscalEmails: " Fiscal@Cliente.com ; financeiro@cliente.com , fiscal@cliente.com "
      });

      expect(customer.email).toBe("contato@cliente.com");
      expect(customer.fiscal_emails).toBe("fiscal@cliente.com, financeiro@cliente.com");

      // Mexer num nao mexe no outro.
      const updated = updateCustomer(database, customer.id, {
        fiscalEmails: "nota@cliente.com"
      });
      expect(updated.fiscal_emails).toBe("nota@cliente.com");
      expect(updated.email).toBe("contato@cliente.com");

      const cleared = updateCustomer(database, customer.id, { fiscalEmails: "  " });
      expect(cleared.fiscal_emails).toBeNull();
      expect(cleared.email).toBe("contato@cliente.com");
    } finally {
      database.close();
    }
  });

  it("accepts more than one default NF-e email", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, email, is_active, needs_push, created_at, updated_at)
           VALUES ('local-1', 'company-1', 'local', 'Local 1', 'Local 1', NULL, 1, 0, datetime('now'), datetime('now'))`
        )
        .run();

      const count = applyDefaultNfeEmailToAllCustomers(
        database,
        "company-1",
        "NF@Empresa.com; boletos@empresa.com"
      );

      expect(count).toBe(1);
      expect(getDefaultNfeEmail(database)).toBe("nf@empresa.com, boletos@empresa.com");
      expect(() =>
        applyDefaultNfeEmailToAllCustomers(database, "company-1", "nf@empresa.com, invalido")
      ).toThrow(/invalido/i);
    } finally {
      database.close();
    }
  });

  it("clears the credit limit when creditLimitCents is null and keeps it when undefined", () => {
    const database = createDatabase();

    try {
      const customer = createCustomer(database, {
        companyId: "company-1",
        tradeName: "Cliente Limite",
        legalName: "Cliente Limite LTDA",
        creditLimitCents: 150000
      });

      const untouched = updateCustomer(database, customer.id, { observations: "sem mexer" });
      expect(untouched.credit_limit_cents).toBe(150000);

      const cleared = updateCustomer(database, customer.id, { creditLimitCents: null });
      expect(cleared.credit_limit_cents).toBeNull();
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

  // O documento vem do OMIE com mascara ("144.939.658-51") e do cadastro local so com
  // digitos. Buscando so pelo texto cru, procurar pelo CPF nao achava o cliente que estava
  // ali — e o operador concluia que ele nao existia.
  it("acha o cliente pelo CNPJ/CPF com ou sem mascara", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
           VALUES ('com-mascara', 'company-1', 'omie', 'Jose da Silva', 'Jose', '144.939.658-51', 1, datetime('now'), datetime('now')),
                  ('sem-mascara', 'company-1', 'local', 'Maria Souza', 'Maria', '27912844864', 1, datetime('now'), datetime('now'))`
        )
        .run();
      const cacheStore = new CacheStore(database);
      cacheStore.loadAll("company-1");

      const byDigits = cacheStore.query({ entityType: "customer", search: "14493965851" });
      expect(byDigits.rows.map((row) => row.id)).toEqual(["com-mascara"]);

      const byMask = cacheStore.query({ entityType: "customer", search: "279.128.448-64" });
      expect(byMask.rows.map((row) => row.id)).toEqual(["sem-mascara"]);

      // Busca por nome continua funcionando como antes.
      expect(
        cacheStore.query({ entityType: "customer", search: "maria" }).rows.map((row) => row.id)
      ).toEqual(["sem-mascara"]);
    } finally {
      database.close();
    }
  });

  it("reconhece o mesmo CNPJ alfanumerico e nao confunde com outro", () => {
    const database = createDatabase();

    try {
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Pedreira Nova LTDA",
        tradeName: "Pedreira Nova",
        document: "12.abc.345/01de-35"
      });

      // A tela normaliza, mas o documento tambem chega por planilha e pelo pull da nuvem
      // com mascara e em minusculas — as tres formas sao o mesmo cadastro.
      expect(findCustomerByDocument(database, "company-1", "12ABC34501DE35")?.id).toBeTruthy();
      expect(findCustomerByDocument(database, "company-1", "12.abc.345/01de-35")?.id).toBeTruthy();

      // E um CNPJ que so difere nas letras e OUTRO cliente: comparar por digitos colapsaria
      // os dois e o segundo cadastro seria recusado como duplicado.
      expect(findCustomerByDocument(database, "company-1", "12.DEF.456/01AB-72")).toBeNull();
    } finally {
      database.close();
    }
  });

  // Cliente inativo continua dono do documento, mas a lista o escondia: o operador via
  // "Ja existe um cliente com este CNPJ/CPF" e nao achava ninguem ao procurar.
  it("diz que o cliente que ocupa o documento esta inativo", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
           VALUES ('inativo', 'company-1', 'local', 'Roque de Oliveira Cintra', 'Roque', '27912844864', 0, datetime('now'), datetime('now'))`
        )
        .run();

      expect(() =>
        createCustomer(database, {
          companyId: "company-1",
          tradeName: "Roque",
          legalName: "Roque de Oliveira Cintra",
          document: "27912844864"
        })
      ).toThrow(/inativo/i);

      // O inativo aparece na consulta que a tela de cadastro faz (activeOnly: false).
      const cacheStore = new CacheStore(database);
      cacheStore.loadAll("company-1");
      expect(
        cacheStore.query({ entityType: "customer", activeOnly: false, search: "27912844864" }).total
      ).toBe(1);
      expect(cacheStore.query({ entityType: "customer", search: "27912844864" }).total).toBe(0);
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
        cacheStore.query({
          entityType: "product",
          activeOnly: true,
          productFiscalType: "finished_goods"
        }).total
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
