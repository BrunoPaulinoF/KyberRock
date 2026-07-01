import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { activateDesktop } from "./desktop-activation";
import { readStoredSupabaseConfig } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

describe("desktop activation", () => {
  const tempDatabases: DesktopDatabase[] = [];
  const tempDirectories: string[] = [];

  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    for (const database of tempDatabases.splice(0)) {
      database.close();
    }
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createDatabase(): DesktopDatabase {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-activation-"));
    tempDirectories.push(baseDirectory);
    const databasePath = path.join(baseDirectory, "activation.sqlite3");
    const database = openDesktopDatabase({ databasePath });
    runDesktopMigrations(database);
    tempDatabases.push(database);
    return database;
  }

  it("persists the supabase url and publishable key returned by the activation edge function", async () => {
    const database = createDatabase();
    invokeMock.mockResolvedValue({
      data: {
        status: "approved",
        message: "Desktop ativado com sucesso.",
        companyId: "company-1",
        companyLegalName: "Empresa Teste",
        companyTradeName: "Empresa Teste",
        companyDocument: "12345678000195",
        unitId: "unit-1",
        unitName: "Unidade Teste",
        unitTimezone: "America/Sao_Paulo",
        deviceId: "desktop-device-1",
        deviceToken: "device-token-1",
        supabaseUrl: "https://example.supabase.co",
        publishableKey: "sb_publishable_from_activation",
        checkedAt: "2026-06-19T15:00:00.000Z"
      },
      error: null
    });

    const status = await activateDesktop(database, {
      activationCode: "123456",
      deviceName: "Balanca principal"
    });

    expect(status.canOperate).toBe(true);
    const stored = readStoredSupabaseConfig(database);
    expect(stored).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_from_activation"
    });
  });

  it("stores null supabase values when the activation response omits them", async () => {
    const database = createDatabase();
    invokeMock.mockResolvedValue({
      data: {
        status: "approved",
        message: "Desktop ativado com sucesso.",
        companyId: "company-1",
        companyLegalName: "Empresa Teste",
        companyTradeName: "Empresa Teste",
        companyDocument: null,
        unitId: "unit-1",
        unitName: "Unidade Teste",
        unitTimezone: "America/Sao_Paulo",
        deviceId: "desktop-device-1",
        deviceToken: "device-token-1",
        supabaseUrl: null,
        publishableKey: null,
        checkedAt: "2026-06-19T15:00:00.000Z"
      },
      error: null
    });

    await activateDesktop(database, {
      activationCode: "123456",
      deviceName: "Balanca principal"
    });

    const stored = readStoredSupabaseConfig(database);
    expect(stored.url).toBe("");
    expect(stored.publishableKey).toBe("");
  });
});
