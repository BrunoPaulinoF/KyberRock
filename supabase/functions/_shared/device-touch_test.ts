import { describe, expect, it } from "vitest";

import { orderedTouchAttempts } from "./device-touch.ts";

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
