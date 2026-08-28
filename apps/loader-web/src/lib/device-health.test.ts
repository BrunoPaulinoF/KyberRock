import { describe, expect, it } from "vitest";

import {
  classifyDeviceHealth,
  DEVICE_OFFLINE_THRESHOLD_MS,
  formatElapsed,
  QUEUE_STUCK_THRESHOLD_MS,
  type DeviceHealthInput
} from "./device-health";

const NOW = new Date("2026-08-28T12:00:00.000Z");

function device(overrides: Partial<DeviceHealthInput> = {}): DeviceHealthInput {
  return {
    isActive: true,
    lastSeenAt: NOW.toISOString(),
    queuePending: 0,
    queueBlocked: 0,
    oldestPendingAt: null,
    lastError: null,
    collectedAt: NOW.toISOString(),
    ...overrides
  };
}

describe("classifyDeviceHealth", () => {
  it("fila limpa e balanca respondendo: em dia", () => {
    const verdict = classifyDeviceHealth(device(), NOW);

    expect(verdict.level).toBe("ok");
    expect(verdict.label).toBe("Em dia");
  });

  it("balanca que nunca reportou fica em 'sem dados', nunca em verde", () => {
    // Pintar de verde seria o painel afirmando o que ninguem apurou: instalacao
    // em versao anterior a este relatorio nunca vai preencher as colunas.
    const verdict = classifyDeviceHealth(
      device({ collectedAt: null, queuePending: null, queueBlocked: null }),
      NOW
    );

    expect(verdict.level).toBe("unknown");
    expect(verdict.label).toBe("Sem dados");
  });

  it("balanca bloqueada nao entra na conta: ela nao sincroniza nada", () => {
    const verdict = classifyDeviceHealth(
      device({ isActive: false, queueBlocked: 4, lastSeenAt: null }),
      NOW
    );

    expect(verdict.level).toBe("unknown");
    expect(verdict.label).toBe("—");
  });

  it("envio parado e vermelho e vem antes de qualquer outra coisa", () => {
    // A balanca desligada volta sozinha quando alguem a liga; o envio parado
    // nao volta nunca sem um clique. Por isso ele ganha do silencio.
    const verdict = classifyDeviceHealth(
      device({
        queueBlocked: 2,
        lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        lastError: "Cliente sem CEP para a NF-e"
      }),
      NOW
    );

    expect(verdict.level).toBe("down");
    expect(verdict.label).toBe("2 parados");
    expect(verdict.detail).toContain("Cliente sem CEP para a NF-e");
    expect(verdict.detail).toContain("Ultimo contato ha 5 h.");
  });

  it("singular e plural do rotulo", () => {
    expect(classifyDeviceHealth(device({ queueBlocked: 1 }), NOW).label).toBe("1 parado");
    expect(classifyDeviceHealth(device({ queueBlocked: 3 }), NOW).label).toBe("3 parados");
  });

  it("silencio maior que o limite vira 'sem contato'", () => {
    const verdict = classifyDeviceHealth(
      device({
        lastSeenAt: new Date(NOW.getTime() - DEVICE_OFFLINE_THRESHOLD_MS - 1_000).toISOString()
      }),
      NOW
    );

    expect(verdict.level).toBe("warn");
    expect(verdict.label).toBe("Sem contato");
  });

  it("oscilacao curta de link nao pinta a tela: dentro do limite continua em dia", () => {
    const verdict = classifyDeviceHealth(
      device({
        lastSeenAt: new Date(NOW.getTime() - DEVICE_OFFLINE_THRESHOLD_MS + 1_000).toISOString()
      }),
      NOW
    );

    expect(verdict.level).toBe("ok");
  });

  it("balanca cadastrada que nunca pingou conta como sem contato", () => {
    const verdict = classifyDeviceHealth(device({ lastSeenAt: null }), NOW);

    expect(verdict.level).toBe("warn");
    expect(verdict.detail).toContain("Nunca houve contato");
  });

  it("fila comprida e recente e ritmo normal, nao problema", () => {
    const verdict = classifyDeviceHealth(
      device({
        queuePending: 12,
        oldestPendingAt: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString()
      }),
      NOW
    );

    expect(verdict.level).toBe("ok");
    expect(verdict.label).toBe("12 na fila");
  });

  it("a mesma fila parada ha mais de uma varredura vira atraso", () => {
    const verdict = classifyDeviceHealth(
      device({
        queuePending: 12,
        oldestPendingAt: new Date(NOW.getTime() - QUEUE_STUCK_THRESHOLD_MS - 1_000).toISOString(),
        lastError: "OMIE fora do ar"
      }),
      NOW
    );

    expect(verdict.level).toBe("warn");
    expect(verdict.label).toBe("12 atrasados");
    expect(verdict.detail).toContain("OMIE fora do ar");
  });

  it("relogio adiantado na balanca nao vira atraso negativo", () => {
    const verdict = classifyDeviceHealth(
      device({
        lastSeenAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
        queuePending: 1,
        oldestPendingAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()
      }),
      NOW
    );

    expect(verdict.level).toBe("ok");
    expect(verdict.label).toBe("1 na fila");
  });

  it("data corrompida nao derruba a classificacao", () => {
    const verdict = classifyDeviceHealth(
      device({ lastSeenAt: "ontem", oldestPendingAt: "sei la", queuePending: 2 }),
      NOW
    );

    expect(verdict.level).toBe("warn");
    expect(verdict.label).toBe("Sem contato");
  });
});

describe("formatElapsed", () => {
  it("aproxima pela ordem de grandeza", () => {
    expect(formatElapsed(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe(
      "agora ha pouco"
    );
    expect(formatElapsed(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe("ha 5 min");
    expect(formatElapsed(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW)).toBe(
      "ha 3 h"
    );
    expect(formatElapsed(new Date(NOW.getTime() - 26 * 3_600_000).toISOString(), NOW)).toBe(
      "ha 1 dia"
    );
    expect(formatElapsed(new Date(NOW.getTime() - 72 * 3_600_000).toISOString(), NOW)).toBe(
      "ha 3 dias"
    );
  });

  it("sem data nao inventa tempo", () => {
    expect(formatElapsed(null, NOW)).toBeNull();
    expect(formatElapsed("qualquer coisa", NOW)).toBeNull();
  });
});
