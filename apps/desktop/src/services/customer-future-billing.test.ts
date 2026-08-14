import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import type { DesktopDatabase } from "../database/sqlite";
import {
  getCustomerFutureBillingInvoices,
  normalizeFutureBillingNfeNumber,
  removeCustomerFutureBillingInvoice,
  resolveCustomerFutureBillingNfe,
  setCustomerFutureBillingInvoice
} from "./customer-future-billing";

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
    )
    .run();
  for (const [id, name] of [
    ["customer-1", "Concessionaria"],
    ["customer-2", "Construtora"]
  ]) {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
         VALUES (?, 'company-1', 'local', ?, ?, 1, datetime('now'), datetime('now'))`
      )
      .run(id, name, name);
  }
  for (const [id, code, description] of [
    ["product-rachao", "P1", "Rachao"],
    ["product-brita", "P2", "Brita 1"]
  ]) {
    database
      .prepare(
        `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
         VALUES (?, 'company-1', ?, ?, 'ton', datetime('now'), datetime('now'))`
      )
      .run(id, code, description);
  }
  return database;
}

describe("normalizeFutureBillingNfeNumber", () => {
  it("guarda so os digitos e trata vazio como ausencia de nota", () => {
    expect(normalizeFutureBillingNfeNumber("12.345")).toBe("12345");
    expect(normalizeFutureBillingNfeNumber(" 987 ")).toBe("987");
    expect(normalizeFutureBillingNfeNumber("NF 4321")).toBe("4321");
    expect(normalizeFutureBillingNfeNumber("")).toBeNull();
    expect(normalizeFutureBillingNfeNumber("   ")).toBeNull();
    expect(normalizeFutureBillingNfeNumber(null)).toBeNull();
    expect(normalizeFutureBillingNfeNumber(undefined)).toBeNull();
  });

  it("preserva zeros a esquerda (o numero e texto, nao inteiro)", () => {
    expect(normalizeFutureBillingNfeNumber("000045")).toBe("000045");
  });
});

describe("notas de venda para entrega futura por produto", () => {
  it("a nota do produto e a que sai na pesagem daquele produto", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-brita",
      nfeNumber: "67890"
    });

    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBe("12345");
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-brita")).toBe("67890");
  });

  it("a nota do produto vence a nota geral do cliente", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, { customerId: "customer-1", nfeNumber: "111" });
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "222"
    });

    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBe("222");
    // Produto sem nota propria cai na geral do cliente.
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-brita")).toBe("111");
  });

  it("nao carimba a pesagem de um produto com a nota de OUTRO produto", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    // Sem nota geral, a brita nao pode herdar a nota do rachao.
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-brita")).toBeNull();
    // Pesagem sem produto tambem nao pega a nota de um produto especifico.
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", null)).toBeNull();
  });

  it("a nota de um cliente nao vaza para outro", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    expect(resolveCustomerFutureBillingNfe(database, "customer-2", "product-rachao")).toBeNull();
    expect(resolveCustomerFutureBillingNfe(database, null, "product-rachao")).toBeNull();
  });

  it("cliente sem nota cadastrada nao carimba nada", () => {
    const database = createDatabase();
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBeNull();
  });

  it("regravar o mesmo par atualiza o numero em vez de criar uma segunda nota", () => {
    const database = createDatabase();
    const first = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });
    const second = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "99999"
    });

    expect(second.id).toBe(first.id);
    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(1);
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBe("99999");
  });

  it("recusa numero em branco: uma nota sem numero nao referencia nada", () => {
    const database = createDatabase();
    expect(() =>
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-1",
        productId: "product-rachao",
        nfeNumber: "   "
      })
    ).toThrow(/numero da nota/i);
  });

  it("remover encerra a entrega futura sem apagar a linha (soft delete)", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    removeCustomerFutureBillingInvoice(database, invoice.id);

    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBeNull();
    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(0);
    // A linha continua na base com deleted_at, para a remocao atravessar para a outra
    // balanca em vez de a nota reaparecer no proximo pull.
    expect(
      database
        .prepare(
          "SELECT deleted_at FROM customer_future_billing_invoices WHERE id = ? AND deleted_at IS NOT NULL"
        )
        .get(invoice.id)
    ).toBeTruthy();
  });

  it("depois de remover, o mesmo par pode receber uma nota nova", () => {
    const database = createDatabase();
    const first = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });
    removeCustomerFutureBillingInvoice(database, first.id);

    const second = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "54321"
    });

    expect(second.id).not.toBe(first.id);
    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBe("54321");
  });

  it("lista a nota geral primeiro e traz a descricao do produto para a tela", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "222"
    });
    setCustomerFutureBillingInvoice(database, { customerId: "customer-1", nfeNumber: "111" });

    expect(
      getCustomerFutureBillingInvoices(database, "customer-1").map((invoice) => ({
        productDescription: invoice.productDescription,
        nfeNumber: invoice.nfeNumber
      }))
    ).toEqual([
      { productDescription: null, nfeNumber: "111" },
      { productDescription: "Rachao", nfeNumber: "222" }
    ]);
  });

  it("normaliza o numero na gravacao (o operador digita com ponto)", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12.345"
    });

    expect(resolveCustomerFutureBillingNfe(database, "customer-1", "product-rachao")).toBe("12345");
  });
});
