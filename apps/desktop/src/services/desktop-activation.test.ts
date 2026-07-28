import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { activateDesktop, logoutDesktop, validateDesktopAccess } from "./desktop-activation";
import { readStoredSupabaseConfig, writeStoredSupabaseConfig } from "./supabase-sync";

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
    vi.mocked(createClient).mockClear();
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

  it("nao envia previousDeviceId na primeira ativacao e envia o id ja usado na reativacao", async () => {
    const database = createDatabase();
    const activationResponse = (deviceId: string) => ({
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
        deviceId,
        deviceToken: "device-token-1",
        supabaseUrl: "https://example.supabase.co",
        publishableKey: "sb_publishable_from_activation",
        checkedAt: "2026-07-28T15:00:00.000Z"
      },
      error: null
    });

    // Maquina nova: sem id anterior, a nuvem nunca adota o registro de outro
    // computador da pedreira (era assim que o primeiro PC ficava bloqueado).
    invokeMock.mockResolvedValueOnce(activationResponse("desktop-device-1"));
    await activateDesktop(database, {
      activationCode: "123456",
      deviceName: "Balanca 2"
    });
    expect(invokeMock.mock.calls[0][1].body.previousDeviceId).toBeUndefined();
    const installationId = invokeMock.mock.calls[0][1].body.installationId;
    expect(installationId).toBeTruthy();

    // Reativacao da mesma maquina: apresenta o registro que ja usava.
    invokeMock.mockResolvedValueOnce(activationResponse("desktop-device-1"));
    await activateDesktop(database, {
      activationCode: "123456",
      deviceName: "Balanca 2"
    });
    expect(invokeMock.mock.calls[1][1].body).toMatchObject({
      installationId,
      previousDeviceId: "desktop-device-1"
    });
  });

  it("registra o erro tecnico quando a nuvem nao responde e limpa quando volta", async () => {
    const database = createDatabase();
    // Maquina ja ativada e com bloqueio guardado de uma verificacao anterior.
    for (const [key, value] of [
      ["cloud_company_id", "company-1"],
      ["cloud_unit_id", "unit-1"],
      ["cloud_device_id", "desktop-device-1"],
      ["cloud_device_token", "device-token-1"],
      ["desktop_access_status", "device_blocked"],
      ["desktop_access_message", "Este desktop foi bloqueado pelo administrador."]
    ] as Array<[string, string]>) {
      database
        .prepare(
          `INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
        )
        .run(key, JSON.stringify(value), "2026-07-28T10:00:00.000Z");
    }

    invokeMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    const offline = await validateDesktopAccess(database, { internetOnline: true, force: true });

    // Sem resposta da nuvem, o bloqueio exibido e apenas o ultimo conhecido: a
    // tela precisa do erro para nao acusar bloqueio do administrador.
    expect(offline.canOperate).toBe(false);
    expect(offline.lastError).toBe("Failed to fetch");

    invokeMock.mockResolvedValueOnce({
      data: {
        status: "approved",
        allowed: true,
        message: "Acesso aprovado. Sistema liberado.",
        checkedAt: "2026-07-28T10:05:00.000Z"
      },
      error: null
    });
    const recovered = await validateDesktopAccess(database, { internetOnline: true, force: true });

    expect(recovered.canOperate).toBe(true);
    expect(recovered.lastError).toBeNull();
  });

  it("keeps supabase connection settings after logout so the desktop can be reactivated", () => {
    const database = createDatabase();
    writeStoredSupabaseConfig(database, {
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_from_previous_activation"
    });

    logoutDesktop(database, new Date("2026-06-19T16:00:00.000Z"));

    expect(readStoredSupabaseConfig(database)).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_from_previous_activation"
    });
  });

  it("activates with the bundled bootstrap key and stores the unit publishable key", async () => {
    const database = createDatabase();
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    writeStoredSupabaseConfig(database, {
      url: "https://old-unit.supabase.co",
      publishableKey: "sb_publishable_old_unit"
    });
    invokeMock.mockResolvedValue({
      data: {
        status: "approved",
        message: "Desktop ativado com sucesso.",
        companyId: "company-1",
        companyLegalName: "Empresa Teste",
        companyTradeName: "Empresa Teste",
        companyDocument: null,
        unitId: "unit-2",
        unitName: "Unidade Nova",
        unitTimezone: "America/Sao_Paulo",
        deviceId: "desktop-device-2",
        deviceToken: "device-token-2",
        supabaseUrl: "https://new-unit.supabase.co",
        publishableKey: "sb_publishable_new_unit",
        checkedAt: "2026-06-19T17:00:00.000Z"
      },
      error: null
    });

    try {
      await activateDesktop(database, {
        activationCode: "654321",
        deviceName: "Balanca principal"
      });

      expect(createClient).toHaveBeenCalledWith(
        "https://vksihzfrgqoemcqpquit.supabase.co",
        "sb_publishable_Wbp8y7lARYTAPEQCCU-vfA_MXobcikv",
        expect.any(Object)
      );
      expect(readStoredSupabaseConfig(database)).toEqual({
        url: "https://new-unit.supabase.co",
        publishableKey: "sb_publishable_new_unit"
      });
    } finally {
      if (previousUrl) process.env.SUPABASE_URL = previousUrl;
      else delete process.env.SUPABASE_URL;
      if (previousKey) process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
      else delete process.env.SUPABASE_PUBLISHABLE_KEY;
    }
  });
});
