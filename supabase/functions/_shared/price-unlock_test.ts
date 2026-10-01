import { describe, expect, it } from "vitest";

import {
  activePriceUnlock,
  parsePriceUnlockRequest,
  PRICE_UNLOCK_MAX_MINUTES,
  priceUnlockRow
} from "./price-unlock";

const NOW = "2026-10-01T15:00:00.000Z";
const NOW_MS = Date.parse(NOW);

describe("balanca liberada sem senha", () => {
  it("le o pedido do site e recusa o que nao faz sentido", () => {
    expect(parsePriceUnlockRequest({ mode: "minutes", minutes: 30 })).toEqual({
      mode: "minutes",
      minutes: 30
    });
    expect(parsePriceUnlockRequest({ mode: "indefinite" })).toEqual({ mode: "indefinite" });
    expect(parsePriceUnlockRequest({ mode: "off" })).toEqual({ mode: "off" });
    expect(parsePriceUnlockRequest({ mode: "minutes", minutes: 0 })).toBeNull();
    expect(parsePriceUnlockRequest({ mode: "minutes", minutes: 1.5 })).toBeNull();
    expect(
      parsePriceUnlockRequest({ mode: "minutes", minutes: PRICE_UNLOCK_MAX_MINUTES + 1 })
    ).toBeNull();
    expect(parsePriceUnlockRequest({ mode: "sempre" })).toBeNull();
    expect(parsePriceUnlockRequest({})).toBeNull();
  });

  it("grava o prazo pela hora da nuvem", () => {
    const base = {
      id: "u-1",
      companyId: "c-1",
      userId: "user-1",
      userName: "Rafaela",
      nowIso: NOW
    };
    expect(priceUnlockRow({ mode: "minutes", minutes: 30 }, base)).toMatchObject({
      company_id: "c-1",
      indefinite: false,
      unlocked_until: "2026-10-01T15:30:00.000Z",
      created_by_name: "Rafaela",
      created_at: NOW
    });
    expect(priceUnlockRow({ mode: "indefinite" }, base)).toMatchObject({
      indefinite: true,
      unlocked_until: null
    });
    expect(priceUnlockRow({ mode: "off" }, base)).toMatchObject({
      indefinite: false,
      unlocked_until: null
    });
  });

  it("so vale enquanto o prazo nao venceu; sem prazo vale ate o comercial tirar", () => {
    expect(activePriceUnlock(null, NOW_MS)).toBeNull();
    expect(
      activePriceUnlock(
        { indefinite: false, unlocked_until: "2026-10-01T15:30:00.000Z", created_by_name: "Ana" },
        NOW_MS
      )
    ).toEqual({ indefinite: false, until: "2026-10-01T15:30:00.000Z", byName: "Ana", at: null });
    // Venceu: pede senha de novo.
    expect(
      activePriceUnlock({ indefinite: false, unlocked_until: "2026-10-01T14:59:59.000Z" }, NOW_MS)
    ).toBeNull();
    expect(activePriceUnlock({ indefinite: true, unlocked_until: null }, NOW_MS)).toMatchObject({
      indefinite: true,
      until: null
    });
    // A linha de "voltar a pedir senha".
    expect(activePriceUnlock({ indefinite: false, unlocked_until: null }, NOW_MS)).toBeNull();
  });
});
