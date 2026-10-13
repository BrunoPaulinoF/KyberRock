import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { applyOmieReferenceData } from "./supabase-sync";

/**
 * O mesmo CNPJ com DOIS cadastros no OMIE: o antigo, bloqueado la para ninguem mais faturar, e o
 * novo, que fatura normalmente. Aqui a unificacao junta os dois num cliente so, e a passada do
 * OMIE gravava nele o que viesse por ultimo — inclusive o bloqueio do cadastro antigo. A balanca
 * recusava a pesagem ("Cliente bloqueado no OMIE nao pode iniciar pesagem") de um cliente que, no
 * OMIE, nao estava bloqueado (PACTOCRET, Pedreira Ibiuna, 13/10/2026: `omie_11455934512` vivo e
 * `omie_11490349076` unificado nele).
 */
describe("cliente com cadastro duplicado no OMIE", () => {
  const OLD_CODE = 11455934512;
  const NEW_CODE = 11490349076;
  const DOCUMENT = "11582513000174";

  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
      )
      .run();
    return database;
  }

  function omieCustomer(id: number, overrides: Record<string, unknown> = {}) {
    return {
      id,
      name: "PACTOCRET INDUSTRIA E COMERCIO DE ARTEFATOS DE CIMENTO LTDA",
      tradeName: "PACTOCRET INDUSTRIA E COMERCIO DE ARTEFATOS DE CIMENTO LTDA",
      document: "11.582.513/0001-74",
      email: null,
      phone: null,
      zipcode: null,
      addressStreet: null,
      addressNumber: null,
      neighborhood: null,
      city: null,
      state: null,
      defaultPaymentTermId: null,
      ...overrides
    };
  }

  function omiePass(database: DesktopDatabase, customers: Array<Record<string, unknown>>): void {
    applyOmieReferenceData(database, "company-1", { customers } as unknown as Parameters<
      typeof applyOmieReferenceData
    >[2]);
  }

  /** O estado depois da unificacao: a sobrevivente viva e a perdedora como tombstone. */
  function seedMergedPair(database: DesktopDatabase, survivorCode: number, loserCode: number) {
    const insert = database.prepare(
      `INSERT INTO customers (
         id, company_id, omie_customer_id, source, legal_name, trade_name, document,
         is_active, needs_push, created_at, updated_at, deleted_at
       ) VALUES (?, 'company-1', ?, 'omie', 'PACTOCRET', 'PACTOCRET', ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      "omie_11455934512",
      survivorCode,
      DOCUMENT,
      1,
      0,
      "2026-08-01T10:00:00.000Z",
      "2026-08-01T10:00:00.000Z",
      null
    );
    insert.run(
      "omie_11490349076",
      loserCode,
      DOCUMENT,
      0,
      1,
      "2026-09-01T10:00:00.000Z",
      "2026-09-29T16:37:39.636Z",
      "2026-09-29T16:37:39.636Z"
    );
  }

  function readSurvivor(database: DesktopDatabase) {
    return database
      .prepare(
        `SELECT omie_customer_id, omie_billing_blocked, is_active, deleted_at
         FROM customers WHERE id = 'omie_11455934512'`
      )
      .get() as {
      omie_customer_id: number;
      omie_billing_blocked: number;
      is_active: number;
      deleted_at: string | null;
    };
  }

  it.each([
    ["bloqueado primeiro", true],
    ["bloqueado por ultimo", false]
  ])(
    "o cadastro bloqueado no OMIE nao trava o cliente que fatura pelo outro (%s)",
    (_label, blockedFirst) => {
      const database = createDatabase();
      seedMergedPair(database, OLD_CODE, NEW_CODE);
      const blocked = omieCustomer(OLD_CODE, { billingBlocked: true });
      const released = omieCustomer(NEW_CODE, { billingBlocked: false });
      const page = blockedFirst ? [blocked, released] : [released, blocked];

      omiePass(database, page);
      omiePass(database, page);

      expect(readSurvivor(database)).toMatchObject({
        omie_customer_id: NEW_CODE,
        omie_billing_blocked: 0,
        is_active: 1,
        deleted_at: null
      });
      database.close();
    }
  );

  it("o duplicado bloqueado nao toma o lugar do cadastro que o cliente ja usa", () => {
    const database = createDatabase();
    seedMergedPair(database, NEW_CODE, OLD_CODE);
    // A perdedora some do caminho: o duplicado so chega a sobrevivente pelo documento.
    database.prepare("DELETE FROM customers WHERE id = 'omie_11490349076'").run();

    omiePass(database, [omieCustomer(OLD_CODE, { billingBlocked: true })]);

    expect(readSurvivor(database)).toMatchObject({
      omie_customer_id: NEW_CODE,
      omie_billing_blocked: 0
    });
    database.close();
  });

  it("o duplicado inativo no OMIE tambem nao inativa o cliente", () => {
    const database = createDatabase();
    seedMergedPair(database, NEW_CODE, OLD_CODE);
    database.prepare("DELETE FROM customers WHERE id = 'omie_11490349076'").run();

    omiePass(database, [omieCustomer(OLD_CODE, { isActive: false })]);

    expect(readSurvivor(database)).toMatchObject({ omie_customer_id: NEW_CODE, is_active: 1 });
    database.close();
  });

  it("o bloqueio do PROPRIO cadastro do cliente continua valendo", () => {
    const database = createDatabase();
    seedMergedPair(database, NEW_CODE, OLD_CODE);

    omiePass(database, [
      omieCustomer(OLD_CODE, { billingBlocked: true }),
      omieCustomer(NEW_CODE, { billingBlocked: true })
    ]);

    expect(readSurvivor(database)).toMatchObject({
      omie_customer_id: NEW_CODE,
      omie_billing_blocked: 1
    });
    database.close();
  });

  it("cliente recadastrado no OMIE passa para o codigo novo, como antes", () => {
    const database = createDatabase();
    seedMergedPair(database, OLD_CODE, NEW_CODE);
    database.prepare("DELETE FROM customers WHERE id = 'omie_11490349076'").run();

    // O codigo antigo nao existe mais la; so o novo chega.
    omiePass(database, [omieCustomer(NEW_CODE)]);

    expect(readSurvivor(database)).toMatchObject({
      omie_customer_id: NEW_CODE,
      omie_billing_blocked: 0
    });
    database.close();
  });
});
