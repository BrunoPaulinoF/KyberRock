import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  createAccount,
  deleteAccount,
  DEFAULT_ACCOUNTS,
  ensureDefaultAccounts,
  listAccounts,
  updateAccount
} from "./accounts.js";
import {
  applyDefaultAccountBindings,
  createPaymentMethod,
  ensureDefaultPaymentMethods,
  listPaymentMethods,
  updatePaymentMethod
} from "./payment-methods.js";

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

function seedCompany(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, document, created_at, updated_at)
       VALUES (?, 'ACME LTDA', 'ACME', '00000000000191', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
}

describe("accounts service", () => {
  let database: DesktopDatabase;

  beforeEach(() => {
    database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    seedCompany(database);
  });

  afterEach(() => {
    database.close();
  });

  it("seeds the default accounts idempotently", () => {
    ensureDefaultAccounts(database, COMPANY_ID);
    ensureDefaultAccounts(database, COMPANY_ID);

    const accounts = listAccounts(database, COMPANY_ID);
    expect(accounts).toHaveLength(DEFAULT_ACCOUNTS.length);
    expect(accounts.map((a) => a.code)).toEqual(["caixinha", "omie_cash", "getnet"]);
    expect(accounts.map((a) => a.name)).toEqual(["Caixinha", "OMIE Cash", "GetNet"]);
    expect(accounts.every((a) => a.is_system === 1)).toBe(true);
  });

  it("creates a custom account with an OMIE code", () => {
    const created = createAccount(database, {
      companyId: COMPANY_ID,
      name: "Banco X",
      omieCode: "12345"
    });
    expect(created.name).toBe("Banco X");
    expect(created.omie_code).toBe("12345");
    expect(created.is_system).toBe(0);
    expect(created.code).toBeNull();
  });

  it("renames, sets the OMIE code and deactivates", () => {
    const created = createAccount(database, { companyId: COMPANY_ID, name: "Conta" });
    const updated = updateAccount(database, created.id, {
      name: "Conta Corrente",
      omieCode: "999",
      isActive: false
    });
    expect(updated.name).toBe("Conta Corrente");
    expect(updated.omie_code).toBe("999");
    expect(updated.is_active).toBe(0);
  });

  it("blocks deletion of system accounts but allows custom", () => {
    ensureDefaultAccounts(database, COMPANY_ID);
    const caixinha = listAccounts(database, COMPANY_ID).find((a) => a.code === "caixinha");
    expect(() => deleteAccount(database, caixinha!.id)).toThrow(/padrao/i);

    const custom = createAccount(database, { companyId: COMPANY_ID, name: "Temp" });
    deleteAccount(database, custom.id);
    expect(listAccounts(database, COMPANY_ID).find((a) => a.id === custom.id)).toBeUndefined();
  });

  it("unbinds payment methods when their account is deleted", () => {
    const account = createAccount(database, { companyId: COMPANY_ID, name: "Conta Y" });
    const method = createPaymentMethod(database, {
      companyId: COMPANY_ID,
      name: "Transferencia",
      accountId: account.id
    });
    expect(method.account_id).toBe(account.id);

    deleteAccount(database, account.id);
    const reloaded = listPaymentMethods(database, COMPANY_ID).find((m) => m.id === method.id);
    expect(reloaded?.account_id).toBeNull();
  });

  it("applies the default forma -> conta bindings", () => {
    ensureDefaultAccounts(database, COMPANY_ID);
    ensureDefaultPaymentMethods(database, COMPANY_ID);
    applyDefaultAccountBindings(database, COMPANY_ID);

    const accounts = listAccounts(database, COMPANY_ID);
    const idByCode = new Map(accounts.map((a) => [a.code, a.id]));
    const methods = listPaymentMethods(database, COMPANY_ID);
    const byCode = new Map(methods.map((m) => [m.code, m]));

    expect(byCode.get("cash")?.account_id).toBe(idByCode.get("caixinha"));
    expect(byCode.get("pix")?.account_id).toBe(idByCode.get("omie_cash"));
    expect(byCode.get("boleto")?.account_id).toBe(idByCode.get("omie_cash"));
    expect(byCode.get("debit_card")?.account_id).toBe(idByCode.get("getnet"));
    expect(byCode.get("credit_card")?.account_id).toBe(idByCode.get("getnet"));
    // Fiado e lancado uma unica vez no OMIE pela OMIE Cash.
    expect(byCode.get("customer_credit")?.account_id).toBe(idByCode.get("omie_cash"));
  });

  it("does not override an existing binding", () => {
    ensureDefaultAccounts(database, COMPANY_ID);
    ensureDefaultPaymentMethods(database, COMPANY_ID);
    const custom = createAccount(database, { companyId: COMPANY_ID, name: "Cofre" });
    const cash = listPaymentMethods(database, COMPANY_ID).find((m) => m.code === "cash");
    updatePaymentMethod(database, cash!.id, { accountId: custom.id });

    applyDefaultAccountBindings(database, COMPANY_ID);
    const reloaded = listPaymentMethods(database, COMPANY_ID).find((m) => m.code === "cash");
    expect(reloaded?.account_id).toBe(custom.id);
  });
});
