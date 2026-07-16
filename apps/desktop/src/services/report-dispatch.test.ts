import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  DEFAULT_REPORT_DISPATCH_SETTINGS,
  EMPTY_REPORT_DISPATCH_STATE,
  computeDueBundles,
  computeManualBundles,
  normalizeSendHour,
  readReportDispatchSettings,
  readReportDispatchState,
  writeReportDispatchSettings,
  writeReportDispatchState,
  type ReportDispatchSettings,
  type ReportDispatchState
} from "./report-dispatch";

function settingsWith(patch: Partial<ReportDispatchSettings>): ReportDispatchSettings {
  return { ...DEFAULT_REPORT_DISPATCH_SETTINGS, enabled: true, ...patch };
}

function stateWith(patch: Partial<ReportDispatchState>): ReportDispatchState {
  return { ...EMPTY_REPORT_DISPATCH_STATE, ...patch };
}

// 16/07/2026 (quinta-feira) as 19h (apos o horario padrao de envio, 18h).
const NOW = new Date(2026, 6, 16, 19, 0, 0);
// 17/07/2026 (sexta-feira) as 19h — dia em que o pacote semanal dispara.
const FRIDAY = new Date(2026, 6, 17, 19, 0, 0);

describe("computeDueBundles", () => {
  it("returns nothing when disabled", () => {
    expect(computeDueBundles(settingsWith({ enabled: false }), stateWith({}), NOW)).toEqual([]);
  });

  it("returns nothing before the send hour", () => {
    const early = new Date(2026, 6, 16, 17, 59, 0);
    expect(computeDueBundles(settingsWith({}), stateWith({}), early)).toEqual([]);
  });

  it("sends the daily bundle once per day", () => {
    const due = computeDueBundles(settingsWith({}), stateWith({}), NOW);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: "daily", startDate: "2026-07-16", endDate: "2026-07-16" });

    const alreadySent = stateWith({ lastDailyDate: "2026-07-16" });
    expect(computeDueBundles(settingsWith({}), alreadySent, NOW)).toEqual([]);
  });

  it("combines daily and weekly on Fridays", () => {
    const due = computeDueBundles(
      settingsWith({ weekly: true }),
      stateWith({ lastWeeklyDate: "2026-07-10" }),
      FRIDAY
    );
    expect(due.map((bundle) => bundle.kind)).toEqual(["daily", "weekly"]);
    const weekly = due.find((bundle) => bundle.kind === "weekly");
    expect(weekly).toMatchObject({ startDate: "2026-07-11", endDate: "2026-07-17" });
  });

  it("does not send weekly twice on the same Friday", () => {
    const due = computeDueBundles(
      settingsWith({ weekly: true }),
      stateWith({ lastWeeklyDate: "2026-07-17" }),
      FRIDAY
    );
    expect(due.map((bundle) => bundle.kind)).toEqual(["daily"]);
  });

  it("does not send weekly on days other than Friday", () => {
    const due = computeDueBundles(
      settingsWith({ weekly: true }),
      stateWith({ lastWeeklyDate: "2026-07-03" }),
      NOW
    );
    expect(due.map((bundle) => bundle.kind)).toEqual(["daily"]);
  });

  it("sends monthly for the previous month on month turn (with catch-up)", () => {
    const firstOfMonth = new Date(2026, 7, 1, 19, 0, 0); // 01/08/2026
    const due = computeDueBundles(
      settingsWith({ daily: false, monthly: true }),
      stateWith({ lastMonthlyMonth: "2026-06" }),
      firstOfMonth
    );
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      kind: "monthly",
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    });

    // App fechado no dia 1: recupera no dia 3.
    const lateCatchUp = new Date(2026, 7, 3, 19, 0, 0);
    const dueLate = computeDueBundles(
      settingsWith({ daily: false, monthly: true }),
      stateWith({ lastMonthlyMonth: "2026-06" }),
      lateCatchUp
    );
    expect(dueLate[0]).toMatchObject({ kind: "monthly", startDate: "2026-07-01" });

    // Mes anterior ja coberto: nada a enviar.
    const covered = stateWith({ lastMonthlyMonth: "2026-07" });
    expect(
      computeDueBundles(settingsWith({ daily: false, monthly: true }), covered, lateCatchUp)
    ).toEqual([]);
  });

  it("can combine all three bundles on a coinciding day", () => {
    // 01/05/2026 e sexta-feira, entao semanal e mensal vencem no mesmo dia.
    const firstOfMonthOnFriday = new Date(2026, 4, 1, 19, 0, 0);
    const due = computeDueBundles(
      settingsWith({ weekly: true, monthly: true }),
      stateWith({ lastWeeklyDate: "2026-04-20", lastMonthlyMonth: "2026-03" }),
      firstOfMonthOnFriday
    );
    expect(due.map((bundle) => bundle.kind)).toEqual(["daily", "weekly", "monthly"]);
  });

  it("handles february month-end correctly", () => {
    const firstOfMarch = new Date(2026, 2, 1, 19, 0, 0);
    const due = computeDueBundles(
      settingsWith({ daily: false, monthly: true }),
      stateWith({ lastMonthlyMonth: "2026-01" }),
      firstOfMarch
    );
    expect(due[0]).toMatchObject({ startDate: "2026-02-01", endDate: "2026-02-28" });
  });
});

describe("computeManualBundles", () => {
  it("returns the enabled bundles with today-based periods", () => {
    const bundles = computeManualBundles(settingsWith({ weekly: true, monthly: true }), NOW);
    expect(bundles.map((bundle) => bundle.kind)).toEqual(["daily", "weekly", "monthly"]);
    expect(bundles[1]).toMatchObject({ startDate: "2026-07-10", endDate: "2026-07-16" });
    expect(bundles[2]).toMatchObject({ startDate: "2026-06-01", endDate: "2026-06-30" });
  });

  it("falls back to daily when nothing is enabled", () => {
    const bundles = computeManualBundles(
      settingsWith({ daily: false, weekly: false, monthly: false }),
      NOW
    );
    expect(bundles.map((bundle) => bundle.kind)).toEqual(["daily"]);
  });
});

describe("settings persistence", () => {
  function createDatabase() {
    const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
    runDesktopMigrations(db);
    return db;
  }

  it("returns defaults when nothing is stored", () => {
    const db = createDatabase();
    try {
      expect(readReportDispatchSettings(db)).toEqual(DEFAULT_REPORT_DISPATCH_SETTINGS);
      expect(readReportDispatchState(db)).toEqual(EMPTY_REPORT_DISPATCH_STATE);
    } finally {
      db.close();
    }
  });

  it("anchors weekly/monthly state when the bundle is first enabled", () => {
    const db = createDatabase();
    try {
      // 17/07/2026 e sexta-feira, entao a ancora e a unica coisa que impede um
      // envio semanal retroativo no mesmo dia em que o pacote foi ligado.
      const now = new Date(2026, 6, 17, 10, 0, 0);
      writeReportDispatchSettings(db, { enabled: true, weekly: true, monthly: true }, now);

      const state = readReportDispatchState(db);
      expect(state.lastWeeklyDate).toBe("2026-07-17");
      expect(state.lastMonthlyMonth).toBe("2026-06");

      // Com a ancora, nada de semanal/mensal vence hoje — so o diario.
      const due = computeDueBundles(
        readReportDispatchSettings(db),
        state,
        new Date(2026, 6, 17, 19, 0, 0)
      );
      expect(due.map((bundle) => bundle.kind)).toEqual(["daily"]);
    } finally {
      db.close();
    }
  });

  it("keeps existing anchors when re-saving settings", () => {
    const db = createDatabase();
    try {
      writeReportDispatchSettings(db, { enabled: true, weekly: true }, new Date(2026, 6, 1));
      writeReportDispatchState(db, { lastWeeklyDate: "2026-07-08" });
      writeReportDispatchSettings(db, { sendHour: 20 }, new Date(2026, 6, 16));
      expect(readReportDispatchState(db).lastWeeklyDate).toBe("2026-07-08");
    } finally {
      db.close();
    }
  });

  it("normalizes invalid send hours", () => {
    expect(normalizeSendHour(25)).toBe(18);
    expect(normalizeSendHour(-1)).toBe(18);
    expect(normalizeSendHour("20")).toBe(18);
    expect(normalizeSendHour(20)).toBe(20);
  });
});
