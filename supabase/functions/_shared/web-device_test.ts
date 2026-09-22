import { describe, expect, it } from "vitest";

import { sha256Hex } from "./crypto";
import {
  WEB_DEVICE_NAME,
  ensureWebDevice,
  isWebDeviceId,
  webDeviceId,
  webDeviceToken,
  type WebDeviceClient
} from "./web-device";

function fakeClient(existing: Record<string, unknown> | null) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ patch: Record<string, unknown>; id: string }> = [];
  const client: WebDeviceClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) })
      }),
      insert: async (row) => {
        inserts.push(row);
        return { error: null };
      },
      update: (patch) => ({
        eq: async (_column, id) => {
          updates.push({ patch, id });
          return { error: null };
        }
      })
    })
  };
  return { client, inserts, updates };
}

describe("dispositivo virtual do site", () => {
  it("o id e reconhecivel e nunca colide com uma balanca", () => {
    expect(webDeviceId("company-1")).toBe("web-company-1");
    expect(isWebDeviceId("web-company-1")).toBe(true);
    expect(isWebDeviceId("desktop-abc")).toBe(false);
    expect(isWebDeviceId(null)).toBe(false);
  });

  it("o token e deterministico por empresa e muda com a chave de servico", async () => {
    const a = await webDeviceToken("chave-A", "company-1");
    expect(a).toBe(await webDeviceToken("chave-A", "company-1"));
    expect(a).not.toBe(await webDeviceToken("chave-A", "company-2"));
    expect(a).not.toBe(await webDeviceToken("chave-B", "company-1"));
  });

  it("cria o registro na primeira vez, sem marca de principal de precos", async () => {
    const { client, inserts, updates } = fakeClient(null);

    const result = await ensureWebDevice(client, {
      companyId: "company-1",
      unitId: "unit-1",
      serviceRoleKey: "chave-A",
      now: new Date("2026-09-22T12:00:00.000Z")
    });

    expect(result.deviceId).toBe("web-company-1");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      id: "web-company-1",
      company_id: "company-1",
      unit_id: "unit-1",
      name: WEB_DEVICE_NAME,
      is_active: true,
      // A virada de "principal" e um ato explicito (Etapa 4 do plano), nunca deste modulo.
      is_price_master: false,
      installation_id: "web-company-1",
      token_hash: await sha256Hex(result.deviceToken)
    });
    expect(updates).toHaveLength(0);
  });

  it("com o registro ja certo, nao grava nada", async () => {
    const token = await webDeviceToken("chave-A", "company-1");
    const { client, inserts, updates } = fakeClient({
      id: "web-company-1",
      token_hash: await sha256Hex(token)
    });

    await ensureWebDevice(client, {
      companyId: "company-1",
      unitId: "unit-1",
      serviceRoleKey: "chave-A"
    });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  /** Chave de servico trocada: o token derivado muda e o hash gravado precisa acompanhar. */
  it("regrava o hash quando a chave de servico mudou", async () => {
    const oldToken = await webDeviceToken("chave-ANTIGA", "company-1");
    const { client, inserts, updates } = fakeClient({
      id: "web-company-1",
      token_hash: await sha256Hex(oldToken)
    });

    const result = await ensureWebDevice(client, {
      companyId: "company-1",
      unitId: "unit-1",
      serviceRoleKey: "chave-NOVA"
    });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("web-company-1");
    expect(updates[0].patch.token_hash).toBe(await sha256Hex(result.deviceToken));
    expect(updates[0].patch).not.toHaveProperty("is_active");
  });
});
