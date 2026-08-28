import { describe, expect, it } from "vitest";

import {
  DEVICE_HEALTH_MAX_COUNT,
  DEVICE_HEALTH_MAX_ERROR_LENGTH,
  deviceHealthColumns,
  normalizeDeviceHealth
} from "./device-health.ts";

describe("normalizeDeviceHealth", () => {
  it("aceita o resumo que o desktop manda", () => {
    expect(
      normalizeDeviceHealth({
        queuePending: 3,
        queueBlocked: 1,
        oldestPendingAt: "2026-08-20T08:00:00.000Z",
        lastError: "Cliente sem CEP para a NF-e",
        collectedAt: "2026-08-28T12:00:00.000Z"
      })
    ).toEqual({
      queuePending: 3,
      queueBlocked: 1,
      oldestPendingAt: "2026-08-20T08:00:00.000Z",
      lastError: "Cliente sem CEP para a NF-e",
      collectedAt: "2026-08-28T12:00:00.000Z"
    });
  });

  it("fila limpa e um resumo valido: zero nao e ausencia", () => {
    const report = normalizeDeviceHealth({
      queuePending: 0,
      queueBlocked: 0,
      oldestPendingAt: null,
      lastError: null,
      collectedAt: "2026-08-28T12:00:00.000Z"
    });

    expect(report).not.toBeNull();
    expect(report?.queuePending).toBe(0);
  });

  it("desktop antigo (campo ausente) nao reporta nada", () => {
    expect(normalizeDeviceHealth(undefined)).toBeNull();
    expect(normalizeDeviceHealth(null)).toBeNull();
    expect(normalizeDeviceHealth("saudavel")).toBeNull();
    expect(normalizeDeviceHealth([1, 2])).toBeNull();
  });

  it("objeto sem nenhum campo reconhecido nao vira balanca saudavel", () => {
    // Gravar isto como zero faria uma balanca de origem duvidosa aparecer em
    // dia no painel, que e pior do que ela nao aparecer.
    expect(normalizeDeviceHealth({})).toBeNull();
    expect(normalizeDeviceHealth({ queuePending: "muitos", collectedAt: 42 })).toBeNull();
  });

  it("contagem negativa, quebrada ou absurda nao chega no banco", () => {
    // A coluna e `integer`: um numero inventado faria o update INTEIRO falhar e
    // levaria junto o `last_seen_at` de uma balanca que so esta ligada.
    expect(
      normalizeDeviceHealth({ queuePending: -5, collectedAt: "2026-08-28T12:00:00Z" })?.queuePending
    ).toBe(0);
    expect(
      normalizeDeviceHealth({ queuePending: 2.7, collectedAt: "2026-08-28T12:00:00Z" })
        ?.queuePending
    ).toBe(2);
    expect(
      normalizeDeviceHealth({ queueBlocked: 9e12, collectedAt: "2026-08-28T12:00:00Z" })
        ?.queueBlocked
    ).toBe(DEVICE_HEALTH_MAX_COUNT);
    expect(normalizeDeviceHealth({ queuePending: Number.NaN, queueBlocked: 1 })?.queuePending).toBe(
      0
    );
  });

  it("data que nao e data e descartada em vez de derrubar o update", () => {
    expect(
      normalizeDeviceHealth({ queuePending: 1, oldestPendingAt: "ontem de manha" })?.oldestPendingAt
    ).toBeNull();
    expect(normalizeDeviceHealth({ collectedAt: "ontem de manha" })).toBeNull();
  });

  it("mensagem gigante e truncada", () => {
    const report = normalizeDeviceHealth({ queuePending: 1, lastError: "x".repeat(5000) });

    expect(report?.lastError).toHaveLength(DEVICE_HEALTH_MAX_ERROR_LENGTH);
    expect(report?.lastError?.endsWith("…")).toBe(true);
  });

  it("mensagem em branco vira ausencia", () => {
    expect(normalizeDeviceHealth({ queuePending: 1, lastError: "   " })?.lastError).toBeNull();
  });
});

describe("deviceHealthColumns", () => {
  it("mapeia o resumo para as colunas do device_registrations", () => {
    const report = normalizeDeviceHealth({
      queuePending: 2,
      queueBlocked: 1,
      oldestPendingAt: "2026-08-20T08:00:00.000Z",
      lastError: "OMIE fora do ar",
      collectedAt: "2026-08-28T12:00:00.000Z"
    });

    expect(deviceHealthColumns(report!, "2026-08-28T12:00:05.000Z")).toEqual({
      health_queue_pending: 2,
      health_queue_blocked: 1,
      health_oldest_pending_at: "2026-08-20T08:00:00.000Z",
      health_last_error: "OMIE fora do ar",
      health_collected_at: "2026-08-28T12:00:00.000Z"
    });
  });

  it("sem hora da balanca vale a hora da nuvem: a coluna e o que diz que houve relato", () => {
    const report = normalizeDeviceHealth({ queuePending: 1 });

    expect(deviceHealthColumns(report!, "2026-08-28T12:00:05.000Z").health_collected_at).toBe(
      "2026-08-28T12:00:05.000Z"
    );
  });
});
