import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting } from "./local-settings";

/**
 * Sem internet a balanca cadastra, mas nao edita o que ja existia; e o que foi cadastrado
 * sem internet espera a conferencia antes de subir.
 */
describe("Cadastro sem internet no runtime", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("marca o cadastro novo, deixa edita-lo e recusa editar o que ja existia", () => {
    const { runtime } = createRuntime(tempDirectories);

    try {
      const antigo = runtime.createDriver({ name: "Antigo" }) as { id: string };

      runtime.setInternetOnline(false);
      const novo = runtime.createDriver({ name: "Novo" }) as { id: string };

      expect(runtime.listOfflinePendingCadastro().drivers).toEqual([novo.id]);
      expect(() => runtime.updateDriver(novo.id, { name: "Novo Corrigido" })).not.toThrow();
      expect(() => runtime.updateDriver(antigo.id, { name: "Mudou" })).toThrow(/Sem internet/);
      expect(() => runtime.deleteDriver(antigo.id)).toThrow(/Sem internet/);
    } finally {
      runtime.close();
    }
  });

  it("com internet nada e marcado nem travado", () => {
    const { runtime } = createRuntime(tempDirectories);

    try {
      runtime.setInternetOnline(true);
      const driver = runtime.createDriver({ name: "Qualquer" }) as { id: string };

      expect(runtime.listOfflinePendingCadastro().drivers).toEqual([]);
      expect(() => runtime.updateDriver(driver.id, { name: "Outro" })).not.toThrow();
    } finally {
      runtime.close();
    }
  });

  it("segura o envio enquanto houver cadastro sem conferencia e a internet nao voltou", async () => {
    const { runtime, internals } = createRuntime(tempDirectories);

    try {
      runtime.setInternetOnline(false);
      runtime.createDriver({ name: "Novo" });

      await expect(internals.prepareOfflineCadastroForPublish()).resolves.toBe(false);
    } finally {
      runtime.close();
    }
  });
});

interface RuntimeInternals {
  database: DesktopDatabase;
  prepareOfflineCadastroForPublish: () => Promise<boolean>;
  pushCadastroToCloud: () => Promise<void>;
}

function createRuntime(tempDirectories: string[]): {
  runtime: DesktopRuntime;
  internals: RuntimeInternals;
} {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-offline-cadastro-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const internals = runtime as unknown as RuntimeInternals;

  writeLocalSetting(internals.database, "cloud_company_id", "company-1");
  writeLocalSetting(internals.database, "cloud_unit_id", "unit-1");
  writeLocalSetting(internals.database, "cloud_device_id", "device-1");
  writeLocalSetting(internals.database, "cloud_device_token", "token-1");
  writeLocalSetting(internals.database, "cloud_configured", true);
  writeLocalSetting(internals.database, "last_license_check_at", new Date().toISOString());
  // O envio (HTTP) fica de fora.
  internals.pushCadastroToCloud = async () => {};

  return { runtime, internals };
}
