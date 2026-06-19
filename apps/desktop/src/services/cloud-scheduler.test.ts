import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  computeNextSyncAt,
  DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES,
  MAX_CLOUD_SYNC_INTERVAL_MINUTES,
  MIN_CLOUD_SYNC_INTERVAL_MINUTES,
  normalizeCloudSyncConfig,
  readCloudSyncConfig,
  readCloudSyncLastRunAt,
  recordCloudSyncRanAt,
  shouldRunCloudSync,
  startCloudSyncScheduler,
  writeCloudSyncConfig
} from "./cloud-scheduler";

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}

describe("normalizeCloudSyncConfig", () => {
  it("aplica defaults quando vazio", () => {
    expect(normalizeCloudSyncConfig(null)).toEqual({
      enabled: true,
      intervalMinutes: DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES
    });
  });

  it("clampa intervalo abaixo do minimo", () => {
    expect(normalizeCloudSyncConfig({ intervalMinutes: 1 })).toMatchObject({
      intervalMinutes: MIN_CLOUD_SYNC_INTERVAL_MINUTES
    });
  });

  it("clampa intervalo acima do maximo", () => {
    expect(normalizeCloudSyncConfig({ intervalMinutes: 10_000 })).toMatchObject({
      intervalMinutes: MAX_CLOUD_SYNC_INTERVAL_MINUTES
    });
  });

  it("respeita enabled=false explicito", () => {
    expect(normalizeCloudSyncConfig({ enabled: false })).toMatchObject({ enabled: false });
  });
});

describe("shouldRunCloudSync", () => {
  const config = { enabled: true, intervalMinutes: 20 };

  it("nao roda quando desabilitado", () => {
    expect(shouldRunCloudSync({ enabled: false, intervalMinutes: 20 }, null)).toBe(false);
  });

  it("roda quando nunca rodou", () => {
    expect(shouldRunCloudSync(config, null, new Date("2026-06-16T12:00:00.000Z"))).toBe(true);
  });

  it("roda quando o intervalo ja passou", () => {
    expect(
      shouldRunCloudSync(config, "2026-06-16T11:00:00.000Z", new Date("2026-06-16T12:00:00.000Z"))
    ).toBe(true);
  });

  it("nao roda quando o intervalo ainda nao passou", () => {
    expect(
      shouldRunCloudSync(config, "2026-06-16T11:50:00.000Z", new Date("2026-06-16T12:00:00.000Z"))
    ).toBe(false);
  });

  it("dispara imediato quando syncInProgress=true (retomada parcial)", () => {
    expect(
      shouldRunCloudSync(
        config,
        "2026-06-16T11:55:00.000Z",
        new Date("2026-06-16T12:00:00.000Z"),
        true
      )
    ).toBe(true);
  });
});

describe("computeNextSyncAt", () => {
  it("retorna null quando desabilitado", () => {
    expect(computeNextSyncAt({ enabled: false, intervalMinutes: 20 }, null)).toBeNull();
  });

  it("soma intervalo ao lastRunAt", () => {
    expect(
      computeNextSyncAt({ enabled: true, intervalMinutes: 20 }, "2026-06-16T12:00:00.000Z")
    ).toBe("2026-06-16T12:20:00.000Z");
  });
});

describe("readCloudSyncConfig / writeCloudSyncConfig", () => {
  let database: DesktopDatabase;

  beforeEach(() => {
    database = createDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it("retorna defaults antes da primeira escrita", () => {
    expect(readCloudSyncConfig(database)).toEqual({
      enabled: true,
      intervalMinutes: DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES
    });
  });

  it("persiste e normaliza o intervalo gravado", () => {
    const result = writeCloudSyncConfig(database, { enabled: false, intervalMinutes: 1 });
    expect(result).toEqual({ enabled: false, intervalMinutes: MIN_CLOUD_SYNC_INTERVAL_MINUTES });
    expect(readCloudSyncConfig(database)).toEqual(result);
  });

  it("registra e le lastRunAt", () => {
    expect(readCloudSyncLastRunAt(database)).toBeNull();
    recordCloudSyncRanAt(database, "2026-06-16T12:00:00.000Z");
    expect(readCloudSyncLastRunAt(database)).toBe("2026-06-16T12:00:00.000Z");
  });
});

describe("startCloudSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispara o sync no primeiro tick e grava lastRunAt antes", async () => {
    const runSync = vi.fn().mockResolvedValue(undefined);
    const setLastRunAt = vi.fn();
    let lastRun: string | null = null;
    const fixedNow = new Date("2026-06-16T12:00:00.000Z");

    startCloudSyncScheduler({
      getConfig: () => ({ enabled: true, intervalMinutes: 20 }),
      getLastRunAt: () => lastRun,
      setLastRunAt: (iso) => {
        lastRun = iso;
        setLastRunAt(iso);
      },
      runSync,
      now: () => fixedNow
    });

    expect(setLastRunAt).toHaveBeenCalledWith("2026-06-16T12:00:00.000Z");
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("nao roda quando enabled=false", () => {
    const runSync = vi.fn().mockResolvedValue(undefined);

    startCloudSyncScheduler({
      getConfig: () => ({ enabled: false, intervalMinutes: 20 }),
      getLastRunAt: () => null,
      setLastRunAt: () => undefined,
      runSync
    });

    expect(runSync).not.toHaveBeenCalled();
  });

  it("captura erros do runSync via onError", async () => {
    const error = new Error("falhou");
    const onError = vi.fn();
    const runSync = vi.fn().mockRejectedValue(error);

    startCloudSyncScheduler({
      getConfig: () => ({ enabled: true, intervalMinutes: 20 }),
      getLastRunAt: () => null,
      setLastRunAt: () => undefined,
      runSync,
      onError,
      now: () => new Date("2026-06-16T12:00:00.000Z")
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });

  it("para de agendar quando stop() e chamado", () => {
    const clearIntervalFn = vi.fn();
    const handle = startCloudSyncScheduler({
      getConfig: () => ({ enabled: false, intervalMinutes: 20 }),
      getLastRunAt: () => null,
      setLastRunAt: () => undefined,
      runSync: vi.fn(),
      clearIntervalFn
    });

    handle.stop();
    expect(clearIntervalFn).toHaveBeenCalled();
  });
});
