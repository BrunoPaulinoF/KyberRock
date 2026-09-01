import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import {
  getCustomerFutureBillingInvoices,
  setCustomerFutureBillingInvoice
} from "./customer-future-billing";
import { enqueueSyncJob } from "./sync-queue";
import {
  listOperationsPendingCloudPush,
  processCloudSyncQueue,
  pullDesktopDataFromCloud,
  syncOperationToSupabase
} from "./supabase-sync";
import { listUnitDevices, pruneMissingUnitDevices, upsertUnitDevices } from "./unit-devices";
import { getWalletReport, reopenWalletOperations, settleWalletOperations } from "./wallet";
import {
  closeWeighingOperation,
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
      expect(listUnitDevices(database, identity).map((device) => device.id)).toEqual(
        expect.arrayContaining(["desktop-a", "desktop-b"])
      );
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

  it("entrega futura: a carga que saiu na outra balanca baixa o saldo da nota aqui", async () => {
    // O saldo da nota e o mesmo para a pedreira inteira. Se a retirada feita na balanca B
    // nao descontasse aqui, cada maquina ofereceria a mesma quantidade faturada ao seu
    // operador e o cliente levaria mais do que a nota cobre.
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertCadastro(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
      ]);
      const nota = setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345",
        totalWeightKg: 100_000
      });
      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-entrega-futura",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-b",
              status: "closed_local",
              operation_type: "invoice",
              customer_id: "cust-1",
              product_id: "prod-1",
              exit_weight_kg: 40_000,
              net_weight_kg: 28_000,
              future_billing_nfe_number: "12345",
              future_billing_invoice_id: nota.id,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      const [saldo] = getCustomerFutureBillingInvoices(database, "cust-1");
      expect(saldo.withdrawnWeightKg).toBe(28_000);
      expect(saldo.remainingWeightKg).toBe(72_000);
    } finally {
      database.close();
    }
  });

  it("entrega futura: a carga desta balanca leva a nota que baixou para a nuvem", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertCadastro(database);
      const nota = setCustomerFutureBillingInvoice(database, {
        customerId: "cust-1",
        productId: "prod-1",
        nfeNumber: "12345",
        totalWeightKg: 100_000
      });
      // Pesagem ja fechada citando a nota, como o fechamento grava.
      database
        .prepare(
          `INSERT INTO weighing_operations (
             id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
             entry_weight_kg, exit_weight_kg, net_weight_kg,
             future_billing_nfe_number, future_billing_invoice_id, created_at, updated_at
           ) VALUES ('op-entrega-futura', 'company-1', 'unit-1', ?, 'closed_local', 'invoice',
             'cust-1', 'prod-1', 12000, 40000, 28000, '12345', ?,
             '2026-07-22T11:00:00.000Z', '2026-07-22T12:00:00.000Z')`
        )
        .run(identity.deviceId, nota.id);
      invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });

      await syncOperationToSupabase(database, "op-entrega-futura", identity);

      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          operations: [
            expect.objectContaining({
              id: "op-entrega-futura",
              future_billing_nfe_number: "12345",
              future_billing_invoice_id: nota.id
            })
          ]
        })
      });
    } finally {
      database.close();
    }
  });

  it("carteira: a venda e o fechamento de uma balanca chegam na outra", async () => {
    // A carteira e da pedreira, nao do computador: a venda em carteira feita na
    // balanca A e o fechamento lancado nela tem de aparecer na balanca B.
    const machineA = createMachine("desktop-a");
    const machineB = createMachine("desktop-b");

    try {
      const identityA = readIdentity(machineA);
      const identityB = readIdentity(machineB);
      for (const database of [machineA, machineB]) {
        insertWalletPaymentMethods(database);
        upsertUnitDevices(database, readIdentity(database), [
          { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true },
          { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
        ]);
      }
      insertOperation(machineA, {
        id: "op-wallet",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      machineA
        .prepare(
          "UPDATE weighing_operations SET payment_method_id = 'pm-wallet', total_cents = 50000 WHERE id = ?"
        )
        .run("op-wallet");

      // A venda em aberto ja aparece na carteira da outra balanca.
      await syncOperationToSupabase(machineA, "op-wallet", identityA);
      await pullPushedOperation(machineB, identityB);
      const openOnB = getWalletReport(machineB, { status: "open" });
      expect(openOnB.summary.openCount).toBe(1);
      expect(openOnB.summary.openTotalCents).toBe(50_000);

      // Fechamento lancado na balanca A: a B passa a ver a venda como fechada.
      expect(
        settleWalletOperations(
          machineA,
          { operationIds: ["op-wallet"], settlementMethodId: "pm-pix", dueDate: "2026-08-10" },
          new Date("2026-07-22T13:00:00.000Z")
        )
      ).toBe(1);
      await syncOperationToSupabase(machineA, "op-wallet", identityA);
      await pullPushedOperation(machineB, identityB);

      const settledOnB = getWalletReport(machineB, { status: "settled" });
      expect(settledOnB.summary.settledCount).toBe(1);
      const operation = settledOnB.groups[0]?.operations[0];
      expect(operation?.settlementMethodName).toBe("PIX da Pedreira");
      expect(operation?.settlementDueDate).toBe("2026-08-10");
      expect(operation?.settledAt).not.toBeNull();
      expect(getWalletReport(machineB, { status: "open" }).summary.openCount).toBe(0);

      // Reabertura na balanca A tambem viaja: o nulo e informacao, nao ausencia.
      expect(
        reopenWalletOperations(machineA, ["op-wallet"], new Date("2026-07-22T14:00:00.000Z"))
      ).toBe(1);
      await syncOperationToSupabase(machineA, "op-wallet", identityA);
      await pullPushedOperation(machineB, identityB);
      expect(getWalletReport(machineB, { status: "open" }).summary.openCount).toBe(1);
      expect(getWalletReport(machineB, { status: "settled" }).summary.settledCount).toBe(0);
    } finally {
      machineA.close();
      machineB.close();
    }
  });

  it("carteira: venda da outra balanca aparece mesmo com a forma de pagamento gemea", async () => {
    // Cada computador semeia as formas padrao com um id proprio, entao a venda feita na
    // outra balanca aponta para a "Em carteira" DELA — um id que nunca entra aqui
    // (UNIQUE(company_id, code) mantem a forma local). Sem traduzir o id para a gemea
    // local a operacao chegava sem forma de pagamento e a venda sumia da Carteira.
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);

      invokeMock.mockResolvedValueOnce({
        data: {
          paymentMethods: [
            {
              id: "pm-wallet-da-balanca-a",
              company_id: "company-1",
              code: "CARTEIRA",
              name: "Em carteira",
              is_wallet: true,
              is_system: true,
              is_active: true,
              sort_order: 1,
              created_at: "2026-07-22T09:00:00.000Z",
              updated_at: "2026-07-22T09:00:00.000Z"
            }
          ],
          operations: [
            {
              id: "op-wallet",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "closed_local",
              operation_type: "invoice",
              customer_name: "Cliente da outra balanca",
              total_cents: 50_000,
              payment_method_id: "pm-wallet-da-balanca-a",
              wallet_settlement_method_id: null,
              wallet_settlement_due_date: null,
              wallet_settled_at: null,
              wallet_settlement_note: null,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      const report = getWalletReport(database, { status: "open" });
      expect(report.summary.openCount).toBe(1);
      expect(report.summary.openTotalCents).toBe(50_000);
      // A forma gravada e a desta maquina, nao o id que veio da outra.
      expect(
        database
          .prepare("SELECT payment_method_id FROM weighing_operations WHERE id = 'op-wallet'")
          .pluck()
          .get()
      ).toBe("pm-wallet");
    } finally {
      database.close();
    }
  });

  it("carteira: o abatimento do adiantamento chega junto com a venda da outra balanca", async () => {
    // A venda foi abatida do adiantamento na outra balanca. Sem projetar o abatimento, a
    // Carteira daqui cobraria os 500,00 inteiros de um cliente que ja pagou 300,00
    // adiantado — e o proximo fechamento reservaria de novo um adiantamento ja gasto.
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-wallet",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "closed_local",
              operation_type: "invoice",
              customer_name: "Cliente da outra balanca",
              total_cents: 50_000,
              payment_method_id: "pm-wallet",
              wallet_settlement_method_id: null,
              wallet_settlement_due_date: null,
              wallet_settled_at: null,
              wallet_settlement_note: null,
              settle_from_advance: true,
              omie_advance_settle_cents: 30_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      const report = getWalletReport(database, { status: "open" });
      expect(report.summary).toMatchObject({
        openCount: 1,
        openTotalCents: 20_000,
        advanceAppliedTotalCents: 30_000
      });
      expect(
        database
          .prepare("SELECT settle_from_advance FROM weighing_operations WHERE id = 'op-wallet'")
          .pluck()
          .get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("carteira: nuvem sem as colunas do adiantamento nao apaga o abatimento local", async () => {
    // Nuvem ainda sem a migracao: o pull devolve a operacao SEM as chaves. O valor local
    // e o unico que existe e precisa sobreviver — sobrescrever com zero faria a venda ja
    // paga pelo adiantamento voltar a ser cobranca.
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true }
      ]);
      insertOperation(database, {
        id: "op-wallet",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      database
        .prepare(
          `UPDATE weighing_operations
             SET total_cents = 50000, payment_method_id = 'pm-wallet',
                 settle_from_advance = 1, omie_advance_settle_cents = 30000
           WHERE id = 'op-wallet'`
        )
        .run();

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-wallet",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "closed_local",
              operation_type: "invoice",
              total_cents: 50_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T13:00:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare(
            "SELECT omie_advance_settle_cents FROM weighing_operations WHERE id = 'op-wallet'"
          )
          .pluck()
          .get()
      ).toBe(30_000);
      expect(getWalletReport(database, { status: "open" }).summary.openTotalCents).toBe(20_000);
    } finally {
      database.close();
    }
  });

  it("carteira: venda ja espelhada sem a forma de pagamento e completada no pull seguinte", async () => {
    // A venda foi espelhada aqui por uma versao que ainda nao trazia a carteira: ficou
    // com a forma de pagamento vazia e `updated_at` identico ao da nuvem. Como o empate
    // nao e "projecao mais nova", o valor nunca era preenchido e a venda ficava invisivel
    // para sempre nesta maquina. No empate a projecao preenche o que falta (e so isso).
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true }
      ]);
      insertOperation(database, {
        id: "op-wallet",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      database
        .prepare("UPDATE weighing_operations SET total_cents = 40000 WHERE id = 'op-wallet'")
        .run();
      expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(0);

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-wallet",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "closed_local",
              operation_type: "invoice",
              total_cents: 40_000,
              payment_method_id: "pm-wallet",
              wallet_settlement_method_id: null,
              wallet_settlement_due_date: null,
              wallet_settled_at: null,
              wallet_settlement_note: null,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("carteira: empate de updated_at nao apaga o fechamento lancado nesta maquina", async () => {
    // O outro lado do empate: a nuvem gravou a linha antes de ganhar as colunas (ou quem
    // enviou foi uma balanca de versao antiga) e o eco volta com os campos vazios. No
    // empate a projecao so preenche — nunca limpa o fechamento que acabou de ser lancado.
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);
      insertOperation(database, {
        id: "op-wallet",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      database
        .prepare(
          "UPDATE weighing_operations SET payment_method_id = 'pm-wallet', total_cents = 30000 WHERE id = ?"
        )
        .run("op-wallet");
      settleWalletOperations(
        database,
        { operationIds: ["op-wallet"], settlementMethodId: "pm-pix" },
        new Date("2026-07-22T13:00:00.000Z")
      );
      const localUpdatedAt = database
        .prepare("SELECT updated_at FROM weighing_operations WHERE id = 'op-wallet'")
        .pluck()
        .get() as string;

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-wallet",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "closed_local",
              operation_type: "invoice",
              total_cents: 30_000,
              payment_method_id: null,
              wallet_settlement_method_id: null,
              wallet_settlement_due_date: null,
              wallet_settled_at: null,
              wallet_settlement_note: null,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: localUpdatedAt
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      const report = getWalletReport(database, { status: "settled" });
      expect(report.summary.settledCount).toBe(1);
      expect(report.groups[0]?.operations[0]?.settlementMethodName).toBe("PIX da Pedreira");
    } finally {
      database.close();
    }
  });

  it("carteira: projecao antiga da nuvem nao apaga o fechamento desta maquina", async () => {
    // Enquanto a migracao da nuvem nao roda, a operacao volta do pull SEM as colunas
    // da carteira. Sobrescrever com nulo apagaria o fechamento que esta maquina
    // acabou de lancar — o valor local e o unico que existe.
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);
      insertOperation(database, {
        id: "op-wallet",
        deviceId: "desktop-a",
        status: "closed_local",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      database
        .prepare(
          "UPDATE weighing_operations SET payment_method_id = 'pm-wallet', total_cents = 30000 WHERE id = ?"
        )
        .run("op-wallet");
      settleWalletOperations(
        database,
        { operationIds: ["op-wallet"], settlementMethodId: "pm-pix" },
        new Date("2026-07-22T13:00:00.000Z")
      );

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-wallet",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "closed_local",
              operation_type: "invoice",
              total_cents: 30_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T13:30:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      const report = getWalletReport(database, { status: "settled" });
      expect(report.summary.settledCount).toBe(1);
      expect(report.groups[0]?.operations[0]?.settlementMethodName).toBe("PIX da Pedreira");
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

  it("pull tira da legenda o computador que a nuvem nao lista mais", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      // Ontem a unidade tinha tres maquinas; hoje o painel apagou a balanca de
      // teste. Ate aqui o espelho so somava e ela ficava na legenda para sempre.
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true },
        { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true },
        { id: "desktop-teste", name: "Desktop balanca", color: "#16a34a", is_active: true }
      ]);
      createSimulatedWeighingOperation(database, {
        identity: { ...identity, deviceId: "desktop-teste" },
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      invokeMock.mockResolvedValueOnce({
        data: {
          devices: [
            { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true },
            { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(listUnitDevices(database, identity).map((device) => device.id)).toEqual([
        "desktop-a",
        "desktop-b"
      ]);
      // A operacao que a balanca apagada deixou continua sabendo em que
      // computador foi feita: a remocao e logica, a FK segue de pe.
      const operation = listOpenWeighingOperations(database).find(
        (op) => op.deviceId === "desktop-teste"
      );
      expect(operation?.deviceName).toBe("Desktop balanca");
    } finally {
      database.close();
    }
  });

  it("pull devolve a legenda o computador que a nuvem voltou a listar", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", is_active: true },
        { id: "desktop-b", name: "Balanca 2", is_active: true }
      ]);

      invokeMock.mockResolvedValueOnce({
        data: { devices: [{ id: "desktop-a", name: "Balanca 1", is_active: true }] },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);
      expect(listUnitDevices(database, identity).map((device) => device.id)).toEqual(["desktop-a"]);

      invokeMock.mockResolvedValueOnce({
        data: {
          devices: [
            { id: "desktop-a", name: "Balanca 1", is_active: true },
            { id: "desktop-b", name: "Balanca 2", is_active: true }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(listUnitDevices(database, identity).map((device) => device.id)).toEqual([
        "desktop-a",
        "desktop-b"
      ]);
    } finally {
      database.close();
    }
  });

  it("pull nao mexe na legenda quando a nuvem avisou falha na consulta de dispositivos", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", is_active: true },
        { id: "desktop-b", name: "Balanca 2", is_active: true }
      ]);

      // Consulta dos dispositivos quebrada na nuvem: o que veio e um pedaco da
      // unidade, e um pedaco nunca pode apagar o resto da frota.
      invokeMock.mockResolvedValueOnce({
        data: {
          devices: [{ id: "desktop-a", name: "Balanca 1", is_active: true }],
          warnings: ["device_registrations: timeout (code=57014)"]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(listUnitDevices(database, identity).map((device) => device.id)).toEqual([
        "desktop-a",
        "desktop-b"
      ]);
    } finally {
      database.close();
    }
  });

  it("legenda intacta quando a lista da nuvem nao traz esta propria maquina", () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", is_active: true },
        { id: "desktop-b", name: "Balanca 2", is_active: true }
      ]);

      // Toda lista de unidade contem o dispositivo que a pediu. Sem ele, o que
      // chegou nao e a lista desta unidade — e nao se apaga nada por causa dela.
      const removed = pruneMissingUnitDevices(database, identity, [
        { id: "desktop-b", name: "Balanca 2", is_active: true }
      ]);

      expect(removed).toBe(0);
      expect(listUnitDevices(database, identity).map((device) => device.id)).toEqual([
        "desktop-a",
        "desktop-b"
      ]);
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

  it("troca de produto, cliente e transportadora na operacao aberta chega na outra balanca", async () => {
    // Cenario relatado na pedreira: a operacao ainda esta aberta e o operador
    // troca produto/cliente/transportadora numa balanca. Antes so produto e
    // cliente trafegavam — `carrier_id` nao existia na projecao da nuvem, entao
    // a transportadora nunca chegava, nem depois do fechamento.
    const origin = createMachine("desktop-a");
    const mirror = createMachine("desktop-b");

    try {
      const originIdentity = readIdentity(origin);
      const mirrorIdentity = readIdentity(mirror);
      for (const database of [origin, mirror]) {
        insertCadastro(database);
      }
      origin
        .prepare(
          `INSERT INTO weighing_operations (
            id, company_id, unit_id, device_id, status, operation_type,
            customer_id, product_id, carrier_id, entry_weight_kg, created_at, updated_at
          ) VALUES ('op-open', 'company-1', 'unit-1', 'desktop-a', 'loading_requested', 'invoice',
            'cust-1', 'prod-1', 'carr-1', 10000, '2026-07-22T11:00:00.000Z', '2026-07-22T11:00:00.000Z')`
        )
        .run();

      await syncOperationToSupabase(origin, "op-open", originIdentity);
      await pullPushedOperation(mirror, mirrorIdentity);

      expect(listOpenWeighingOperations(mirror)[0]).toMatchObject({
        customerName: "Cliente Um",
        productDescription: "Brita 1"
      });
      expect(readCarrierId(mirror, "op-open")).toBe("carr-1");

      origin
        .prepare(
          `UPDATE weighing_operations
           SET customer_id = 'cust-2', product_id = 'prod-2', carrier_id = 'carr-2',
               updated_at = '2026-07-22T11:30:00.000Z'
           WHERE id = 'op-open'`
        )
        .run();

      await syncOperationToSupabase(origin, "op-open", originIdentity);
      await pullPushedOperation(mirror, mirrorIdentity);

      expect(listOpenWeighingOperations(mirror)[0]).toMatchObject({
        customerName: "Cliente Dois",
        productDescription: "Po de Pedra"
      });
      expect(readCarrierId(mirror, "op-open")).toBe("carr-2");
    } finally {
      origin.close();
      mirror.close();
    }
  });

  it("pull limpa a transportadora quando a outra balanca passou para transporte proprio", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true }
      ]);
      insertCadastro(database);
      insertOperation(database, {
        id: "op-own-transport",
        deviceId: "desktop-a",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T11:00:00.000Z"
      });
      database
        .prepare(
          "UPDATE weighing_operations SET carrier_id = 'carr-1' WHERE id = 'op-own-transport'"
        )
        .run();

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-own-transport",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "open",
              operation_type: "invoice",
              carrier_id: null,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:30:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(readCarrierId(database, "op-own-transport")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("pull preserva o vinculo local quando o cadastro referenciado ainda nao chegou", async () => {
    // O cadastro compartilhado vem no mesmo pull, mas pode falhar por tabela.
    // Nesse caso apagar o vinculo deixaria a operacao pior do que estava.
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-a", name: "Balanca 1", color: "#2563eb", is_active: true }
      ]);
      insertCadastro(database);
      insertOperation(database, {
        id: "op-unknown-cadastro",
        deviceId: "desktop-a",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T11:00:00.000Z"
      });
      database
        .prepare(
          `UPDATE weighing_operations
           SET customer_id = 'cust-1', product_id = 'prod-1', carrier_id = 'carr-1'
           WHERE id = 'op-unknown-cadastro'`
        )
        .run();

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-unknown-cadastro",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "open",
              operation_type: "invoice",
              customer_id: "cust-nao-espelhado",
              product_id: "prod-nao-espelhado",
              carrier_id: "carr-nao-espelhado",
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:30:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare(
            "SELECT customer_id, product_id, carrier_id FROM weighing_operations WHERE id = 'op-unknown-cadastro'"
          )
          .get()
      ).toEqual({ customer_id: "cust-1", product_id: "prod-1", carrier_id: "carr-1" });
    } finally {
      database.close();
    }
  });

  it("pull nao apaga a forma de pagamento quando a nuvem devolve a linha sem ela", async () => {
    // Eco do proprio push: a projecao volta com o mesmo `updated_at` e sem a forma de
    // pagamento — e o que acontece quando a nuvem gravou a linha antes de ganhar a
    // coluna, ou quando quem enviou foi uma balanca de versao antiga. Aceitar esse
    // vazio apagava a forma escolhida na entrada, e a ficha da operacao passava a
    // mostrar "Forma de pagamento —" sozinha, no primeiro pull depois da entrada.
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertWalletPaymentMethods(database);
      insertOperation(database, {
        id: "op-forma",
        deviceId: "desktop-a",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T11:00:00.000Z"
      });
      database
        .prepare(
          "UPDATE weighing_operations SET payment_method_id = 'pm-pix' WHERE id = 'op-forma'"
        )
        .run();

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-forma",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "open",
              operation_type: "invoice",
              payment_method_id: null,
              wallet_settled_at: null,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(
        listOpenWeighingOperations(database).find((operation) => operation.id === "op-forma")
      ).toMatchObject({ paymentMethodId: "pm-pix", paymentMethodName: "PIX" });
    } finally {
      database.close();
    }
  });

  it("pull aceita a troca de forma de pagamento feita depois na outra balanca", async () => {
    // O outro lado da regra: quando a projecao e mais nova que a copia local, ela manda
    // — inclusive para limpar a forma de pagamento.
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      upsertUnitDevices(database, identity, [
        { id: "desktop-b", name: "Balanca 2", color: "#ea580c", is_active: true }
      ]);
      insertWalletPaymentMethods(database);
      insertOperation(database, {
        id: "op-trocada",
        deviceId: "desktop-b",
        status: "awaiting_exit",
        updatedAt: "2026-07-22T11:00:00.000Z"
      });
      database
        .prepare(
          "UPDATE weighing_operations SET payment_method_id = 'pm-pix' WHERE id = 'op-trocada'"
        )
        .run();

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-trocada",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-b",
              status: "open",
              operation_type: "invoice",
              payment_method_id: "pm-wallet",
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(
        listOpenWeighingOperations(database).find((operation) => operation.id === "op-trocada")
      ).toMatchObject({ paymentMethodId: "pm-wallet", paymentMethodName: "Em carteira" });
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
        database.prepare("SELECT status FROM loading_requests WHERE id = ?").pluck().get(requestId)
      ).toBe("closed");
    } finally {
      database.close();
    }
  });

  // O frete so vira valor no FECHAMENTO (precisa do peso liquido), entao a regra de
  // calculo precisa sobreviver a todos os pulls entre a entrada e a saida. Ela nao era
  // projetada: o pull devolvia a operacao sem `freight_json`, apagava a regra local e a
  // saida fechava com frete zero — sem linha FRETE no cupom e sem `valor_frete` no OMIE.
  it("a regra de frete da operacao aberta sobrevive ao pull e o fechamento cobra o frete", async () => {
    const machineA = createMachine("desktop-a");
    const machineB = createMachine("desktop-b");

    try {
      const identityA = readIdentity(machineA);
      const identityB = readIdentity(machineB);
      insertOperation(machineA, {
        id: "op-frete",
        deviceId: "desktop-a",
        status: "loading_requested",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      setOperationFreight(machineA, "op-frete", PER_TON_FREIGHT_RULE);

      await syncOperationToSupabase(machineA, "op-frete", identityA);
      const projected = lastPushedOperation();
      expect(projected).toMatchObject({
        id: "op-frete",
        freight_json: PER_TON_FREIGHT_RULE,
        freight_type: "fob"
      });

      // A MESMA projecao volta para as duas balancas: para a que registrou a entrada
      // ela e o eco do proprio push (mesmo `updated_at`), e para a outra e a operacao
      // da colega — nenhuma das duas pode perder a regra de frete no caminho.
      for (const [database, identity] of [
        [machineA, identityA],
        [machineB, identityB]
      ] as const) {
        invokeMock.mockResolvedValueOnce({ data: { operations: [projected] }, error: null });
        await pullDesktopDataFromCloud(database, identity);
      }

      for (const database of [machineA, machineB]) {
        expect(readFreightJson(database, "op-frete")).toBe(PER_TON_FREIGHT_RULE);
        // 20.000 kg de saida - 10.000 kg de entrada = 10 t x R$ 90,00/t = R$ 900,00.
        expect(
          closeWeighingOperation(database, { operationId: "op-frete", exitWeightKg: 20_000 })
            .freightTotalCents
        ).toBe(90_000);
      }
    } finally {
      machineA.close();
      machineB.close();
    }
  });

  // Migracao da nuvem ainda nao aplicada (ou push de uma balanca de versao antiga): a
  // operacao volta SEM a chave `freight_json`. Ausencia nao e "apagaram o frete".
  it("projecao sem a coluna de frete nao apaga a regra local", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertOperation(database, {
        id: "op-frete-legado",
        deviceId: "desktop-a",
        status: "loading_requested",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      setOperationFreight(database, "op-frete-legado", PER_TON_FREIGHT_RULE);

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-frete-legado",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "open",
              operation_type: "invoice",
              freight_type: "fob",
              entry_weight_kg: 10_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T12:00:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(readFreightJson(database, "op-frete-legado")).toBe(PER_TON_FREIGHT_RULE);
    } finally {
      database.close();
    }
  });

  // O contrario tambem precisa valer: quando a OUTRA balanca tira o frete da operacao,
  // a projecao mais nova chega com o campo vazio e essa remocao tem de valer aqui.
  it("projecao mais nova sem frete remove a regra local", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      insertOperation(database, {
        id: "op-frete-removido",
        deviceId: "desktop-a",
        status: "loading_requested",
        updatedAt: "2026-07-22T12:00:00.000Z"
      });
      setOperationFreight(database, "op-frete-removido", PER_TON_FREIGHT_RULE);

      invokeMock.mockResolvedValueOnce({
        data: {
          operations: [
            {
              id: "op-frete-removido",
              company_id: "company-1",
              unit_id: "unit-1",
              device_id: "desktop-a",
              status: "open",
              operation_type: "invoice",
              freight_json: null,
              freight_type: "none",
              entry_weight_kg: 10_000,
              created_at: "2026-07-22T11:00:00.000Z",
              updated_at: "2026-07-22T13:00:00.000Z"
            }
          ]
        },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(readFreightJson(database, "op-frete-removido")).toBeNull();
    } finally {
      database.close();
    }
  });
});

/** Regra de frete "por tonelada" a R$ 90,00/t, como o `freight_json` da operacao guarda. */
const PER_TON_FREIGHT_RULE = JSON.stringify({
  payer: "customer",
  rule: {
    id: "operation-freight",
    name: "Frete da operacao",
    type: "per_ton",
    baseValueCents: 9_000,
    unit: "ton"
  },
  destination: null,
  showOnReceipt: true
});

/** Lanca na operacao um frete "com valor na nota" (situacao 1). */
function setOperationFreight(
  database: DesktopDatabase,
  operationId: string,
  freightJson: string
): void {
  database
    .prepare("UPDATE weighing_operations SET freight_json = ?, freight_type = 'fob' WHERE id = ?")
    .run(freightJson, operationId);
}

function readFreightJson(database: DesktopDatabase, operationId: string): string | null {
  return (database
    .prepare("SELECT freight_json FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(operationId) ?? null) as string | null;
}

/** Ultima operacao que o push enviou para o desktop-sync. */
function lastPushedOperation(): Record<string, unknown> {
  const call = invokeMock.mock.calls.at(-1)?.[1] as {
    body: { operations: Array<Record<string, unknown>> };
  };
  return call.body.operations[0];
}

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

/** Cadastro minimo compartilhado pelas duas balancas (clientes/produtos/transportadoras). */
function insertCadastro(database: DesktopDatabase): void {
  const at = "2026-07-22T10:00:00.000Z";
  const customer = database.prepare(
    `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
     VALUES (?, 'company-1', 'local', ?, ?, ?, 1, ?, ?)`
  );
  const product = database.prepare(
    `INSERT INTO products (id, company_id, code, description, unit, is_active, created_at, updated_at)
     VALUES (?, 'company-1', ?, ?, 'KG', 1, ?, ?)`
  );
  const carrier = database.prepare(
    `INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
     VALUES (?, 'company-1', ?, 'local', 1, ?, ?)`
  );
  customer.run("cust-1", "Cliente Um", "Cliente Um", "cust-1", at, at);
  customer.run("cust-2", "Cliente Dois", "Cliente Dois", "cust-2", at, at);
  product.run("prod-1", "prod-1", "Brita 1", at, at);
  product.run("prod-2", "prod-2", "Po de Pedra", at, at);
  carrier.run("carr-1", "Transportadora Um", at, at);
  carrier.run("carr-2", "Transportadora Dois", at, at);
}

/** Formas de pagamento compartilhadas: uma "em carteira" e uma de recebimento. */
function insertWalletPaymentMethods(database: DesktopDatabase): void {
  const at = "2026-07-22T10:00:00.000Z";
  const method = database.prepare(
    `INSERT INTO payment_methods (id, company_id, code, name, alias, is_wallet, is_active, created_at, updated_at)
     VALUES (?, 'company-1', ?, ?, ?, ?, 1, ?, ?)`
  );
  method.run("pm-wallet", "CARTEIRA", "Em carteira", null, 1, at, at);
  // Apelido dado pela pedreira: e o rotulo que a Carteira exibe nas duas balancas.
  method.run("pm-pix", "PIX", "PIX", "PIX da Pedreira", 0, at, at);
}

/** Devolve para a outra maquina exatamente o payload que o ultimo push enviou. */
async function pullPushedOperation(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<void> {
  const body = invokeMock.mock.calls.at(-1)?.[1] as { body: { operations: unknown[] } };
  invokeMock.mockResolvedValueOnce({
    data: { operations: body.body.operations },
    error: null
  });
  await pullDesktopDataFromCloud(database, identity);
}

function readCarrierId(database: DesktopDatabase, operationId: string): string | null {
  return (database
    .prepare("SELECT carrier_id FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(operationId) ?? null) as string | null;
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
