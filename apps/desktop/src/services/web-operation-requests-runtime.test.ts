import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import type { LocalDesktopIdentity } from "./bootstrap";
import { writeLocalSetting } from "./local-settings";
import { configureReceiptPrintProfile } from "./printing";
import { DesktopRuntime } from "./runtime";
import { writeStoredSupabaseConfig } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: { invoke: invokeMock }
  }))
}));

type Pending = { id: string; kind: string; operationId: string; payload: Record<string, unknown> };

/**
 * O caminho inteiro de um pedido do site dentro da balanca executora: a nuvem entrega o pedido
 * (`desktop-operation-requests` claim), a balanca registra pelas MESMAS funcoes do botao e
 * devolve o resultado (report). A nuvem aqui e um `invoke` de mentira que so fala esse
 * protocolo; o resto (SQLite, preco, cupom) e o de verdade.
 */
describe("pedidos de pesagem do site executados pela balanca", () => {
  const tempDirectories: string[] = [];
  let queue: Pending[] = [];
  let reports: Array<Record<string, unknown>> = [];
  let executor = true;

  beforeEach(() => {
    queue = [];
    reports = [];
    executor = true;
    invokeMock.mockReset();
    invokeMock.mockImplementation(
      async (name: string, options: { body: Record<string, unknown> }) => {
        if (name !== "desktop-operation-requests") return { data: { ok: true }, error: null };
        if (options.body.action === "claim") {
          const requests = executor ? queue.splice(0) : [];
          return { data: { ok: true, executor, requests }, error: null };
        }
        reports.push(...((options.body.results as Array<Record<string, unknown>>) ?? []));
        return { data: { ok: true }, error: null };
      }
    );
  });

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("registra a entrada com o peso digitado e o id do pedido; fecha e imprime o cupom", async () => {
    const { runtime, database, printed } = createRuntime(tempDirectories);
    try {
      seedCatalog(database);
      queue.push({
        id: "req-entry",
        kind: "entry",
        operationId: "11111111-1111-4111-8111-111111111111",
        payload: {
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          operationType: "invoice",
          entryWeightKg: 15_000
        }
      });
      await run(runtime);

      expect(reports[0]).toMatchObject({ id: "req-entry", status: "done" });
      const opened = database
        .prepare("SELECT id, status, entry_weight_kg FROM weighing_operations")
        .all() as Array<Record<string, unknown>>;
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({
        id: "11111111-1111-4111-8111-111111111111",
        entry_weight_kg: 15_000
      });
      // A auditoria diz de onde veio o peso: digitado no site, nao lido da balanca.
      const audit = database
        .prepare("SELECT after_json FROM audit_logs WHERE action = 'entry_weight_captured'")
        .pluck()
        .get();
      expect(String(audit)).toContain("WEB:15000");

      queue.push({
        id: "req-exit",
        kind: "exit",
        operationId: "11111111-1111-4111-8111-111111111111",
        payload: { exitWeightKg: 40_000 }
      });
      await run(runtime);

      expect(reports[1]).toMatchObject({
        id: "req-exit",
        status: "done",
        printStatus: "printed",
        result: expect.objectContaining({ netWeightKg: 25_000, exitWeightKg: 40_000 })
      });
      // 2 vias: o padrao do perfil.
      expect(printed).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });

  it("executar o mesmo pedido de novo nao cria um segundo caminhao nem imprime de novo", async () => {
    const { runtime, database, printed } = createRuntime(tempDirectories);
    try {
      seedCatalog(database);
      const entry: Pending = {
        id: "req-entry",
        kind: "entry",
        operationId: "22222222-2222-4222-8222-222222222222",
        payload: {
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          entryWeightKg: 15_000
        }
      };
      const exit: Pending = {
        id: "req-exit",
        kind: "exit",
        operationId: entry.operationId,
        payload: { exitWeightKg: 40_000 }
      };
      queue.push(entry, exit);
      await run(runtime);
      // A resposta se perdeu e a nuvem devolveu os dois pedidos para a fila.
      queue.push(entry, exit);
      await run(runtime);

      expect(database.prepare("SELECT COUNT(*) FROM weighing_operations").pluck().get()).toBe(1);
      expect(reports.map((report) => report.status)).toEqual(["done", "done", "done", "done"]);
      expect(String(reports[3].message)).toContain("ja estava fechada");
      expect(reports[3].printStatus).toBe("skipped");
      expect(printed).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });

  it("devolve a mesma recusa que o desktop mostraria (placa ja no patio)", async () => {
    const { runtime, database } = createRuntime(tempDirectories);
    try {
      seedCatalog(database);
      const base = {
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 15_000
      };
      queue.push(
        {
          id: "r1",
          kind: "entry",
          operationId: "33333333-3333-4333-8333-333333333333",
          payload: base
        },
        {
          id: "r2",
          kind: "entry",
          operationId: "44444444-4444-4444-8444-444444444444",
          payload: base
        }
      );
      await run(runtime);
      expect(reports[0]).toMatchObject({ id: "r1", status: "done" });
      expect(reports[1]).toMatchObject({ id: "r2", status: "failed" });
      expect(String(reports[1].message)).toContain("Ja existe uma operacao aberta");
    } finally {
      runtime.close();
    }
  });

  it("cancela pelo site e registra quem pediu no motivo", async () => {
    const { runtime, database } = createRuntime(tempDirectories);
    try {
      seedCatalog(database);
      const operationId = "55555555-5555-4555-8555-555555555555";
      queue.push({
        id: "r1",
        kind: "entry",
        operationId,
        payload: {
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          entryWeightKg: 15_000
        }
      });
      await run(runtime);
      queue.push({
        id: "r2",
        kind: "cancel",
        operationId,
        payload: { reason: "placa errada" }
      });
      (queue[0] as Pending & { requestedByName?: string }).requestedByName = "Rafaela";
      await run(runtime);
      const row = database
        .prepare("SELECT status, cancel_reason FROM weighing_operations WHERE id = ?")
        .get(operationId) as { status: string; cancel_reason: string };
      expect(row.status).toBe("cancelled");
      expect(row.cancel_reason).toContain("placa errada");
      expect(row.cancel_reason).toContain("Rafaela");
    } finally {
      runtime.close();
    }
  });

  it("dinheiro parcelado e recusado com a mesma mensagem do desktop", async () => {
    const { runtime, database } = createRuntime(tempDirectories);
    try {
      seedCatalog(database);
      const at = "2026-09-25T09:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, is_system, created_at, updated_at)
           VALUES ('pm-cash-test', 'company-1', 'cash', 'Dinheiro', 1, ?, ?)
           ON CONFLICT DO NOTHING`
        )
        .run(at, at);
      const cashId = database
        .prepare("SELECT id FROM payment_methods WHERE company_id = 'company-1' AND code = 'cash'")
        .pluck()
        .get() as string;
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, created_at, updated_at)
           VALUES ('term-7-14-21', 'company-1', '7/14/21', '{"raw":"7/14/21"}', ?, ?)`
        )
        .run(at, at);
      queue.push({
        id: "r1",
        kind: "entry",
        operationId: "66666666-6666-4666-8666-666666666666",
        payload: {
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          paymentMethodId: cashId,
          paymentTermId: "term-7-14-21",
          entryWeightKg: 15_000
        }
      });
      await run(runtime);
      expect(reports[0]).toMatchObject({ id: "r1", status: "failed" });
      expect(String(reports[0].message)).toContain("Dinheiro so aceita pagamento a vista");
      expect(database.prepare("SELECT COUNT(*) FROM weighing_operations").pluck().get()).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("alteracao de preco que chega depois do fechamento e recusada, sem aplicar metade", async () => {
    const { runtime, database } = createRuntime(tempDirectories);
    try {
      seedCatalog(database);
      const operationId = "77777777-7777-4777-8777-777777777777";
      queue.push(
        {
          id: "r1",
          kind: "entry",
          operationId,
          payload: {
            customerId: "customer-1",
            vehicleId: "vehicle-1",
            driverId: "driver-1",
            productId: "product-1",
            entryWeightKg: 15_000
          }
        },
        { id: "r2", kind: "exit", operationId, payload: { exitWeightKg: 40_000 } },
        {
          id: "r3",
          kind: "update",
          operationId,
          payload: { unitPriceCents: 9900, productId: "product-1" }
        }
      );
      await run(runtime);
      expect(reports[2]).toMatchObject({ id: "r3", status: "failed" });
      expect(String(reports[2].message)).toContain("foi fechada antes");
      const price = database
        .prepare("SELECT unit_price_cents FROM weighing_operations WHERE id = ?")
        .pluck()
        .get(operationId);
      expect(price).toBe(12000);
    } finally {
      runtime.close();
    }
  });

  it("balanca que nao e a executora pergunta e depois fica quieta", async () => {
    const { runtime } = createRuntime(tempDirectories);
    try {
      executor = false;
      await run(runtime);
      await run(runtime);
      const claims = invokeMock.mock.calls.filter(
        ([name, options]) =>
          name === "desktop-operation-requests" &&
          (options as { body: { action: string } }).body.action === "claim"
      );
      expect(claims).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });
});

type RuntimeInternals = {
  database: DesktopDatabase;
  runWebOperationRequests: () => Promise<void>;
};

function run(runtime: DesktopRuntime): Promise<void> {
  return (runtime as unknown as RuntimeInternals).runWebOperationRequests();
}

function createRuntime(tempDirectories: string[]) {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-web-ops-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const database = (runtime as unknown as RuntimeInternals).database;
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
  // O perfil de impressao e do dispositivo que a balanca realmente usa.
  configureReceiptPrintProfile(database, {
    identity: (
      runtime as unknown as { ensureIdentity: () => LocalDesktopIdentity }
    ).ensureIdentity(),
    windowsPrinterName: "TERMICA-80"
  });
  const printed: unknown[] = [];
  runtime.setReceiptPrinter({
    printReceipt: async (document: unknown) => {
      printed.push(document);
    }
  });
  return { runtime, database, printed };
}

/** Cadastro minimo e completo para o OMIE: cliente, produto com preco, placa e motorista. */
function seedCatalog(database: DesktopDatabase): void {
  const at = "2026-09-25T09:00:00.000Z";
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
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, document, email,
        zipcode, address_street, address_number, neighborhood, city, state,
        omie_customer_id, created_at, updated_at
      ) VALUES ('customer-1', 'company-1', 'omie', 'Cliente Teste LTDA', 'Cliente Teste',
                '12345678000195', 'cliente@example.com',
                '18150-000', 'Rua das Pedras', '123', 'Centro', 'Ibiuna', 'SP', 4242, ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      "INSERT INTO vehicles (id, company_id, plate, created_at, updated_at) VALUES ('vehicle-1', 'company-1', 'ABC1D23', ?, ?)"
    )
    .run(at, at);
  database
    .prepare(
      "INSERT INTO drivers (id, company_id, name, created_at, updated_at) VALUES ('driver-1', 'company-1', 'Motorista Teste', ?, ?)"
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO products (
        id, company_id, omie_product_id, code, description, unit, unit_price_cents, item_type, created_at, updated_at
      ) VALUES ('product-1', 'company-1', 123, 'BRITA1', 'Brita 1', 'ton', 12000, '04 - Produtos Acabados', ?, ?)`
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO product_default_prices (
        id, company_id, product_id, unit_price_cents, unit, created_at, updated_at
      ) VALUES ('default-price-1', 'company-1', 'product-1', 12000, 'ton', ?, ?)`
    )
    .run(at, at);
}
