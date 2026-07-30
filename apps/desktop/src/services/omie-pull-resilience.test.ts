import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { writeLocalSetting } from "./local-settings";
import type * as SupabaseSyncModule from "./supabase-sync";
import type { OmieCloudSyncResult } from "./supabase-sync";

const syncReferenceDataMock = vi.fn();

vi.mock("./supabase-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof SupabaseSyncModule>();
  return { ...actual, syncOmieReferenceDataFromCloud: syncReferenceDataMock };
});

const { DesktopRuntime } = await import("./runtime");

/**
 * Uma pagina que falha (timeout/instabilidade do OMIE) nao pode abortar o pull
 * inteiro: era assim que um desktop recem-instalado ficava com so as primeiras
 * paginas de clientes e nenhuma re-tentativa.
 */
describe("resiliencia do pull de cadastro do OMIE", () => {
  const tempDirectories: string[] = [];

  beforeEach(() => {
    syncReferenceDataMock.mockReset();
  });

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("re-tenta a pagina que falhou e segue ate o fim do cadastro", async () => {
    const runtime = createRuntime(tempDirectories);

    try {
      syncReferenceDataMock
        .mockRejectedValueOnce(new Error("OMIE indisponivel"))
        .mockImplementationOnce(() => Promise.resolve(page(runtime, { finished: false })))
        .mockImplementationOnce(() => Promise.resolve(page(runtime, { finished: true })));

      const result = await runtime.runOmieDataEntryLoop({
        maxIterations: 5,
        delayBetweenPagesMs: 0,
        retryDelayMs: 0
      });

      expect(syncReferenceDataMock).toHaveBeenCalledTimes(3);
      expect(result.customersPulled).toBe(200);
      expect(result.finished).toBe(true);
      expect(result.errors.join(" ")).toContain("OMIE indisponivel");
    } finally {
      runtime.close();
    }
  });

  it("desiste apos falhas seguidas mantendo o pull em andamento para retomar depois", async () => {
    const runtime = createRuntime(tempDirectories);

    try {
      syncReferenceDataMock.mockRejectedValue(new Error("OMIE indisponivel"));

      const result = await runtime.runOmieDataEntryLoop({
        maxIterations: 20,
        delayBetweenPagesMs: 0,
        retryDelayMs: 0
      });

      expect(syncReferenceDataMock).toHaveBeenCalledTimes(3);
      expect(result.finished).toBe(false);
      expect(result.errors).toHaveLength(3);
      // Estado preservado: o proximo ciclo retoma da pagina que faltou.
      expect(runtime.getOmieLoopStatus()?.inProgress).toBe(true);
    } finally {
      runtime.close();
    }
  });
});

/** Simula uma pagina aplicada pelo applyOmieReferenceData (que grava o estado). */
function page(
  runtime: InstanceType<typeof DesktopRuntime>,
  options: { finished: boolean }
): OmieCloudSyncResult {
  const database = (runtime as unknown as { database: DesktopDatabase }).database;
  const state = readState(database);
  writeLocalSetting(database, "omie_pull_state", {
    ...state,
    customersPage: options.finished ? 1 : state.customersPage + 1,
    customersFinished: options.finished,
    productsFinished: options.finished,
    paymentTermsFinished: options.finished,
    suppliersFinished: options.finished,
    categoriesFinished: options.finished,
    inProgress: !options.finished
  });
  return {
    customersPulled: 100,
    customersPushed: 0,
    productsSynced: 0,
    paymentTermsSynced: 0,
    suppliersSynced: 0,
    categoriesSynced: 0,
    errors: []
  };
}

function readState(database: DesktopDatabase): {
  customersPage: number;
  productsPage: number;
  paymentTermsPage: number;
  suppliersPage: number;
  categoriesPage: number;
} {
  const raw = database
    .prepare("SELECT value_json FROM local_settings WHERE key = 'omie_pull_state'")
    .pluck()
    .get() as string | undefined;
  const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return {
    customersPage: parsed.customersPage ?? 1,
    productsPage: parsed.productsPage ?? 1,
    paymentTermsPage: parsed.paymentTermsPage ?? 1,
    suppliersPage: parsed.suppliersPage ?? 1,
    categoriesPage: parsed.categoriesPage ?? 1
  };
}

function createRuntime(tempDirectories: string[]): InstanceType<typeof DesktopRuntime> {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-omie-pull-"));
  tempDirectories.push(baseDirectory);
  const runtime = DesktopRuntime.initialize(baseDirectory);
  const database = (runtime as unknown as { database: DesktopDatabase }).database;
  writeLocalSetting(database, "cloud_company_id", "company-1");
  writeLocalSetting(database, "cloud_unit_id", "unit-1");
  writeLocalSetting(database, "cloud_device_id", "device-1");
  writeLocalSetting(database, "cloud_device_token", "token-1");
  return runtime;
}
