import { describe, expect, it } from "vitest";

import {
  parseUpdateNotice,
  shouldShowUpdateNotice,
  type DesktopUpdateNotice
} from "./update-notice";

describe("parseUpdateNotice", () => {
  it("le a versao e a data do aviso", () => {
    expect(
      parseUpdateNotice({ version: "0.8.201", requestedAt: "2026-08-28T12:00:00.000Z" })
    ).toEqual({ version: "0.8.201", requestedAt: "2026-08-28T12:00:00.000Z" });
  });

  it("aceita a versao com 'v' e sem data", () => {
    expect(parseUpdateNotice({ version: "v0.8.201" })).toEqual({
      version: "0.8.201",
      requestedAt: null
    });
  });

  it("descarta o que nao e uma versao: aviso errado e pior que aviso nenhum", () => {
    // O recado manda o operador reiniciar a balanca. Reiniciar em direcao a
    // "atualize para —" nao e um pedido, e um susto.
    for (const value of [null, undefined, {}, { version: "" }, { version: "0.8" }, "0.8.201"]) {
      expect(parseUpdateNotice(value)).toBeNull();
    }
  });
});

describe("shouldShowUpdateNotice", () => {
  const notice: DesktopUpdateNotice = { version: "0.8.201", requestedAt: null };

  it("mostra enquanto a balanca esta atras da versao pedida", () => {
    expect(shouldShowUpdateNotice(notice, "0.8.200")).toBe(true);
  });

  it("nao mostra na balanca que ja esta na versao pedida", () => {
    // Ela chega nesse estado ANTES de a nuvem apagar o aviso (o desktop-status
    // so limpa no ping seguinte): sem isto, o app recem-atualizado abriria
    // pedindo para atualizar.
    expect(shouldShowUpdateNotice(notice, "0.8.201")).toBe(false);
  });

  it("nao mostra na balanca que ja passou da versao pedida", () => {
    // O caso da VOLTA ATRAS: o painel chamou a frota para uma versao mais velha
    // do que a instalada. Como a balanca de producao nao regride, clicar em
    // "Atualizar agora" nao instalava nada e o recado voltava a cada abertura.
    expect(shouldShowUpdateNotice({ version: "0.8.226", requestedAt: null }, "0.8.236")).toBe(
      false
    );
  });

  it("compara numero a numero, e nao como texto", () => {
    // "0.8.9" > "0.8.10" num compare de texto.
    expect(shouldShowUpdateNotice({ version: "0.8.9", requestedAt: null }, "0.8.10")).toBe(false);
    expect(shouldShowUpdateNotice({ version: "0.8.10", requestedAt: null }, "0.8.9")).toBe(true);
  });

  it("sem aviso nao ha nada a mostrar", () => {
    expect(shouldShowUpdateNotice(null, "0.8.200")).toBe(false);
  });

  it("versao instalada desconhecida ainda mostra o aviso", () => {
    // Nao saber onde a maquina esta nao e motivo para engolir o recado.
    expect(shouldShowUpdateNotice(notice, null)).toBe(true);
  });
});
