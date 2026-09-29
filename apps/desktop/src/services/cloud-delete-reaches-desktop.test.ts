import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { deleteCarrier } from "./carriers";
import { applyOmieReferenceData, upsertCloudCustomers } from "./supabase-sync";

/**
 * Excluir no site (ou em outra balanca) tem de tirar o cadastro DESTA balanca, e ele nao pode
 * voltar sozinho. Dois defeitos faziam isso falhar:
 *
 * 1. O tombstone da nuvem era barrado pela guarda `needs_push = 0`. Cliente com envio ao OMIE
 *    pendente — e o sem CPF/CNPJ fica pendente para sempre, porque o OMIE o recusa — nunca saia
 *    daqui ("teste sinc", 29/09/2026).
 * 2. A passada do OMIE gravava `deleted_at = NULL` em todo cliente que la continua cadastrado:
 *    o excluido voltava a cada sincronizacao completa (30 min).
 */
describe("exclusao feita no site chega na balanca e fica", () => {
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

  function cloudCustomer(overrides: Record<string, unknown> = {}) {
    return {
      id: "customer-1",
      legal_name: "teste sinc",
      trade_name: "teste sinc",
      document: null,
      is_active: true,
      deleted_at: null,
      created_at: "2026-09-29T11:24:25.021Z",
      updated_at: "2026-09-29T11:24:25.021Z",
      ...overrides
    };
  }

  function readCustomer(database: DesktopDatabase, id = "customer-1") {
    return database
      .prepare("SELECT deleted_at, needs_push FROM customers WHERE id = ?")
      .get(id) as { deleted_at: string | null; needs_push: number };
  }

  it("cliente com envio ao OMIE pendente (sem documento) sai quando o site exclui", () => {
    const database = createDatabase();
    upsertCloudCustomers(database, "company-1", [cloudCustomer()]);
    // Cadastro nascido aqui sem documento: o OMIE recusa e a marca de envio nunca baixa.
    database.prepare("UPDATE customers SET needs_push = 1 WHERE id = 'customer-1'").run();

    upsertCloudCustomers(database, "company-1", [
      cloudCustomer({
        is_active: false,
        deleted_at: "2026-09-29T11:58:39.324Z",
        updated_at: "2026-09-29T11:58:39.324Z"
      })
    ]);

    expect(readCustomer(database).deleted_at).toBe("2026-09-29T11:58:39.324Z");
    database.close();
  });

  it("exclusao local que ainda nao subiu continua protegida da linha viva da nuvem", () => {
    const database = createDatabase();
    upsertCloudCustomers(database, "company-1", [cloudCustomer()]);
    database
      .prepare(
        "UPDATE customers SET deleted_at = '2026-09-29T12:00:00.000Z', needs_push = 1 WHERE id = 'customer-1'"
      )
      .run();

    upsertCloudCustomers(database, "company-1", [cloudCustomer({ is_active: true })]);

    expect(readCustomer(database).deleted_at).toBe("2026-09-29T12:00:00.000Z");
    database.close();
  });

  it("cliente do OMIE excluido no site nao volta na passada do OMIE", () => {
    const database = createDatabase();
    const omiePass = () =>
      applyOmieReferenceData(database, "company-1", {
        customers: [
          {
            id: 4001,
            name: "CONSTRUTORA ALFA LTDA",
            tradeName: "Alfa",
            document: "12345678000190",
            email: null,
            phone: null,
            zipcode: null,
            addressStreet: null,
            addressNumber: null,
            neighborhood: null,
            city: null,
            state: null,
            defaultPaymentTermId: null
          }
        ]
      } as unknown as Parameters<typeof applyOmieReferenceData>[2]);

    omiePass();
    const id = (
      database.prepare("SELECT id FROM customers WHERE omie_customer_id = 4001").get() as {
        id: string;
      }
    ).id;
    expect(readCustomer(database, id).deleted_at).toBeNull();

    upsertCloudCustomers(database, "company-1", [
      cloudCustomer({
        id,
        legal_name: "CONSTRUTORA ALFA LTDA",
        trade_name: "Alfa",
        document: "12345678000190",
        omie_customer_id: 4001,
        is_active: false,
        deleted_at: "2026-09-29T12:10:00.000Z",
        updated_at: "2026-09-29T12:10:00.000Z"
      })
    ]);
    expect(readCustomer(database, id)).toEqual({
      deleted_at: "2026-09-29T12:10:00.000Z",
      needs_push: 1
    });

    omiePass();

    expect(readCustomer(database, id).deleted_at).toBe("2026-09-29T12:10:00.000Z");
    database.close();
  });

  it("cliente que o OMIE tirou (sem marca) continua voltando quando reaparece la", () => {
    const database = createDatabase();
    const pass = () =>
      applyOmieReferenceData(database, "company-1", {
        customers: [{ id: 4002, name: "BETA LTDA", tradeName: "Beta", document: "98765432000110" }]
      } as unknown as Parameters<typeof applyOmieReferenceData>[2]);
    pass();
    database
      .prepare(
        "UPDATE customers SET deleted_at = '2026-09-01T00:00:00.000Z', needs_push = 0 WHERE omie_customer_id = 4002"
      )
      .run();

    pass();

    expect(
      database
        .prepare("SELECT deleted_at FROM customers WHERE omie_customer_id = 4002")
        .pluck()
        .get()
    ).toBeNull();
    database.close();
  });

  it("transportadora excluida aqui fica com a marca que a segura contra o OMIE", () => {
    const database = createDatabase();
    database
      .prepare(
        `INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
         VALUES ('carrier-1', 'company-1', 'Trans X', 'omie', 1, datetime('now'), datetime('now'))`
      )
      .run();
    deleteCarrier(database, "carrier-1");
    const row = database
      .prepare("SELECT deleted_at, needs_push FROM carriers WHERE id = 'carrier-1'")
      .get() as { deleted_at: string | null; needs_push: number };
    expect(row.deleted_at).not.toBeNull();
    expect(row.needs_push).toBe(1);
    database.close();
  });
});
