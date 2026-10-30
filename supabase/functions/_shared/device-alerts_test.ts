import { describe, expect, it } from "vitest";

import {
  buildDeviceAlertMessage,
  deviceAlertLabel,
  evaluateDeviceAlerts,
  isWithinAlertWindow,
  normalizeAlertPhone,
  planDeviceAlerts,
  recipientsForCompany,
  type DeviceAlertInput
} from "./device-alerts.ts";

// Terca-feira, 14h de Sao Paulo (17h UTC).
const NOW = new Date("2026-10-27T17:00:00.000Z");

function device(overrides: Partial<DeviceAlertInput> = {}): DeviceAlertInput {
  return {
    deviceId: "dev-1",
    companyId: "company-1",
    isActive: true,
    lastSeenAt: "2026-10-27T16:59:00.000Z",
    queuePending: 0,
    queueBlocked: 0,
    oldestPendingAt: null,
    lastError: null,
    ...overrides
  };
}

function stateOf(input: DeviceAlertInput, kind: string, now = NOW) {
  return evaluateDeviceAlerts(input, now).find((evaluation) => evaluation.kind === kind);
}

describe("evaluateDeviceAlerts", () => {
  it("balanca falando e com a fila em dia nao tem alerta", () => {
    for (const evaluation of evaluateDeviceAlerts(device(), NOW)) {
      expect(evaluation.state).toBe("clear");
    }
  });

  it("balanca que ligou hoje e parou no horario de trabalho vira alerta", () => {
    const result = stateOf(device({ lastSeenAt: "2026-10-27T16:20:00.000Z" }), "offline");
    expect(result?.state).toBe("active");
    expect(result?.detail).toBe("parou de responder às 13:20 (há 40 min).");
  });

  it("silencio curto (reinicio do Windows) ainda nao e alerta", () => {
    expect(stateOf(device({ lastSeenAt: "2026-10-27T16:40:00.000Z" }), "offline")?.state).toBe(
      "clear"
    );
  });

  it("balanca que nao ligou hoje (folga, feriado) nao abre alerta", () => {
    expect(stateOf(device({ lastSeenAt: "2026-10-26T20:00:00.000Z" }), "offline")?.state).toBe(
      "unknown"
    );
  });

  it("fora do horario de trabalho a balanca desligada nao abre alerta", () => {
    // 19h de Sao Paulo: a pedreira ja fechou.
    const evening = new Date("2026-10-27T22:00:00.000Z");
    expect(
      stateOf(device({ lastSeenAt: "2026-10-27T21:00:00.000Z" }), "offline", evening)?.state
    ).toBe("unknown");
  });

  it("balanca que nunca falou nao e queda", () => {
    expect(stateOf(device({ lastSeenAt: null }), "offline")?.state).toBe("unknown");
  });

  it("envio parado esperando alguem vira alerta com o ultimo erro", () => {
    const result = stateOf(
      device({ queueBlocked: 2, lastError: "Cliente sem CEP" }),
      "queue_blocked"
    );
    expect(result?.state).toBe("active");
    expect(result?.detail).toContain("2 envios pararam");
    expect(result?.detail).toContain("Último erro: Cliente sem CEP");
  });

  it("fila com envio ha mais de 1 hora vira alerta de atraso", () => {
    const result = stateOf(
      device({ queuePending: 3, oldestPendingAt: "2026-10-27T15:30:00.000Z" }),
      "queue_stuck"
    );
    expect(result?.state).toBe("active");
    expect(result?.detail).toContain("3 envios estão na fila há 1h30");
  });

  it("fila andando no ritmo normal nao e atraso", () => {
    expect(
      stateOf(
        device({ queuePending: 3, oldestPendingAt: "2026-10-27T16:40:00.000Z" }),
        "queue_stuck"
      )?.state
    ).toBe("clear");
  });

  it("calada, a fila nao e julgada: o resumo dela e velho", () => {
    const silent = device({
      lastSeenAt: "2026-10-27T16:00:00.000Z",
      queueBlocked: 0,
      queuePending: 0
    });
    expect(stateOf(silent, "queue_blocked")?.state).toBe("unknown");
    expect(stateOf(silent, "queue_stuck")?.state).toBe("unknown");
  });

  it("balanca em versao sem o resumo de saude nao abre nem resolve alerta de fila", () => {
    const old = device({ queueBlocked: null, queuePending: null });
    expect(stateOf(old, "queue_blocked")?.state).toBe("unknown");
    expect(stateOf(old, "queue_stuck")?.state).toBe("unknown");
  });

  it("balanca bloqueada pelo administrador resolve tudo", () => {
    for (const evaluation of evaluateDeviceAlerts(
      device({ isActive: false, lastSeenAt: null, queueBlocked: 5 }),
      NOW
    )) {
      expect(evaluation.state).toBe("clear");
    }
  });
});

describe("isWithinAlertWindow", () => {
  it("segunda a sabado, das 6h as 18h de Sao Paulo", () => {
    expect(isWithinAlertWindow(new Date("2026-10-27T09:00:00.000Z"))).toBe(true); // ter 06h
    expect(isWithinAlertWindow(new Date("2026-10-27T08:59:00.000Z"))).toBe(false); // ter 05h59
    expect(isWithinAlertWindow(new Date("2026-10-27T21:00:00.000Z"))).toBe(false); // ter 18h
    expect(isWithinAlertWindow(new Date("2026-10-31T15:00:00.000Z"))).toBe(true); // sab 12h
    expect(isWithinAlertWindow(new Date("2026-11-01T15:00:00.000Z"))).toBe(false); // dom 12h
  });
});

describe("planDeviceAlerts", () => {
  it("abre o problema novo uma vez so e resolve o que acabou", () => {
    const plan = planDeviceAlerts({
      devices: [
        device({ deviceId: "dev-1", queueBlocked: 1 }),
        device({ deviceId: "dev-2", lastSeenAt: "2026-10-27T16:00:00.000Z" }),
        device({ deviceId: "dev-3" })
      ],
      openAlerts: [
        { id: "a-1", deviceId: "dev-1", kind: "queue_blocked", notifiedAt: NOW.toISOString() },
        { id: "a-3", deviceId: "dev-3", kind: "offline", notifiedAt: NOW.toISOString() }
      ],
      now: NOW
    });

    // dev-1 ja tinha o alerta aberto: nao repete.
    expect(plan.open).toEqual([
      {
        deviceId: "dev-2",
        companyId: "company-1",
        kind: "offline",
        detail: expect.stringContaining("parou de responder")
      }
    ]);
    // dev-3 voltou a responder.
    expect(plan.resolve.map((alert) => alert.id)).toEqual(["a-3"]);
  });

  it("alerta aberto continua aberto enquanto o estado e desconhecido", () => {
    const evening = new Date("2026-10-27T23:00:00.000Z");
    const plan = planDeviceAlerts({
      devices: [device({ lastSeenAt: "2026-10-27T18:00:00.000Z" })],
      openAlerts: [{ id: "a-1", deviceId: "dev-1", kind: "offline", notifiedAt: null }],
      now: evening
    });
    expect(plan).toEqual({ open: [], resolve: [] });
  });

  it("resolve o alerta da balanca que saiu do cadastro", () => {
    const plan = planDeviceAlerts({
      devices: [],
      openAlerts: [{ id: "a-9", deviceId: "dev-9", kind: "offline", notifiedAt: null }],
      now: NOW
    });
    expect(plan.resolve.map((alert) => alert.id)).toEqual(["a-9"]);
  });
});

describe("destinatarios", () => {
  it("a pedreira recebe os numeros dela e os do suporte, sem repetir", () => {
    expect(
      recipientsForCompany(
        [
          { companyId: null, whatsappPhone: "(11) 99999-0001", isActive: true },
          { companyId: "company-1", whatsappPhone: "5511999990002", isActive: true },
          { companyId: "company-1", whatsappPhone: "11 99999-0001", isActive: true },
          { companyId: "company-2", whatsappPhone: "11999990003", isActive: true },
          { companyId: "company-1", whatsappPhone: "11999990004", isActive: false }
        ],
        "company-1"
      )
    ).toEqual(["5511999990001", "5511999990002"]);
  });

  it("normaliza o numero para o formato do UAZAPI", () => {
    expect(normalizeAlertPhone("(15) 3333-4444")).toBe("551533334444");
    expect(normalizeAlertPhone("+55 15 99999-8888")).toBe("5515999998888");
    expect(normalizeAlertPhone("123")).toBe("");
    expect(normalizeAlertPhone(null)).toBe("");
  });
});

describe("mensagem", () => {
  it("junta o que abriu e o que resolveu na mesma pedreira", () => {
    const text = buildDeviceAlertMessage({
      companyName: "Pedreira Ibiúna",
      opened: [
        {
          deviceLabel: "Balança 2 — Matriz",
          kind: "offline",
          detail: "parou de responder às 13:20 (há 40 min)."
        }
      ],
      resolved: [{ deviceLabel: "Balança 1 — Matriz", kind: "queue_blocked", detail: null }]
    });
    expect(text).toBe(
      [
        "*KyberRock — Pedreira Ibiúna*",
        "",
        "⚠️ *Balança sem contato* — Balança 2 — Matriz",
        "parou de responder às 13:20 (há 40 min).",
        "",
        "✅ *Resolvido* — Balança 1 — Matriz: não tem mais envio parado."
      ].join("\n")
    );
  });

  it("nome da balanca com numero e unidade", () => {
    expect(deviceAlertLabel({ deviceName: "Expedição", deviceNumber: 2, unitName: "Matriz" })).toBe(
      "Expedição (nº 2) — Matriz"
    );
    expect(deviceAlertLabel({ deviceName: "Balança 2", deviceNumber: 2, unitName: null })).toBe(
      "Balança 2"
    );
    expect(deviceAlertLabel({ deviceName: " ", deviceNumber: null, unitName: "Matriz" })).toBe(
      "Balança — Matriz"
    );
  });
});
