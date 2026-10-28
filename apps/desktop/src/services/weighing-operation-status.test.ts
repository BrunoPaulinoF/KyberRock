import { describe, expect, it } from "vitest";

import { openDesktopDatabase } from "../database/sqlite";
import { operationSaleDay, operationSaleDaySql } from "./weighing-operation-status";

// O dia da venda e calculado em DOIS lugares: no JS (emissao do OMIE, VENCTO do cupom) e
// no SQL (recorte dos relatorios). Se discordarem, o relatorio volta a nao bater com o OMIE
// justamente na pesagem da noite.
const CASES: Array<[string, string]> = [
  ["2026-10-20T13:00:00.000Z", "2026-10-20"],
  // 22h de 20/10 em Sao Paulo.
  ["2026-10-21T01:00:00.000Z", "2026-10-20"],
  // 23h59 de 20/10 e meia-noite de 21/10 em Sao Paulo.
  ["2026-10-21T02:59:59.999Z", "2026-10-20"],
  ["2026-10-21T03:00:00.000Z", "2026-10-21"],
  // Virada de ano.
  ["2027-01-01T02:30:00.000Z", "2026-12-31"],
  // Como o pull grava o horario da nuvem e como o `datetime()` do SQLite grava (sem fuso = UTC).
  ["2026-10-21T01:00:00+00:00", "2026-10-20"],
  ["2026-10-21 01:00:00", "2026-10-20"],
  // So a data ja e o dia do calendario.
  ["2026-10-21", "2026-10-21"]
];

describe("dia da venda", () => {
  it.each(CASES)("%s e do dia %s em Sao Paulo", (capturedAt, day) => {
    expect(operationSaleDay(capturedAt)).toBe(day);
  });

  it("o SQL dos relatorios da o mesmo dia que o JS da emissao", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      database.exec("CREATE TABLE sale (exit_weight_captured_at TEXT, created_at TEXT NOT NULL)");
      const insert = database.prepare(
        "INSERT INTO sale (exit_weight_captured_at, created_at) VALUES (?, '2000-01-01T12:00:00.000Z')"
      );
      for (const [capturedAt] of CASES) insert.run(capturedAt);

      const rows = database
        .prepare(`SELECT exit_weight_captured_at AS at, ${operationSaleDaySql()} AS day FROM sale`)
        .all() as Array<{ at: string; day: string }>;

      expect(rows.map((row) => row.day)).toEqual(rows.map((row) => operationSaleDay(row.at)));
      expect(rows.map((row) => row.day)).toEqual(CASES.map(([, day]) => day));
    } finally {
      database.close();
    }
  });

  it("sem horario de saida, vale o de criacao", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      expect(
        database
          .prepare(
            `SELECT ${operationSaleDaySql("o")} FROM (SELECT NULL AS exit_weight_captured_at, '2026-10-21T01:00:00.000Z' AS created_at) o`
          )
          .pluck()
          .get()
      ).toBe("2026-10-20");
      expect(operationSaleDay(null)).toBe("");
    } finally {
      database.close();
    }
  });
});
