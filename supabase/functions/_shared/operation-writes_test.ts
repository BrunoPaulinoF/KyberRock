import { describe, expect, it } from "vitest";

import {
  cancellationReannouncements,
  isStaleOperationWrite,
  keepOperationLinks
} from "./operation-writes.ts";

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

describe("keepOperationLinks", () => {
  const CLOUD = {
    customer_id: "omie_11488403507",
    customer_name: "LEVISA DESCARTAVEIS LTDA",
    product_id: "omie_11455901041",
    product_description: "Rachão"
  };

  it("nao deixa a balanca sem o cadastro apagar o cliente da nuvem", () => {
    // A outra balanca conferiu a nota no OMIE e reenviou a pesagem que ela guarda sem
    // cliente: o gemeo do cadastro nunca chegou la.
    const row = keepOperationLinks(CLOUD, {
      id: "op-1",
      status: "synced",
      customer_id: null,
      customer_name: null,
      product_id: "omie_11455901041",
      product_description: "Rachão",
      omie_invoice_number: "30017"
    });
    expect(row).toMatchObject({
      customer_id: "omie_11488403507",
      customer_name: "LEVISA DESCARTAVEIS LTDA",
      omie_invoice_number: "30017"
    });
  });

  it("tambem guarda o produto", () => {
    const row = keepOperationLinks(CLOUD, {
      id: "op-1",
      customer_id: "omie_11488403507",
      product_id: "",
      product_description: null
    });
    expect(row).toMatchObject({ product_id: "omie_11455901041", product_description: "Rachão" });
  });

  it("aceita a troca de cliente feita na operacao", () => {
    const row = keepOperationLinks(CLOUD, {
      id: "op-1",
      customer_id: "cliente-novo",
      customer_name: "OUTRO CLIENTE"
    });
    expect(row).toMatchObject({ customer_id: "cliente-novo", customer_name: "OUTRO CLIENTE" });
  });

  it("nao deixa o nome do mesmo cliente sumir", () => {
    const row = keepOperationLinks(CLOUD, {
      id: "op-1",
      customer_id: "omie_11488403507",
      customer_name: null
    });
    expect(row.customer_name).toBe("LEVISA DESCARTAVEIS LTDA");
  });

  it("nao mexe no nome que chegou com outro cliente", () => {
    const row = keepOperationLinks(CLOUD, {
      id: "op-1",
      customer_id: "cliente-novo",
      customer_name: null
    });
    expect(row).toMatchObject({ customer_id: "cliente-novo", customer_name: null });
  });

  it("nao inventa coluna que o payload nao trouxe", () => {
    // Ausente o upsert ja preserva; incluir a coluna mudaria o que a balanca mandou.
    expect(keepOperationLinks(CLOUD, { id: "op-1", status: "synced" })).toEqual({
      id: "op-1",
      status: "synced"
    });
  });

  it("nuvem sem cliente aceita o vazio", () => {
    const row = keepOperationLinks(
      { customer_id: null, customer_name: null },
      { id: "op-1", customer_id: null }
    );
    expect(row).toEqual({ id: "op-1", customer_id: null });
  });
});
