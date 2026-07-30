import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { createCustomer } from "./customers";
import {
  getCustomerDefaultCarrierId,
  isPlaceholderDefaultCarrierName,
  linkCustomerCarrier,
  listCarriersByCustomer,
  unlinkCustomerCarrier
} from "./customer-carriers";

describe("customer carriers", () => {
  it("promotes the linked carrier over the auto-created placeholder", () => {
    const database = createDatabase();

    try {
      // Cliente criado sem transportadora ganha a automatica "<cliente> (padrão)".
      const customer = createCustomer(database, {
        companyId: "company-1",
        legalName: "Apenas Teste LTDA",
        tradeName: "APENAS TESTE (NAO USAR)"
      });
      const placeholderId = customer.default_carrier_id;
      expect(placeholderId).toBeTruthy();

      const carrierId = insertCarrier(database, "Transportes Alfa");
      linkCustomerCarrier(database, customer.id, carrierId);

      // A vinculada assume o padrao: antes o cadastro (e a nova entrada) ficavam
      // presos no marcador "<cliente> (padrão)".
      expect(getCustomerDefaultCarrierId(database, customer.id)).toBe(carrierId);
      expect(
        database.prepare("SELECT needs_push FROM customers WHERE id = ?").pluck().get(customer.id)
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("never overwrites a default carrier chosen by the user", () => {
    const database = createDatabase();

    try {
      const chosenId = insertCarrier(database, "Transportes Escolhida");
      const customer = createCustomer(database, {
        companyId: "company-1",
        legalName: "Apenas Teste LTDA",
        tradeName: "Apenas Teste",
        defaultCarrierId: chosenId
      });

      const otherId = insertCarrier(database, "Transportes Outra");
      linkCustomerCarrier(database, customer.id, otherId);

      expect(getCustomerDefaultCarrierId(database, customer.id)).toBe(chosenId);
    } finally {
      database.close();
    }
  });

  it("falls back to another linked carrier when the default is unlinked", () => {
    const database = createDatabase();

    try {
      const customer = createCustomer(database, {
        companyId: "company-1",
        legalName: "Apenas Teste LTDA",
        tradeName: "Apenas Teste"
      });
      const firstId = insertCarrier(database, "Transportes Alfa");
      const secondId = insertCarrier(database, "Transportes Beta");
      linkCustomerCarrier(database, customer.id, firstId);
      linkCustomerCarrier(database, customer.id, secondId);
      expect(getCustomerDefaultCarrierId(database, customer.id)).toBe(firstId);

      unlinkCustomerCarrier(database, customer.id, firstId);
      // Padrao apontando para uma transportadora que o seletor nao lista mais
      // reintroduziria o bug: cai para a que sobrou.
      expect(getCustomerDefaultCarrierId(database, customer.id)).toBe(secondId);
      expect(listCarriersByCustomer(database, customer.id).map((c) => c.id)).toEqual([secondId]);

      unlinkCustomerCarrier(database, customer.id, secondId);
      expect(getCustomerDefaultCarrierId(database, customer.id)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("recognizes the placeholder name with or without accent", () => {
    expect(isPlaceholderDefaultCarrierName("Apenas Teste (padrão)", "Apenas Teste", null)).toBe(
      true
    );
    expect(isPlaceholderDefaultCarrierName("Apenas Teste (padrao)", "Apenas Teste", null)).toBe(
      true
    );
    // Casa tambem pela razao social, usada quando nao ha nome fantasia.
    expect(
      isPlaceholderDefaultCarrierName("Apenas Teste LTDA (padrao)", "", "Apenas Teste LTDA")
    ).toBe(true);
    // Transportadora de verdade nao e marcador, mesmo com nome parecido.
    expect(isPlaceholderDefaultCarrierName("Transportes Alfa", "Apenas Teste", null)).toBe(false);
    expect(isPlaceholderDefaultCarrierName("Outro Cliente (padrao)", "Apenas Teste", null)).toBe(
      false
    );
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

let carrierSeq = 0;

function insertCarrier(database: DesktopDatabase, name: string): string {
  carrierSeq += 1;
  const id = `carrier-${carrierSeq}`;
  const now = "2026-07-30T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
       VALUES (?, 'company-1', ?, 'local', 1, ?, ?)`
    )
    .run(id, name, now, now);
  return id;
}
