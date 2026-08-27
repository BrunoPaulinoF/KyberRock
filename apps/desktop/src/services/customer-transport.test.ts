import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { createCarrier } from "./carriers";
import {
  addCustomerPlate,
  clearCustomerOwnCarrier,
  getCustomerTransport,
  removeCustomerPlate,
  setCustomerDefaultFreightModality,
  useCustomerOwnCarrier
} from "./customer-transport";
import { listVehiclesByCustomer } from "./customer-vehicles";

const COMPANY = "company-1";

/**
 * Aba Transporte do cadastro do cliente: as placas dele, como o frete costuma sair e o
 * transporte proprio (a transportadora que E o cliente).
 */
describe("transporte do cliente", () => {
  it("cadastra a placa junto com o vinculo, e a mesma placa nao entra duas vezes", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { id: "cust-1", name: "Pavimentadora Sete Voltas" });

      const first = addCustomerPlate(database, COMPANY, "cust-1", "hji-0517");
      // A placa e comparavel sem traco e em maiusculas: e o mesmo caminhao.
      const second = addCustomerPlate(database, COMPANY, "cust-1", "HJI0517");

      expect(first.plate).toBe("HJI-0517");
      expect(second.id).toBe(first.id);
      expect(listVehiclesByCustomer(database, "cust-1")).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("desvincula a placa sem apagar o cadastro do veiculo", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { id: "cust-1", name: "Pavimentadora Sete Voltas" });
      const plate = addCustomerPlate(database, COMPANY, "cust-1", "HJI0517");

      removeCustomerPlate(database, "cust-1", plate.id);

      expect(listVehiclesByCustomer(database, "cust-1")).toEqual([]);
      // O caminhao continua cadastrado: ele roda para outros clientes.
      expect(
        database.prepare("SELECT deleted_at FROM vehicles WHERE id = ?").pluck().get(plate.id)
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  // Placa desvinculada e vinculada de novo e a rotina de quem troca de caminhao: o
  // tombstone do vinculo antigo nao pode travar o indice unico.
  it("aceita vincular de novo uma placa que foi retirada", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { id: "cust-1", name: "Pavimentadora Sete Voltas" });
      const plate = addCustomerPlate(database, COMPANY, "cust-1", "HJI0517");
      removeCustomerPlate(database, "cust-1", plate.id);

      const again = addCustomerPlate(database, COMPANY, "cust-1", "HJI0517");

      expect(again.id).toBe(plate.id);
      expect(listVehiclesByCustomer(database, "cust-1")).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("no transporte proprio, cria a transportadora com o nome e o documento do cliente", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "cust-1",
        name: "Pavimentadora Sete Voltas",
        document: "11222333000155"
      });

      const result = useCustomerOwnCarrier(database, COMPANY, "cust-1");

      expect(result.created).toBe(true);
      const carrier = database
        .prepare("SELECT name, document FROM carriers WHERE id = ?")
        .get(result.carrierId) as { name: string; document: string | null };
      expect(carrier.name).toBe("Pavimentadora Sete Voltas");
      expect(carrier.document).toBe("11222333000155");

      const transport = getCustomerTransport(database, COMPANY, "cust-1");
      expect(transport.isOwnTransport).toBe(true);
      expect(transport.defaultCarrierId).toBe(result.carrierId);
      expect(transport.carriers.map((entry) => entry.id)).toContain(result.carrierId);
    } finally {
      database.close();
    }
  });

  /**
   * O criterio e o DOCUMENTO, o mesmo do OMIE (find-or-create por CNPJ/CPF): criar outra
   * linha com o mesmo documento viraria o mesmo cadastro la, e duas transportadoras iguais
   * aqui.
   */
  it("reaproveita a transportadora que ja tem o CNPJ do cliente, em vez de criar outra", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "cust-1",
        name: "Pavimentadora Sete Voltas",
        document: "11.222.333/0001-55"
      });
      const existing = createCarrier(database, {
        companyId: COMPANY,
        name: "SETE VOLTAS TRANSPORTES",
        document: "11222333000155"
      }) as { id: string };

      const result = useCustomerOwnCarrier(database, COMPANY, "cust-1");

      expect(result.created).toBe(false);
      expect(result.carrierId).toBe(existing.id);
      expect(
        database.prepare("SELECT COUNT(*) FROM carriers WHERE deleted_at IS NULL").pluck().get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("desligar o transporte proprio devolve o cliente a outra transportadora vinculada", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, {
        id: "cust-1",
        name: "Pavimentadora Sete Voltas",
        document: "11222333000155"
      });
      const outra = createCarrier(database, {
        companyId: COMPANY,
        name: "Transportes Alfa",
        document: "99888777000166"
      }) as { id: string };
      database
        .prepare(
          `INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('link-1', 'cust-1', ?, 1, ?, ?)`
        )
        .run(outra.id, "2026-08-27T10:00:00.000Z", "2026-08-27T10:00:00.000Z");
      useCustomerOwnCarrier(database, COMPANY, "cust-1");

      clearCustomerOwnCarrier(database, COMPANY, "cust-1");

      const transport = getCustomerTransport(database, COMPANY, "cust-1");
      expect(transport.isOwnTransport).toBe(false);
      expect(transport.defaultCarrierId).toBe(outra.id);
    } finally {
      database.close();
    }
  });

  it("guarda o tipo de frete padrao e recusa valor que a tela nao sabe desenhar", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { id: "cust-1", name: "Pavimentadora Sete Voltas" });

      expect(setCustomerDefaultFreightModality(database, "cust-1", "cif")).toBe("cif");
      expect(getCustomerTransport(database, COMPANY, "cust-1").defaultFreightModality).toBe("cif");

      expect(setCustomerDefaultFreightModality(database, "cust-1", "qualquer-coisa")).toBeNull();
      expect(getCustomerTransport(database, COMPANY, "cust-1").defaultFreightModality).toBeNull();
    } finally {
      database.close();
    }
  });

  // A edicao do cadastro tem de subir para as outras balancas: o `needs_push` e o que faz
  // o cliente entrar na proxima passada do sync.
  it("marca o cliente para sincronizar ao mudar o frete padrao", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { id: "cust-1", name: "Pavimentadora Sete Voltas" });
      database.prepare("UPDATE customers SET needs_push = 0 WHERE id = 'cust-1'").run();

      setCustomerDefaultFreightModality(database, "cust-1", "cif");

      expect(
        database.prepare("SELECT needs_push FROM customers WHERE id = 'cust-1'").pluck().get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: COMPANY,
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return database;
}

function insertCustomer(
  database: DesktopDatabase,
  input: { id: string; name: string; document?: string }
): void {
  const now = "2026-08-27T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
       VALUES (?, ?, 'local', ?, ?, ?, 1, ?, ?)`
    )
    .run(input.id, COMPANY, input.name, input.name, input.document ?? null, now, now);
}
