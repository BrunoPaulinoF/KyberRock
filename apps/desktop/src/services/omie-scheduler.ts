import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

export const OMIE_PULL_SCHEDULER_KEY = "omie_pull_scheduler";
export const OMIE_PULL_LAST_RUN_KEY = "omie_pull_last_run_at";

export const DEFAULT_OMIE_PULL_INTERVAL_MINUTES = 30;
const LEGACY_OMIE_PULL_INTERVAL_MINUTES = 20;
export const MIN_OMIE_PULL_INTERVAL_MINUTES = 5;
export const MAX_OMIE_PULL_INTERVAL_MINUTES = 720;
const TICK_FALLBACK_MS = 60_000;

export interface OmieSchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface OmieSchedulerStatus extends OmieSchedulerConfig {
  lastPullAt: string | null;
  nextPullAt: string | null;
}

export interface StartOmiePullSchedulerOptions {
  getConfig: () => OmieSchedulerConfig;
  getLastPullAt: () => string | null;
  setLastPullAt: (isoString: string) => void;
  runPull: () => Promise<void>;
  isPullInProgress?: () => boolean;
  onError?: (error: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => Date;
}

export interface OmieSchedulerHandle {
  stop: () => void;
}

export function readOmieSchedulerConfig(database: DesktopDatabase): OmieSchedulerConfig {
  const stored = readLocalSetting<Partial<OmieSchedulerConfig>>(database, OMIE_PULL_SCHEDULER_KEY);
  return normalizeOmieSchedulerConfig(stored);
}

export function writeOmieSchedulerConfig(
  database: DesktopDatabase,
  config: Partial<OmieSchedulerConfig>,
  updatedAt: string = new Date().toISOString()
): OmieSchedulerConfig {
  const current = readOmieSchedulerConfig(database);
  const next = normalizeOmieSchedulerConfig({ ...current, ...config });
  writeLocalSetting(database, OMIE_PULL_SCHEDULER_KEY, next, updatedAt);
  return next;
}

export function readOmiePullLastRunAt(database: DesktopDatabase): string | null {
  const stored = readLocalSetting<string>(database, OMIE_PULL_LAST_RUN_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : null;
}

export function recordOmiePullRanAt(
  database: DesktopDatabase,
  isoString: string = new Date().toISOString()
): void {
  writeLocalSetting(database, OMIE_PULL_LAST_RUN_KEY, isoString, isoString);
}

export function normalizeOmieSchedulerConfig(
  config: Partial<OmieSchedulerConfig> | null | undefined
): OmieSchedulerConfig {
  const intervalRaw = Number(config?.intervalMinutes);
  const interval =
    Number.isFinite(intervalRaw) && intervalRaw > 0 && intervalRaw !== LEGACY_OMIE_PULL_INTERVAL_MINUTES
      ? intervalRaw
      : DEFAULT_OMIE_PULL_INTERVAL_MINUTES;
  return {
    enabled: config?.enabled !== false,
    intervalMinutes: clampInterval(interval)
  };
}

export function shouldRunOmiePull(
  config: OmieSchedulerConfig,
  lastPullAt: string | null,
  now: Date = new Date(),
  pullInProgress = false
): boolean {
  if (!config.enabled) return false;
  if (pullInProgress) return true;
  if (!lastPullAt) return true;

  const last = Date.parse(lastPullAt);
  if (Number.isNaN(last)) return true;

  const intervalMs = clampInterval(config.intervalMinutes) * 60 * 1000;
  return now.getTime() - last >= intervalMs;
}

export function computeNextPullAt(
  config: OmieSchedulerConfig,
  lastPullAt: string | null
): string | null {
  if (!config.enabled) return null;
  const intervalMs = clampInterval(config.intervalMinutes) * 60 * 1000;
  if (!lastPullAt) {
    return new Date().toISOString();
  }
  const last = Date.parse(lastPullAt);
  if (Number.isNaN(last)) return new Date().toISOString();
  return new Date(last + intervalMs).toISOString();
}

export function startOmiePullScheduler(
  options: StartOmiePullSchedulerOptions
): OmieSchedulerHandle {
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const now = options.now ?? (() => new Date());

  let running = false;

  const tick = (): void => {
    const config = options.getConfig();
    if (!config.enabled) return;
    if (running) return;

    const pullInProgress = options.isPullInProgress?.() ?? false;
    if (!shouldRunOmiePull(config, options.getLastPullAt(), now(), pullInProgress)) return;

    running = true;
    const startedAt = now().toISOString();
    options.setLastPullAt(startedAt);
    void options
      .runPull()
      .catch((error: unknown) => {
        options.onError?.(error);
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  const intervalId = setIntervalFn(tick, TICK_FALLBACK_MS);

  return {
    stop: () => clearIntervalFn(intervalId)
  };
}

function clampInterval(value: number): number {
  if (value < MIN_OMIE_PULL_INTERVAL_MINUTES) return MIN_OMIE_PULL_INTERVAL_MINUTES;
  if (value > MAX_OMIE_PULL_INTERVAL_MINUTES) return MAX_OMIE_PULL_INTERVAL_MINUTES;
  return Math.round(value);
}
