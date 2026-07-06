import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  CUSTOMER_CREDIT_METHOD_CODE,
  createPaymentMethod,
  deletePaymentMethod,
  DEFAULT_PAYMENT_METHODS,
  ensureDefaultPaymentMethods,
  listPaymentMethods,
  paymentMethodDisplayName,
  updatePaymentMethod
} from "./payment-methods.js";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function seedCompany(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, document, created_at, updated_at)
       VALUES (?, 'ACME LTDA', 'ACME', '00000000000191', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
}

describe("payment-methods service", () => {
  let database: DesktopDatabase;

  beforeEach(() => {
    database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    seedCompany(database);
  });

  afterEach(() => {
    database.close();
  });

  it("seeds the six system defaults idempotently", () => {
    ensureDefaultPaymentMethods(database, COMPANY_ID);
    ensureDefaultPaymentMethods(database, COMPANY_ID); // segunda chamada nao duplica

    const methods = listPaymentMethods(database, COMPANY_ID);
    expect(methods).toHaveLength(DEFAULT_PAYMENT_METHODS.length);
    expect(methods.map((m) => m.code)).toEqual([
      "cash",
      "pix",
      "credit_card",
      "debit_card",
      "boleto",
      "customer_credit"
    ]);
    expect(methods.every((m) => m.is_system === 1)).toBe(true);
  });

  it("flags the customer-credit method", () => {
    ensureDefaultPaymentMethods(database, COMPANY_ID);
    const credit = listPaymentMethods(database, COMPANY_ID).find(
      (m) => m.code === CUSTOMER_CREDIT_METHOD_CODE
    );
    expect(credit?.is_customer_credit).toBe(1);
  });

  it("creates a custom method with a slugified code", () => {
    const created = createPaymentMethod(database, { companyId: COMPANY_ID, name: "Cheque à vista" });
    expect(created.code).toBe("cheque_a_vista");
    expect(created.is_system).toBe(0);
  });

  it("renames and deactivates a method", () => {
    const created = createPaymentMethod(database, { companyId: COMPANY_ID, name: "Vale" });
    const updated = updatePaymentMethod(database, created.id, { name: "Vale-compra", isActive: false });
    expect(updated.name).toBe("Vale-compra");
    expect(updated.is_active).toBe(0);
  });

  it("blocks deletion of system methods but allows custom", () => {
    ensureDefaultPaymentMethods(database, COMPANY_ID);
    const boleto = listPaymentMethods(database, COMPANY_ID).find((m) => m.code === "boleto");
    expect(() => deletePaymentMethod(database, boleto!.id)).toThrow(/padrao/i);

    const custom = createPaymentMethod(database, { companyId: COMPANY_ID, name: "Permuta" });
    deletePaymentMethod(database, custom.id);
    expect(listPaymentMethods(database, COMPANY_ID).find((m) => m.id === custom.id)).toBeUndefined();
  });

  it("stores alias, omie code and account binding on create", () => {
    const created = createPaymentMethod(database, {
      companyId: COMPANY_ID,
      name: "Boleto Santander",
      alias: "Boleto",
      omieCode: "BOL-1",
      accountId: "acc-123"
    });
    expect(created.alias).toBe("Boleto");
    expect(created.omie_code).toBe("BOL-1");
    expect(created.account_id).toBe("acc-123");
  });

  it("updates and clears alias / omie code / account", () => {
    const created = createPaymentMethod(database, {
      companyId: COMPANY_ID,
      name: "Pix",
      alias: "Pix loja",
      omieCode: "PIX-9",
      accountId: "acc-1"
    });
    const updated = updatePaymentMethod(database, created.id, {
      alias: "",
      omieCode: null,
      accountId: null
    });
    expect(updated.alias).toBeNull();
    expect(updated.omie_code).toBeNull();
    expect(updated.account_id).toBeNull();
  });

  it("derives the display name from the alias when present", () => {
    expect(paymentMethodDisplayName({ alias: "Apelido", name: "Nome real" })).toBe("Apelido");
    expect(paymentMethodDisplayName({ alias: "  ", name: "Nome real" })).toBe("Nome real");
    expect(paymentMethodDisplayName({ alias: null, name: "Nome real" })).toBe("Nome real");
  });
});
