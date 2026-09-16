import { describe, expect, it } from "vitest";

import { orderedTouchAttempts, shouldWriteDeviceTouch } from "./device-touch.ts";

const TOUCH = { last_seen_at: "2026-08-28T12:00:00.000Z", updated_at: "2026-08-28T12:00:00.000Z" };
const ENRICHED = { ...TOUCH, app_version: "0.8.0" };
const WITH_HEALTH = { ...ENRICHED, health_queue_pending: 0 };

describe("orderedTouchAttempts", () => {
  it("mantem os degraus do mais completo para o mais pobre", () => {
    expect(orderedTouchAttempts([WITH_HEALTH, ENRICHED, TOUCH])).toEqual([
      WITH_HEALTH,
      ENRICHED,
      TOUCH
    ]);
  });

  it("degrau identico ao seguinte nao gasta uma ida ao banco", () => {
    // Desktop que nao reporta saude: o degrau da saude e o mesmo da versao.
    expect(orderedTouchAttempts([ENRICHED, ENRICHED, TOUCH])).toEqual([ENRICHED, TOUCH]);
  });

  it("o ultimo degrau roda mesmo quando nao ha nada a enriquecer", () => {
    // Este e o caso que estava quebrado: o desktop antigo manda so deviceId e
    // token, os tres degraus sao iguais e a versao anterior nao gravava nada —
    // a balanca ficava com o `last_seen_at` congelado e o painel a mostrava
    // eternamente offline.
    expect(orderedTouchAttempts([TOUCH, TOUCH, TOUCH])).toEqual([TOUCH]);
  });

  it("mesma quantidade de colunas com nomes diferentes sao degraus diferentes", () => {
    const outro = { last_seen_at: TOUCH.last_seen_at, app_version: "0.8.0" };

    expect(orderedTouchAttempts([outro, TOUCH])).toEqual([outro, TOUCH]);
  });

  it("um degrau so continua sendo um degrau", () => {
    expect(orderedTouchAttempts([TOUCH])).toEqual([TOUCH]);
  });
});

describe("shouldWriteDeviceTouch", () => {
  const CHECKED_AT = "2026-09-16T12:00:00.000Z";
  const STORED = {
    last_seen_at: "2026-09-16T11:59:30.000Z",
    app_version: "0.9.0",
    app_version_seen_at: "2026-09-16T11:59:30.000Z",
    update_notice_version: null,
    update_notice_sent_at: null,
    update_notice_seen_at: null,
    health_queue_pending: 0,
    health_queue_blocked: 0,
    health_oldest_pending_at: null,
    health_last_error: null,
    health_collected_at: "2026-09-16T11:59:30.000Z"
  };
  const SAME_TOUCH = {
    last_seen_at: CHECKED_AT,
    updated_at: CHECKED_AT,
    app_version: "0.9.0",
    app_version_seen_at: CHECKED_AT,
    health_queue_pending: 0,
    health_queue_blocked: 0,
    health_oldest_pending_at: null,
    health_last_error: null,
    health_collected_at: CHECKED_AT
  };

  it("nada mudou e o relogio e recente: nao gasta um update", () => {
    expect(shouldWriteDeviceTouch(STORED, SAME_TOUCH, CHECKED_AT)).toBe(false);
  });

  it("nada mudou mas o relogio ja passou da folga: grava", () => {
    // 5 min e 1 s desde o ultimo carimbo — o painel nao pode ver a balanca envelhecer
    // ate o limite de 15 min so porque a pedreira esta parada.
    const stale = { ...STORED, last_seen_at: "2026-09-16T11:54:59.000Z" };
    expect(shouldWriteDeviceTouch(stale, SAME_TOUCH, CHECKED_AT)).toBe(true);
  });

  it("fila que encheu vai para o painel na hora, sem esperar a folga", () => {
    const touch = { ...SAME_TOUCH, health_queue_pending: 3 };
    expect(shouldWriteDeviceTouch(STORED, touch, CHECKED_AT)).toBe(true);
  });

  it("balanca que atualizou de versao grava na hora", () => {
    const touch = { ...SAME_TOUCH, app_version: "0.9.1" };
    expect(shouldWriteDeviceTouch(STORED, touch, CHECKED_AT)).toBe(true);
  });

  it("marca de aviso entregue grava na hora", () => {
    const touch = { ...SAME_TOUCH, update_notice_seen_at: CHECKED_AT };
    expect(shouldWriteDeviceTouch(STORED, touch, CHECKED_AT)).toBe(true);
  });

  it("erro que sumiu da fila tambem e mudanca", () => {
    const stored = { ...STORED, health_last_error: "OMIE recusou" };
    expect(shouldWriteDeviceTouch(stored, SAME_TOUCH, CHECKED_AT)).toBe(true);
  });

  it("formato de data do Postgres nao conta como mudanca", () => {
    // O banco devolve `+00:00` com microssegundos; a funcao monta `Z` com milissegundos.
    const stored = {
      ...STORED,
      health_oldest_pending_at: "2026-09-16 11:30:00.123456+00"
    };
    const touch = { ...SAME_TOUCH, health_oldest_pending_at: "2026-09-16T11:30:00.123Z" };
    expect(shouldWriteDeviceTouch(stored, touch, CHECKED_AT)).toBe(false);
  });

  it("coluna que nao veio no SELECT grava, em vez de supor que esta igual", () => {
    // Degrau mais pobre da escada (migracao da saude pendente): sem o valor gravado a
    // comparacao nao pode afirmar nada, e o lado seguro e escrever.
    const withoutHealth: Record<string, unknown> = { ...STORED };
    delete withoutHealth.health_queue_pending;
    expect(shouldWriteDeviceTouch(withoutHealth, SAME_TOUCH, CHECKED_AT)).toBe(true);
  });

  it("balanca que nunca pingou grava", () => {
    expect(shouldWriteDeviceTouch({ ...STORED, last_seen_at: null }, SAME_TOUCH, CHECKED_AT)).toBe(
      true
    );
  });

  it("carimbo no futuro nao vira silencio eterno", () => {
    // Relogio da balanca adiantado gravou uma data a frente: sem esta guarda a diferenca
    // ficaria negativa e a linha nunca mais seria atualizada.
    const ahead = { ...STORED, last_seen_at: "2026-09-16T18:00:00.000Z" };
    expect(shouldWriteDeviceTouch(ahead, SAME_TOUCH, CHECKED_AT)).toBe(true);
  });

  it("sem a linha em maos, grava", () => {
    expect(shouldWriteDeviceTouch(null, SAME_TOUCH, CHECKED_AT)).toBe(true);
  });
});
