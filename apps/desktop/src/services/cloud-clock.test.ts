import { afterEach, describe, expect, it } from "vitest";

import { openDesktopDatabase } from "../database/sqlite";
import {
  CLOUD_CLOCK_JITTER_MS,
  cloudClockOffsetMs,
  installCloudClock,
  installSqliteCloudClock,
  measureCloudClockOffset,
  realNowMs,
  setCloudClockOffsetMs,
  uninstallCloudClockForTests
} from "./cloud-clock";

const SEVENTEEN_MIN = 17 * 60 * 1000;

describe("relogio da nuvem", () => {
  afterEach(() => {
    uninstallCloudClockForTests();
  });

  it("mede o deslocamento pela hora do servidor contra o relogio real", () => {
    const received = Date.parse("2026-09-28T19:00:00.000Z");
    expect(measureCloudClockOffset("2026-09-28T18:43:00.000Z", received)).toBe(-SEVENTEEN_MIN);
    expect(measureCloudClockOffset(null, received)).toBeNull();
    expect(measureCloudClockOffset("lixo", received)).toBeNull();
  });

  it("ignora variacao dentro do ruido da rede e deslocamento absurdo", () => {
    expect(setCloudClockOffsetMs(SEVENTEEN_MIN)).toBe(true);
    expect(setCloudClockOffsetMs(SEVENTEEN_MIN + CLOUD_CLOCK_JITTER_MS - 1)).toBe(false);
    expect(setCloudClockOffsetMs(365 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(setCloudClockOffsetMs("17")).toBe(false);
    expect(cloudClockOffsetMs()).toBe(SEVENTEEN_MIN);
  });

  it("new Date() e Date.now() passam a sair na hora da nuvem", () => {
    installCloudClock();
    setCloudClockOffsetMs(SEVENTEEN_MIN);

    const real = realNowMs();
    expect(Math.abs(Date.now() - (real + SEVENTEEN_MIN))).toBeLessThan(1000);
    expect(Math.abs(new Date().getTime() - (real + SEVENTEEN_MIN))).toBeLessThan(1000);
    // Data com valor explicito nao muda.
    expect(new Date("2026-01-01T00:00:00.000Z").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(new Date(0).getTime()).toBe(0);
    // Identidade preservada: toda data continua sendo Date.
    expect(new Date() instanceof Date).toBe(true);
    expect(typeof Date()).toBe("string");
    expect(Date.parse("2026-01-01T00:00:00.000Z")).toBe(1767225600000);
  });

  it("o 'now' do SQLite passa a sair na hora da nuvem, o resto fica igual", () => {
    installCloudClock();
    setCloudClockOffsetMs(SEVENTEEN_MIN);
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    try {
      const nowIso = database
        .prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .pluck()
        .get() as string;
      expect(Math.abs(Date.parse(nowIso) - (realNowMs() + SEVENTEEN_MIN))).toBeLessThan(2000);

      const datetimeNow = database.prepare("SELECT datetime('now')").pluck().get() as string;
      expect(Math.abs(Date.parse(`${datetimeNow.replace(" ", "T")}Z`) - Date.now())).toBeLessThan(
        2000
      );

      expect(
        database.prepare("SELECT datetime('2026-01-01 10:00:00', '+1 day')").pluck().get()
      ).toBe("2026-01-02 10:00:00");
      expect(database.prepare("SELECT date('2026-03-05')").pluck().get()).toBe("2026-03-05");
      expect(database.prepare("SELECT datetime(NULL)").pluck().get()).toBeNull();
    } finally {
      database.close();
    }
  });

  it("conexao aberta com o relogio certo passa a corrigir quando a diferenca aparece", () => {
    installCloudClock();
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    try {
      const read = () => {
        const text = database.prepare("SELECT datetime('now')").pluck().get() as string;
        return Date.parse(`${text.replace(" ", "T")}Z`);
      };
      expect(Math.abs(read() - realNowMs())).toBeLessThan(2000);

      setCloudClockOffsetMs(SEVENTEEN_MIN);

      expect(Math.abs(read() - (realNowMs() + SEVENTEEN_MIN))).toBeLessThan(2000);
    } finally {
      database.close();
    }
  });

  it("sem o relogio instalado (testes, ferramentas) o SQLite fica como e", () => {
    setCloudClockOffsetMs(SEVENTEEN_MIN);
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    try {
      installSqliteCloudClock(database);
      const datetimeNow = database.prepare("SELECT datetime('now')").pluck().get() as string;
      expect(Math.abs(Date.parse(`${datetimeNow.replace(" ", "T")}Z`) - realNowMs())).toBeLessThan(
        2000
      );
    } finally {
      database.close();
    }
  });
});
