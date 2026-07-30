import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { createCarrier, updateCarrier } from "./carriers";
import { createCustomer, updateCustomer } from "./customers";

describe("cadastro deduplication by document", () => {
  it("refuses a second customer with the same CNPJ", () => {
    const database = createDatabase();

    try {
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Apenas Teste LTDA",
        tradeName: "Apenas Teste",
        document: "26463463000183"
      });

      // Salvar o mesmo cadastro de novo criava um cliente identico na lista.
      expect(() =>
        createCustomer(database, {
          companyId: "company-1",
          legalName: "Apenas Teste LTDA",
          tradeName: "Apenas Teste",
          document: "26463463000183"
        })
      ).toThrow("Ja existe um cliente com este CNPJ/CPF");

      expect(customerCount(database)).toBe(1);
    } finally {
      database.close();
    }
  });

  it("matches the document ignoring the mask", () => {
    const database = createDatabase();

    try {
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Apenas Teste LTDA",
        tradeName: "Apenas Teste",
        document: "26.463.463/0001-83"
      });

      expect(() =>
        createCustomer(database, {
          companyId: "company-1",
          legalName: "Outro Nome LTDA",
          tradeName: "Outro Nome",
          document: "26463463000183"
        })
      ).toThrow("Ja existe um cliente");
    } finally {
      database.close();
    }
  });

  it("still allows customers without a document", () => {
    const database = createDatabase();

    try {
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Sem Documento A",
        tradeName: "Sem Documento A"
      });
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Sem Documento B",
        tradeName: "Sem Documento B"
      });

      expect(customerCount(database)).toBe(2);
    } finally {
      database.close();
    }
  });

  it("keeps a customer that already has a twin editable", () => {
    const database = createDatabase();

    try {
      const first = createCustomer(database, {
        companyId: "company-1",
        legalName: "Apenas Teste LTDA",
        tradeName: "Apenas Teste",
        document: "26463463000183"
      });
      // Duplicata que ja existia no banco antes da trava.
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, created_at, updated_at)
           VALUES ('duplicata', 'company-1', 'local', 'Apenas Teste LTDA', 'Apenas Teste', '26463463000183', ?, ?)`
        )
        .run("2026-07-30T12:00:00.000Z", "2026-07-30T12:00:00.000Z");

      // Documento inalterado: a edicao passa (senao o cadastro ficaria travado ate o
      // usuario apagar a copia).
      const updated = updateCustomer(database, first.id, {
        document: "26.463.463/0001-83",
        creditLimitCents: 2_000_000
      });
      expect(updated.credit_limit_cents).toBe(2_000_000);

      // Mudar para o documento de OUTRO cadastro continua bloqueado.
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, created_at, updated_at)
           VALUES ('outro', 'company-1', 'local', 'Outro LTDA', 'Outro', '11222333000144', ?, ?)`
        )
        .run("2026-07-30T12:00:00.000Z", "2026-07-30T12:00:00.000Z");
      expect(() => updateCustomer(database, first.id, { document: "11222333000144" })).toThrow(
        "Ja existe um cliente"
      );
    } finally {
      database.close();
    }
  });

  it("refuses a second carrier with the same CNPJ", () => {
    const database = createDatabase();

    try {
      createCarrier(database, {
        companyId: "company-1",
        name: "Transportes Alfa",
        document: "11222333000144"
      });

      expect(() =>
        createCarrier(database, {
          companyId: "company-1",
          name: "Transportes Alfa",
          document: "11.222.333/0001-44"
        })
      ).toThrow("Ja existe uma transportadora com este CNPJ/CPF");
    } finally {
      database.close();
    }
  });

  it("keeps creating the automatic default carrier, which has no document", () => {
    const database = createDatabase();

    try {
      // Duas "<cliente> (padrão)" sem documento nao podem colidir entre si.
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Cliente A LTDA",
        tradeName: "Cliente A",
        document: "26463463000183"
      });
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Cliente B LTDA",
        tradeName: "Cliente B",
        document: "11222333000144"
      });

      expect(
        database.prepare("SELECT COUNT(*) FROM carriers WHERE deleted_at IS NULL").pluck().get()
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("allows editing a carrier without touching its document", () => {
    const database = createDatabase();

    try {
      const carrier = createCarrier(database, {
        companyId: "company-1",
        name: "Transportes Alfa",
        document: "11222333000144"
      }) as { id: string };

      const updated = updateCarrier(database, carrier.id, {
        document: "11.222.333/0001-44",
        city: "Sorocaba"
      }) as { city: string };
      expect(updated.city).toBe("Sorocaba");
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return database;
}

function customerCount(database: DesktopDatabase): number {
  return database
    .prepare("SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL")
    .pluck()
    .get() as number;
}
