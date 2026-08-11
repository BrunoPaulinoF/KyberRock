import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting } from "./local-settings";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ functions: { invoke: vi.fn() } }))
}));

/**
 * A entrada e a ULTIMA hora barata de exigir o cadastro. No fechamento o caminhao ja esta
 * carregado em cima da balanca e a operacao TEM que fechar local (offline-first) — foi
 * assim que uma venda inteira acabou sem pedido no OMIE por falta do endereco do cliente.
 */
describe("trava de cadastro OMIE na abertura da operacao", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recusa a entrada fiscal do cliente sem endereco, sem tocar na balanca", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const database = internalsOf(runtime);
      insertBaseRows(database);
      insertCustomer(database, { id: "customer-sem-endereco", city: null, zipcode: null });

      // Balanca nao pode nem ser acionada: se a captura viesse primeiro, o operador
      // esperaria o peso estabilizar para so entao ouvir "nao".
      const captureSpy = vi.spyOn(
        runtime as unknown as { captureStableWeight: () => Promise<unknown> },
        "captureStableWeight"
      );

      await expect(
        runtime.startWeighing(weighingInput({ customerId: "customer-sem-endereco" }))
      ).rejects.toThrow(/Cadastro do cliente incompleto para o OMIE/);
      expect(captureSpy).not.toHaveBeenCalled();

      // E nao pode ter nascido operacao nenhuma.
      expect(runtime.listOpenWeighingOperations()).toHaveLength(0);
    } finally {
      runtime.close();
    }
  });

  it("deixa passar a operacao interna do mesmo cliente — a OS nao emite NF-e", async () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const database = internalsOf(runtime);
      insertBaseRows(database);
      insertCustomer(database, { id: "customer-sem-endereco", city: null, zipcode: null });

      expect(runtime.getCustomerOmieReadiness("customer-sem-endereco", "internal")).toMatchObject({
        ready: true
      });
      expect(runtime.getCustomerOmieReadiness("customer-sem-endereco", "invoice")).toMatchObject({
        ready: false
      });
    } finally {
      runtime.close();
    }
  });

  it("assume venda com nota quando o tipo nao foi informado", () => {
    // `createWeighingOperation` faz o mesmo padrao. Assumir "interna" aqui deixaria passar
    // exatamente a venda que a trava existe para pegar.
    const runtime = createRuntime(tempDirectories);
    try {
      const database = internalsOf(runtime);
      insertBaseRows(database);
      insertCustomer(database, { id: "customer-sem-endereco", city: null, zipcode: null });

      expect(runtime.getCustomerOmieReadiness("customer-sem-endereco")).toMatchObject({
        ready: false
      });
    } finally {
      runtime.close();
    }
  });

  it("libera assim que o cadastro e completado", () => {
    const runtime = createRuntime(tempDirectories);
    try {
      const database = internalsOf(runtime);
      insertBaseRows(database);
      insertCustomer(database, { id: "customer-completo" });

      expect(runtime.getCustomerOmieReadiness("customer-completo", "invoice")).toMatchObject({
        ready: true,
        missing: []
      });
    } finally {
      runtime.close();
    }
  });
});

function internalsOf(runtime: DesktopRuntime): DesktopDatabase {
  return (runtime as unknown as { database: DesktopDatabase }).database;
}

function weighingInput(overrides: { customerId: string }) {
  return {
    operationType: "invoice" as const,
    vehicleId: "vehicle-1",
    driverId: "driver-1",
    productId: "product-1",
    ...overrides
  };
}

function createRuntime(tempDirectories: string[]): DesktopRuntime {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-entry-guard-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const database = internalsOf(runtime);
  writeLocalSetting(database, "cloud_company_id", "company-1");
  writeLocalSetting(database, "cloud_unit_id", "unit-1");
  writeLocalSetting(database, "cloud_device_id", "device-1");
  writeLocalSetting(database, "cloud_device_token", "token-1");
  writeLocalSetting(database, "cloud_configured", true);
  writeLocalSetting(database, "last_license_check_at", new Date().toISOString());
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
  database
    .prepare(
      "INSERT INTO vehicles (id, company_id, plate, created_at, updated_at) VALUES ('vehicle-1', 'company-1', 'ETS7D93', ?, ?)"
    )
    .run(at, at);
  database
    .prepare(
      "INSERT INTO drivers (id, company_id, name, created_at, updated_at) VALUES ('driver-1', 'company-1', 'ADRIANO', ?, ?)"
    )
    .run(at, at);
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
       VALUES ('product-1', 'company-1', 'PO', 'Po de Pedra', 'ton', ?, ?)`
    )
    .run(at, at);
}

function insertCustomer(
  database: DesktopDatabase,
  overrides: { id: string; city?: string | null; zipcode?: string | null }
): void {
  const at = "2026-08-11T09:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, document, email,
        zipcode, address_street, address_number, neighborhood, city, state,
        created_at, updated_at
      ) VALUES (?, 'company-1', 'local', 'Cliente Teste', 'Cliente Teste', '39184582880',
                'cliente@pedreira.com.br', ?, 'Rua das Pedras', '123', 'Centro', ?, 'SP', ?, ?)`
    )
    .run(
      overrides.id,
      overrides.zipcode === undefined ? "18150-000" : overrides.zipcode,
      overrides.city === undefined ? "Ibiuna" : overrides.city,
      at,
      at
    );
}
