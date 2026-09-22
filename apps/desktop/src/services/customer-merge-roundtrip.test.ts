/**
 * A unificacao sobrevive ao pull — que e o defeito de verdade deste conserto.
 *
 * Os testes de `customer-merge.test.ts` provam que a unificacao junta certo; os de
 * `shared-cadastro-sync.test.ts`, que o tombstone sobe e desce. Falta o encontro dos dois, que e
 * onde a limpeza morria antes: a migracao local 39 unificava o par e o ciclo seguinte trazia a
 * perdedora de volta viva, porque a nuvem nao tinha como dizer "excluido".
 *
 * O caso aqui e o real, com os dados do par que o operador viu na tela: "MORAES - AREIA E PEDRA
 * LTDA" com duas linhas (a local, criada 01/08 as 12:44, e a que voltou do OMIE as 13:50), mesmo
 * CNPJ com mascaras diferentes, mesmo codigo OMIE, 23 pesagens numa e 2 na outra.
 */
import { describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { mergeDuplicateCustomersByDocument } from "./customer-merge";
import { pullDesktopDataFromCloud } from "./supabase-sync";

const invokeMock = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ functions: { invoke: invokeMock } }))
}));

const KEEPER = "04bc46fc-8c4d-4150-8e04-1d1551f207c9";
const LOSER = "omie_11489145762";

describe("unificacao que sobrevive ao pull (par MORAES)", () => {
  it("unifica na abertura e nao volta no pull seguinte", async () => {
    const database = createMachine();
    try {
      const identity = readIdentity(database);
      insertMoraes(database, identity.companyId);
      for (let i = 0; i < 23; i++)
        insertOperation(database, `op-k-${i}`, KEEPER, identity.companyId);
      for (let i = 0; i < 2; i++) insertOperation(database, `op-l-${i}`, LOSER, identity.companyId);

      // 1. Abertura do programa.
      const merged = mergeDuplicateCustomersByDocument(database, identity.companyId);
      expect(merged).toHaveLength(1);
      expect(merged[0].keeperId).toBe(KEEPER);
      expect(merged[0].counts.operations).toBe(2);
      expect(countOperations(database, KEEPER)).toBe(25);
      expect(countOperations(database, LOSER)).toBe(0);
      expect(isDeleted(database, LOSER)).toBe(true);
      expect(isDeleted(database, KEEPER)).toBe(false);

      // 2. Pull seguinte com a nuvem JA migrada (a perdedora chega com tombstone).
      invokeMock.mockResolvedValue({
        data: {
          customers: [
            cloudRow(KEEPER, "61241889000193", { isActive: true, deletedAt: null }),
            cloudRow(LOSER, "61.241.889/0001-93", {
              isActive: false,
              deletedAt: "2026-09-22T12:43:51.373Z"
            })
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(isDeleted(database, LOSER)).toBe(true);
      expect(isDeleted(database, KEEPER)).toBe(false);
      expect(countOperations(database, KEEPER)).toBe(25);

      /*
       * 3. E com a nuvem AINDA sem a migracao aplicada — a janela entre o instalador chegar na
       * balanca e a migracao rodar. La a perdedora volta so com `is_active = false`, sem
       * `deleted_at`, e era exatamente esse payload que ressuscitava o duplicado.
       */
      invokeMock.mockResolvedValue({
        data: {
          customers: [
            cloudRow(KEEPER, "61241889000193", { isActive: true, deletedAt: null }),
            cloudRow(LOSER, "61.241.889/0001-93", { isActive: false, deletedAt: undefined })
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(isDeleted(database, LOSER)).toBe(true);
      expect(isDeleted(database, KEEPER)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("a segunda abertura nao mexe em nada", () => {
    const database = createMachine();
    try {
      const identity = readIdentity(database);
      insertMoraes(database, identity.companyId);
      expect(mergeDuplicateCustomersByDocument(database, identity.companyId)).toHaveLength(1);
      expect(mergeDuplicateCustomersByDocument(database, identity.companyId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

function cloudRow(
  id: string,
  document: string,
  options: { isActive: boolean; deletedAt?: string | null }
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id,
    legal_name: "MORAES - AREIA E PEDRA LTDA",
    trade_name: "MORAES - AREIA E PEDRA LTDA",
    document,
    omie_customer_id: 11489145762,
    email: "escritorio.simaolopes@gmail.com",
    is_active: options.isActive,
    created_at: "2026-08-01T12:44:48.330Z",
    updated_at: "2026-09-22T12:43:51.373Z"
  };
  if (options.deletedAt !== undefined) row.deleted_at = options.deletedAt;
  return row;
}

function insertMoraes(database: DesktopDatabase, companyId: string): void {
  const insert = database.prepare(
    `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document,
       omie_customer_id, omie_integration_code, sync_status, needs_push, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'MORAES - AREIA E PEDRA LTDA', 'MORAES - AREIA E PEDRA LTDA', ?, 11489145762,
             'KRR7SUMV5GYZX7', 'synced', 0, 1, ?, ?)`
  );
  insert.run(
    KEEPER,
    companyId,
    "local",
    "61241889000193",
    "2026-08-01T12:44:48.330Z",
    "2026-09-22T08:51:23.337Z"
  );
  insert.run(
    LOSER,
    companyId,
    "omie",
    "61.241.889/0001-93",
    "2026-08-01T13:50:15.173Z",
    "2026-08-03T11:55:56.208Z"
  );
}

function insertOperation(
  database: DesktopDatabase,
  id: string,
  customerId: string,
  companyId: string
): void {
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, customer_id, created_at, updated_at)
       VALUES (?, ?, 'unit-1', 'device-1', 'synced', 'invoice', ?, ?, ?)`
    )
    .run(id, companyId, customerId, "2026-08-12T10:00:00.000Z", "2026-08-12T10:00:00.000Z");
}

function countOperations(database: DesktopDatabase, customerId: string): number {
  return database
    .prepare("SELECT COUNT(*) FROM weighing_operations WHERE customer_id = ?")
    .pluck()
    .get(customerId) as number;
}

function isDeleted(database: DesktopDatabase, id: string): boolean {
  const row = database.prepare("SELECT deleted_at FROM customers WHERE id = ?").get(id) as {
    deleted_at: string | null;
  };
  return row.deleted_at !== null;
}

function createMachine(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "Pedreira Ibiuna",
    unitId: "unit-1",
    unitName: "Pedreira",
    deviceId: "device-1",
    deviceName: "PC PRINCIPAL",
    installationId: "install-1",
    adoptDeviceId: true
  });
  const now = "2026-09-22T10:00:00.000Z";
  for (const [key, value] of [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", "device-1"],
    ["cloud_device_token", "token-1"]
  ] as Array<[string, string]>) {
    database
      .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), now);
  }
  return database;
}

function readIdentity(database: DesktopDatabase): LocalDesktopIdentity {
  const deviceId = database
    .prepare("SELECT value_json FROM local_settings WHERE key = 'active_device_id'")
    .pluck()
    .get() as string;
  return {
    companyId: "company-1",
    companyLegalName: "Pedreira Ibiuna",
    unitId: "unit-1",
    unitName: "Pedreira",
    deviceId: JSON.parse(deviceId) as string,
    deviceName: "PC PRINCIPAL",
    installationId: "install-1"
  } as LocalDesktopIdentity;
}
