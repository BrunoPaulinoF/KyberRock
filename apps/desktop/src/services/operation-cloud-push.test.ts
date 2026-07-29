import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting } from "./local-settings";
import { writeStoredSupabaseConfig } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: { invoke: invokeMock }
  }))
}));

/**
 * Uma alteracao numa operacao aberta precisa sair desta maquina na hora.
 *
 * A varredura completa (`syncCloudNow`) e longa — fila cloud, fila OMIE,
 * cadastro compartilhado inteiro e pull — e desiste quando ja existe outra em
 * andamento. Enquanto o envio da operacao dependia so dela, a outra balanca da
 * pedreira ficava com a versao velha ate o proximo ciclo agendado (30 min).
 */
describe("envio imediato da operacao para a nuvem", () => {
  const tempDirectories: string[] = [];

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publica a operacao mesmo com uma varredura completa em andamento", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = runtime as unknown as {
        database: DesktopDatabase;
        cloudSyncInProgress: boolean;
        operationPushChain: Promise<void>;
      };
      insertOperation(internals.database, "op-1");
      // Varredura completa ocupada: antes, o envio desta alteracao era descartado.
      internals.cloudSyncInProgress = true;

      runtime.cancelWeighing("op-1", "Teste");
      await internals.operationPushChain;

      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          operations: [expect.objectContaining({ id: "op-1", status: "cancelled" })]
        })
      });
    } finally {
      runtime.close();
    }
  });

  it("guarda o pedido de varredura feito durante outra e roda ao terminar", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = runtime as unknown as {
        cloudSyncInProgress: boolean;
        cloudSyncRerunRequested: boolean;
      };
      internals.cloudSyncInProgress = true;

      const skipped = await runtime.syncCloudNow();
      expect(skipped.errors.join(" ")).toContain("nova passada");
      expect(internals.cloudSyncRerunRequested).toBe(true);

      // Ao terminar a varredura em andamento, o pedido guardado e consumido em
      // vez de esperar o proximo ciclo agendado.
      internals.cloudSyncInProgress = false;
      await runtime.syncCloudNow();
      expect(internals.cloudSyncRerunRequested).toBe(false);
      await flushPending();
    } finally {
      runtime.close();
    }
  });
});

function createRuntime(tempDirectories: string[]): DesktopRuntime {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-op-push-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const database = (runtime as unknown as { database: DesktopDatabase }).database;
  writeLocalSetting(database, "cloud_company_id", "company-1");
  writeLocalSetting(database, "cloud_unit_id", "unit-1");
  writeLocalSetting(database, "cloud_device_id", "device-1");
  writeLocalSetting(database, "cloud_device_token", "token-1");
  writeLocalSetting(database, "cloud_configured", true);
  writeLocalSetting(database, "last_license_check_at", new Date().toISOString());
  writeStoredSupabaseConfig(database, {
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test"
  });
  return runtime;
}

function insertOperation(database: DesktopDatabase, operationId: string): void {
  const at = "2026-07-22T11:00:00.000Z";
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'KyberRock', 'KyberRock', ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
       VALUES ('unit-1', 'company-1', 'Pedreira', 'America/Sao_Paulo', ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, is_active, created_at, updated_at)
       VALUES ('device-1', 'company-1', 'unit-1', 'Balanca 1', 'desktop_scale', 'install-1', 1, ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type,
        entry_weight_kg, created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', 'device-1', 'awaiting_exit', 'invoice', 10000, ?, ?)`
    )
    .run(operationId, at, at);
}

/** Deixa a re-execucao agendada em segundo plano terminar antes do teardown. */
async function flushPending(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
