import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { FinancialBlockService } from "./financial-block";

describe("FinancialBlockService", () => {
  function createDatabase() {
    const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
    runDesktopMigrations(db);
    return db;
  }

  function setupCompany(db: ReturnType<typeof createDatabase>) {
    db.prepare(`
      INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
      VALUES ('comp-1', 'Empresa', 'Empresa', datetime('now'), datetime('now'))
    `).run();
  }

  describe("canLoad", () => {
    it("allows loading when customer has no credit limit", () => {
      const db = createDatabase();

      try {
        setupCompany(db);
        db.prepare(`
          INSERT INTO customers (id, company_id, legal_name, trade_name, source, credit_limit_cents, open_receivables_cents, created_at, updated_at)
          VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', 'local', NULL, 0, datetime('now'), datetime('now'))
        `).run();

        const service = new FinancialBlockService(db);
        const result = service.canLoad("cust-1", 100_000);

        expect(result.allowed).toBe(true);
      } finally {
        db.close();
      }
    });

    it("allows loading when customer has zero credit limit", () => {
      const db = createDatabase();

      try {
        setupCompany(db);
        db.prepare(`
          INSERT INTO customers (id, company_id, legal_name, trade_name, source, credit_limit_cents, open_receivables_cents, created_at, updated_at)
          VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', 'local', 0, 0, datetime('now'), datetime('now'))
        `).run();

        const service = new FinancialBlockService(db);
        const result = service.canLoad("cust-1", 100_000);

        expect(result.allowed).toBe(true);
      } finally {
        db.close();
      }
    });

    it("allows loading when available credit is sufficient", () => {
      const db = createDatabase();

      try {
        setupCompany(db);
        db.prepare(`
          INSERT INTO customers (id, company_id, legal_name, trade_name, source, credit_limit_cents, open_receivables_cents, created_at, updated_at)
          VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', 'local', 1_000_000, 300_000, datetime('now'), datetime('now'))
        `).run();

        const service = new FinancialBlockService(db);
        const result = service.canLoad("cust-1", 100_000); // R$ 1.000,00

        expect(result.allowed).toBe(true);
      } finally {
        db.close();
      }
    });

    it("blocks loading when available credit is insufficient", () => {
      const db = createDatabase();

      try {
        setupCompany(db);
        db.prepare(`
          INSERT INTO customers (id, company_id, legal_name, trade_name, source, credit_limit_cents, open_receivables_cents, created_at, updated_at)
          VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', 'local', 500_000, 400_000, datetime('now'), datetime('now'))
        `).run();

        const service = new FinancialBlockService(db);
        const result = service.canLoad("cust-1", 200_000); // R$ 2.000,00

        expect(result.allowed).toBe(false);
        expect(result.message).toContain("Bloqueado");
      } finally {
        db.close();
      }
    });

    it("considers pending local operations in balance", () => {
      const db = createDatabase();

      try {
        setupCompany(db);

        db.prepare(`
          INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
          VALUES ('unit-1', 'comp-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))
        `).run();

        db.prepare(`
          INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
          VALUES ('dev-1', 'comp-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))
        `).run();

        db.prepare(`
          INSERT INTO customers (id, company_id, legal_name, trade_name, source, credit_limit_cents, open_receivables_cents, created_at, updated_at)
          VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', 'local', 1_000_000, 400_000, datetime('now'), datetime('now'))
        `).run();

        // Inserir operações pendentes
        db.prepare(`
          INSERT INTO weighing_operations (
            id, company_id, unit_id, device_id, status, operation_type, customer_id,
            product_total_cents, total_cents, created_at, updated_at
          ) VALUES (
            'op-1', 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'invoice', 'cust-1',
            150_000, 150_000, datetime('now'), datetime('now')
          )
        `).run();

        db.prepare(`
          INSERT INTO weighing_operations (
            id, company_id, unit_id, device_id, status, operation_type, customer_id,
            product_total_cents, total_cents, created_at, updated_at
          ) VALUES (
            'op-2', 'comp-1', 'unit-1', 'dev-1', 'draft', 'invoice', 'cust-1',
            150_000, 150_000, datetime('now'), datetime('now')
          )
        `).run();

        const service = new FinancialBlockService(db);
        const result = service.canLoad("cust-1", 350_000); // R$ 3.500,00

        // Limite: 10.000 | Receber: 4.000 | Pendentes: 3.000 | Atual: 3.500
        // Disponível: 10.000 - 4.000 - 3.000 = 3.000 < 3.500
        expect(result.allowed).toBe(false);
        expect(result.message).toContain("Bloqueado");
      } finally {
        db.close();
      }
    });
  });

  describe("getAvailableBalance", () => {
    it("returns full limit when no receivables or pending operations", () => {
      const db = createDatabase();

      try {
        setupCompany(db);
        db.prepare(`
          INSERT INTO customers (id, company_id, legal_name, trade_name, source, credit_limit_cents, open_receivables_cents, created_at, updated_at)
          VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', 'local', 1_000_000, 0, datetime('now'), datetime('now'))
        `).run();

        const service = new FinancialBlockService(db);
        const balance = service.getAvailableBalance("cust-1");

        expect(balance).toBe(1_000_000);
      } finally {
        db.close();
      }
    });
  });
});
