import { describe, expect, it } from "vitest";

import { parseDbTimestamp } from "./format-datetime";

describe("parseDbTimestamp", () => {
  it("trata timestamps do SQLite (sem fuso) como UTC", () => {
    const parsed = parseDbTimestamp("2026-07-07 17:00:48");
    expect(parsed.toISOString()).toBe("2026-07-07T17:00:48.000Z");
  });

  it("aceita o formato ISO sem fuso", () => {
    const parsed = parseDbTimestamp("2026-07-07T17:00:48");
    expect(parsed.toISOString()).toBe("2026-07-07T17:00:48.000Z");
  });

  it("mantem strings ISO com fuso explicito", () => {
    expect(parseDbTimestamp("2026-07-07T17:00:48Z").toISOString()).toBe(
      "2026-07-07T17:00:48.000Z"
    );
    expect(parseDbTimestamp("2026-07-07T17:00:48-03:00").toISOString()).toBe(
      "2026-07-07T20:00:48.000Z"
    );
  });
});
