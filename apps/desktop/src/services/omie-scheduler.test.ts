import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  computeNextPullAt,
  DEFAULT_OMIE_PULL_INTERVAL_MINUTES,
  MAX_OMIE_PULL_INTERVAL_MINUTES,
  MIN_OMIE_PULL_INTERVAL_MINUTES,
  normalizeOmieSchedulerConfig,
  readOmiePullLastRunAt,
  readOmieSchedulerConfig,
  recordOmiePullRanAt,
  shouldRunOmiePull,
  startOmiePullScheduler,
  writeOmieSchedulerConfig
} from "./omie-scheduler";

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}

describe("normalizeOmieSchedulerConfig", () => {
  it("aplica defaults quando vazio", () => {
    expect(normalizeOmieSchedulerConfig(null)).toEqual({
      enabled: true,
      intervalMinutes: DEFAULT_OMIE_PULL_INTERVAL_MINUTES
    });
  });

  it("clampa intervalo abaixo do minimo", () => {
    expect(normalizeOmieSchedulerConfig({ intervalMinutes: 1 })).toMatchObject({
      intervalMinutes: MIN_OMIE_PULL_INTERVAL_MINUTES
    });
  });

  it("clampa intervalo acima do maximo", () => {
    expect(normalizeOmieSchedulerConfig({ intervalMinutes: 10_000 })).toMatchObject({
      intervalMinutes: MAX_OMIE_PULL_INTERVAL_MINUTES
    });
  });

  it("respeita enabled=false explicito", () => {
    expect(normalizeOmieSchedulerConfig({ enabled: false })).toMatchObject({ enabled: false });
  });

  it("migra o intervalo legado de 20 minutos para o default atual", () => {
    expect(normalizeOmieSchedulerConfig({ intervalMinutes: 20 })).toMatchObject({
      intervalMinutes: DEFAULT_OMIE_PULL_INTERVAL_MINUTES
    });
  });

  it("trata intervalo invalido como default", () => {
    expect(
      normalizeOmieSchedulerConfig({ intervalMinutes: Number.NaN })
    ).toMatchObject({ intervalMinutes: DEFAULT_OMIE_PULL_INTERVAL_MINUTES });
  });
});

describe("shouldRunOmiePull", () => {
  const config = { enabled: true, intervalMinutes: 20 };

  it("nao roda quando desabilitado", () => {
    expect(shouldRunOmiePull({ enabled: false, intervalMinutes: 20 }, null)).toBe(false);
  });

  it("roda quando nunca rodou", () => {
    expect(shouldRunOmiePull(config, null, new Date("2026-06-16T12:00:00.000Z"))).toBe(true);
  });

  it("roda quando o intervalo ja passou", () => {
    expect(
      shouldRunOmiePull(config, "2026-06-16T11:00:00.000Z", new Date("2026-06-16T12:00:00.000Z"))
    ).toBe(true);
  });

  it("nao roda quando o intervalo ainda nao passou", () => {
    expect(
      shouldRunOmiePull(config, "2026-06-16T11:50:00.000Z", new Date("2026-06-16T12:00:00.000Z"))
    ).toBe(false);
  });

  it("trata lastPullAt invalido como nunca rodou", () => {
    expect(shouldRunOmiePull(config, "data-invalida")).toBe(true);
  });

  it("dispara imediato quando pullInProgress=true (retomada parcial)", () => {
    expect(
      shouldRunOmiePull(
        config,
        "2026-06-16T11:55:00.000Z",
        new Date("2026-06-16T12:00:00.000Z"),
        true
      )
    ).toBe(true);
  });

  it("pullInProgress=true nao sobrepoe enabled=false", () => {
    expect(
      shouldRunOmiePull(
        { enabled: false, intervalMinutes: 20 },
        "2026-06-16T11:55:00.000Z",
        new Date("2026-06-16T12:00:00.000Z"),
        true
      )
    ).toBe(false);
  });
});

describe("computeNextPullAt", () => {
  it("retorna null quando desabilitado", () => {
    expect(computeNextPullAt({ enabled: false, intervalMinutes: 20 }, null)).toBeNull();
  });

  it("soma intervalo ao lastPullAt", () => {
    expect(
      computeNextPullAt({ enabled: true, intervalMinutes: 20 }, "2026-06-16T12:00:00.000Z")
    ).toBe("2026-06-16T12:20:00.000Z");
  });

  it("retorna agora quando nunca rodou", () => {
    const before = Date.now();
    const next = computeNextPullAt({ enabled: true, intervalMinutes: 20 }, null);
    expect(next).not.toBeNull();
    expect(Date.parse(next as string)).toBeGreaterThanOrEqual(before);
  });
});

describe("readOmieSchedulerConfig / writeOmieSchedulerConfig", () => {
  let database: DesktopDatabase;

  beforeEach(() => {
    database = createDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it("retorna defaults antes da primeira escrita", () => {
    expect(readOmieSchedulerConfig(database)).toEqual({
      enabled: true,
      intervalMinutes: DEFAULT_OMIE_PULL_INTERVAL_MINUTES
    });
  });

  it("persiste e normaliza o intervalo gravado", () => {
    const result = writeOmieSchedulerConfig(database, { enabled: false, intervalMinutes: 1 });
    expect(result).toEqual({ enabled: false, intervalMinutes: MIN_OMIE_PULL_INTERVAL_MINUTES });
    expect(readOmieSchedulerConfig(database)).toEqual(result);
  });

  it("registra e le lastRunAt", () => {
    expect(readOmiePullLastRunAt(database)).toBeNull();
    recordOmiePullRanAt(database, "2026-06-16T12:00:00.000Z");
    expect(readOmiePullLastRunAt(database)).toBe("2026-06-16T12:00:00.000Z");
  });
});

describe("startOmiePullScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispara o pull no primeiro tick e grava lastPullAt antes", async () => {
    const runPull = vi.fn().mockResolvedValue(undefined);
    const setLastPullAt = vi.fn();
    let lastPull: string | null = null;
    const fixedNow = new Date("2026-06-16T12:00:00.000Z");

    startOmiePullScheduler({
      getConfig: () => ({ enabled: true, intervalMinutes: 20 }),
      getLastPullAt: () => lastPull,
      setLastPullAt: (iso) => {
        lastPull = iso;
        setLastPullAt(iso);
      },
      runPull,
      now: () => fixedNow
    });

    expect(setLastPullAt).toHaveBeenCalledWith("2026-06-16T12:00:00.000Z");
    expect(runPull).toHaveBeenCalledTimes(1);
  });

  it("nao roda quando enabled=false", () => {
    const runPull = vi.fn().mockResolvedValue(undefined);

    startOmiePullScheduler({
      getConfig: () => ({ enabled: false, intervalMinutes: 20 }),
      getLastPullAt: () => null,
      setLastPullAt: () => undefined,
      runPull
    });

    expect(runPull).not.toHaveBeenCalled();
  });

  it("pula quando o intervalo ainda nao passou", () => {
    const runPull = vi.fn().mockResolvedValue(undefined);
    const fixedNow = new Date("2026-06-16T12:05:00.000Z");

    startOmiePullScheduler({
      getConfig: () => ({ enabled: true, intervalMinutes: 20 }),
      getLastPullAt: () => "2026-06-16T12:00:00.000Z",
      setLastPullAt: () => undefined,
      runPull,
      now: () => fixedNow
    });

    expect(runPull).not.toHaveBeenCalled();
  });

  it("evita reentrancia se o pull anterior ainda nao terminou", async () => {
    let resolvePull: () => void = () => undefined;
    const runPull = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePull = resolve;
        })
    );
    const fixedNow = new Date("2026-06-16T12:00:00.000Z");
    let lastPull: string | null = null;

    startOmiePullScheduler({
      getConfig: () => ({ enabled: true, intervalMinutes: 20 }),
      getLastPullAt: () => lastPull,
      setLastPullAt: (iso) => {
        lastPull = iso;
      },
      runPull,
      now: () => fixedNow,
      setIntervalFn: ((handler: () => void) => {
        handler();
        handler();
        return 0 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval
    });

    expect(runPull).toHaveBeenCalledTimes(1);
    resolvePull();
  });

  it("captura erros do runPull via onError", async () => {
    const error = new Error("falhou");
    const onError = vi.fn();
    const runPull = vi.fn().mockRejectedValue(error);

    startOmiePullScheduler({
      getConfig: () => ({ enabled: true, intervalMinutes: 20 }),
      getLastPullAt: () => null,
      setLastPullAt: () => undefined,
      runPull,
      onError,
      now: () => new Date("2026-06-16T12:00:00.000Z")
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });

  it("para de agendar quando stop() e chamado", () => {
    const clearIntervalFn = vi.fn();
    const handle = startOmiePullScheduler({
      getConfig: () => ({ enabled: false, intervalMinutes: 20 }),
      getLastPullAt: () => null,
      setLastPullAt: () => undefined,
      runPull: vi.fn(),
      clearIntervalFn
    });

    handle.stop();
    expect(clearIntervalFn).toHaveBeenCalled();
  });
});
