import { describe, expect, it } from "vitest";

import type { ScaleReading } from "@kyberrock/scale-adapters";

import { SCALE_CAPTURE_TOKEN_TTL_MS, ScaleCaptureTokenStore } from "./scale-capture-tokens";

const CAPTURED_AT = "2026-08-14T12:00:00.000Z";

function reading(weightKg: number): ScaleReading {
  return {
    weightKg,
    unit: "kg",
    status: "stable",
    stable: true,
    capturedAt: CAPTURED_AT,
    receivedAt: CAPTURED_AT
  };
}

describe("ScaleCaptureTokenStore", () => {
  it("devolve o peso capturado para a operacao que emitiu o token", () => {
    const store = new ScaleCaptureTokenStore();
    const captureId = store.issue({
      operationType: "exit",
      reading: reading(38_400),
      operationId: "op-1"
    });

    expect(store.consume(captureId, { operationType: "exit", operationId: "op-1" })).toMatchObject({
      weightKg: 38_400
    });
  });

  it("sem token, deixa quem chamou falar com a balanca na hora", () => {
    const store = new ScaleCaptureTokenStore();
    expect(store.consume(undefined, { operationType: "exit", operationId: "op-1" })).toBeNull();
  });

  it("queima o token: o mesmo peso nao fecha duas operacoes", () => {
    const store = new ScaleCaptureTokenStore();
    const captureId = store.issue({ operationType: "entry", reading: reading(12_000) });

    store.consume(captureId, { operationType: "entry" });

    expect(() => store.consume(captureId, { operationType: "entry" })).toThrow(/ja utilizada/i);
  });

  it("recusa peso de entrada em um fechamento (e vice-versa)", () => {
    const store = new ScaleCaptureTokenStore();
    const captureId = store.issue({ operationType: "entry", reading: reading(12_000) });

    expect(() => store.consume(captureId, { operationType: "exit", operationId: "op-1" })).toThrow(
      /tipo de operacao/i
    );
  });

  it("recusa o peso de saida de uma operacao no fechamento de outra", () => {
    const store = new ScaleCaptureTokenStore();
    const captureId = store.issue({
      operationType: "exit",
      reading: reading(38_400),
      operationId: "op-1"
    });

    expect(() => store.consume(captureId, { operationType: "exit", operationId: "op-2" })).toThrow(
      /outra operacao/i
    );
  });

  it("a captura de entrada nao tem operacao e continua valendo", () => {
    // A entrada e capturada ANTES de a operacao existir: o token nasce sem vinculo
    // e a conferencia de operacao nao pode barra-lo.
    const store = new ScaleCaptureTokenStore();
    const captureId = store.issue({ operationType: "entry", reading: reading(12_000) });

    expect(store.consume(captureId, { operationType: "entry" })).toMatchObject({
      weightKg: 12_000
    });
  });

  /**
   * O caso que travava a balanca: a moca capturava a saida, escolhia o tipo de
   * fechamento e atendia o motorista; passados 30s o token vencia e o conselho da
   * mensagem ("capture o peso novamente") ja era impossivel, com o caminhao fora
   * da balanca. A janela precisa cobrir uma parada real na guarita.
   */
  it("segura o peso de saida durante a conversa na guarita", () => {
    const store = new ScaleCaptureTokenStore();
    const issuedAt = 1_000_000;
    const captureId = store.issue(
      { operationType: "exit", reading: reading(38_400), operationId: "op-1" },
      issuedAt
    );

    const fiveMinutesLater = issuedAt + 5 * 60_000;
    expect(
      store.consume(captureId, { operationType: "exit", operationId: "op-1" }, fiveMinutesLater)
    ).toMatchObject({ weightKg: 38_400 });
  });

  it("mantem uma janela de minutos, nao de segundos", () => {
    expect(SCALE_CAPTURE_TOKEN_TTL_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("vencido o prazo, recusa o peso e diz quanto tempo ele valia", () => {
    const store = new ScaleCaptureTokenStore({ ttlMs: 60_000 });
    const issuedAt = 1_000_000;
    const captureId = store.issue(
      { operationType: "exit", reading: reading(38_400), operationId: "op-1" },
      issuedAt
    );

    expect(() =>
      store.consume(captureId, { operationType: "exit", operationId: "op-1" }, issuedAt + 60_001)
    ).toThrow(/expirada \(o peso capturado vale por 1 minutos\)/i);
  });

  it("descarta tokens vencidos ao emitir o proximo", () => {
    const store = new ScaleCaptureTokenStore({ ttlMs: 60_000 });
    const issuedAt = 1_000_000;
    store.issue({ operationType: "exit", reading: reading(38_400), operationId: "op-1" }, issuedAt);
    expect(store.size).toBe(1);

    store.issue(
      { operationType: "exit", reading: reading(41_000), operationId: "op-2" },
      issuedAt + 120_000
    );

    expect(store.size).toBe(1);
  });
});
