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

/**
 * Um CNPJ diferente por cliente do fixture.
 *
 * Todos nasciam com o MESMO documento, o que nunca acontece na base real (o cadastro
 * recusa e o OMIE tem um cadastro por documento) — e passou a importar quando o fechamento
 * comecou a juntar os cadastros duplicados do mesmo cliente pelo CNPJ. Com o documento
 * repetido, dois clientes distintos do teste virariam um so.
 */
function documentFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 100_000_000_000_000;
  return String(hash).padStart(14, "0");
}

interface CustomerSeed {
  id: string;
  name: string;
  /** Ausente = um CNPJ proprio. Dois seeds com o MESMO documento sao o cliente duplicado. */
  document?: string;
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
     VALUES (?, 'comp-1', ?, ?, ?, 'local', datetime('now'), datetime('now'),
             ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    seed.id,
    seed.name,
    seed.name,
    seed.document ?? documentFor(seed.id),
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
  unitPriceCents?: number | null;
  priceUnit?: string | null;
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
  billingMessage?: string | null;
  deletedAt?: string | null;
}

function insertOperation(db: Database, seed: OperationSeed): void {
  db.prepare(
    `INSERT INTO weighing_operations
       (id, company_id, unit_id, device_id, operation_code, status, operation_type,
        customer_id, vehicle_id, carrier_id, driver_id, product_id,
        net_weight_kg, unit_price_cents, price_unit,
        product_total_cents, freight_total_cents, total_cents,
        omie_sales_order_id, omie_order_number, omie_invoice_number,
        omie_billing_status, omie_billing_message,
        created_at, updated_at, deleted_at)
     VALUES (?, 'comp-1', ?, 'dev-1', ?, ?, ?, ?, ?, ?, ?, 'prod-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    seed.unitPriceCents === undefined ? 4_200 : seed.unitPriceCents,
    seed.priceUnit === undefined ? "ton" : seed.priceUnit,
    seed.productCents ?? 90_000,
    seed.freightCents ?? 10_000,
    seed.totalCents ?? 100_000,
    seed.salesOrderId ?? null,
    seed.orderNumber ?? null,
    seed.invoiceNumber ?? null,
    seed.billingStatus ?? null,
    seed.billingMessage ?? null,
    seed.createdAt,
    seed.createdAt,
    seed.deletedAt ?? null
  );
}

/**
 * O fechamento pela base do CADASTRO — a que estes testes descrevem.
 *
 * A base padrao da tela e a do PERIODO (toda carga do periodo entra na fatura, inclusive a
 * do cliente em carteira); a do cadastro continua disponivel e e ela que decide ciclo,
 * data de fechamento e "clientes fora do fechamento". Os testes da base do periodo passam
 * `basis: "period"` explicitamente.
 */
function report(db: Database, options: Record<string, unknown> = {}) {
  return new InvoiceClosingService(db).getReport("2026-07-01", "2026-07-31", "unit-1", {
    basis: "customer",
    ...options
  });
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

  it("sem placa escolhida, a fatura e a do cliente inteiro e as placas do periodo vem listadas", () => {
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

      const result = report(db);
      expect(result.filters.plates).toEqual([]);
      expect(result.availablePlates).toEqual(["ABC1D23", "XYZ4E56"]);
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].plate).toBeNull();
      expect(result.invoices[0].totals.operations).toBe(2);
    } finally {
      db.close();
    }
  });

  it("com placas escolhidas, o mesmo cliente sai com uma fatura por placa", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      // Duas viagens da primeira placa e uma da segunda, no mesmo fechamento.
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, { id: "op-2", customer: "cust-1", createdAt: "2026-07-12" });
      insertOperation(db, {
        id: "op-3",
        customer: "cust-1",
        createdAt: "2026-07-11",
        vehicle: "veh-2"
      });

      const result = report(db, { plates: ["ABC1D23", "XYZ4E56"] });
      expect(result.filters.plates).toEqual(["ABC1D23", "XYZ4E56"]);
      expect(result.invoices).toHaveLength(2);
      expect(result.invoices.map((invoice) => invoice.plate)).toEqual(["ABC1D23", "XYZ4E56"]);
      expect(result.invoices.map((invoice) => invoice.totals.operations)).toEqual([2, 1]);
      // Cada fatura por placa mantem o fechamento e o vencimento do cliente.
      expect(result.invoices.every((invoice) => invoice.closingDate === "2026-07-31")).toBe(true);
      expect(result.invoices.every((invoice) => invoice.dueDate === "2026-08-10")).toBe(true);
      // O cliente continua sendo um so, e o total do periodo nao muda com o corte.
      expect(result.customers).toBe(1);
      expect(result.totals.totalCents).toBe(300_000);
      // A lista de opcoes sai de antes do filtro: escolher uma placa nao apaga a outra.
      expect(report(db, { plates: ["ABC1D23"] }).availablePlates).toEqual(["ABC1D23", "XYZ4E56"]);
    } finally {
      db.close();
    }
  });

  it("a placa escolhida corta as cargas das outras placas, inclusive nos totais", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-1",
        createdAt: "2026-07-11",
        vehicle: "veh-2",
        carrier: "carr-2"
      });

      // Placa escrita de qualquer jeito acha a mesma carga: o filtro normaliza os dois lados.
      const result = report(db, { plates: [" xyz4e56 "] });
      expect(result.filters.plates).toEqual(["XYZ4E56"]);
      expect(result.totals.operations).toBe(1);
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].lines.map((line) => line.operationId)).toEqual(["op-2"]);
      expect(result.byCarrier.map((carrier) => carrier.carrierName)).toEqual(["Transportes Souza"]);
    } finally {
      db.close();
    }
  });

  it("a lista pesagem a pesagem cobre o periodo inteiro, com cliente e preco em cada linha", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertCustomer(db, { id: "cust-2", name: "Beta", closingDay: 31, boletoDays: 10 });
      insertOperation(db, { id: "op-1", code: 22, customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, {
        id: "op-2",
        code: 23,
        customer: "cust-2",
        createdAt: "2026-07-11",
        vehicle: "veh-2"
      });

      const result = report(db);
      // Uma fatura por cliente, mas UMA lista com as duas cargas, na ordem em que rodaram.
      expect(result.invoices).toHaveLength(2);
      expect(result.rows.map((line) => line.operationId)).toEqual(["op-1", "op-2"]);
      expect(result.rows.map((line) => line.customerName)).toEqual(["Alfa", "Beta"]);
      expect(result.rows.map((line) => line.plate)).toEqual(["ABC1D23", "XYZ4E56"]);
      expect(result.rows.map((line) => line.unitPriceCents)).toEqual([4200, 4200]);
      expect(result.rows.map((line) => line.priceUnit)).toEqual(["ton", "ton"]);
      // O rodape da lista e o mesmo total a faturar: as duas tabelas somam as mesmas cargas.
      expect(result.rows.reduce((total, line) => total + line.totalCents, 0)).toBe(
        result.totals.totalCents
      );
      expect(result.rows).toHaveLength(result.totals.operations);
    } finally {
      db.close();
    }
  });

  it("cada linha traz a operacao inteira: cadastro, quem levou, OMIE e em qual fatura caiu", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, {
        id: "cust-1",
        name: "Alfa",
        document: "11222333000155",
        closingDay: 31,
        boletoDays: 10
      });
      insertOperation(db, {
        id: "op-1",
        code: 22,
        customer: "cust-1",
        createdAt: "2026-07-10",
        carrier: "carr-1",
        salesOrderId: 4_017_998_231,
        orderNumber: "50139",
        invoiceNumber: "28727",
        billingStatus: "billed"
      });

      const [line] = report(db).rows;
      // Cadastro: o que identifica a carga na conferencia com o cliente.
      expect(line.customerName).toBe("Alfa");
      expect(line.customerDocument).toBe("11222333000155");
      expect(line.productCode).toBe("B0");
      expect(line.productDescription).toBe("Brita 0");
      // Quem levou.
      expect(line.plate).toBe("ABC1D23");
      expect(line.carrierName).toBe("Transportes Silva");
      expect(line.driverName).toBe("Joao");
      // OMIE: a situacao e os numeros pelos quais a pesagem e procurada la.
      expect(line.situation).toBe("billed");
      expect(line.situationLabel).toBe("Faturada");
      expect(line.omieSalesOrderId).toBe(4_017_998_231);
      expect(line.omieServiceOrderId).toBeNull();
      expect(line.omieOrderNumber).toBe("50139");
      expect(line.invoiceNumber).toBe("28727");
      expect(line.operationTypeLabel).toBe("Com nota");
      // E em qual fatura ela caiu — a resposta para "onde essa carga foi cobrada?".
      expect(line.closingDate).toBe("2026-07-31");
      expect(line.dueDate).toBe("2026-08-10");
    } finally {
      db.close();
    }
  });

  it("a linha explica a pesagem parada com o motivo gravado pelo OMIE", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertOperation(db, {
        id: "op-1",
        customer: "cust-1",
        createdAt: "2026-07-10",
        billingStatus: "failed",
        billingMessage: "CFOP invalido para a operacao."
      });

      const [line] = report(db).rows;
      expect(line.situation).toBe("failed");
      expect(line.situationDetail).toBe("CFOP invalido para a operacao.");
    } finally {
      db.close();
    }
  });

  it("a carga do cliente FORA do fechamento aparece na lista, sem data e fora do total a faturar", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      // O caso real da pedreira: a maior parte dos clientes ainda nao tem credito e
      // periodicidade no cadastro, e por isso nao entra em fatura nenhuma.
      insertCustomer(db, { id: "cust-2", name: "Beta", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, { id: "op-fora-1", customer: "cust-2", createdAt: "2026-07-12" });
      insertOperation(db, { id: "op-fora-2", customer: "cust-2", createdAt: "2026-07-13" });

      const result = report(db);
      // A lista mostra TUDO: esconder a carga que ninguem cobra seria esconder o problema.
      expect(result.rows.map((line) => line.operationId)).toEqual([
        "op-1",
        "op-fora-1",
        "op-fora-2"
      ]);
      // Sem data de fechamento e o que marca a carga de fora, na tela e no arquivo.
      expect(result.rows.map((line) => line.closingDate)).toEqual(["2026-07-31", null, null]);
      expect(result.rows.map((line) => line.dueDate)).toEqual(["2026-08-10", null, null]);

      // Os dois totais convivem: o da lista e o periodo, o das faturas e o que se cobra.
      expect(result.rowTotals.operations).toBe(3);
      expect(result.rowTotals.totalCents).toBe(300_000);
      expect(result.totals.operations).toBe(1);
      expect(result.totals.totalCents).toBe(100_000);

      // E o cliente de fora continua avisado no bloco proprio, com as duas cargas.
      expect(result.pendingSetup).toEqual([
        { customerId: "cust-2", customerName: "Beta", operations: 2, totalCents: 200_000 }
      ]);
    } finally {
      db.close();
    }
  });

  it("a lista pesagem a pesagem obedece aos filtros da tela", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", closingDay: 31, boletoDays: 10 });
      insertCustomer(db, { id: "cust-2", name: "Beta", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-10" });
      insertOperation(db, {
        id: "op-2",
        customer: "cust-1",
        createdAt: "2026-07-11",
        vehicle: "veh-2"
      });
      insertOperation(db, { id: "op-fora", customer: "cust-2", createdAt: "2026-07-12" });

      expect(report(db, { plates: ["XYZ4E56"] }).rows.map((line) => line.operationId)).toEqual([
        "op-2"
      ]);
      expect(report(db, { customerId: "cust-2" }).rows.map((line) => line.operationId)).toEqual([
        "op-fora"
      ]);
      expect(report(db, { search: "beta" }).rows.map((line) => line.operationId)).toEqual([
        "op-fora"
      ]);
      // Com CICLO escolhido, a carga sem periodicidade nao pertence a ciclo nenhum e sai.
      expect(report(db, { cycles: ["monthly"] }).rows.map((line) => line.operationId)).toEqual([
        "op-1",
        "op-2"
      ]);
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

  // ---------------------------------------------------------------------------------
  // Base do PERIODO: o fechamento que a atendente escolhe na tela.
  // ---------------------------------------------------------------------------------

  /** O fechamento da quinzena, como a tela pede. */
  function periodReport(db: Database, options: Record<string, unknown> = {}) {
    return new InvoiceClosingService(db).getReport("2026-07-16", "2026-07-31", "unit-1", {
      basis: "period",
      periodCycle: "biweekly",
      ...options
    });
  }

  it("na base do periodo, a venda EM CARTEIRA entra na fatura mesmo sem credito no cadastro", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      // O cliente que compra em carteira nao tem conta de credito: pela base do cadastro ele
      // caia em "clientes fora do fechamento" e a quinzena inteira dele nao era cobrada.
      insertCustomer(db, { id: "cust-carteira", name: "Levisa", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-carteira", createdAt: "2026-07-17" });
      insertOperation(db, { id: "op-2", customer: "cust-carteira", createdAt: "2026-07-20" });
      insertOperation(db, { id: "op-3", customer: "cust-carteira", createdAt: "2026-07-28" });
      insertOperation(db, { id: "op-4", customer: "cust-carteira", createdAt: "2026-07-31" });

      const result = periodReport(db);

      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].lines.map((line) => line.operationId)).toEqual([
        "op-1",
        "op-2",
        "op-3",
        "op-4"
      ]);
      expect(result.pendingSetup).toEqual([]);
      // A fatura fecha no ultimo dia do periodo; sem prazo de boleto no cadastro, vence nele.
      expect(result.invoices[0]).toMatchObject({
        closingDate: "2026-07-31",
        dueDate: "2026-07-31",
        cycle: "biweekly",
        cycleLabel: "Quinzenal"
      });
      // O total a faturar e o total do periodo: nao sobra carga fora da cobranca.
      expect(result.totals.totalCents).toBe(result.rowTotals.totalCents);
    } finally {
      db.close();
    }
  });

  it("na base do periodo, o prazo de boleto do cadastro conta a partir do fechamento", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, {
        id: "cust-1",
        name: "Alfa",
        periodicity: "biweekly",
        closingDay: 1,
        secondClosingDay: 16,
        boletoDays: 3,
        secondBoletoDays: 10
      });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-20" });

      // Quinzena: vale o prazo do SEGUNDO fechamento, que e o que termina o periodo.
      expect(periodReport(db).invoices[0]).toMatchObject({
        closingDate: "2026-07-31",
        dueDate: "2026-08-10"
      });
    } finally {
      db.close();
    }
  });

  it("periodo personalizado nao inventa ciclo", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-20" });

      const result = periodReport(db, { periodCycle: null });
      expect(result.invoices[0]).toMatchObject({ cycle: null, cycleLabel: "Periodo" });
    } finally {
      db.close();
    }
  });

  it("na base do periodo o filtro de ciclo nao esconde carga nenhuma", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-20" });

      // O ciclo vem do periodo escolhido, e nao do cadastro: um filtro de ciclo herdado da
      // outra base zeraria a quinzena do cliente em carteira.
      expect(periodReport(db, { cycles: ["weekly"] }).rows).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  // ---------------------------------------------------------------------------------
  // Cadastro duplicado do mesmo cliente.
  // ---------------------------------------------------------------------------------

  it("o cliente cadastrado duas vezes rende UMA fatura, com as cargas dos dois cadastros", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      // O caso real: o cadastro que veio do OMIE e o que nasceu na balanca, mesmo CNPJ.
      insertCustomer(db, {
        id: "omie_11488403507",
        name: "Levisa",
        document: "06020284000164",
        creditEnabled: false
      });
      insertCustomer(db, {
        id: "28cbc2e5",
        name: "Levisa",
        document: "06020284000164",
        creditEnabled: false
      });
      insertOperation(db, { id: "op-1", customer: "omie_11488403507", createdAt: "2026-07-17" });
      insertOperation(db, { id: "op-2", customer: "28cbc2e5", createdAt: "2026-07-20" });
      insertOperation(db, { id: "op-3", customer: "omie_11488403507", createdAt: "2026-07-28" });
      insertOperation(db, { id: "op-4", customer: "28cbc2e5", createdAt: "2026-07-31" });

      const result = periodReport(db);

      expect(result.invoices).toHaveLength(1);
      expect(result.customers).toBe(1);
      expect(result.invoices[0].lines.map((line) => line.operationId)).toEqual([
        "op-1",
        "op-2",
        "op-3",
        "op-4"
      ]);
      expect(result.invoices[0].customerIds.sort()).toEqual(["28cbc2e5", "omie_11488403507"]);
    } finally {
      db.close();
    }
  });

  it("escolher UM dos cadastros duplicados traz as cargas dos dois", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "omie_1", name: "Levisa", document: "06020284000164" });
      insertCustomer(db, { id: "local-1", name: "Levisa", document: "06020284000164" });
      insertCustomer(db, { id: "outro", name: "Beta", document: "11222333000155" });
      insertOperation(db, { id: "op-1", customer: "omie_1", createdAt: "2026-07-17" });
      insertOperation(db, { id: "op-2", customer: "local-1", createdAt: "2026-07-20" });
      insertOperation(db, { id: "op-outro", customer: "outro", createdAt: "2026-07-21" });

      // Era aqui que a quinzena de quatro cargas aparecia com duas: o filtro pegava so o
      // cadastro escolhido.
      for (const chosen of ["omie_1", "local-1"]) {
        expect(
          periodReport(db, { customerId: chosen }).rows.map((line) => line.operationId)
        ).toEqual(["op-1", "op-2"]);
      }
      expect(
        periodReport(db, { customerId: "outro" }).rows.map((line) => line.operationId)
      ).toEqual(["op-outro"]);
    } finally {
      db.close();
    }
  });

  it("a carga cujo cadastro de cliente sumiu continua aparecendo", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertCustomer(db, { id: "cust-1", name: "Alfa", creditEnabled: false });
      insertOperation(db, { id: "op-1", customer: "cust-1", createdAt: "2026-07-20" });
      insertOperation(db, { id: "op-orfa", customer: "cust-1", createdAt: "2026-07-21" });
      // Cadastro apagado da base: com JOIN, a carga sumia do fechamento inteiro — pesada,
      // saida da pedreira e invisivel para quem cobra.
      db.prepare("UPDATE weighing_operations SET customer_id = NULL WHERE id = 'op-orfa'").run();

      const result = periodReport(db);
      expect(result.rows.map((line) => line.operationId)).toEqual(["op-1", "op-orfa"]);
      expect(result.rowTotals.operations).toBe(2);
    } finally {
      db.close();
    }
  });
});
