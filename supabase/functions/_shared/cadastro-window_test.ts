import { describe, expect, it } from "vitest";

import {
  CADASTRO_ARRIVAL_COLUMN,
  CADASTRO_LEGACY_WINDOW_COLUMN,
  cadastroWindowColumn,
  shouldRetryWithLegacyWindow
} from "./cadastro-window.ts";

describe("cadastroWindowColumn", () => {
  it("recorta o pull incremental pela chegada na nuvem, nao pela edicao", () => {
    // O motivo esta no topo de cadastro-window.ts: `updated_at` e a hora da maquina que
    // editou, e a linha chega aqui muito depois disso.
    expect(cadastroWindowColumn("2026-09-15T10:24:00.000Z")).toBe(CADASTRO_ARRIVAL_COLUMN);
    expect(CADASTRO_ARRIVAL_COLUMN).not.toBe(CADASTRO_LEGACY_WINDOW_COLUMN);
  });

  it("nao recorta nada na varredura completa", () => {
    expect(cadastroWindowColumn(null)).toBeNull();
    expect(cadastroWindowColumn(null, { legacy: true })).toBeNull();
  });

  it("volta ao recorte antigo enquanto a migracao nao chegou", () => {
    expect(cadastroWindowColumn("2026-09-15T10:24:00.000Z", { legacy: true })).toBe(
      CADASTRO_LEGACY_WINDOW_COLUMN
    );
  });
});

describe("shouldRetryWithLegacyWindow", () => {
  it("refaz a consulta quando a coluna nova ainda nao existe", () => {
    expect(
      shouldRetryWithLegacyWindow({
        code: "42703",
        message: "column customers.cloud_synced_at does not exist"
      })
    ).toBe(true);
    expect(shouldRetryWithLegacyWindow({ code: "PGRST204", message: "schema cache" })).toBe(true);
  });

  it("nao refaz nada quando deu certo", () => {
    expect(shouldRetryWithLegacyWindow(null)).toBe(false);
    expect(shouldRetryWithLegacyWindow(undefined)).toBe(false);
  });

  it("banco fora do ar continua virando aviso, nao janela antiga", () => {
    // Cair para o recorte antigo aqui esconderia a falha de verdade atras de um cadastro
    // que "quase" chega — e dobraria a carga sobre um banco que ja esta caindo.
    expect(shouldRetryWithLegacyWindow({ code: "57014", message: "canceling statement" })).toBe(
      false
    );
    expect(shouldRetryWithLegacyWindow({ code: "PGRST001", message: "connection failure" })).toBe(
      false
    );
  });
});
