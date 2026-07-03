import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  createPaymentTerm,
  deletePaymentTerm,
  listPaymentTerms,
  updatePaymentTerm
} from "./payment-terms.js";

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

function seedCompany(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, document, created_at, updated_at)
       VALUES (?, 'ACME LTDA', 'ACME', '00000000000191', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
}

describe("payment-terms service", () => {
  let database: DesktopDatabase;

  beforeEach(() => {
    database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    seedCompany(database);
  });

  afterEach(() => {
    database.close();
  });

  it("creates a local condition and derives installment metadata", () => {
    const term = createPaymentTerm(database, {
      companyId: COMPANY_ID,
      name: "Boleto 30/60/90",
      condition: "30/60/90"
    });
    expect(term.omie_code).toBeNull();
    expect(term.installment_count).toBe(3);
    expect(term.first_installment_days).toBe(30);
    expect(JSON.parse(term.installment_days_json!)).toEqual([30, 60, 90]);
    const rules = JSON.parse(term.rules_json);
    expect(rules.kind).toBe("fixed_days");
    expect(rules.summary).toContain("3 parcelas");
  });

  it("rejects an invalid condition format", () => {
    expect(() =>
      createPaymentTerm(database, { companyId: COMPANY_ID, name: "X", condition: "nao vale" })
    ).toThrow();
  });

  it("updates the condition and refreshes metadata", () => {
    const term = createPaymentTerm(database, {
      companyId: COMPANY_ID,
      name: "Mensal",
      condition: "A Vista"
    });
    const updated = updatePaymentTerm(database, term.id, { condition: "3 Parcelas" });
    expect(updated.installment_count).toBe(3);
    expect(updated.installment_interval_days).toBe(30);
  });

  it("soft-deletes a condition", () => {
    const term = createPaymentTerm(database, {
      companyId: COMPANY_ID,
      name: "Para 45 dias",
      condition: "Para 45 dias"
    });
    deletePaymentTerm(database, term.id);
    expect(listPaymentTerms(database, COMPANY_ID)).toHaveLength(0);
  });

  it("refuses to edit an OMIE-sourced condition", () => {
    const nowIso = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO payment_terms (id, company_id, omie_code, name, rules_json, visible, is_active, created_at, updated_at)
         VALUES ('omie_99', ?, '99', 'OMIE cond', '{}', 1, 1, ?, ?)`
      )
      .run(COMPANY_ID, nowIso, nowIso);
    expect(() => updatePaymentTerm(database, "omie_99", { name: "novo" })).toThrow(/OMIE/i);
  });

  it("migration purges OMIE-sourced conditions on upgrade", () => {
    // As condicoes vindas do OMIE devem estar ausentes apos as migracoes (soft delete v25).
    const rows = database
      .prepare("SELECT COUNT(*) AS c FROM payment_terms WHERE deleted_at IS NULL AND omie_code IS NOT NULL")
      .get() as { c: number };
    expect(rows.c).toBe(0);
  });
});
