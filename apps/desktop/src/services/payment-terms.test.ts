import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  createPaymentTerm,
  deletePaymentTerm,
  listOmiePaymentTerms,
  listPaymentTerms,
  provisionPaymentTermsFromOmieMirror,
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
      .prepare(
        "SELECT COUNT(*) AS c FROM payment_terms WHERE deleted_at IS NULL AND omie_code IS NOT NULL"
      )
      .get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it("stores and preserves the OMIE parcela code (with leading zeros)", () => {
    const term = createPaymentTerm(database, {
      companyId: COMPANY_ID,
      name: "A prazo 30",
      condition: "Para 30 dias",
      omieParcelaCode: "030"
    });
    expect(term.omie_parcela_code).toBe("030");

    const cleared = updatePaymentTerm(database, term.id, { omieParcelaCode: null });
    expect(cleared.omie_parcela_code).toBeNull();

    const relinked = updatePaymentTerm(database, term.id, { omieParcelaCode: "  000  " });
    expect(relinked.omie_parcela_code).toBe("000");
  });

  it("lists active OMIE payment terms for linking", () => {
    const nowIso = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO omie_payment_terms (id, company_id, omie_id, code, description, installment_count, is_active, visible, created_at, updated_at)
         VALUES ('omie_parcela_000', ?, 0, '000', 'A vista', 1, 1, 1, ?, ?),
                ('omie_parcela_030', ?, 30, '030', '30 dias', 1, 1, 1, ?, ?),
                ('omie_parcela_060', ?, 60, '060', 'Inativa', 2, 0, 1, ?, ?)`
      )
      .run(COMPANY_ID, nowIso, nowIso, COMPANY_ID, nowIso, nowIso, COMPANY_ID, nowIso, nowIso);

    const options = listOmiePaymentTerms(database, COMPANY_ID);
    expect(options.map((o) => o.code)).toEqual(["000", "030"]);
    expect(options[0].description).toBe("A vista");
  });

  it("materializes OMIE mirror parcelas as selectable local terms (idempotent)", () => {
    const nowIso = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO omie_payment_terms (id, company_id, omie_id, code, description, installment_count, installment_days_json, is_active, visible, created_at, updated_at)
         VALUES ('omie_parcela_212', ?, 212, '212', '7/14/21', 3, '[7,14,21]', 1, 1, ?, ?),
                ('omie_parcela_090', ?, 90, '090', 'Inativa', 1, NULL, 0, 1, ?, ?)`
      )
      .run(COMPANY_ID, nowIso, nowIso, COMPANY_ID, nowIso, nowIso);

    const created = provisionPaymentTermsFromOmieMirror(database, COMPANY_ID);
    expect(created).toBe(1);

    const terms = listPaymentTerms(database, COMPANY_ID);
    const provisioned = terms.find((t) => t.omie_parcela_code === "212");
    expect(provisioned).toBeDefined();
    expect(provisioned!.name).toBe("7/14/21");
    expect(JSON.parse(provisioned!.installment_days_json!)).toEqual([7, 14, 21]);
    expect(JSON.parse(provisioned!.rules_json).raw).toBe("7/14/21");
    // Parcela inativa nao vira condicao local.
    expect(terms.some((t) => t.omie_parcela_code === "090")).toBe(false);

    // Idempotente: nada novo na segunda rodada.
    expect(provisionPaymentTermsFromOmieMirror(database, COMPANY_ID)).toBe(0);

    // Exclusao do operador e respeitada: nao recria o termo apagado.
    deletePaymentTerm(database, provisioned!.id);
    expect(provisionPaymentTermsFromOmieMirror(database, COMPANY_ID)).toBe(0);
  });
});
