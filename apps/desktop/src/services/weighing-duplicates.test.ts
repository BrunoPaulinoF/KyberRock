import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { findDuplicateWeighings, groupDuplicateWeighings } from "./weighing-duplicates";
import type { DuplicateWeighingCandidate } from "./weighing-duplicates";

function candidate(patch: Partial<DuplicateWeighingCandidate> = {}): DuplicateWeighingCandidate {
  return {
    operationId: "op-1",
    couponNumber: 1,
    createdAt: "2026-07-10T12:00:00.000Z",
    date: "2026-07-10",
    customerKey: "cust-1",
    customerName: "Cliente",
    plate: "ABC1D23",
    productKey: "prod-1",
    productDescription: "Brita 1",
    entryWeightKg: 12_000,
    exitWeightKg: 33_000,
    totalCents: 100_000,
    operationType: "invoice",
    invoiceNumber: null,
    ...patch
  };
}

describe("groupDuplicateWeighings", () => {
  it("junta a carga relancada e mantem a ultima registrada", () => {
    const groups = groupDuplicateWeighings([
      candidate({ operationId: "op-errada", couponNumber: 970, createdAt: "2026-07-10T12:00:00Z" }),
      candidate({
        operationId: "op-certa",
        couponNumber: 1126,
        createdAt: "2026-07-12T18:00:00Z",
        date: "2026-07-12",
        totalCents: 86_000
      })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.keepers.map((item) => item.operationId)).toEqual(["op-certa"]);
    expect(groups[0]?.duplicates.map((item) => item.operationId)).toEqual(["op-errada"]);
    expect(groups[0]?.billedMoreThanOnce).toBe(false);
  });

  it("mantem a que ja tem nota emitida, mesmo sendo a mais antiga", () => {
    // Quem manda e o OMIE: a nota existe e o cliente vai receber a cobranca dela. Tirar a
    // faturada da fatura e deixar a outra faria o fechamento nao bater com o OMIE de novo,
    // so que para menos.
    const groups = groupDuplicateWeighings([
      candidate({
        operationId: "op-com-nota",
        couponNumber: 970,
        createdAt: "2026-07-10T12:00:00Z",
        invoiceNumber: "4321"
      }),
      candidate({
        operationId: "op-refeita",
        couponNumber: 1126,
        createdAt: "2026-07-12T18:00:00Z"
      })
    ]);

    expect(groups[0]?.keepers.map((item) => item.operationId)).toEqual(["op-com-nota"]);
    expect(groups[0]?.duplicates.map((item) => item.operationId)).toEqual(["op-refeita"]);
  });

  it("nao tira nenhuma da fatura quando as duas ja tem nota, e avisa", () => {
    const groups = groupDuplicateWeighings([
      candidate({ operationId: "op-a", couponNumber: 601, invoiceNumber: "10" }),
      candidate({
        operationId: "op-b",
        couponNumber: 602,
        createdAt: "2026-07-10T13:00:00Z",
        invoiceNumber: "11"
      })
    ]);

    expect(groups[0]?.duplicates).toEqual([]);
    expect(groups[0]?.billedMoreThanOnce).toBe(true);
  });

  it("nao junta cargas com pesos diferentes, mesmo com o liquido igual", () => {
    // Duas viagens de verdade do mesmo caminhao: a tara nunca repete no quilo. E o caso que
    // a regra estreita existe para proteger — juntar aqui seria deixar de cobrar uma carga
    // que saiu da pedreira.
    const groups = groupDuplicateWeighings([
      candidate({ operationId: "op-a", entryWeightKg: 12_000, exitWeightKg: 33_000 }),
      candidate({ operationId: "op-b", entryWeightKg: 12_010, exitWeightKg: 33_010 })
    ]);

    expect(groups).toEqual([]);
  });

  it("nao junta cargas de clientes, placas ou produtos diferentes", () => {
    expect(
      groupDuplicateWeighings([
        candidate({ operationId: "op-a" }),
        candidate({ operationId: "op-b", customerKey: "cust-2" })
      ])
    ).toEqual([]);
    expect(
      groupDuplicateWeighings([
        candidate({ operationId: "op-a" }),
        candidate({ operationId: "op-b", plate: "XYZ4E56" })
      ])
    ).toEqual([]);
    expect(
      groupDuplicateWeighings([
        candidate({ operationId: "op-a" }),
        candidate({ operationId: "op-b", productKey: "prod-2" })
      ])
    ).toEqual([]);
  });

  it("ignora a pesagem sem placa ou sem os dois pesos", () => {
    // Sao as importadas e as antigas: sem evidencia nenhuma, agrupar juntaria cargas
    // diferentes do mesmo dia.
    expect(
      groupDuplicateWeighings([
        candidate({ operationId: "op-a", plate: "" }),
        candidate({ operationId: "op-b", plate: "" })
      ])
    ).toEqual([]);
    expect(
      groupDuplicateWeighings([
        candidate({ operationId: "op-a", entryWeightKg: null }),
        candidate({ operationId: "op-b", entryWeightKg: null })
      ])
    ).toEqual([]);
  });

  it("compara a placa sem depender de espaco ou caixa", () => {
    const groups = groupDuplicateWeighings([
      candidate({ operationId: "op-a", plate: " abc1d23 " }),
      candidate({ operationId: "op-b", createdAt: "2026-07-11T12:00:00Z", plate: "ABC1D23" })
    ]);

    expect(groups[0]?.duplicates.map((item) => item.operationId)).toEqual(["op-a"]);
  });
});

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  return db;
}

type Database = ReturnType<typeof createDatabase>;

function setupBaseData(db: Database): void {
  db.prepare(
    `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
     VALUES ('comp-1', 'Pedreira', 'Pedreira', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
     VALUES ('unit-1', 'comp-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
     VALUES ('dev-1', 'comp-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
     VALUES ('prod-1', 'comp-1', 'B1', 'Brita 1', 'TON', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
     VALUES ('veh-1', 'comp-1', 'ABC1D23', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
     VALUES ('cust-1', 'comp-1', 'Cliente', 'Cliente', '26463463000183', 'local',
             datetime('now'), datetime('now'))`
  ).run();
  // O MESMO cliente cadastrado duas vezes (o do OMIE e o da balanca), como a base real tem.
  db.prepare(
    `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, omie_customer_id,
                            created_at, updated_at)
     VALUES ('omie-1', 'comp-1', 'Cliente', 'Cliente', '26.463.463/0001-83', 'omie', 777,
             datetime('now'), datetime('now'))`
  ).run();
}

function insertOperation(
  db: Database,
  seed: {
    id: string;
    code: number;
    createdAt: string;
    customer?: string;
    entry?: number;
    exit?: number;
    totalCents?: number;
    status?: string;
    invoiceNumber?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO weighing_operations
       (id, company_id, unit_id, device_id, operation_code, status, operation_type, customer_id,
        vehicle_id, product_id, entry_weight_kg, exit_weight_kg, net_weight_kg,
        product_total_cents, freight_total_cents, total_cents, omie_invoice_number,
        created_at, updated_at)
     VALUES (?, 'comp-1', 'unit-1', 'dev-1', ?, ?, 'invoice', ?, 'veh-1', 'prod-1', ?, ?, ?,
             ?, 0, ?, ?, ?, ?)`
  ).run(
    seed.id,
    seed.code,
    seed.status ?? "synced",
    seed.customer ?? "cust-1",
    seed.entry ?? 12_000,
    seed.exit ?? 33_000,
    (seed.exit ?? 33_000) - (seed.entry ?? 12_000),
    seed.totalCents ?? 100_000,
    seed.totalCents ?? 100_000,
    seed.invoiceNumber ?? null,
    seed.createdAt,
    seed.createdAt
  );
}

describe("findDuplicateWeighings", () => {
  it("acha o relancamento feito depois do periodo do fechamento", () => {
    // O caso real: a quinzena e fechada dias depois, e a correcao de preco e lancada ja fora
    // do periodo. Olhando so o periodo, a fatura cobraria justamente a errada.
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertOperation(db, { id: "op-errada", code: 970, createdAt: "2026-07-19T15:00:00.000Z" });
      insertOperation(db, {
        id: "op-certa",
        code: 1126,
        createdAt: "2026-08-02T18:00:00.000Z",
        totalCents: 86_000
      });

      const groups = findDuplicateWeighings(db, "unit-1", "2026-07-16", "2026-07-31");
      expect(groups).toHaveLength(1);
      expect(groups[0]?.duplicates.map((item) => item.couponNumber)).toEqual([970]);
      expect(groups[0]?.keepers.map((item) => item.couponNumber)).toEqual([1126]);
    } finally {
      db.close();
    }
  });

  it("junta o relancamento que escolheu o cadastro duplicado do mesmo cliente", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertOperation(db, { id: "op-a", code: 601, createdAt: "2026-07-10T10:00:00.000Z" });
      insertOperation(db, {
        id: "op-b",
        code: 602,
        customer: "omie-1",
        createdAt: "2026-07-10T10:49:00.000Z"
      });

      const groups = findDuplicateWeighings(db, "unit-1", "2026-07-01", "2026-07-31");
      expect(groups[0]?.duplicates.map((item) => item.couponNumber)).toEqual([601]);
    } finally {
      db.close();
    }
  });

  it("ignora a cancelada e a excluida — elas ja nao contam em fechamento nenhum", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertOperation(db, { id: "op-a", code: 601, createdAt: "2026-07-10T10:00:00.000Z" });
      insertOperation(db, {
        id: "op-b",
        code: 602,
        createdAt: "2026-07-10T10:49:00.000Z",
        status: "cancelled"
      });

      expect(findDuplicateWeighings(db, "unit-1", "2026-07-01", "2026-07-31")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("nao traz o grupo que nao encosta no periodo", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertOperation(db, { id: "op-a", code: 601, createdAt: "2026-06-02T10:00:00.000Z" });
      insertOperation(db, { id: "op-b", code: 602, createdAt: "2026-06-02T10:49:00.000Z" });

      expect(findDuplicateWeighings(db, "unit-1", "2026-07-01", "2026-07-31")).toEqual([]);
    } finally {
      db.close();
    }
  });
});
