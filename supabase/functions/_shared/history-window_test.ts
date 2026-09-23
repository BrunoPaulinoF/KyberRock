import { describe, expect, it } from "vitest";

import {
  HISTORY_ARRIVAL_COLUMN,
  HISTORY_LEGACY_WINDOW_COLUMN,
  historyWindowColumn,
  shouldRetryHistoryWithLegacyWindow
} from "./history-window.ts";

describe("historyWindowColumn", () => {
  it("recorta o historico pela chegada na nuvem, nao pela edicao", () => {
    // O cancelamento feito as 12:56 que so chegou as 13:02 tem de entrar no pull de quem ja
    // tinha puxado as 13:00 — por `updated_at` ele ficava de fora para sempre.
    expect(historyWindowColumn("2026-09-18T12:55:00.000Z")).toBe("cloud_synced_at");
    expect(HISTORY_ARRIVAL_COLUMN).not.toBe(HISTORY_LEGACY_WINDOW_COLUMN);
  });

  it("nao recorta nada na varredura completa", () => {
    expect(historyWindowColumn(null)).toBeNull();
    expect(historyWindowColumn(null, { legacy: true })).toBeNull();
  });

  it("cai no recorte antigo so quando pedido", () => {
    expect(historyWindowColumn("2026-09-18T12:55:00.000Z", { legacy: true })).toBe("updated_at");
  });
});

describe("shouldRetryHistoryWithLegacyWindow", () => {
  it("refaz com o recorte antigo quando a coluna nova ainda nao existe", () => {
    expect(
      shouldRetryHistoryWithLegacyWindow({
        code: "42703",
        message: "column weighing_operations.cloud_synced_at does not exist"
      })
    ).toBe(true);
  });

  it("nao refaz por outra falha", () => {
    expect(shouldRetryHistoryWithLegacyWindow(null)).toBe(false);
    expect(
      shouldRetryHistoryWithLegacyWindow({ code: "57014", message: "statement timeout" })
    ).toBe(false);
  });
});
