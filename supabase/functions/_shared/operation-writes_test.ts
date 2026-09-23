import { describe, expect, it } from "vitest";

import { cancellationReannouncements, isStaleOperationWrite } from "./operation-writes.ts";

const CANCELLED_AT = "2026-09-18T12:56:45.569Z";

describe("isStaleOperationWrite", () => {
  it("nao deixa uma copia mais nova de outro status desfazer o cancelamento", () => {
    // O computador que nao ficou sabendo do cancelamento mexeu na carga depois: a copia
    // dele e mais nova, mas a carga continua cancelada.
    expect(
      isStaleOperationWrite(
        { status: "cancelled", updated_at: CANCELLED_AT },
        { status: "synced", updated_at: "2026-09-19T09:00:00.000Z" }
      )
    ).toBe(true);
  });

  it("aceita o proprio cancelamento reenviado", () => {
    expect(
      isStaleOperationWrite(
        { status: "cancelled", updated_at: CANCELLED_AT },
        { status: "cancelled", updated_at: "2026-09-18T13:00:00.000Z" }
      )
    ).toBe(false);
  });

  it("aceita o cancelamento de uma carga concluida", () => {
    expect(
      isStaleOperationWrite(
        { status: "synced", updated_at: "2026-09-18T12:01:11.931Z" },
        { status: "cancelled", updated_at: CANCELLED_AT }
      )
    ).toBe(false);
  });

  it("mantem as regras antigas: status terminal nao volta a aberto, copia velha nao entra", () => {
    expect(
      isStaleOperationWrite(
        { status: "synced", updated_at: "2026-09-18T12:00:00.000Z" },
        { status: "awaiting_exit", updated_at: "2026-09-18T13:00:00.000Z" }
      )
    ).toBe(true);
    expect(
      isStaleOperationWrite(
        { status: "synced", updated_at: "2026-09-18T12:00:00.000Z" },
        { status: "synced", updated_at: "2026-09-18T11:00:00.000Z" }
      )
    ).toBe(true);
    expect(
      isStaleOperationWrite(
        { status: "awaiting_exit", updated_at: "2026-09-18T12:00:00.000Z" },
        { status: "synced", updated_at: "2026-09-18T12:30:00.000Z" }
      )
    ).toBe(false);
  });
});

describe("cancellationReannouncements", () => {
  const now = new Date("2026-09-19T09:00:00.000Z");
  const current = new Map([
    ["op-cancelada", { status: "cancelled", updated_at: CANCELLED_AT }],
    ["op-concluida", { status: "synced", updated_at: "2026-09-18T12:00:00.000Z" }]
  ]);

  it("reanuncia a carga cancelada que uma balanca tentou sobrescrever com copia mais nova", () => {
    const result = cancellationReannouncements(
      current,
      [{ id: "op-cancelada", status: "synced", updated_at: "2026-09-19T10:00:00.000Z" }],
      now
    );
    // Depois da copia recusada, para vencer o "mais novo ganha" do espelho daquela balanca.
    expect(result).toEqual([{ id: "op-cancelada", updatedAt: "2026-09-19T10:00:00.001Z" }]);
  });

  it("nunca carimba antes do relogio da nuvem", () => {
    const result = cancellationReannouncements(
      current,
      [{ id: "op-cancelada", status: "synced", updated_at: "2026-09-18T13:00:00.000Z" }],
      now
    );
    expect(result).toEqual([{ id: "op-cancelada", updatedAt: now.toISOString() }]);
  });

  it("ignora copia mais velha que o cancelamento, o cancelamento reenviado e carga nao cancelada", () => {
    expect(
      cancellationReannouncements(
        current,
        [
          { id: "op-cancelada", status: "synced", updated_at: "2026-09-18T12:00:00.000Z" },
          { id: "op-cancelada", status: "cancelled", updated_at: "2026-09-19T10:00:00.000Z" },
          { id: "op-concluida", status: "synced", updated_at: "2026-09-19T10:00:00.000Z" },
          { id: "op-nova", status: "synced", updated_at: "2026-09-19T10:00:00.000Z" }
        ],
        now
      )
    ).toEqual([]);
  });
});
