import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import { findDuplicateCustomerCadastros } from "./customer-duplicates.js";

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(database);
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'Pedreira', 'Pedreira', datetime('now'), datetime('now'))`
    )
    .run();
  return database;
}

function insertCustomer(
  database: DesktopDatabase,
  row: {
    id: string;
    legalName: string;
    tradeName: string;
    document?: string | null;
    omieCustomerId?: number | null;
    deletedAt?: string | null;
  }
): void {
  database
    .prepare(
      `INSERT INTO customers
         (id, company_id, source, legal_name, trade_name, document, omie_customer_id,
          is_active, deleted_at, created_at, updated_at)
       VALUES (?, 'company-1', 'local', ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`
    )
    .run(
      row.id,
      row.legalName,
      row.tradeName,
      row.document ?? null,
      row.omieCustomerId ?? null,
      row.deletedAt ?? null
    );
}

describe("findDuplicateCustomerCadastros", () => {
  it("aponta o cadastro sem documento ao lado do gemeo que veio do OMIE", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "local-uuid",
        legalName: "Pedra Forte Mineracao LTDA",
        tradeName: "Pedra Forte"
      });
      insertCustomer(database, {
        id: "omie_777",
        legalName: "PEDRA FORTE MINERACAO LTDA",
        tradeName: "PEDRA FORTE",
        document: "26.463.463/0001-83",
        omieCustomerId: 777
      });

      const groups = findDuplicateCustomerCadastros(database, "company-1");

      expect(groups).toHaveLength(1);
      expect(groups[0].reason).toBe("nome-sem-documento");
      expect(groups[0].rows.map((row) => row.id).sort()).toEqual(["local-uuid", "omie_777"]);
    } finally {
      database.close();
    }
  });

  it("conta as pesagens penduradas em cada linha do par", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "local-uuid",
        legalName: "Pedra Forte Mineracao LTDA",
        tradeName: "Pedra Forte"
      });
      insertCustomer(database, {
        id: "omie_777",
        legalName: "Pedra Forte Mineracao LTDA",
        tradeName: "Pedra Forte",
        document: "26463463000183",
        omieCustomerId: 777
      });
      database.exec(
        `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
         VALUES ('unit-1', 'company-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'));
         INSERT INTO devices
           (id, company_id, unit_id, installation_id, name, device_type, created_at, updated_at)
         VALUES ('device-1', 'company-1', 'unit-1', 'inst-1', 'Balanca', 'desktop_scale',
                 datetime('now'), datetime('now'));`
      );
      const insertOperation = database.prepare(
        `INSERT INTO weighing_operations
           (id, company_id, unit_id, device_id, customer_id, status, operation_type,
            created_at, updated_at)
         VALUES (?, 'company-1', 'unit-1', 'device-1', ?, 'closed_local', 'invoice',
                 datetime('now'), datetime('now'))`
      );
      insertOperation.run("op-1", "local-uuid");
      insertOperation.run("op-2", "local-uuid");
      insertOperation.run("op-3", "omie_777");

      const [group] = findDuplicateCustomerCadastros(database, "company-1");
      const byId = new Map(group.rows.map((row) => [row.id, row]));

      expect(byId.get("local-uuid")?.operations).toBe(2);
      expect(byId.get("omie_777")?.operations).toBe(1);
    } finally {
      database.close();
    }
  });

  it("nao acusa matriz e filial: nomes iguais, os dois com documento", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "matriz",
        legalName: "Pedra Forte Mineracao LTDA",
        tradeName: "Pedra Forte",
        document: "26463463000183"
      });
      insertCustomer(database, {
        id: "filial",
        legalName: "Pedra Forte Mineracao LTDA",
        tradeName: "Pedra Forte",
        document: "26463463000264"
      });

      expect(findDuplicateCustomerCadastros(database, "company-1")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("acusa uma vez so o par que casa pelo nome fantasia E pela razao social", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "local-uuid",
        legalName: "Pedra Forte",
        tradeName: "Pedra Forte"
      });
      insertCustomer(database, {
        id: "omie_777",
        legalName: "Pedra Forte",
        tradeName: "Pedra Forte",
        document: "26463463000183",
        omieCustomerId: 777
      });

      expect(findDuplicateCustomerCadastros(database, "company-1")).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("ignora o cadastro ja excluido — ele nao aparece em tela nenhuma", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "local-uuid",
        legalName: "Pedra Forte",
        tradeName: "Pedra Forte",
        deletedAt: "2026-01-01T00:00:00.000Z"
      });
      insertCustomer(database, {
        id: "omie_777",
        legalName: "Pedra Forte",
        tradeName: "Pedra Forte",
        document: "26463463000183",
        omieCustomerId: 777
      });

      expect(findDuplicateCustomerCadastros(database, "company-1")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("aponta tambem o par que divide o CNPJ, que a migracao 39 deveria ter fundido", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "local-uuid",
        legalName: "Levisa Descartaveis LTDA",
        tradeName: "Levisa",
        document: "06020284000164"
      });
      insertCustomer(database, {
        id: "omie_888",
        legalName: "Levisa Descartaveis LTDA",
        tradeName: "Levisa",
        document: "06.020.284/0001-64",
        omieCustomerId: 888
      });

      const groups = findDuplicateCustomerCadastros(database, "company-1");

      expect(groups).toHaveLength(1);
      expect(groups[0].reason).toBe("documento");
    } finally {
      database.close();
    }
  });
});
