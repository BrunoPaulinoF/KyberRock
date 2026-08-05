import { describe, expect, it } from "vitest";

import {
  SCALE_LIVE_READING_GRACE_MS,
  SCALE_RECONNECT_PROMPT_DELAY_MS,
  buildScaleLinkMessage,
  buildScaleLinkViewModel,
  trackScaleDegradedSince
} from "./scale-link-view-model";

const NOW = 1_700_000_000_000;

describe("buildScaleLinkViewModel", () => {
  it("mantem a balanca utilizavel quando o adaptador reporta conectado", () => {
    const link = buildScaleLinkViewModel({
      state: "connected",
      lastReadingAt: null,
      degradedSince: null,
      now: NOW
    });

    expect(link).toEqual({ usable: true, showReconnect: false, tone: "connected" });
  });

  it("nao pede reconexao enquanto leituras ao vivo continuam chegando", () => {
    // O caso relatado em campo: o peso aparece na tela, mas uma consulta de
    // status pegou o adaptador no meio de uma reconexao automatica.
    const link = buildScaleLinkViewModel({
      state: "disconnected",
      lastReadingAt: NOW - 1_000,
      degradedSince: NOW - 60_000,
      now: NOW
    });

    expect(link.usable).toBe(true);
    expect(link.showReconnect).toBe(false);
    expect(link.tone).toBe("connected");
  });

  it("para de confiar na leitura ao vivo depois da carencia", () => {
    const link = buildScaleLinkViewModel({
      state: "disconnected",
      lastReadingAt: NOW - SCALE_LIVE_READING_GRACE_MS - 1,
      degradedSince: NOW - SCALE_RECONNECT_PROMPT_DELAY_MS,
      now: NOW
    });

    expect(link.usable).toBe(false);
    expect(link.showReconnect).toBe(true);
    expect(link.tone).toBe("down");
  });

  it("segura o botao durante a reconexao automatica em vez de piscar", () => {
    const link = buildScaleLinkViewModel({
      state: "connecting",
      lastReadingAt: null,
      degradedSince: NOW - 3_000,
      now: NOW
    });

    expect(link.usable).toBe(false);
    expect(link.showReconnect).toBe(false);
    expect(link.tone).toBe("connecting");
  });

  it("pede reconexao quando a queda persiste alem da carencia", () => {
    const link = buildScaleLinkViewModel({
      state: "error",
      lastReadingAt: null,
      degradedSince: NOW - SCALE_RECONNECT_PROMPT_DELAY_MS,
      now: NOW
    });

    expect(link.showReconnect).toBe(true);
    expect(link.tone).toBe("down");
  });

  it("trata uma queda sem marco como recem-iniciada", () => {
    const link = buildScaleLinkViewModel({
      state: "disconnected",
      lastReadingAt: null,
      degradedSince: null,
      now: NOW
    });

    expect(link.showReconnect).toBe(false);
  });
});

describe("trackScaleDegradedSince", () => {
  it("zera o marco assim que o adaptador conecta", () => {
    expect(trackScaleDegradedSince(NOW - 10_000, "connected", NOW)).toBeNull();
  });

  it("marca o inicio da queda na primeira consulta fora de conectado", () => {
    expect(trackScaleDegradedSince(null, "disconnected", NOW)).toBe(NOW);
  });

  it("preserva o marco em consultas seguintes para a carencia avancar", () => {
    const start = NOW - 5_000;
    expect(trackScaleDegradedSince(start, "connecting", NOW)).toBe(start);
    expect(trackScaleDegradedSince(start, "error", NOW)).toBe(start);
  });
});

describe("buildScaleLinkMessage", () => {
  const usable = { usable: true, showReconnect: false, tone: "connected" } as const;
  const reconnecting = { usable: false, showReconnect: false, tone: "connecting" } as const;
  const down = { usable: false, showReconnect: true, tone: "down" } as const;

  it("avisa quando o socket esta aberto sem leitura do indicador", () => {
    expect(buildScaleLinkMessage(usable, { state: "connected", stale: true })).toBe(
      "Conectada, mas sem leitura do indicador"
    );
  });

  it("mostra leitura em tempo real quando ha quadros recentes", () => {
    expect(buildScaleLinkMessage(usable, { state: "connected", stale: false })).toBe(
      "Leitura em tempo real"
    );
  });

  it("explica a reconexao em curso antes de cobrar acao do operador", () => {
    expect(buildScaleLinkMessage(reconnecting, { state: "connecting", stale: true })).toBe(
      "Reconectando a balanca..."
    );
  });

  it("mostra o erro do adaptador quando a reconexao ja falhou", () => {
    expect(
      buildScaleLinkMessage(down, {
        state: "error",
        stale: true,
        errorMessage: "Falha ao abrir a porta COM3."
      })
    ).toBe("Falha ao abrir a porta COM3.");
  });

  it("mostra o diagnostico mesmo com a reconexao ainda em curso", () => {
    // A reconexao nao desiste mais, entao uma balanca fora do ar fica indefinidamente
    // em "connecting": prender a mensagem ao estado "error" esconderia a causa.
    expect(
      buildScaleLinkMessage(down, {
        state: "connecting",
        stale: true,
        errorMessage: "Timeout de conexao (3000ms)"
      })
    ).toBe("Timeout de conexao (3000ms)");
  });

  it("cai na mensagem generica quando o adaptador nao informa causa", () => {
    expect(buildScaleLinkMessage(down, { state: "disconnected", stale: true })).toBe(
      "Balanca desconectada"
    );
  });
});
