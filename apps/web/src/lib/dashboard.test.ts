import { describe, expect, it } from "vitest";

import {
  activityAt,
  buildHealthPills,
  classifyOpenAge,
  formatDashTons,
  formatElapsed,
  formatHour,
  formatKg,
  formatOldDate,
  isOpenOperation,
  omieBacklog,
  recentOperations,
  requestBacklog,
  summarizeDay
} from "./dashboard";

const NOW = new Date("2026-09-24T15:00:00Z");

function openRow(id: string, createdAt: string) {
  return {
    id,
    created_at: createdAt,
    plate: "ABC1234",
    customer_name: "Cliente",
    product_description: "Brita 1"
  };
}

function fiscalRow(overrides: Partial<Parameters<typeof omieBacklog>[0][number]> = {}) {
  return {
    operation_type: "invoice",
    omie_billing_status: null,
    omie_billing_message: null,
    omie_sales_order_id: null,
    omie_service_order_id: null,
    omie_invoice_number: null,
    ...overrides
  };
}

describe("formatacao", () => {
  it("toneladas com uma casa e quilos sem casa, como o desktop", () => {
    expect(formatDashTons(12_345)).toBe("12,3 t");
    expect(formatDashTons(0)).toBe("0,0 t");
    expect(formatKg(42_380)).toBe("42.380");
  });

  it("hora no fuso da pedreira", () => {
    expect(formatHour("2026-09-24T15:07:00Z")).toBe("12:07");
    expect(formatHour(null)).toBe("--:--");
    expect(formatHour("lixo")).toBe("--:--");
  });

  it("data so para pesagem com mais de uma semana", () => {
    expect(formatOldDate("2026-09-20T15:00:00Z", NOW)).toBeNull();
    expect(formatOldDate("2026-09-10T15:00:00Z", NOW)).toBe("10/09/2026");
  });

  it("tempo no patio em minutos ou horas", () => {
    expect(formatElapsed("2026-09-24T14:59:50Z", NOW)).toBe("1 min");
    expect(formatElapsed("2026-09-24T14:25:00Z", NOW)).toBe("35 min");
    expect(formatElapsed("2026-09-24T12:55:00Z", NOW)).toBe("2h05");
  });
});

describe("summarizeDay", () => {
  it("soma peso e valor e tira o ticket medio", () => {
    expect(
      summarizeDay([
        { net_weight_kg: 30_000, total_cents: 150_000 },
        { net_weight_kg: 20_000, total_cents: 100_001 },
        { net_weight_kg: null, total_cents: null }
      ])
    ).toEqual({ operations: 3, weightKg: 50_000, totalCents: 250_001, ticketCents: 83_334 });
  });

  it("dia vazio nao divide por zero", () => {
    expect(summarizeDay([])).toEqual({
      operations: 0,
      weightKg: 0,
      totalCents: 0,
      ticketCents: 0
    });
  });
});

describe("classifyOpenAge", () => {
  it("ordena da mais antiga e marca 2 h como aviso e 4 h como perigo", () => {
    const result = classifyOpenAge(
      [
        openRow("recente", "2026-09-24T14:30:00Z"),
        openRow("velha", "2026-09-24T10:00:00Z"),
        openRow("media", "2026-09-24T12:30:00Z")
      ],
      NOW
    );
    expect(result.map((item) => [item.operation.id, item.tone])).toEqual([
      ["velha", "danger"],
      ["media", "warning"],
      ["recente", "neutral"]
    ]);
  });
});

describe("omieBacklog", () => {
  it("usa a regra da coluna Fiscal OMIE: neutro e pendente, aviso/perigo e falha", () => {
    expect(
      omieBacklog([
        fiscalRow(),
        fiscalRow({ operation_type: "internal" }),
        fiscalRow({ omie_billing_status: "failed" }),
        fiscalRow({ omie_billing_status: "cadastro_incompleto" }),
        fiscalRow({ operation_type: "internal", omie_billing_status: "service_order_failed" }),
        fiscalRow({ omie_sales_order_id: 99 }),
        fiscalRow({ omie_billing_status: "billed", omie_invoice_number: "123" })
      ])
    ).toEqual({ pending: 2, failed: 3 });
  });
});

describe("requestBacklog", () => {
  it("separa o que espera a balanca do que ela devolveu", () => {
    expect(
      requestBacklog([
        { status: "pending" },
        { status: "processing" },
        { status: "done" },
        { status: "failed" }
      ])
    ).toEqual({ waiting: 2, failed: 1 });
  });
});

describe("ultimas pesagens", () => {
  const base = { created_at: "2026-09-24T08:00:00Z", updated_at: "2026-09-24T08:00:00Z" };

  it("aberta e concluida pelo status da nuvem", () => {
    expect(isOpenOperation({ status: "open" })).toBe(true);
    expect(isOpenOperation({ status: "synced" })).toBe(false);
    expect(isOpenOperation({ status: "sync_error" })).toBe(false);
    expect(isOpenOperation({ status: "cancelled" })).toBe(false);
  });

  it("concluida conta pelo fechamento, nao pelo updated_at que anda com o OMIE", () => {
    expect(
      activityAt({
        id: "a",
        status: "synced",
        created_at: "2026-09-24T08:00:00Z",
        closed_at: "2026-09-24T09:00:00Z",
        updated_at: "2026-09-24T14:00:00Z"
      })
    ).toBe("2026-09-24T09:00:00Z");
    expect(
      activityAt({
        id: "b",
        status: "open",
        closed_at: null,
        ...base,
        updated_at: "2026-09-24T10:00:00Z"
      })
    ).toBe("2026-09-24T10:00:00Z");
  });

  it("junta abertas e concluidas, mais nova primeiro, sem repetir e ate o limite", () => {
    const open = [
      { id: "o1", status: "open", closed_at: null, ...base, updated_at: "2026-09-24T11:00:00Z" }
    ];
    const closed = [
      { id: "c1", status: "synced", ...base, closed_at: "2026-09-24T12:00:00Z" },
      { id: "c2", status: "synced", ...base, closed_at: "2026-09-24T10:00:00Z" },
      { id: "o1", status: "open", closed_at: null, ...base, updated_at: "2026-09-24T11:00:00Z" }
    ];
    expect(recentOperations(open, closed).map((op) => op.id)).toEqual(["c1", "o1", "c2"]);
    expect(recentOperations(open, closed, 2).map((op) => op.id)).toEqual(["c1", "o1"]);
  });
});

describe("buildHealthPills", () => {
  const fmt = (iso: string) => `fmt(${iso})`;

  it("enquanto pergunta, a balanca aparece como verificando", () => {
    const pills = buildHealthPills({
      executor: undefined,
      omie: null,
      requests: null,
      formatDateTime: fmt
    });
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({ label: "Balanca", value: "Verificando...", tone: "neutral" });
  });

  it("sem balanca executora e aviso", () => {
    const [pill] = buildHealthPills({
      executor: null,
      omie: null,
      requests: null,
      formatDateTime: fmt
    });
    expect(pill).toMatchObject({ value: "Nao definida", tone: "warning" });
  });

  it("balanca fora do ar, OMIE com falha e pedidos esperando", () => {
    const pills = buildHealthPills({
      executor: { name: "Balanca 1", online: false, seenAt: "2026-09-24T10:00:00Z" },
      omie: { pending: 3, failed: 1 },
      requests: { waiting: 2, failed: 0 },
      formatDateTime: fmt
    });
    expect(pills.map((pill) => [pill.label, pill.value, pill.tone, pill.to])).toEqual([
      ["Balanca", "Balanca 1 fora do ar", "danger", null],
      ["Ultimo sinal", "fmt(2026-09-24T10:00:00Z)", "warning", null],
      ["OMIE", "1 com falha", "danger", "/operacoes?aba=concluidas"],
      ["Pedidos do site", "2 aguardando", "warning", "/operacoes"]
    ]);
  });

  it("tudo em dia", () => {
    const pills = buildHealthPills({
      executor: { name: "Balanca 1", online: true, seenAt: null },
      omie: { pending: 0, failed: 0 },
      requests: { waiting: 0, failed: 0 },
      formatDateTime: fmt
    });
    expect(pills.map((pill) => [pill.value, pill.tone])).toEqual([
      ["Balanca 1 conectada", "success"],
      ["Nunca", "warning"],
      ["Em dia", "success"],
      ["Em dia", "success"]
    ]);
  });
});
