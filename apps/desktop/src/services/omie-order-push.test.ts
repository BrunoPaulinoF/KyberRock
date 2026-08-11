import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting } from "./local-settings";
import { writeStoredSupabaseConfig } from "./supabase-sync";
import { enqueueSyncJob, getSyncJobById } from "./sync-queue";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: { invoke: invokeMock }
  }))
}));

/**
 * O pedido/OS do fechamento tem que sair na hora.
 *
 * A fila OMIE tem trava unica (o envio imediato do fechamento, a varredura cloud e a
 * sincronizacao OMIE disputam a mesma). Quando o envio imediato esbarrava nela, ele era
 * DESCARTADO em silencio: o fechamento so era pego na proxima varredura completa — ate
 * 30 minutos parado, com a operacao mostrando "sera enviado na proxima sincronizacao".
 */
describe("envio imediato do pedido ao OMIE", () => {
  const tempDirectories: string[] = [];

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { orderId: 9001 }, error: null });
  });

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("guarda o envio feito durante outra passada e roda ao terminar", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      insertBaseRows(internals.database);
      insertOperation(internals.database, "op-1");
      enqueueOmieJob(internals.database, "op-1");

      // Passada em andamento (ex.: a varredura de 30 min): o envio do fechamento
      // que chega agora nao pode ser jogado fora.
      internals.omieQueueProcessing = true;

      const skipped = await internals.runOmieQueue("op-1");
      expect(skipped).toBeNull();
      expect(internals.omieQueueRerunRequested).toBe(true);
      expect(invokeMock).not.toHaveBeenCalled();

      // Ao terminar a passada em andamento, o pedido guardado e consumido.
      internals.omieQueueProcessing = false;
      await internals.runOmieQueue();
      await flushPending();

      expect(internals.omieQueueRerunRequested).toBe(false);
      expect(invokeMock).toHaveBeenCalledWith(
        "omie-sync",
        expect.objectContaining({
          body: expect.objectContaining({ action: "create_order" })
        })
      );
      expect(getSyncJobById(internals.database, "job-op-1")?.status).toBe("done");
    } finally {
      runtime.close();
    }
  });

  it("envia o fechamento que chegou enquanto a passada anterior rodava", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      insertBaseRows(internals.database);
      insertOperation(internals.database, "op-1");
      insertOperation(internals.database, "op-2");
      enqueueOmieJob(internals.database, "op-1");

      // Segura o envio do op-1 para simular a passada longa em andamento.
      let releaseFirstCall: () => void = () => undefined;
      invokeMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstCall = () => resolve({ data: { orderId: 9001 }, error: null });
          })
      );

      const inFlight = internals.runOmieQueue();
      await flushPending();
      expect(invokeMock).toHaveBeenCalledTimes(1);

      // Fechamento do op-2 no meio da passada: hoje ele fica agendado em vez de sumir.
      enqueueOmieJob(internals.database, "op-2");
      expect(await internals.runOmieQueue("op-2")).toBeNull();

      releaseFirstCall();
      await inFlight;
      await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

      expect(getSyncJobById(internals.database, "job-op-2")?.status).toBe("done");
    } finally {
      runtime.close();
    }
  });

  it("nao chama a nuvem quando a fila nao tem job vencido", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      insertBaseRows(internals.database);

      const result = await internals.runOmieQueue();

      expect(result).toEqual({ processed: 0, failed: 0, errors: [] });
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });

  it("respeita o backoff: job com nova tentativa no futuro nao e drenado", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      insertBaseRows(internals.database);
      insertOperation(internals.database, "op-1");
      enqueueOmieJob(internals.database, "op-1", new Date(Date.now() + 60_000));

      expect(internals.hasRunnableOmieJobs()).toBe(false);
      await internals.runOmieQueue();

      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });
});

interface RuntimeInternals {
  database: DesktopDatabase;
  omieQueueProcessing: boolean;
  omieQueueRerunRequested: boolean;
  runOmieQueue(
    entityId?: string
  ): Promise<{ processed: number; failed: number; errors: string[] } | null>;
  hasRunnableOmieJobs(entityId?: string): boolean;
}

/** Mesmo objeto do runtime, so com a visao dos membros privados que o teste exercita. */
function asInternals(runtime: DesktopRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals;
}

function createRuntime(tempDirectories: string[]): DesktopRuntime {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-omie-push-"));
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

function insertBaseRows(database: DesktopDatabase): void {
  const at = "2026-08-11T09:00:00.000Z";
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
}

function insertOperation(database: DesktopDatabase, operationId: string): void {
  const at = "2026-08-11T09:00:00.000Z";
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type,
        entry_weight_kg, exit_weight_kg, created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', 'device-1', 'closed_local', 'invoice', 30000, 10000, ?, ?)`
    )
    .run(operationId, at, at);
}

function enqueueOmieJob(
  database: DesktopDatabase,
  operationId: string,
  nextAttemptAt?: Date
): void {
  enqueueSyncJob(database, {
    id: `job-${operationId}`,
    target: "omie",
    action: "create_order",
    entityType: "operation",
    entityId: operationId,
    idempotencyKey: `kyberrock:unit-1:${operationId}:create_sales_order`,
    payload: {
      operationId,
      operationType: "invoice",
      customerOmieId: 555,
      quantity: 20,
      unitPrice: 50,
      issueDate: "11/08/2026"
    },
    nextAttemptAt
  });
}

/** Deixa a re-execucao agendada em segundo plano terminar antes do teardown. */
async function flushPending(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
