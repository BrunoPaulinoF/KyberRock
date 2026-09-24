import { describe, expect, it } from "vitest";

import {
  countInProgressByProduct,
  formatArrival,
  getInProgressOperations,
  getOvertimeOperations,
  getRecentCompletedOperations,
  getRenderedOperations,
  minutesSinceArrival,
  RECENT_COMPLETION_WINDOW_MS
} from "./LoaderDashboard";
import type { WeighingOperation } from "./LoaderDashboard";

function makeOperation(
  id: string,
  createdAt: string,
  loaderCompletedAt: string | null = null
): WeighingOperation {
  return {
    id,
    plate: `ABC${id}`,
    customerName: "Cliente Teste",
    driverName: "Motorista Teste",
    productDescription: "Brita",
    entryWeightKg: 12_000,
    status: "open",
    createdAt,
    loaderCompletedAt
  };
}

function getVisibleLoaderOperations(operations: WeighingOperation[]): WeighingOperation[] {
  return operations.filter((operation) => !operation.loaderCompletedAt);
}

describe("LoaderDashboard visible operations", () => {
  it("keeps operations without loaderCompletedAt visible to the loader", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const visible = getVisibleLoaderOperations([first, second]);

    expect(visible).toEqual([first, second]);
  });

  it("hides operations with loaderCompletedAt after the loader concludes the load", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const visible = getVisibleLoaderOperations([first, second]);

    expect(visible).toEqual([second]);
  });
});

describe("LoaderDashboard overtime alert", () => {
  const base = new Date("2026-06-25T10:00:00.000Z").getTime();
  const now = base + 50 * 60_000; // 50 minutos depois

  it("flags in-progress trucks that exceed the average quarry time", () => {
    const slow = makeOperation("1", "2026-06-25T10:00:00.000Z"); // 50 min
    const fresh = makeOperation("2", "2026-06-25T09:50:00.000Z");
    // fresh chegou 10 min antes de slow, entao ja tem 60 min -> tambem acima.
    const recent = makeOperation("3", new Date(now - 10 * 60_000).toISOString()); // 10 min

    const overtime = getOvertimeOperations([slow, fresh, recent], 30, now);

    expect(overtime.map((o) => o.id)).toEqual(["1", "2"]);
  });

  it("returns nothing when there is no average", () => {
    const slow = makeOperation("1", "2026-06-25T10:00:00.000Z");
    expect(getOvertimeOperations([slow], null, now)).toEqual([]);
    expect(getOvertimeOperations([slow], 0, now)).toEqual([]);
  });

  it("ignores trucks already completed by the loader", () => {
    const done = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:40:00.000Z");
    expect(getOvertimeOperations([done], 30, now)).toEqual([]);
  });

  it("computes elapsed minutes since arrival", () => {
    expect(minutesSinceArrival("2026-06-25T10:00:00.000Z", base + 30 * 60_000)).toBe(30);
    expect(minutesSinceArrival("invalid", now)).toBe(0);
  });
});

describe("LoaderDashboard compact arrival label", () => {
  const timeZone = "America/Sao_Paulo";

  it("shows only the time when the truck arrived on the same day in the unit timezone", () => {
    // 11:12 UTC = 08:12 em Sao Paulo (UTC-3).
    const arrival = "2026-07-31T11:12:00.000Z";
    const now = new Date("2026-07-31T17:00:00.000Z").getTime();

    expect(formatArrival(arrival, timeZone, now)).toBe("08:12");
  });

  it("prefixes the day when the queue crossed midnight", () => {
    const arrival = "2026-07-30T22:40:00.000Z"; // 30/07 19:40 em Sao Paulo
    const now = new Date("2026-07-31T12:00:00.000Z").getTime();

    expect(formatArrival(arrival, timeZone, now)).toBe("30/07 19:40");
  });

  it("falls back to the unit default timezone and handles missing/invalid values", () => {
    const arrival = "2026-07-31T11:12:00.000Z";
    const now = new Date("2026-07-31T17:00:00.000Z").getTime();

    expect(formatArrival(arrival, null, now)).toBe("08:12");
    expect(formatArrival(null, timeZone, now)).toBe("-");
    expect(formatArrival("invalid", timeZone, now)).toBe("-");
  });
});

describe("LoaderDashboard recent completions history", () => {
  const now = new Date("2026-07-31T12:00:00.000Z").getTime();

  it("lists only loads completed inside the 30 minute window, most recent first", () => {
    const justDone = makeOperation("1", "2026-07-31T11:00:00.000Z", "2026-07-31T11:55:00.000Z");
    const older = makeOperation("2", "2026-07-31T10:00:00.000Z", "2026-07-31T11:40:00.000Z");
    const tooOld = makeOperation("3", "2026-07-31T09:00:00.000Z", "2026-07-31T11:00:00.000Z");
    const inProgress = makeOperation("4", "2026-07-31T11:50:00.000Z");

    const recent = getRecentCompletedOperations([older, tooOld, inProgress, justDone], now);

    expect(recent.map((o) => o.id)).toEqual(["1", "2"]);
  });

  it("keeps a load completed exactly at the window edge and drops invalid timestamps", () => {
    const edge = makeOperation(
      "1",
      "2026-07-31T10:00:00.000Z",
      new Date(now - RECENT_COMPLETION_WINDOW_MS).toISOString()
    );
    const invalid = makeOperation("2", "2026-07-31T10:00:00.000Z", "not-a-date");

    expect(getRecentCompletedOperations([edge, invalid], now).map((o) => o.id)).toEqual(["1"]);
  });

  it("returns an empty list when nothing was completed", () => {
    const waiting = makeOperation("1", "2026-07-31T11:50:00.000Z");
    expect(getRecentCompletedOperations([waiting], now)).toEqual([]);
  });
});

describe("countInProgressByProduct", () => {
  function withProduct(id: string, productDescription: string): WeighingOperation {
    return { ...makeOperation(id, "2026-06-25T10:00:00.000Z"), productDescription };
  }

  it("conta as cargas em aberto de cada produto, da maior fila para a menor", () => {
    const counts = countInProgressByProduct([
      withProduct("1", "Po de pedra"),
      withProduct("2", "Brita 1"),
      withProduct("3", "Brita 1")
    ]);

    expect(counts).toEqual([
      { label: "Brita 1", count: 2 },
      { label: "Po de pedra", count: 1 }
    ]);
  });

  it("junta a mesma descricao com caixa diferente e nomeia o produto vazio", () => {
    const counts = countInProgressByProduct([
      withProduct("1", "Brita 1"),
      withProduct("2", "BRITA 1"),
      withProduct("3", "  ")
    ]);

    expect(counts).toEqual([
      { label: "Brita 1", count: 2 },
      { label: "Sem produto", count: 1 }
    ]);
  });

  it("devolve lista vazia sem cargas em aberto", () => {
    expect(countInProgressByProduct([])).toEqual([]);
  });
});

describe("LoaderDashboard departure animation", () => {
  it("excludes concluded operations from the in-progress count", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    expect(getInProgressOperations([first, second])).toEqual([second]);
  });

  it("keeps a concluded operation rendered in place while its truck drives off", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const rendered = getRenderedOperations([first, second], new Set(["1"]));

    // The departing row stays visible (and in its original position) so the
    // animation can play, alongside the still-open rows.
    expect(rendered).toEqual([first, second]);
  });

  it("drops a concluded operation once its departure animation has finished", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const rendered = getRenderedOperations([first, second], new Set());

    expect(rendered).toEqual([second]);
  });
});
