import { describe, expect, it } from "vitest";

import { shouldRunDailyBackup } from "./backup-scheduler";

describe("shouldRunDailyBackup", () => {
  it("runs when no backup exists yet", () => {
    expect(shouldRunDailyBackup(null, new Date("2026-06-06T12:00:00.000Z"))).toBe(true);
  });

  it("runs once the last backup is at least 24 hours old", () => {
    expect(
      shouldRunDailyBackup("2026-06-05T12:00:00.000Z", new Date("2026-06-06T12:00:00.000Z"))
    ).toBe(true);
  });

  it("does not run before the daily window", () => {
    expect(
      shouldRunDailyBackup("2026-06-06T00:00:00.000Z", new Date("2026-06-06T12:00:00.000Z"))
    ).toBe(false);
  });
});
