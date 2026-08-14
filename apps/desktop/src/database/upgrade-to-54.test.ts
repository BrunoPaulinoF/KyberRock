import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import {
  getCustomerFutureBillingInvoices,
  resolveCustomerFutureBillingInvoice,
  setCustomerFutureBillingInvoice
} from "../services/customer-future-billing";

/**
 * O caminho de atualizacao real do release seguinte: a balanca esta na 53, ja com nota de
 * entrega futura cadastrada e carga entregue contra ela, e o instalador novo sobe para a 54 —
 * o saldo da nota. Os demais testes migram banco vazio.
 */
describe("atualizacao de um banco em uso (53 -> 54)", () => {
  it("a nota que ja estava em uso ganha saldo sem perder o que ja foi tirado", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 53);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(53);
      seedCadastro(database);
      // Cadastro e carga como a balanca na 53 tinha: a nota so com o numero, e a pesagem
      // fechada citando o numero (a coluna do vinculo ainda nao existia).
      const at = "2026-08-13T09:00:00.000Z";
      database
        .prepare(
          `INSERT INTO customer_future_billing_invoices
             (id, customer_id, product_id, nfe_number, is_active, created_at, updated_at)
           VALUES ('fb-1', 'cust-1', 'prod-1', '12345', 1, ?, ?)`
        )
        .run(at, at);
      database
        .prepare(
          "UPDATE weighing_operations SET future_billing_nfe_number = '12345' WHERE id = 'op-1'"
        )
        .run();

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(54);

      // A nota antiga fica SEM controle de saldo — ninguem digitou total nenhum — e
      // continua carimbando a proxima pesagem como carimbava antes da atualizacao.
      const [semControle] = getCustomerFutureBillingInvoices(database, "cust-1");
      expect(semControle.totalWeightKg).toBeNull();
      expect(semControle.remainingWeightKg).toBeNull();
      // Mas o que ja saiu ela ja sabe, pelo numero congelado na pesagem: 6.500 kg da op-1.
      expect(semControle.withdrawnWeightKg).toBe(6500);
      expect(resolveCustomerFutureBillingInvoice(database, "cust-1", "prod-1")?.nfeNumber).toBe(
        "12345"
      );

      // Informado o total, o saldo ja nasce descontado do que estava na rua.
      const comTotal = setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345",
        totalWeightKg: 100_000
      });
      expect(comTotal.id).toBe("fb-1");
      expect(comTotal.remainingWeightKg).toBe(93_500);

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("o mesmo produto passa a aceitar varias notas, mas nao a mesma duas vezes", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedCadastro(database);
      const at = "2026-08-14T09:00:00.000Z";
      const insert = database.prepare(
        `INSERT INTO customer_future_billing_invoices
           (id, customer_id, product_id, nfe_number, total_weight_kg, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      );

      // A fila de notas do mesmo produto: e o que a 54 veio permitir.
      insert.run("fb-1", "cust-1", "prod-1", "111", 30000, at, at);
      expect(() => insert.run("fb-2", "cust-1", "prod-1", "222", 30000, at, at)).not.toThrow();
      // Varias gerais do cliente tambem.
      insert.run("fb-3", "cust-1", null, "333", 30000, at, at);
      expect(() => insert.run("fb-4", "cust-1", null, "444", 30000, at, at)).not.toThrow();

      // O que continua barrado e a MESMA nota repetida no mesmo par (erro de digitacao,
      // que ofereceria a mesma quantidade faturada duas vezes ao operador).
      expect(() => insert.run("fb-5", "cust-1", "prod-1", "111", 30000, at, at)).toThrow();
      expect(() => insert.run("fb-6", "cust-1", null, "333", 30000, at, at)).toThrow();

      // O mesmo numero em outro produto, ou em outro cliente, e outra nota.
      expect(() => insert.run("fb-7", "cust-1", "prod-2", "111", 30000, at, at)).not.toThrow();
      expect(() => insert.run("fb-8", "cust-2", "prod-1", "111", 30000, at, at)).not.toThrow();

      // E o soft delete libera o numero para ser cadastrado de novo.
      database
        .prepare("UPDATE customer_future_billing_invoices SET deleted_at = ? WHERE id = 'fb-1'")
        .run(at);
      expect(() => insert.run("fb-9", "cust-1", "prod-1", "111", 30000, at, at)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("permite voltar para o build anterior: as colunas novas ficam inertes", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedCadastro(database);
      setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345",
        totalWeightKg: 100_000
      });

      // O instalador anterior so conhece ate a 53: runDesktopMigrations itera a PROPRIA
      // lista, entao a 54 gravada em schema_migrations e ignorada e o build antigo segue
      // carimbando a nota pelo numero, sem nunca mencionar total nem saldo.
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 53);
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
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-upgrade-54-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");

    try {
      let database = openDesktopDatabase({ databasePath });
      runDesktopMigrations(
        database,
        DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 53)
      );
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      seedCadastro(database);

      // Fecha e reabre, como o app faz entre um uso e o proximo.
      database.close();
      database = openDesktopDatabase({ databasePath });

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(54);
      const invoice = setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345",
        totalWeightKg: 50_000
      });
      expect(invoice.remainingWeightKg).toBe(50_000);
      expect(resolveCustomerFutureBillingInvoice(database, "cust-1", "prod-1")?.id).toBe(
        invoice.id
      );
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
