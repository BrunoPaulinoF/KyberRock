import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting } from "./local-settings";

/**
 * O cadastro feito numa maquina precisa SAIR dela na hora.
 *
 * Antes disso o cadastro so subia na varredura completa — 30 min por padrao, e ela pode ser
 * desligada nas configuracoes —, entao o cliente novo cadastrado no computador do comercial
 * demorava meia hora para existir no computador da expedicao (ou nunca, se a maquina fosse
 * fechada antes). A operacao ja tinha esse envio imediato; o cadastro nao tinha.
 */
describe("Envio imediato do cadastro", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publica na nuvem assim que um cadastro e salvo", async () => {
    const { runtime, internals, pushed } = createRuntime(tempDirectories);

    try {
      runtime.createVehicle({ plate: "ABC1D23" });
      await drainPush(internals);

      expect(pushed).toHaveBeenCalledTimes(1);
    } finally {
      runtime.close();
    }
  });

  it("junta a rajada de um mesmo salvamento em UM envio", async () => {
    const { runtime, internals, pushed } = createRuntime(tempDirectories);

    try {
      // Salvar um cliente mexe em mais de um cadastro (o cliente e a transportadora dele) e
      // cada um avisa: sem juntar, cada salvamento viraria varias chamadas HTTP iguais.
      internals.cadastroChanged("customer", "company-1");
      internals.cadastroChanged("carrier", "company-1");
      internals.cadastroChanged("customer", "company-1");
      await drainPush(internals);

      expect(pushed).toHaveBeenCalledTimes(1);
    } finally {
      runtime.close();
    }
  });

  it("nao perde a edicao feita enquanto o envio anterior corria", async () => {
    const { runtime, internals, pushed } = createRuntime(tempDirectories);

    try {
      internals.cadastroChanged("customer", "company-1");
      await drainPush(internals);
      // Segunda rajada, depois que a primeira ja saiu: precisa de envio proprio, senao a
      // edicao ficaria esperando a varredura de 30 min — o problema que isto corrige.
      internals.cadastroChanged("customer", "company-1");
      await drainPush(internals);

      expect(pushed).toHaveBeenCalledTimes(2);
    } finally {
      runtime.close();
    }
  });

  it("falha de rede nao trava os envios seguintes", async () => {
    const { runtime, internals, pushed } = createRuntime(tempDirectories);

    try {
      pushed.mockRejectedValueOnce(new Error("sem conexao"));
      internals.cadastroChanged("customer", "company-1");
      await drainPush(internals);

      internals.cadastroChanged("customer", "company-1");
      await drainPush(internals);

      expect(pushed).toHaveBeenCalledTimes(2);
    } finally {
      runtime.close();
    }
  });
});

interface RuntimeInternals {
  database: DesktopDatabase;
  cadastroChanged: (entityType: string, companyId: string) => void;
  cadastroPushChain: Promise<void>;
  pushCadastroToCloud: () => Promise<void>;
}

function createRuntime(tempDirectories: string[]): {
  runtime: DesktopRuntime;
  internals: RuntimeInternals;
  pushed: ReturnType<typeof vi.fn>;
} {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-cadastro-push-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const internals = runtime as unknown as RuntimeInternals;

  writeLocalSetting(internals.database, "cloud_company_id", "company-1");
  writeLocalSetting(internals.database, "cloud_unit_id", "unit-1");
  writeLocalSetting(internals.database, "cloud_device_id", "device-1");
  writeLocalSetting(internals.database, "cloud_device_token", "token-1");
  writeLocalSetting(internals.database, "cloud_configured", true);
  // Licenca dentro do prazo: sem isto a balanca esta bloqueada e nem chega a salvar.
  writeLocalSetting(internals.database, "last_license_check_at", new Date().toISOString());

  // O envio em si (HTTP) fica de fora: o que este arquivo cobre e QUANDO ele e disparado.
  const pushed = vi.fn(async () => {});
  internals.pushCadastroToCloud = pushed;

  return { runtime, internals, pushed };
}

/** Espera a corrente de envios esvaziar (ela e serial e vive em uma promise). */
async function drainPush(internals: RuntimeInternals): Promise<void> {
  await internals.cadastroPushChain;
}
