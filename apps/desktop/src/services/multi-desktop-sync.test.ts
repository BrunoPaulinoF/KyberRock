import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { enqueueSyncJob } from "./sync-queue";
import {
  listOperationsPendingCloudPush,
  processCloudSyncQueue,
  pullDesktopDataFromCloud,
  syncOperationToSupabase
} from "./supabase-sync";
import { listUnitDevices, upsertUnitDevices } from "./unit-devices";
import {
  createSimulatedWeighingOperation,
  listCanceledWeighingOperations,
  listClosedWeighingOperations,
  listOpenWeighingOperations
} from "./weighing-operations";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

/**
 * Valida o cenario multi-desktop de ponta a ponta no nivel dos servicos:
 * duas maquinas na mesma pedreira, cada uma com seu proprio dispositivo/cor,
 * enxergando e preservando o trabalho uma da outra via projecao cloud.
 */
describe("multi-desktop na mesma pedreira", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("atribui a operacao ao computador criador e expoe nome/cor para o contorno e a legenda", () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      // Espelho vindo de desktop-status/pull: a propria maquina + a outra da unidade.
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true },
        { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
      ]);

      createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      const [operation] = listOpenWeighingOperations(database);
      expect(operation).toMatchObject({
        deviceId: "desktop-a",
        deviceName: "Balanca 1",
        deviceColor: "#2563eb"
      });

      const legend = listUnitDevices(database, identity);
      expect(legend).toHaveLength(2);
      expect(legend.find((device) => device.id === "desktop-a")).toMatchObject({
        name: "Balanca 1",
        color: "#2563eb",
        isSelf: true
      });
      expect(legend.find((device) => device.id === "desktop-b")).toMatchObject({
        name: "Balanca 2",
        color: "#ea580c",
        isSelf: false
      });
    } finally {
      database.close();
    }
  });

  it("legenda resolve cor deterministica para dispositivo legado sem cor atribuida", () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-legacy", name: "Balanca antiga", color: null, is_active: true }
      ]);

      const legacy = listUnitDevices(database, identity).find(
        (device) => device.id === "desktop-legacy"
      );
      expect(legacy?.color).toMatch(/^#[0-9a-f]{6}$/i);
    } finally {
      database.close();
    }
  });

  it("push preserva o computador criador ao re-enviar operacao criada em outra maquina", async () => {
    // Maquina B sincroniza uma operacao criada pela maquina A (ex.: fechou a
    // saida de um caminhao que entrou pela outra balanca).
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true }
      ]);
      insertOperation(database, {
        id: "op-from-a",
        deviceId: "desktop-a",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      enqueueSyncJob(database, {
        id: "job-op-from-a",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "op-from-a",
        idempotencyKey: "cloud:operation:op-from-a",
        payload: { operationId: "op-from-a" }
      });

      const result = await processCloudSyncQueue(database, identity);

      expect(result.failed).toBe(0);
      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          operations: [expect.objectContaining({ id: "op-from-a", device_id: "desktop-a" })]
        })
      });
    } finally {
      database.close();
    }
  });

  it("push usa o dispositivo atual para ids puramente locais (modo emergencia)", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      // "setup-device" nao existe na nuvem; o payload cai para o dispositivo atual.
      database
        .prepare(
          `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, is_active, created_at, updated_at)
           VALUES ('setup-device', 'company-1', 'unit-1', 'Setup', 'desktop_scale', 'setup-install', 1, '2026-07-22T10:00:00.000Z', '2026-07-22T10:00:00.000Z')`
        )
        .run();
      insertOperation(database, {
        id: "op-emergency",
        deviceId: "setup-device",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      enqueueSyncJob(database, {
        id: "job-op-emergency",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "op-emergency",
        idempotencyKey: "cloud:operation:op-emergency",
        payload: { operationId: "op-emergency" }
      });

      await processCloudSyncQueue(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          operations: [expect.objectContaining({ id: "op-emergency", device_id: "desktop-b" })]
        })
      });
    } finally {
      database.close();
    }
  });

  it("pull espelha os dispositivos da unidade e traz operacoes das outras maquinas", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: {
          devices: [
            { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true },
            { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
          ],
          operations: [
            {
              id: "op-b1",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-b",
              status: "open",
              operation_type: "invoice",
              customer_name: "Cliente da B",
              product_description: "Areia",
              entry_weight_kg: 8_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.operations).toBe(1);
      const operation = listOpenWeighingOperations(database).find((op) => op.id === "op-b1");
      expect(operation).toMatchObject({
        deviceId: "desktop-b",
        deviceName: "Balanca 2",
        deviceColor: "#ea580c"
      });
      expect(
        listUnitDevices(database, identity).map((device) => device.id)
      ).toEqual(expect.arrayContaining(["desktop-a", "desktop-b"]));
    } finally {
      database.close();
    }
  });

  it("pull traz placa, motorista, cliente e produto da operacao da outra balanca", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: {
          devices: [{ id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }],
          // Cadastro compartilhado chega no mesmo pull: a placa da nuvem casa
          // com o veiculo local e a operacao fica vinculada ao cadastro.
          carriers: [
            {
              id: "carrier-1",
              name: "Transportes Serra",
              updated_at: "2026-07-22T10:00:00.000Z"
            }
          ],
          drivers: [
            { id: "driver-1", name: "Joao da Silva", updated_at: "2026-07-22T10:00:00.000Z" }
          ],
          vehicles: [
            {
              id: "vehicle-1",
              plate: "ABC1D23",
              carrier_id: "carrier-1",
              updated_at: "2026-07-22T10:00:00.000Z"
            }
          ],
          operations: [
            {
              id: "op-b1",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-b",
              status: "open",
              operation_type: "invoice",
              plate: "ABC1D23",
              driver_name: "Joao da Silva",
              customer_name: "Construtora Norte",
              product_description: "Brita 1",
              entry_weight_kg: 8_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      const operation = listOpenWeighingOperations(database).find((op) => op.id === "op-b1");
      expect(operation).toMatchObject({
        plate: "ABC1D23",
        driverName: "Joao da Silva",
        // Sem o cliente espelhado localmente, o texto da nuvem sustenta a tela.
        customerName: "Construtora Norte",
        productDescription: "Brita 1"
      });
      expect(
        database
          .prepare("SELECT vehicle_id, driver_id FROM weighing_operations WHERE id = 'op-b1'")
          .get()
      ).toMatchObject({ vehicle_id: "vehicle-1", driver_id: "driver-1" });
    } finally {
      database.close();
    }
  });

  it("pull traz o fechamento e o cancelamento feitos na outra balanca", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
      ]);
      insertOperation(database, {
        id: "op-to-close",
        deviceId: "desktop-b",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T11:00:00.000Z"
      });
      insertOperation(database, {
        id: "op-to-cancel",
        deviceId: "desktop-b",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T11:00:00.000Z"
      });
      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-to-close",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-b",
              status: "closed_local",
              operation_type: "invoice",
              exit_weight_kg: 5_000,
              net_weight_kg: 5_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            },
            {
              id: "op-to-cancel",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-b",
              status: "cancelled",
              operation_type: "invoice",
              cancel_reason: "Caminhao desistiu",
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:05:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(listOpenWeighingOperations(database)).toHaveLength(0);
      expect(listClosedWeighingOperations(database).map((op) => op.id)).toContain("op-to-close");
      expect(listCanceledWeighingOperations(database).map((op) => op.id)).toContain("op-to-cancel");
    } finally {
      database.close();
    }
  });

  it("pull nao deixa uma tabela quebrada derrubar o restante do lote", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      // Simula o que uma migracao local pendente provoca: a tabela de cupons
      // nao existe nesta maquina. Antes isso abortava a transacao inteira do
      // pull e a balanca ficava permanentemente cega para as operacoes da outra.
      database.exec("DROP TABLE print_receipts");
      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-good",
              company_id: "company-1",
              unit_id: "unit-1",
              status: "open",
              operation_type: "invoice",
              plate: "XYZ9A88",
              entry_weight_kg: 9_000,
              created_at: "2026-07-22T11:10:00.000Z",
              updated_at: "2026-07-22T11:10:00.000Z"
            }
          ],
          printReceipts: [
            {
              id: "receipt-1",
              operation_id: "op-good",
              unit_id: "unit-1",
              receipt_number: 1,
              printed_at: "2026-07-22T11:20:00.000Z",
              updated_at: "2026-07-22T11:20:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(listOpenWeighingOperations(database).map((op) => op.id)).toEqual(["op-good"]);
      expect(pulled.warnings.join(" ")).toContain("print_receipts");
    } finally {
      database.close();
    }
  });

  it("pull incremental pede so o que mudou desde o ciclo anterior", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: { serverTime: "2026-07-22T12:00:00.000Z" },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      invokeMock.mockResolvedValueOnce({ data: {}, error: null });
      await pullDesktopDataFromCloud(database, identity, { incremental: true });

      const body = invokeMock.mock.calls[1][1].body as Record<string, string>;
      expect(body.historySince).toBe(body.cadastroSince);
      expect(Date.parse(body.historySince)).toBeLessThan(Date.parse("2026-07-22T12:00:00.000Z"));
    } finally {
      database.close();
    }
  });

  it("reconciliacao reenvia o fechamento cujo job da fila morreu", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      // Fechada localmente e nunca confirmada na nuvem (job em dead_letter).
      insertOperation(database, {
        id: "op-closed-unsent",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:30:00.000Z"
      });
      // Ja confirmada: nao pode voltar para a fila a cada ciclo.
      insertOperation(database, {
        id: "op-already-sent",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:30:00.000Z"
      });
      database
        .prepare("UPDATE weighing_operations SET cloud_synced_at = ? WHERE id = 'op-already-sent'")
        .run("2026-07-22T12:31:00.000Z");

      const pending = listOperationsPendingCloudPush(
        database,
        new Date("2026-07-22T13:00:00.000Z")
      );
      expect(pending.map((item) => item.id)).toEqual(["op-closed-unsent"]);

      await syncOperationToSupabase(database, "op-closed-unsent", identity);
      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          operations: [expect.objectContaining({ id: "op-closed-unsent", status: "closed_local" })]
        })
      });

      // Confirmado o envio, a operacao sai da reconciliacao.
      expect(
        listOperationsPendingCloudPush(database, new Date("2026-07-22T13:00:00.000Z"))
      ).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("pull nao regride operacao fechada localmente com uma projecao atrasada da nuvem", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertOperation(database, {
        id: "op-closed-local",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:30:00.000Z"
      });
      // Projecao antiga: a nuvem ainda nao viu o fechamento desta maquina.
      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-closed-local",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "open",
              operation_type: "invoice",
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:05:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare("SELECT status FROM weighing_operations WHERE id = 'op-closed-local'")
          .pluck()
          .get()
      ).toBe("closed_local");
    } finally {
      database.close();
    }
  });

  it("pull nao sobrescreve versao local mais nova nem reabre solicitacao fechada", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      // Fecha a solicitacao localmente com timestamp mais novo que o da nuvem.
      database
        .prepare(
          "UPDATE loading_requests SET status = 'closed', updated_at = '2026-07-22T13:00:00.000Z' WHERE operation_id = ?"
        )
        .run(operation.id);
      const requestId = database
        .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
        .pluck()
        .get(operation.id) as string;

      invokeMock.mockResolvedValueOnce({
        data: {
          loadingRequests: [
            {
              id: requestId,
              operation_id: operation.id,
              company_id: "company-1",
              unit_id: "unit-1",
              status: "open",
              plate: "ABC1D23",
              customer_name: "Cliente Teste",
              driver_name: "Motorista Teste",
              product_description: "Brita 1",
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare("SELECT status FROM loading_requests WHERE id = ?")
          .pluck()
          .get(requestId)
      ).toBe("closed");
    } finally {
      database.close();
    }
  });
});

/** Cria o SQLite de uma maquina ja ativada na nuvem com o id de dispositivo dado. */
function createMachine(deviceId: string): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId,
    deviceName: `PC ${deviceId}`,
    installationId: `install-${deviceId}`,
    adoptDeviceId: true
  });
  const now = "2026-07-22T10:00:00.000Z";
  const settings: Array<[string, string]> = [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", deviceId],
    ["cloud_device_token", `token-${deviceId}`]
  ];
  for (const [key, value] of settings) {
    database
      .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), now);
  }
  return database;
}

function readIdentity(database: DesktopDatabase): LocalDesktopIdentity {
  const identity = database
    .prepare("SELECT value_json FROM local_settings WHERE key = 'active_device_id'")
    .pluck()
    .get() as string;
  return {
    companyId: "company-1",
    unitId: "unit-1",
    deviceId: JSON.parse(identity) as string,
    installationId: "install"
  };
}

function insertOperation(
  database: DesktopDatabase,
  input: { id: string; deviceId: string; status: string; updatedAt: string }
): void {
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type,
        entry_weight_kg, created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', ?, ?, 'invoice', 10000, '2026-07-22T11:00:00.000Z', ?)`
    )
    .run(input.id, input.deviceId, input.status, input.updatedAt);
}
