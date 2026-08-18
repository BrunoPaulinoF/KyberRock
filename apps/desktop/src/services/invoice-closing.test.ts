import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { InvoiceClosingService } from "./invoice-closing";

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
  // Segunda unidade: o fechamento nao pode atravessar a pedreira.
  db.prepare(
    `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
     VALUES ('unit-2', 'comp-1', 'Outra', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
     VALUES ('dev-1', 'comp-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
     VALUES ('prod-1', 'comp-1', 'B0', 'Brita 0', 'TON', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO carriers (id, company_id, name, source, created_at, updated_at)
     VALUES ('carr-1', 'comp-1', 'Transportes Silva', 'local', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO carriers (id, company_id, name, source, created_at, updated_at)
     VALUES ('carr-2', 'comp-1', 'Transportes Souza', 'local', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO vehicles (id, company_id, plate, carrier_id, created_at, updated_at)
     VALUES ('veh-1', 'comp-1', 'ABC1D23', 'carr-2', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
     VALUES ('veh-2', 'comp-1', 'XYZ4E56', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO drivers (id, company_id, name, created_at, updated_at)
     VALUES ('drv-1', 'comp-1', 'Joao', datetime('now'), datetime('now'))`
  ).run();
}

interface CustomerSeed {
  id: string;
  name: string;
  creditEnabled?: boolean;
  periodicity?: "monthly" | "biweekly" | "weekly";
  closingDay?: number | null;
  boletoDays?: number | null;
  secondClosingDay?: number | null;
  secondBoletoDays?: number | null;
  closingWeekday?: number | null;
}

function insertCustomer(db: Database, seed: CustomerSeed): void {
  db.prepare(
    `INSERT INTO customers
       (id, company_id, legal_name, trade_name, document, source, created_at, updated_at,
        credit_account_enabled, credit_periodicity, credit_closing_day, credit_boleto_days,
        credit_second_closing_day, credit_second_boleto_days, credit_closing_weekday)
     VALUES (?, 'comp-1', ?, ?, '11222333000155', 'local', datetime('now'), datetime('now'),
             ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    seed.id,
    seed.name,
    seed.name,
    seed.creditEnabled === false ? 0 : 1,
    seed.periodicity ?? "monthly",
    seed.closingDay ?? null,
    seed.boletoDays ?? null,
    seed.secondClosingDay ?? null,
    seed.secondBoletoDays ?? null,
    seed.closingWeekday ?? null
  );
}

interface OperationSeed {
  id: string;
  code?: number | null;
  customer: string;
  createdAt: string;
  totalCents?: number;
  productCents?: number;
  freightCents?: number;
  net?: number;
  vehicle?: string | null;
  carrier?: string | null;
  driver?: string | null;
  status?: string;
  operationType?: "invoice" | "internal";
  unitId?: string;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  salesOrderId?: number | null;
  billingStatus?: string | null;
  deletedAt?: string | null;
}

function insertOperation(db: Database, seed: OperationSeed): void {
  db.prepare(
    `INSERT INTO weighing_operations
       (id, company_id, unit_id, device_id, operation_code, status, operation_type,
        customer_id, vehicle_id, carrier_id, driver_id, product_id,
        net_weight_kg, product_total_cents, freight_total_cents, total_cents,
        omie_sales_order_id, omie_order_number, omie_invoice_number, omie_billing_status,
        created_at, updated_at, deleted_at)
     VALUES (?, 'comp-1', ?, 'dev-1', ?, ?, ?, ?, ?, ?, ?, 'prod-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    seed.id,
    seed.unitId ?? "unit-1",
    seed.code ?? null,
    seed.status ?? "synced",
    seed.operationType ?? "invoice",
    seed.customer,
    seed.vehicle ?? "veh-1",
    seed.carrier ?? null,
    seed.driver ?? "drv-1",
    seed.net ?? 10_000,
    seed.productCents ?? 90_000,
    seed.freightCents ?? 10_000,
    seed.totalCents ?? 100_000,
    seed.salesOrderId ?? null,
    seed.orderNumber ?? null,
    seed.invoiceNumber ?? null,
    seed.billingStatus ?? null,
    seed.createdAt,
    seed.createdAt,
    seed.deletedAt ?? null
  );
}

function report(db: Database, options = {}) {
  return new InvoiceClosingService(db).getReport("2026-07-01", "2026-07-31", "unit-1", options);
}

describe("InvoiceClosingService", () => {
  it("separa os clientes pelo ciclo do cadastro e fecha cada um no seu vencimento", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, {
        id: "cust-q",
        name: "Quinzenal",
        periodicity: "biweekly",
        closingDay: 1,
        secondClosingDay: 16,
        boletoDays: 10,
        secondBoletoDays: 10
      });
      insertCustomer(db, {
        id: "cust-m",
        name: "Mensal",
        periodicity: "monthly",
        closingDay: 31,
        boletoDays: 15
      });
      // Quinzenal: uma carga em cada metade do mes, que fecham em datas diferentes.
      insertOperation(db, { id: "op-1", code: 101, customer: "cust-q", createdAt: "2026-07-05" });
      insertOperation(db, { id: "op-2", code: 102, customer: "cust-q", createdAt: "2026-07-20" });
      insertOperation(db, { id: "op-3", code: 103, customer: "cust-m", createdAt: "2026-07-10" });

      const all = report(db);
      // Duas faturas do quinzenal (uma por fechamento) + uma do mensal.
      expect(all.invoices).toHaveLength(3);
      expect(all.customers).toBe(2);

      const quinzenais = all.invoices.filter((invoice) => invoice.customerId === "cust-q");
      expect(quinzenais.map((invoice) => invoice.closingDate)).toEqual([
        "2026-07-16",
        "2026-08-01"
      ]);
      expect(quinzenais.map((invoice) => invoice.dueDate)).toEqual(["2026-07-26", "2026-08-11"]);
      expect(quinzenais.every((invoice) => invoice.cycleLabel === "Quinzenal")).toBe(true);

      const mensal = all.invoices.find((invoice) => invoice.customerId === "cust-m");
      expect(mensal?.closingDate).toBe("2026-07-31");
      expect(mensal?.dueDate).toBe("2026-08-15");

      // O filtro por ciclo e o que a atendente pede: "puxe todos os quinzenais".
      const somenteQuinzenal = report(db, { cycles: ["biweekly"] });
      expect(somenteQuinzenal.invoices).toHaveLength(2);
      expect(somenteQuinzenal.customers).toBe(1);
      expect(somenteQuinzenal.totals.totalCents).toBe(200_000);
    } finally {
      db.close();
    }
  });

  it("traz nota, vale, placa e transportador em cada linha", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, {
        id: "op-1",
        code: 4321,
        customer: "cust-1",
        createdAt: "2026-07-10",
        carrier: "carr-1",
        invoiceNumber: "000028727",
        orderNumber: "50139",
        salesOrderId: 999,
        billingStatus: "billed"
      });

      const [line] = report(db).invoices[0].lines;
      expect(line.couponNumber).toBe(4321);
      expect(line.invoiceNumber).toBe("000028727");
      expect(line.omieOrderNumber).toBe("50139");
      expect(line.plate).toBe("ABC1D23");
      expect(line.carrierName).toBe("Transportes Silva");
      expect(line.driverName).toBe("Joao");
      expect(line.situationLabel).toBe("Faturada");
    } finally {
      db.close();
    }
  });

  it("cai na transportadora do veiculo quando a operacao nao escolheu nenhuma", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-1",
        createdAt: "2026-07-11",
        vehicle: "veh-2"
      });

      const lines = report(db).invoices[0].lines;
      // veh-1 pertence a Souza; veh-2 nao tem dono cadastrado.
      expect(lines.map((line) => line.carrierName)).toEqual([
        "Transportes Souza",
        "Sem transportadora"
      ]);
    } finally {
      db.close();
    }
  });

  it("resume as viagens por transportador e por placa", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, {
        id: "op-1",
        customer: "cust-1",
        createdAt: "2026-07-10",
        carrier: "carr-1",
        freightCents: 10_000
      });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-1",
        createdAt: "2026-07-11",
        carrier: "carr-1",
        vehicle: "veh-2",
        freightCents: 15_000
      });
      insertOperation(db, {
        id: "op-3",
        customer: "cust-1",
        createdAt: "2026-07-12",
        carrier: "carr-2",
        freightCents: 5_000
      });

      const [silva, souza] = report(db).byCarrier;
      expect(silva.carrierName).toBe("Transportes Silva");
      expect(silva.trips).toBe(2);
      expect(silva.freightCents).toBe(25_000);
      expect(silva.plates.map((plate) => plate.plate).sort()).toEqual(["ABC1D23", "XYZ4E56"]);
      expect(souza.trips).toBe(1);
      expect(souza.freightCents).toBe(5_000);
    } finally {
      db.close();
    }
  });

  it("nao esconde o cliente sem periodicidade: ele vira pendencia de cadastro", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertCustomer(db, { id: "cust-sem", name: "Sem ciclo", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-sem",
        createdAt: "2026-07-11",
        totalCents: 250_000
      });

      const result = report(db);
      expect(result.invoices).toHaveLength(1);
      expect(result.pendingSetup).toEqual([
        { customerId: "cust-sem", customerName: "Sem ciclo", operations: 1, totalCents: 250_000 }
      ]);
      // E o que ficou de fora tambem fica de fora dos totais: a fatura soma o que fatura.
      expect(result.totals.totalCents).toBe(100_000);
    } finally {
      db.close();
    }
  });

  it("conta o que ainda esta sem nota emitida no OMIE", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, {
        id: "op-1",
        customer: "cust-1",
        createdAt: "2026-07-10",
        invoiceNumber: "28727",
        billingStatus: "billed",
        salesOrderId: 1
      });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-1",
        createdAt: "2026-07-11",
        salesOrderId: 2,
        totalCents: 300_000
      });

      const result = report(db);
      expect(result.invoices[0].operationsWithoutInvoice).toBe(1);
      expect(result.withoutInvoice.operations).toBe(1);
      expect(result.withoutInvoice.totalCents).toBe(300_000);
    } finally {
      db.close();
    }
  });

  it("ignora excluidas, canceladas, em aberto e as de outra unidade", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, { id: "op-ok", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, {
        id: "op-cancel",
        customer: "cust-1",
        createdAt: "2026-07-10",
        status: "cancelled"
      });
      insertOperation(db, {
        id: "op-aberta",
        customer: "cust-1",
        createdAt: "2026-07-10",
        status: "awaiting_exit"
      });
      insertOperation(db, {
        id: "op-excluida",
        customer: "cust-1",
        createdAt: "2026-07-10",
        deletedAt: "2026-07-11"
      });
      insertOperation(db, {
        id: "op-outra-unidade",
        customer: "cust-1",
        createdAt: "2026-07-10",
        unitId: "unit-2"
      });
      // Fora do periodo.
      insertOperation(db, { id: "op-junho", customer: "cust-1", createdAt: "2026-06-30" });

      const result = report(db);
      expect(result.totals.operations).toBe(1);
      expect(result.invoices[0].lines.map((line) => line.operationId)).toEqual(["op-ok"]);
    } finally {
      db.close();
    }
  });

  it("busca por placa, transportador, nota ou vale", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, {
        id: "op-1",
        code: 777,
        customer: "cust-1",
        createdAt: "2026-07-10",
        carrier: "carr-1",
        invoiceNumber: "28727"
      });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-1",
        createdAt: "2026-07-11",
        vehicle: "veh-2",
        carrier: "carr-2"
      });

      expect(report(db, { search: "XYZ4E56" }).totals.operations).toBe(1);
      expect(report(db, { search: "silva" }).totals.operations).toBe(1);
      expect(report(db, { search: "28727" }).totals.operations).toBe(1);
      expect(report(db, { search: "777" }).totals.operations).toBe(1);
      expect(report(db, { search: "alfa" }).totals.operations).toBe(2);
      expect(report(db, { search: "nao existe" }).totals.operations).toBe(0);
    } finally {
      db.close();
    }
  });

  it("a pesagem do dia do fechamento entra nele, e a do dia seguinte no proximo", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, {
        id: "cust-1",
        name: "Alfa",
        periodicity: "biweekly",
        closingDay: 1,
        secondClosingDay: 16,
        boletoDays: 5,
        secondBoletoDays: 5
      });
      insertOperation(db, { id: "op-16", customer: "cust-1", createdAt: "2026-07-16" });
      insertOperation(db, { id: "op-17", customer: "cust-1", createdAt: "2026-07-17" });

      const invoices = report(db).invoices;
      expect(invoices).toHaveLength(2);
      expect(invoices[0].closingDate).toBe("2026-07-16");
      expect(invoices[0].lines.map((line) => line.operationId)).toEqual(["op-16"]);
      expect(invoices[1].closingDate).toBe("2026-08-01");
      expect(invoices[1].lines.map((line) => line.operationId)).toEqual(["op-17"]);
    } finally {
      db.close();
    }
  });
});
