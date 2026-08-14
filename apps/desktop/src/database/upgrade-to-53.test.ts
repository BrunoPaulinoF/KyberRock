import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import {
  resolveCustomerFutureBillingNfe,
  setCustomerFutureBillingInvoice
} from "../services/customer-future-billing";

/**
 * O caminho de atualizacao real do release seguinte: a balanca esta na 52, com cadastro e
 * pesagens em uso, e o instalador novo sobe para a 53 — a tabela das notas de venda para
 * entrega futura. Os demais testes migram banco vazio.
 */
describe("atualizacao de um banco em uso (52 -> 53)", () => {
  it("aplica a migracao 53 sobre um banco com dados sem perder nada", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 52);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(52);
      seedCadastro(database);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(53);

      // Nada mudou para o operador: sem nota cadastrada, nenhuma pesagem sai carimbada.
      expect(resolveCustomerFutureBillingNfe(database, "cust-1", "prod-1")).toBeNull();
      expect(
        database.prepare("SELECT trade_name FROM customers WHERE id = 'cust-1'").pluck().get()
      ).toBe("Concessionaria");

      // E a tabela nova ja funciona no banco atualizado.
      setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345"
      });
      expect(resolveCustomerFutureBillingNfe(database, "cust-1", "prod-1")).toBe("12345");

      // A coluna do RETRATO na operacao nasce nula: a pesagem que ja estava fechada antes
      // da atualizacao nao entregou entrega futura nenhuma, e nao pode passar a citar uma
      // nota so porque o cadastro ganhou uma agora.
      expect(
        database
          .prepare("SELECT future_billing_nfe_number FROM weighing_operations WHERE id = 'op-1'")
          .pluck()
          .get()
      ).toBeNull();

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("os indices unicos impedem duas notas vigentes para o mesmo par", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedCadastro(database);
      const at = "2026-08-13T09:00:00.000Z";
      const insert = database.prepare(
        `INSERT INTO customer_future_billing_invoices
           (id, customer_id, product_id, nfe_number, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      );

      insert.run("fb-1", "cust-1", "prod-1", "111", at, at);
      expect(() => insert.run("fb-2", "cust-1", "prod-1", "222", at, at)).toThrow();

      // A nota "vale para qualquer produto" tambem e unica por cliente...
      insert.run("fb-3", "cust-1", null, "333", at, at);
      expect(() => insert.run("fb-4", "cust-1", null, "444", at, at)).toThrow();

      // ...mas nao conflita com a nota de um produto, nem com outro cliente.
      expect(() => insert.run("fb-5", "cust-1", "prod-2", "555", at, at)).not.toThrow();
      expect(() => insert.run("fb-6", "cust-2", "prod-1", "666", at, at)).not.toThrow();

      // E o soft delete libera o par para uma nota nova.
      database
        .prepare("UPDATE customer_future_billing_invoices SET deleted_at = ? WHERE id = 'fb-1'")
        .run(at);
      expect(() => insert.run("fb-7", "cust-1", "prod-1", "777", at, at)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("permite voltar para o build anterior: a tabela nova fica inerte", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedCadastro(database);
      setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345"
      });

      // O operador volta para o instalador anterior, que so conhece ate a 52:
      // runDesktopMigrations itera a PROPRIA lista, entao a 53 gravada em
      // schema_migrations e ignorada e a tabela extra nao atrapalha o build antigo,
      // que nunca a menciona.
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 52);
      expect(() => runDesktopMigrations(database, previous)).not.toThrow();
      expect(
        database.prepare("SELECT trade_name FROM customers WHERE id = 'cust-1'").pluck().get()
      ).toBe("Concessionaria");
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      database.close();
    }
  });

  it("aplica sobre um banco em ARQUIVO com WAL, como nas balancas", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-upgrade-53-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");

    try {
      let database = openDesktopDatabase({ databasePath });
      runDesktopMigrations(
        database,
        DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 52)
      );
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      seedCadastro(database);

      // Fecha e reabre, como o app faz entre um uso e o proximo.
      database.close();
      database = openDesktopDatabase({ databasePath });

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(53);
      setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345"
      });
      expect(resolveCustomerFutureBillingNfe(database, "cust-1", "prod-1")).toBe("12345");
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      database.close();
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

/** Cadastro de clientes e produtos, como a balanca tem antes de atualizar. */
function seedCadastro(database: DesktopDatabase): void {
  const identity = ensureInitialDesktopIdentity(database, {
    companyId: "c1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "u1",
    unitName: "Pedreira Principal",
    deviceId: "d1",
    deviceName: "PC Balanca",
    installationId: "i1"
  });
  const at = "2026-08-13T09:00:00.000Z";
  for (const [id, name] of [
    ["cust-1", "Concessionaria"],
    ["cust-2", "Construtora"]
  ]) {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
         VALUES (?, ?, 'local', ?, ?, 1, ?, ?)`
      )
      .run(id, identity.companyId, name, name, at, at);
  }
  for (const [id, code, description] of [
    ["prod-1", "P1", "Rachao"],
    ["prod-2", "P2", "Brita 1"]
  ]) {
    database
      .prepare(
        `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ton', ?, ?)`
      )
      .run(id, identity.companyId, code, description, at, at);
  }
  // Uma pesagem ja fechada antes da atualizacao.
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
          entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents, created_at, updated_at)
       VALUES ('op-1', ?, ?, ?, 'synced', 'invoice', 'cust-1', 'prod-1', 12000, 18500, 6500, 78000, ?, ?)`
    )
    .run(identity.companyId, identity.unitId, identity.deviceId, at, at);
}
