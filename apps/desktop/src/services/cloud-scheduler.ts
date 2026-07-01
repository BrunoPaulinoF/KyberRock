import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

export const CLOUD_SYNC_SCHEDULER_KEY = "cloud_sync_scheduler";
export const CLOUD_SYNC_LAST_RUN_KEY = "cloud_sync_last_run_at";

export const DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES = 30;
const LEGACY_CLOUD_SYNC_INTERVAL_MINUTES = 20;
export const MIN_CLOUD_SYNC_INTERVAL_MINUTES = 5;
export const MAX_CLOUD_SYNC_INTERVAL_MINUTES = 720;
const TICK_FALLBACK_MS = 60_000;

export interface CloudSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface CloudSyncSchedulerStatus extends CloudSyncConfig {
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface StartCloudSyncSchedulerOptions {
  getConfig: () => CloudSyncConfig;
  getLastRunAt: () => string | null;
  setLastRunAt: (isoString: string) => void;
  runSync: () => Promise<void>;
  isSyncInProgress?: () => boolean;
  onError?: (error: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => Date;
}

export interface CloudSyncSchedulerHandle {
  stop: () => void;
}

export function readCloudSyncConfig(database: DesktopDatabase): CloudSyncConfig {
  const stored = readLocalSetting<Partial<CloudSyncConfig>>(database, CLOUD_SYNC_SCHEDULER_KEY);
  return normalizeCloudSyncConfig(stored);
}

export function writeCloudSyncConfig(
  database: DesktopDatabase,
  config: Partial<CloudSyncConfig>,
  updatedAt: string = new Date().toISOString()
): CloudSyncConfig {
  const current = readCloudSyncConfig(database);
  const next = normalizeCloudSyncConfig({ ...current, ...config });
  writeLocalSetting(database, CLOUD_SYNC_SCHEDULER_KEY, next, updatedAt);
  return next;
}

export function readCloudSyncLastRunAt(database: DesktopDatabase): string | null {
  const stored = readLocalSetting<string>(database, CLOUD_SYNC_LAST_RUN_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : null;
}

export function recordCloudSyncRanAt(
  database: DesktopDatabase,
  isoString: string = new Date().toISOString()
): void {
  writeLocalSetting(database, CLOUD_SYNC_LAST_RUN_KEY, isoString, isoString);
}

export function normalizeCloudSyncConfig(
  config: Partial<CloudSyncConfig> | null | undefined
): CloudSyncConfig {
  const intervalRaw = Number(config?.intervalMinutes);
  const interval =
    Number.isFinite(intervalRaw) && intervalRaw > 0 && intervalRaw !== LEGACY_CLOUD_SYNC_INTERVAL_MINUTES
      ? intervalRaw
      : DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES;
  return {
    enabled: config?.enabled !== false,
    intervalMinutes: clampInterval(interval)
  };
}

export function shouldRunCloudSync(
  config: CloudSyncConfig,
  lastRunAt: string | null,
  now: Date = new Date(),
  syncInProgress = false
): boolean {
  if (!config.enabled) return false;
  if (syncInProgress) return true;
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = clampInterval(config.intervalMinutes) * 60 * 1000;
  return now.getTime() - last >= intervalMs;
}

export function computeNextSyncAt(
  config: CloudSyncConfig,
  lastRunAt: string | null
): string | null {
  if (!config.enabled) return null;
  const intervalMs = clampInterval(config.intervalMinutes) * 60 * 1000;
  if (!lastRunAt) {
    return new Date().toISOString();
  }
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return new Date().toISOString();
  return new Date(last + intervalMs).toISOString();
}

export function startCloudSyncScheduler(
  options: StartCloudSyncSchedulerOptions
): CloudSyncSchedulerHandle {
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const now = options.now ?? (() => new Date());

  let running = false;

  const tick = (): void => {
    const config = options.getConfig();
    if (!config.enabled) return;
    if (running) return;

    const syncInProgress = options.isSyncInProgress?.() ?? false;
    if (!shouldRunCloudSync(config, options.getLastRunAt(), now(), syncInProgress)) return;

    running = true;
    const startedAt = now().toISOString();
    options.setLastRunAt(startedAt);
    void options
      .runSync()
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
  if (value < MIN_CLOUD_SYNC_INTERVAL_MINUTES) return MIN_CLOUD_SYNC_INTERVAL_MINUTES;
  if (value > MAX_CLOUD_SYNC_INTERVAL_MINUTES) return MAX_CLOUD_SYNC_INTERVAL_MINUTES;
  return Math.round(value);
}
