export const DAILY_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface StartDailyBackupSchedulerOptions {
  getLastBackupAt: () => string | null;
  runBackup: () => Promise<void>;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface BackupSchedulerHandle {
  stop: () => void;
}

export function shouldRunDailyBackup(lastBackupAt: string | null, now: Date = new Date()): boolean {
  if (!lastBackupAt) {
    return true;
  }

  const lastBackupTime = Date.parse(lastBackupAt);

  if (Number.isNaN(lastBackupTime)) {
    return true;
  }

  return now.getTime() - lastBackupTime >= DAILY_BACKUP_INTERVAL_MS;
}

export function startDailyBackupScheduler(
  options: StartDailyBackupSchedulerOptions
): BackupSchedulerHandle {
  const intervalMs = options.intervalMs ?? 60 * 60 * 1000;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  const tick = (): void => {
    if (!shouldRunDailyBackup(options.getLastBackupAt())) {
      return;
    }

    void options.runBackup().catch((error: unknown) => {
      options.onError?.(error);
    });
  };

  tick();
  const intervalId = setIntervalFn(tick, intervalMs);

  return {
    stop: () => clearIntervalFn(intervalId)
  };
}
