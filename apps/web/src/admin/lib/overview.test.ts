import { describe, expect, it } from "vitest";

import {
  buildOverview,
  isOnline,
  sinceLabel,
  type OverviewCompany,
  type OverviewDevice,
  type OverviewUnit,
  type OverviewUser
} from "./overview";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function company(id: string, overrides: Partial<OverviewCompany> = {}): OverviewCompany {
  return { id, name: `Pedreira ${id}`, isActive: true, omieAppKeyMasked: "****1234", ...overrides };
}

function unit(id: string, companyId: string, overrides: Partial<OverviewUnit> = {}): OverviewUnit {
  return { id, companyId, name: `Unidade ${id}`, isActive: true, ...overrides };
}

/** Balanca em dia: pingou agora e reportou fila vazia. */
function device(
  id: string,
  companyId: string,
  unitId: string,
  overrides: Partial<OverviewDevice> = {}
): OverviewDevice {
  return {
    id,
    companyId,
    unitId,
    name: `Balanca ${id}`,
    isActive: true,
    isPriceMaster: true,
    executesWebOperations: true,
    lastSeenAt: minutesAgo(1),
    healthQueuePending: 0,
    healthQueueBlocked: 0,
    healthOldestPendingAt: null,
    healthLastError: null,
    healthCollectedAt: minutesAgo(1),
    ...overrides
  };
}

function user(id: string, companyId: string, overrides: Partial<OverviewUser> = {}): OverviewUser {
  return { id, role: "gestor", companyId, isActive: true, deviceId: null, ...overrides };
}

describe("buildOverview", () => {
  it("pedreira toda configurada nao gera pendencia nem alerta", () => {
    const overview = buildOverview(
      {
        companies: [company("a")],
        units: [unit("u1", "a")],
        users: [user("p1", "a", { deviceId: "d1" })],
        devices: [device("d1", "a", "u1")]
      },
      NOW
    );
    expect(overview.pending).toEqual([]);
    expect(overview.attention).toEqual([]);
    expect(overview.devices).toMatchObject({ active: 1, online: 1, down: 0, warn: 0 });
  });

  it("envio parado vem antes de balanca sem contato", () => {
    const overview = buildOverview(
      {
        companies: [company("a")],
        units: [unit("u1", "a")],
        users: [],
        devices: [
          device("silenciosa", "a", "u1", { lastSeenAt: minutesAgo(120) }),
          device("travada", "a", "u1", { healthQueueBlocked: 2 })
        ]
      },
      NOW
    );
    expect(overview.attention.map((entry) => entry.device.id)).toEqual(["travada", "silenciosa"]);
    expect(overview.devices).toMatchObject({ down: 1, warn: 1, online: 1 });
  });

  it("o dispositivo virtual do site nao conta como balanca", () => {
    const overview = buildOverview(
      {
        companies: [company("a")],
        units: [unit("u1", "a")],
        users: [],
        devices: [device("web-a", "a", "u1", { lastSeenAt: null, healthCollectedAt: null })]
      },
      NOW
    );
    expect(overview.devices.active).toBe(0);
    expect(overview.attention).toEqual([]);
    // Sem computador de verdade, a pedreira ainda nao tem balanca ativada.
    expect(overview.pending.map((item) => item.kind)).toContain("no-device");
  });

  it("aponta o que falta configurar em cada pedreira ativa", () => {
    const overview = buildOverview(
      {
        companies: [company("a", { omieAppKeyMasked: null })],
        units: [unit("u1", "a")],
        users: [],
        devices: [
          device("d1", "a", "u1", { isPriceMaster: false, executesWebOperations: false }),
          device("d2", "a", "u1", { isPriceMaster: false, executesWebOperations: false })
        ]
      },
      NOW
    );
    const kinds = overview.pending.map((item) => item.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["no-omie", "no-price-master", "no-web-executor", "no-login"])
    );
    // Aviso antes de informacao.
    const tones = overview.pending.map((item) => item.tone);
    expect(tones.indexOf("info")).toBeGreaterThan(tones.lastIndexOf("warn"));
  });

  it("uma balanca so nao precisa de principal de precos", () => {
    const overview = buildOverview(
      {
        companies: [company("a")],
        units: [unit("u1", "a")],
        users: [user("p1", "a", { deviceId: "d1" })],
        devices: [device("d1", "a", "u1", { isPriceMaster: false })]
      },
      NOW
    );
    expect(overview.pending.map((item) => item.kind)).not.toContain("no-price-master");
  });

  it("pedreira inativa nao cobra configuracao", () => {
    const overview = buildOverview(
      {
        companies: [company("a", { isActive: false, omieAppKeyMasked: null })],
        units: [],
        users: [],
        devices: []
      },
      NOW
    );
    expect(overview.pending).toEqual([]);
    expect(overview.companies).toEqual({ total: 1, active: 0 });
  });

  it("resume cada pedreira", () => {
    const overview = buildOverview(
      {
        companies: [company("a")],
        units: [unit("u1", "a"), unit("u2", "a")],
        users: [user("p1", "a"), user("p2", "a", { role: "loader" })],
        devices: [
          device("d1", "a", "u1"),
          device("d2", "a", "u2", { lastSeenAt: minutesAgo(90) }),
          device("d3", "a", "u2", { isActive: false })
        ]
      },
      NOW
    );
    expect(overview.perCompany[0]).toMatchObject({
      units: 2,
      devices: 2,
      online: 1,
      attention: 1,
      users: 2
    });
    expect(overview.users).toMatchObject({ total: 2, loaders: 1, site: 1 });
    expect(overview.devices.blocked).toBe(1);
  });
});

describe("isOnline / sinceLabel", () => {
  it("online e contato nos ultimos 15 minutos", () => {
    expect(isOnline(minutesAgo(14), NOW)).toBe(true);
    expect(isOnline(minutesAgo(16), NOW)).toBe(false);
    expect(isOnline(null, NOW)).toBe(false);
  });

  it("diz ha quanto tempo em palavras", () => {
    expect(sinceLabel(null, NOW)).toBe("nunca");
    expect(sinceLabel(minutesAgo(0), NOW)).toBe("agora");
    expect(sinceLabel(minutesAgo(5), NOW)).toBe("há 5 min");
    expect(sinceLabel(minutesAgo(180), NOW)).toBe("há 3 h");
    expect(sinceLabel(minutesAgo(60 * 50), NOW)).toBe("há 2 dias");
  });
});
