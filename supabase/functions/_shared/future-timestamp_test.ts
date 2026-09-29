import { describe, expect, it } from "vitest";

import { clampFutureTimestamps } from "./future-timestamp.ts";

const NOW = Date.parse("2026-09-28T19:00:00.000Z");

describe("clampFutureTimestamps", () => {
  it("troca pela hora do servidor o updated_at alem da tolerancia", () => {
    const { rows, clamped } = clampFutureTimestamps(
      [
        { id: "futuro", updated_at: "2026-09-28T19:17:00.000Z" },
        { id: "folga", updated_at: "2026-09-28T19:00:30.000Z" },
        { id: "passado", updated_at: "2026-09-28T18:00:00.000Z" }
      ],
      NOW
    );
    expect(clamped).toBe(1);
    expect(rows).toEqual([
      { id: "futuro", updated_at: "2026-09-28T19:00:00.000Z" },
      { id: "folga", updated_at: "2026-09-28T19:00:30.000Z" },
      { id: "passado", updated_at: "2026-09-28T18:00:00.000Z" }
    ]);
  });

  it("nao mexe em linha sem updated_at nem em lote vazio", () => {
    expect(clampFutureTimestamps([{ id: "x" }], NOW).rows).toEqual([{ id: "x" }]);
    expect(clampFutureTimestamps(undefined, NOW)).toEqual({ rows: undefined, clamped: 0 });
  });
});
