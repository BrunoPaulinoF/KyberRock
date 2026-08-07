import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScaleReading } from "@kyberrock/scale-adapters";
import type { DesktopDatabase } from "../database/sqlite";
import { CreditService } from "./credit";
import { writeLocalSetting } from "./local-settings";
import { DesktopRuntime } from "./runtime";
import { OMIE_ADVANCES_STATE_KEY, writeStoredSupabaseConfig } from "./supabase-sync";
import { getWalletReport } from "./wallet";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: { invoke: invokeMock }
  }))
}));

/**
 * O adiantamento e lancado no OMIE pelo financeiro e so existe na balanca depois de
 * espelhado. Enquanto isso dependia da varredura agendada, o cliente que "deixou pago"
 * de manha e voltou para retirar a carga podia ser abatido contra um saldo velho — ou
 * contra saldo nenhum — e a venda inteira caia na carteira, cobrando de quem ja pagou.
 *
 * Por isso a pesagem de uma venda em carteira marcada para abater confere o
 * adiantamento DAQUELE cliente no OMIE, na entrada e no fechamento. Estes testes
 * prendem as tres decisoes: que a conferencia acontece, que ela e best-effort (a
 * balanca e offline-first) e que ela nao pode adiantar o cursor da varredura completa.
 */
describe("conferencia do adiantamento na pesagem", () => {
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

  it("confere o adiantamento do cliente no OMIE ao capturar o peso de entrada", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      seedCatalog(internals.database);

      await runtime.startWeighing({
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "pm-wallet",
        settleFromAdvance: true,
        scaleCaptureId: stageCapture(runtime, "entry", 12_000)
      });

      // Mira o cliente da entrada, e so ele: o resto do tenant fica para a varredura.
      expect(advancePullPayloads()).toEqual([
        expect.objectContaining({ customerOmieCode: 4242, page: 1 })
      ]);
    } finally {
      runtime.close();
    }
  });

  it("confere de novo no fechamento e abate o adiantamento que chegou nesse meio tempo", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      seedCatalog(internals.database);

      const operation = await runtime.startWeighing({
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "pm-wallet",
        settleFromAdvance: true,
        scaleCaptureId: stageCapture(runtime, "entry", 12_000)
      });
      // Na entrada o cliente ainda nao tinha adiantamento espelhado.
      expect(
        new CreditService(internals.database).getAdvanceAvailableToSettleCents("customer-1")
      ).toBe(0);

      // O financeiro lanca os 1.000,00 no OMIE enquanto o caminhao carrega: a
      // conferencia do fechamento e que traz esse dinheiro para ca.
      invokeMock.mockResolvedValueOnce({
        data: {
          advances: 1,
          imported: 1,
          finished: true,
          movements: [advanceMovement(100_000)]
        },
        error: null
      });

      const closed = await runtime.closeWeighing(
        operation.id,
        "invoice",
        stageCapture(runtime, "exit", 18_500)
      );

      // 780,00 de compra abatidos do adiantamento que acabou de chegar.
      expect(closed).toMatchObject({ totalCents: 78_000, advanceAppliedCents: 78_000 });
      expect(getWalletReport(internals.database, { status: "open" }).summary.openCount).toBe(0);
      expect(advancePullPayloads()).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });

  it("nao confere nada quando a venda em carteira nao foi marcada para abater", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      seedCatalog(internals.database);

      const operation = await runtime.startWeighing({
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "pm-wallet",
        scaleCaptureId: stageCapture(runtime, "entry", 12_000)
      });
      await runtime.closeWeighing(operation.id, "invoice", stageCapture(runtime, "exit", 18_500));

      // Sem a marca a pesagem nao para para falar com o OMIE.
      expect(advancePullPayloads()).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it("fecha a operacao mesmo com o OMIE fora do ar, usando o que ja estava espelhado", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      seedCatalog(internals.database);
      seedMirroredAdvance(internals.database, 30_000);

      const operation = await runtime.startWeighing({
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "pm-wallet",
        settleFromAdvance: true,
        scaleCaptureId: stageCapture(runtime, "entry", 12_000)
      });

      invokeMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      const closed = await runtime.closeWeighing(
        operation.id,
        "invoice",
        stageCapture(runtime, "exit", 18_500)
      );

      // A balanca e offline-first: a operacao fecha, e o abatimento usa os 300,00 que
      // ja estavam espelhados. Errar para MENOS e seguro — o resto fica em carteira.
      expect(closed).toMatchObject({ totalCents: 78_000, advanceAppliedCents: 30_000 });
      expect(getWalletReport(internals.database, { status: "open" }).summary).toMatchObject({
        openCount: 1,
        openTotalCents: 48_000
      });
    } finally {
      runtime.close();
    }
  });

  it("nao adianta o cursor da varredura completa ao conferir um cliente", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const internals = asInternals(runtime);
      seedCatalog(internals.database);

      await runtime.startWeighing({
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "pm-wallet",
        settleFromAdvance: true,
        scaleCaptureId: stageCapture(runtime, "entry", 12_000)
      });

      // Se a conferencia gravasse o cursor, a proxima varredura completa acharia que
      // tudo ate hoje ja foi visto e os adiantamentos antigos dos DEMAIS clientes
      // ficariam para sempre fora da janela.
      const state = internals.database
        .prepare("SELECT value_json FROM local_settings WHERE key = ?")
        .pluck()
        .get(OMIE_ADVANCES_STATE_KEY);
      expect(state).toBeUndefined();
    } finally {
      runtime.close();
    }
  });
});

type RuntimeInternals = {
  database: DesktopDatabase;
  pendingScaleCaptures: Map<
    string,
    { operationType: "entry" | "exit"; reading: ScaleReading; expiresAt: number }
  >;
};

function asInternals(runtime: DesktopRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals;
}

/**
 * Peso ja capturado pela tela, como o operador faz ao clicar em capturar: e o que
 * `startWeighing`/`closeWeighing` consomem no lugar de falar com a balanca.
 */
function stageCapture(
  runtime: DesktopRuntime,
  operationType: "entry" | "exit",
  weightKg: number
): string {
  const captureId = `capture-${operationType}-${weightKg}`;
  const capturedAt = "2026-08-07T12:00:00.000Z";
  asInternals(runtime).pendingScaleCaptures.set(captureId, {
    operationType,
    expiresAt: Date.now() + 60_000,
    reading: {
      weightKg,
      unit: "kg",
      status: "stable",
      stable: true,
      capturedAt,
      receivedAt: capturedAt
    }
  });
  return captureId;
}

/** Payloads de `pull_customer_advances` enviados a Edge Function nesta pesagem. */
function advancePullPayloads(): Array<Record<string, unknown>> {
  return invokeMock.mock.calls
    .filter(([functionName, options]) => {
      const body = (options as { body?: { action?: string } } | undefined)?.body;
      return functionName === "omie-sync" && body?.action === "pull_customer_advances";
    })
    .map(([, options]) => (options as { body: { payload: Record<string, unknown> } }).body.payload);
}

/** Um adiantamento vindo da Edge Function, no formato do extrato compartilhado. */
function advanceMovement(amountCents: number): Record<string, unknown> {
  return {
    id: "omie-adv-company-1-7001-0",
    company_id: "company-1",
    customer_id: "customer-1",
    operation_id: null,
    movement_type: "credit",
    amount_cents: amountCents,
    balance_after_cents: amountCents,
    reason: "Adiantamento OMIE #7001",
    source: "omie",
    omie_title_id: 7001,
    created_at: "2026-08-07T11:00:00.000Z"
  };
}

/** Adiantamento que a varredura anterior ja tinha trazido para esta maquina. */
function seedMirroredAdvance(database: DesktopDatabase, amountCents: number): void {
  const at = "2026-08-06T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
        id, company_id, customer_id, operation_id, movement_type, amount_cents,
        balance_after_cents, reason, source, omie_title_id, created_at
      ) VALUES ('adv-antigo', 'company-1', 'customer-1', NULL, 'credit', ?, ?,
                'Adiantamento OMIE #7000', 'omie', 7000, ?)`
    )
    .run(amountCents, amountCents, at);
  database
    .prepare(
      `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
       VALUES ('customer-1', ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET balance_cents = excluded.balance_cents`
    )
    .run(amountCents, at);
}

function createRuntime(tempDirectories: string[]): DesktopRuntime {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-advance-sync-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const database = asInternals(runtime).database;
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

/** Cadastro minimo da pedreira: cliente com codigo no OMIE, produto, placa e motorista. */
function seedCatalog(database: DesktopDatabase): void {
  const at = "2026-08-07T09:00:00.000Z";
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
        id, company_id, source, legal_name, trade_name, email, address_number,
        omie_customer_id, created_at, updated_at
      ) VALUES ('customer-1', 'company-1', 'omie', 'Cliente Teste LTDA', 'Cliente Teste',
                'cliente@example.com', '123', 4242, ?, ?)`
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
  database
    .prepare(
      `INSERT INTO payment_methods (
        id, company_id, code, name, omie_code, is_system, is_customer_credit, is_wallet,
        sort_order, is_active, created_at, updated_at
      ) VALUES ('pm-wallet', 'company-1', 'wallet', 'Em carteira', '99', 1, 0, 1, 7, 1, ?, ?)`
    )
    .run(at, at);
}
