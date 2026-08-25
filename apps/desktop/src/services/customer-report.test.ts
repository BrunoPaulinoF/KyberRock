import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  CustomerReportService,
  addDaysToIsoDate,
  splitInstallmentAmounts
} from "./customer-report";
import {
  customerReportFileBaseName,
  customersOverviewFileBaseName,
  formatDatesSummary,
  renderCustomerReportHtml,
  renderCustomerReportSpreadsheet,
  renderCustomersOverviewHtml,
  renderCustomersOverviewSpreadsheet
} from "./customer-report-render";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  return db;
}

type Database = ReturnType<typeof createDatabase>;

function setupBaseData(db: Database): void {
  db.prepare(
    `
    INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
    VALUES ('comp-1', 'Empresa', 'Empresa', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
    VALUES ('unit-1', 'comp-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
    VALUES ('dev-1', 'comp-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO payment_terms (
      id, company_id, name, rules_json, first_installment_days, installment_interval_days,
      installment_count, installment_days_json, created_at, updated_at
    ) VALUES (
      'term-1', 'comp-1', '30 dias', '{}', 30, 30, 3, '[30,60,90]',
      datetime('now'), datetime('now')
    )
  `
  ).run();
  db.prepare(
    `
    INSERT INTO carriers (id, company_id, name, document, source, created_at, updated_at)
    VALUES ('carr-1', 'comp-1', 'Transportes Rocha', '11222333000144', 'local', datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO customers (
      id, company_id, legal_name, trade_name, document, phone, email, source,
      city, state, open_receivables_cents, default_payment_term_id, default_carrier_id,
      created_at, updated_at
    ) VALUES (
      'cust-1', 'comp-1', 'Construtora Alfa LTDA', 'Alfa', '11222333000155', '11999998888',
      'alfa@exemplo.com', 'local', 'Sorocaba', 'SP', 250000, 'term-1', 'carr-1',
      datetime('now'), datetime('now')
    )
  `
  ).run();
  db.prepare(
    `
    INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
    VALUES ('cust-2', 'comp-1', 'Beta Obras', 'Beta', 'local', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO customers (id, company_id, legal_name, trade_name, source, is_active, created_at, updated_at)
    VALUES ('cust-3', 'comp-1', 'Gama Inativa', 'Gama', 'local', 0, datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
    VALUES ('prod-1', 'comp-1', 'B0', 'Brita 0', 'TON', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
    VALUES ('prod-2', 'comp-1', 'B1', 'Brita 1', 'TON', datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO vehicles (id, company_id, plate, description, carrier_id, created_at, updated_at)
    VALUES ('veh-1', 'comp-1', 'ABC1D23', 'Truck', 'carr-1', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
    VALUES ('veh-2', 'comp-1', 'XYZ4E56', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO drivers (id, company_id, name, document, created_at, updated_at)
    VALUES ('drv-1', 'comp-1', 'Joao Motorista', '12345678900', datetime('now'), datetime('now'))
  `
  ).run();
}

interface OperationSeed {
  id: string;
  customer: string;
  product: string;
  vehicle: string;
  net: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  entry: string;
  exit: string;
  status?: string;
  cancelReason?: string;
  freightType?: string;
  freightJson?: string | null;
  paymentMethod?: string | null;
  carrier?: string | null;
}

function insertOperations(db: Database, seeds: OperationSeed[]): void {
  for (const seed of seeds) {
    db.prepare(
      `
      INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
        vehicle_id, driver_id, carrier_id, payment_term_id, payment_method_id,
        entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents,
        product_total_cents, freight_total_cents, total_cents, freight_type, freight_json,
        entry_weight_captured_at, exit_weight_captured_at, cancel_reason, created_at, updated_at
      ) VALUES (
        ?, 'comp-1', 'unit-1', 'dev-1', ?, 'invoice', ?, ?,
        ?, 'drv-1', ?, 'term-1', ?,
        10000, ?, ?, 50000,
        ?, ?, ?, ?, ?,
        datetime(?), datetime(?), ?, datetime(?), datetime(?)
      )
    `
    ).run(
      seed.id,
      seed.status ?? "closed_local",
      seed.customer,
      seed.product,
      seed.vehicle,
      seed.carrier === undefined ? "carr-1" : seed.carrier,
      seed.paymentMethod ?? null,
      10000 + seed.net,
      seed.net,
      seed.productCents,
      seed.freightCents,
      seed.totalCents,
      seed.freightType ?? "cif",
      seed.freightJson ?? null,
      seed.entry,
      seed.exit,
      seed.cancelReason ?? null,
      seed.entry,
      seed.exit
    );
  }
}

function seedCustomerOperations(db: Database): void {
  insertOperations(db, [
    {
      id: "op-1",
      customer: "cust-1",
      product: "prod-1",
      vehicle: "veh-1",
      net: 15000,
      productCents: 750000,
      freightCents: 150000,
      totalCents: 900000,
      entry: "2026-06-06 08:00:00",
      exit: "2026-06-06 08:30:00",
      freightJson: JSON.stringify({
        destination: "Obra Centro",
        rule: {
          id: "r1",
          name: "Por tonelada",
          type: "per_ton",
          baseValueCents: 1000,
          unit: "ton",
          distanceKm: 42
        }
      })
    },
    {
      id: "op-2",
      customer: "cust-1",
      product: "prod-2",
      vehicle: "veh-2",
      net: 10000,
      productCents: 600000,
      freightCents: 0,
      totalCents: 600000,
      entry: "2026-06-07 09:00:00",
      exit: "2026-06-07 10:00:00",
      freightType: "own_recipient",
      carrier: null
    },
    // Julho: entra no ano, fica de fora de junho.
    {
      id: "op-3",
      customer: "cust-1",
      product: "prod-1",
      vehicle: "veh-1",
      net: 20000,
      productCents: 1000000,
      freightCents: 200000,
      totalCents: 1200000,
      entry: "2026-07-02 08:00:00",
      exit: "2026-07-02 08:45:00"
    },
    // Cancelada: nao entra nos totais, entra na lista de canceladas.
    {
      id: "op-4",
      customer: "cust-1",
      product: "prod-1",
      vehicle: "veh-1",
      net: 5000,
      productCents: 250000,
      freightCents: 0,
      totalCents: 250000,
      entry: "2026-06-08 08:00:00",
      exit: "2026-06-08 08:10:00",
      status: "cancelled",
      cancelReason: "Erro do operador"
    },
    // Outro cliente: nunca pode aparecer no relatorio do cliente 1.
    {
      id: "op-5",
      customer: "cust-2",
      product: "prod-1",
      vehicle: "veh-1",
      net: 30000,
      productCents: 1500000,
      freightCents: 0,
      totalCents: 1500000,
      entry: "2026-06-06 11:00:00",
      exit: "2026-06-06 11:30:00"
    }
  ]);
}

describe("CustomerReportService.listCustomerOptions", () => {
  it("lists active customers of the unit company with their document", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      const options = new CustomerReportService(db).listCustomerOptions("unit-1");

      expect(options.map((option) => option.name)).toEqual(["Alfa", "Beta"]);
      expect(options[0]).toMatchObject({ id: "cust-1", document: "11222333000155" });
    } finally {
      db.close();
    }
  });

  it("mostra UMA opcao por cliente real, mesmo com o cadastro duplicado", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      // O cadastro que veio do OMIE, com o mesmo CNPJ do que ja existia na balanca. A lista
      // mostrava os dois, identicos na tela — e escolher qualquer um trazia metade das cargas.
      db.prepare(
        `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
         VALUES ('omie_1', 'comp-1', 'Construtora Alfa LTDA', 'Alfa', '11222333000155', 'omie', datetime('now'), datetime('now'))`
      ).run();

      const options = new CustomerReportService(db).listCustomerOptions("unit-1");
      expect(options.map((option) => option.name)).toEqual(["Alfa", "Beta"]);
    } finally {
      db.close();
    }
  });
});

describe("CustomerReportService.getCustomerReport", () => {
  it("le as cargas dos DOIS cadastros do mesmo cliente", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare(
        `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
         VALUES ('omie_1', 'comp-1', 'Construtora Alfa LTDA', 'Alfa', '11222333000155', 'omie', datetime('now'), datetime('now'))`
      ).run();
      // Uma carga gravada no cadastro do OMIE: pelo filtro de um id so ela sumia do
      // relatorio do cliente, sem nada na tela dizendo que faltava.
      db.prepare("UPDATE weighing_operations SET customer_id = 'omie_1' WHERE id = 'op-2'").run();

      const service = new CustomerReportService(db);
      for (const chosen of ["cust-1", "omie_1"]) {
        const report = service.getCustomerReport(chosen, "2026-06-01", "2026-06-30", "unit-1");
        expect(report.operations.map((operation) => operation.id)).toEqual(["op-1", "op-2"]);
      }
    } finally {
      db.close();
    }
  });

  it("aggregates only the customer's closed operations in the range", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "Mes atual"
      );

      expect(report.operations.map((operation) => operation.id)).toEqual(["op-1", "op-2"]);
      expect(report.totals).toMatchObject({
        operations: 2,
        netWeightKg: 25000,
        productCents: 1_350_000,
        freightCents: 150_000,
        totalCents: 1_500_000,
        cancelledOperations: 1,
        cancelledNetWeightKg: 5000,
        firstOperationDate: "2026-06-06",
        lastOperationDate: "2026-06-07"
      });
      // 1.350.000 centavos / 25 t
      expect(report.totals.avgPriceCentsPerTon).toBe(54_000);
      expect(report.totals.avgTicketCents).toBe(750_000);
      expect(report.cancelledOperations.map((operation) => operation.cancelReason)).toEqual([
        "Erro do operador"
      ]);
    } finally {
      db.close();
    }
  });

  it("keeps counting operations after they sync (closed_local -> synced)", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare("UPDATE weighing_operations SET status = 'synced' WHERE id = 'op-1'").run();
      db.prepare("UPDATE weighing_operations SET status = 'pending_omie' WHERE id = 'op-2'").run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(report.totals.operations).toBe(2);
      expect(report.totals.totalCents).toBe(1_500_000);
    } finally {
      db.close();
    }
  });

  it("groups products, plates, carriers, freight modality and periods", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1"
      );

      const brita0 = report.byProduct.find((row) => row.productCode === "B0");
      expect(brita0).toMatchObject({ operations: 2, netWeightKg: 35000, productCents: 1_750_000 });
      expect(brita0?.avgPriceCentsPerTon).toBe(50_000);

      const abc = report.byPlate.find((row) => row.plate === "ABC1D23");
      expect(abc).toMatchObject({
        operations: 2,
        netWeightKg: 35000,
        driverName: "Joao Motorista",
        carrierName: "Transportes Rocha"
      });
      // 30 min + 45 min
      expect(abc?.totalMinutes).toBe(75);
      expect(abc?.avgMinutes).toBe(38);

      expect(report.byCarrier.map((row) => row.carrierName).sort()).toEqual([
        "Sem transportadora",
        "Transportes Rocha"
      ]);
      expect(
        report.byCarrier.find((row) => row.carrierName === "Transportes Rocha")?.plates
      ).toEqual(["ABC1D23"]);

      expect(report.byFreightModality.map((row) => row.name).sort()).toEqual([
        "Com frete (transp. proprio do cliente)",
        "Valor so no sistema"
      ]);

      expect(report.byMonth.map((row) => row.period)).toEqual(["2026-06", "2026-07"]);
      expect(report.byMonth[0]).toMatchObject({ operations: 2, netWeightKg: 25000 });
      expect(report.byDay.map((row) => row.period)).toEqual([
        "2026-06-06",
        "2026-06-07",
        "2026-07-02"
      ]);
    } finally {
      db.close();
    }
  });

  it("records how much of each material was loaded and on which days", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      // Segundo carregamento do mesmo material no mesmo dia: vira uma linha so, com dois
      // carregamentos somados — o dia nao pode aparecer duas vezes.
      insertOperations(db, [
        {
          id: "op-7",
          customer: "cust-1",
          product: "prod-1",
          vehicle: "veh-2",
          net: 5000,
          productCents: 250000,
          freightCents: 0,
          totalCents: 250000,
          entry: "2026-06-06 14:00:00",
          exit: "2026-06-06 14:30:00"
        }
      ]);

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1"
      );

      const brita0 = report.byProduct.find((row) => row.productCode === "B0");
      // 08/06 e a operacao cancelada: nao conta como dia carregado.
      expect(brita0).toMatchObject({
        operations: 3,
        netWeightKg: 40000,
        dates: ["2026-06-06", "2026-07-02"],
        firstDate: "2026-06-06",
        lastDate: "2026-07-02"
      });
      expect(report.byProduct.find((row) => row.productCode === "B1")).toMatchObject({
        dates: ["2026-06-07"],
        firstDate: "2026-06-07",
        lastDate: "2026-06-07"
      });

      // Material com mais peso primeiro, e dentro dele o dia mais antigo primeiro.
      expect(
        report.byProductDay.map((row) => [row.productDescription, row.date, row.netWeightKg])
      ).toEqual([
        ["Brita 0", "2026-06-06", 20000],
        ["Brita 0", "2026-07-02", 20000],
        ["Brita 1", "2026-06-07", 10000]
      ]);
      expect(report.byProductDay[0]).toMatchObject({
        productCode: "B0",
        operations: 2,
        productCents: 1_000_000,
        totalCents: 1_150_000,
        // 1.000.000 centavos / 20 t
        avgPriceCentsPerTon: 50_000
      });
    } finally {
      db.close();
    }
  });

  it("lines up the trips of each plate and driver in sequence", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare(
        `INSERT INTO drivers (id, company_id, name, created_at, updated_at)
         VALUES ('drv-2', 'comp-1', 'Ana Motorista', datetime('now'), datetime('now'))`
      ).run();
      // Mesma placa da op-1/op-3 (ABC1D23), outro motorista: as viagens de cada um saem
      // juntas, sem intercalar pela data.
      insertOperations(db, [
        {
          id: "op-8",
          customer: "cust-1",
          product: "prod-2",
          vehicle: "veh-1",
          net: 8000,
          productCents: 400000,
          freightCents: 0,
          totalCents: 400000,
          entry: "2026-06-20 08:00:00",
          exit: "2026-06-20 08:20:00"
        }
      ]);
      db.prepare("UPDATE weighing_operations SET driver_id = 'drv-2' WHERE id = 'op-8'").run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1"
      );

      // ABC1D23 carregou mais que XYZ4E56, entao vem primeiro; dentro da placa, cada
      // motorista com as suas viagens da mais antiga para a mais nova.
      expect(
        report.tripsByPlate.map((operation) => [
          operation.plate,
          operation.driverName,
          operation.date,
          operation.productDescription
        ])
      ).toEqual([
        ["ABC1D23", "Ana Motorista", "2026-06-20", "Brita 1"],
        ["ABC1D23", "Joao Motorista", "2026-06-06", "Brita 0"],
        ["ABC1D23", "Joao Motorista", "2026-07-02", "Brita 0"],
        ["XYZ4E56", "Joao Motorista", "2026-06-07", "Brita 1"]
      ]);
      // Mesma lista de operacoes do relatorio, so que em outra ordem: nada some nem sobra.
      expect(report.tripsByPlate.map((operation) => operation.id).sort()).toEqual(
        report.operations.map((operation) => operation.id).sort()
      );
      // A cancelada de 08/06 nao e viagem.
      expect(report.tripsByPlate.some((operation) => operation.id === "op-4")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("reads the customer registration data and the freight details of each operation", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(report.customer).toMatchObject({
        legalName: "Construtora Alfa LTDA",
        tradeName: "Alfa",
        document: "11222333000155",
        city: "Sorocaba",
        state: "SP",
        openReceivablesCents: 250000,
        defaultPaymentTermName: "30 dias",
        defaultCarrierName: "Transportes Rocha"
      });

      const first = report.operations[0];
      expect(first).toMatchObject({
        plate: "ABC1D23",
        driverName: "Joao Motorista",
        carrierName: "Transportes Rocha",
        productDescription: "Brita 0",
        freightModality: "cif",
        freightModalityLabel: "Valor so no sistema",
        freightDestination: "Obra Centro",
        freightDistanceKm: 42,
        freightRuleName: "Por tonelada",
        paymentTermName: "30 dias",
        minutesInside: 30,
        statusLabel: "Concluida (local)"
      });
    } finally {
      db.close();
    }
  });

  it("prefers the manual installment count over the registered payment term", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare("UPDATE weighing_operations SET manual_installments = 3 WHERE id = 'op-1'").run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(report.operations[0].paymentTermName).toBe("3 parcelas");
    } finally {
      db.close();
    }
  });

  it("survives a corrupted freight rule instead of failing the whole report", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare("UPDATE weighing_operations SET freight_json = '{oops' WHERE id = 'op-1'").run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(report.operations[0].freightDestination).toBeNull();
      expect(report.totals.operations).toBe(2);
    } finally {
      db.close();
    }
  });

  it("returns an empty report for a customer without operations in the range", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-01-31",
        "unit-1"
      );

      expect(report.totals.operations).toBe(0);
      expect(report.totals.avgPriceCentsPerTon).toBe(0);
      expect(report.byProduct).toEqual([]);
      expect(report.byProductDay).toEqual([]);
      expect(report.operations).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("fails loudly for an unknown customer", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      const service = new CustomerReportService(db);
      expect(() =>
        service.getCustomerReport("missing", "2026-06-01", "2026-06-30", "unit-1")
      ).toThrow(/Cliente nao encontrado/);
    } finally {
      db.close();
    }
  });
});

describe("customer report rendering", () => {
  it("renders the simplified PDF with the main sections only", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "Mes atual"
      );

      const html = renderCustomerReportHtml(report, "simplified", new Date("2026-07-15T12:00:00Z"));

      expect(html).toContain("Relatorio do cliente");
      expect(html).toContain("Simplificado");
      expect(html).toContain("Mes atual");
      expect(html).toContain("Produtos comprados");
      expect(html).toContain("Materiais por dia");
      expect(html).toContain("Placas");
      expect(html).toContain("Viagens por placa e motorista");
      expect(html).toContain("Joao Motorista");
      expect(html).toContain("Compras por mes");
      expect(html).toContain("ABC1D23");
      // O dia de cada material sai no simplificado, nao so no completo.
      expect(html).toContain("06/06/2026");
      // Secoes exclusivas do completo ficam de fora.
      expect(html).not.toContain("Operacoes (detalhado)");
      expect(html).not.toContain("Pagamentos por forma");
      expect(html).not.toContain("Operacoes canceladas");
    } finally {
      db.close();
    }
  });

  it("renders the complete PDF with transport, payments and every operation", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const html = renderCustomerReportHtml(report, "complete", new Date("2026-07-15T12:00:00Z"));

      expect(html).toContain("Completo");
      // Os materiais com os dias e as viagens por placa saem nos dois modelos.
      expect(html).toContain("Materiais por dia");
      expect(html).toContain("Datas");
      expect(html).toContain("Viagens por placa e motorista");
      expect(html).toContain("Transporte por transportadora");
      expect(html).toContain("Tipos de frete");
      expect(html).toContain("Pagamentos por forma");
      expect(html).toContain("Pagamentos por condicao");
      expect(html).toContain("Compras por dia");
      expect(html).toContain("Operacoes (detalhado)");
      expect(html).toContain("Operacoes canceladas");
      expect(html).toContain("Erro do operador");
      expect(html).toContain("Obra Centro");
      expect(html).toContain("06/06/2026");
    } finally {
      db.close();
    }
  });

  it("renders the spreadsheet with one block per section", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const simplified = renderCustomerReportSpreadsheet(report, "simplified");
      expect(simplified).toContain("Resumo");
      expect(simplified).toContain("Produtos");
      expect(simplified).toContain("Materiais por dia");
      expect(simplified).toContain("Placas");
      expect(simplified).toContain("Viagens por placa");
      expect(simplified).not.toContain("Canceladas");

      const complete = renderCustomerReportSpreadsheet(report, "complete");
      expect(complete).toContain("Transporte");
      expect(complete).toContain("Operacoes");
      expect(complete).toContain("Canceladas");
    } finally {
      db.close();
    }
  });

  it("formats the spreadsheet with a header, banded rows, totals and sized columns", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "Mes atual"
      );

      const sheet = renderCustomerReportSpreadsheet(report, "simplified");

      // Cabecalho do documento: cliente, periodo e modelo antes da primeira tabela.
      expect(sheet).toContain("<h1>Alfa</h1>");
      expect(sheet).toContain("01/06/2026 a 30/06/2026");
      expect(sheet).toContain("Mes atual");
      // Faixa zebrada e linha de total marcadas linha a linha (o Excel nao le nth-child).
      expect(sheet).toContain('<tr class="alt">');
      expect(sheet).toContain('<tr class="total">');
      // Colunas com largura: sem isso a planilha abre com valores em "#####".
      expect(sheet).toMatch(/<th[^>]*style="width:\d+px"/);
      // Peso e valor alinhados a direita; a primeira coluna, que rotula a linha, nao.
      expect(sheet).toContain('<td class="num">15.000</td>');
      expect(sheet).toContain('<td class="num">06/06/2026</td>');
      expect(sheet).toContain("<td>Brita 0</td>");
      expect(sheet).toContain("<td>06/2026</td>");
    } finally {
      db.close();
    }
  });

  it("escapes customer data so a quote in the name cannot break the document", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare(
        "UPDATE customers SET trade_name = '<b>Alfa</b> & \"Cia\"' WHERE id = 'cust-1'"
      ).run();
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const html = renderCustomerReportHtml(report, "simplified");
      expect(html).toContain("&lt;b&gt;Alfa&lt;/b&gt; &amp; &quot;Cia&quot;");
      expect(html).not.toContain("<b>Alfa</b>");
    } finally {
      db.close();
    }
  });

  it("writes out one or two loading days and summarizes longer lists", () => {
    expect(formatDatesSummary([])).toBe("-");
    expect(formatDatesSummary(["2026-06-06"])).toBe("06/06/2026");
    expect(formatDatesSummary(["2026-06-06", "2026-07-02"])).toBe("06/06/2026, 02/07/2026");
    expect(formatDatesSummary(["2026-06-06", "2026-06-07", "2026-07-02"])).toBe(
      "06/06/2026 a 02/07/2026 (3 dias)"
    );
  });

  it("builds a file name with the customer, the variant and the range", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(customerReportFileBaseName(report, "simplified")).toBe(
        "relatorio-cliente-alfa-simplificado-2026-06-01-a-2026-06-30"
      );
      expect(customerReportFileBaseName(report, "complete")).toBe(
        "relatorio-cliente-alfa-completo-2026-06-01-a-2026-06-30"
      );
    } finally {
      db.close();
    }
  });
});

describe("CustomerReportService.getCustomersOverview", () => {
  it("lists every customer with movement in the range, biggest revenue first", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      // Desempata o mes: Beta passa a faturar mais que Alfa, e vem antes apesar de vir
      // depois no alfabeto — e a receita que manda na ordem.
      insertOperations(db, [
        {
          id: "op-6",
          customer: "cust-2",
          product: "prod-1",
          vehicle: "veh-1",
          net: 12000,
          productCents: 600000,
          freightCents: 0,
          totalCents: 600000,
          entry: "2026-06-09 08:00:00",
          exit: "2026-06-09 08:30:00"
        }
      ]);

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "Mes atual"
      );

      expect(overview.customers.map((row) => row.customer.name)).toEqual(["Beta", "Alfa"]);
      expect(overview.customers[0]).toMatchObject({
        customer: { id: "cust-2" },
        totals: { operations: 2, netWeightKg: 42000, totalCents: 2_100_000 }
      });
      expect(overview.periodLabel).toBe("Mes atual");
    } finally {
      db.close();
    }
  });

  it("carries what each customer loaded of each material, with the days", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const alfa = overview.customers.find((row) => row.customer.id === "cust-1");
      expect(
        alfa?.byProduct.map((row) => [row.productDescription, row.netWeightKg, row.dates])
      ).toEqual([
        ["Brita 0", 15000, ["2026-06-06"]],
        ["Brita 1", 10000, ["2026-06-07"]]
      ]);

      const beta = overview.customers.find((row) => row.customer.id === "cust-2");
      expect(beta?.byProduct.map((row) => row.productDescription)).toEqual(["Brita 0"]);
      expect(beta?.byProduct[0]).toMatchObject({ netWeightKg: 30000, dates: ["2026-06-06"] });
    } finally {
      db.close();
    }
  });

  it("breaks a revenue tie by customer name, so the order never dances", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      // Em junho os dois faturam R$ 15.000 (Alfa em duas operacoes, Beta em uma).
      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(overview.customers.map((row) => row.totals.totalCents)).toEqual([
        1_500_000, 1_500_000
      ]);
      expect(overview.customers.map((row) => row.customer.name)).toEqual(["Alfa", "Beta"]);
    } finally {
      db.close();
    }
  });

  // O resumo existe para comparar com o relatorio individual: se as duas contas
  // divergirem, o operador nao sabe em qual acreditar.
  it("matches the individual report of the same customer, number by number", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const service = new CustomerReportService(db);

      const report = service.getCustomerReport("cust-1", "2026-06-01", "2026-06-30", "unit-1");
      const overview = service.getCustomersOverview("2026-06-01", "2026-06-30", "unit-1");
      const alfa = overview.customers.find((row) => row.customer.id === "cust-1");

      expect(alfa?.totals).toEqual(report.totals);
      expect(alfa?.installmentTotals).toEqual(report.installmentTotals);
    } finally {
      db.close();
    }
  });

  // A cancelada nao pode entrar no faturamento, mas precisa ser contada como cancelada —
  // exatamente como no relatorio individual.
  it("keeps cancelled operations out of the revenue and counts them apart", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );
      const alfa = overview.customers.find((row) => row.customer.id === "cust-1");

      expect(alfa?.totals).toMatchObject({
        operations: 2,
        totalCents: 1_500_000,
        cancelledOperations: 1,
        cancelledNetWeightKg: 5000
      });
    } finally {
      db.close();
    }
  });

  it("totals the whole period in the footer row", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      // Alfa (2 operacoes, 25t, R$ 15.000) + Beta (1 operacao, 30t, R$ 15.000).
      expect(overview.totals).toMatchObject({
        operations: 3,
        netWeightKg: 55000,
        totalCents: 3_000_000
      });
      expect(overview.customers.reduce((sum, row) => sum + row.totals.totalCents, 0)).toBe(
        overview.totals.totalCents
      );
    } finally {
      db.close();
    }
  });

  // Quem so tem parcela vencendo no periodo (comprou antes) precisa aparecer: e dinheiro
  // do periodo, e sem a linha o total de "a vencer" nao fecharia com a soma das linhas.
  it("keeps a customer that only has installments falling due in the range", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      // Julho: Alfa carregou (op-3); Beta nao, mas a op-5 de 06/06 vence 30 dias depois.
      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-07-01",
        "2026-07-31",
        "unit-1"
      );
      const beta = overview.customers.find((row) => row.customer.id === "cust-2");

      expect(beta?.totals.operations).toBe(0);
      expect(beta?.installmentTotals.amountCents).toBeGreaterThan(0);
      expect(overview.installmentTotals.amountCents).toBe(
        overview.customers.reduce((sum, row) => sum + row.installmentTotals.amountCents, 0)
      );
    } finally {
      db.close();
    }
  });

  // Cliente cadastrado que nunca carregou nem deve nada nao polui a lista com uma linha
  // zerada — a comparacao existe para achar quem comprou.
  it("leaves out customers without any movement in the range", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(overview.customers.map((row) => row.customer.id)).not.toContain("cust-3");
    } finally {
      db.close();
    }
  });

  it("returns an empty overview for a range without operations", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-01-01",
        "2026-01-31",
        "unit-1"
      );

      expect(overview.customers).toEqual([]);
      expect(overview.totals).toMatchObject({ operations: 0, totalCents: 0 });
      expect(overview.installmentTotals).toMatchObject({ installments: 0, amountCents: 0 });
    } finally {
      db.close();
    }
  });

  it("groups operations without a linked customer into a single row", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      // Operacoes vindas de outro desktop podem chegar sem o cliente vinculado: elas
      // precisam somar numa linha so, senao o total do periodo nao fecha.
      db.prepare(
        `UPDATE weighing_operations SET customer_id = NULL, remote_customer_name = 'Cliente Remoto'
         WHERE id IN ('op-1', 'op-2')`
      ).run();

      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );
      const orphan = overview.customers.find((row) => row.customer.id === null);

      expect(orphan?.customer.name).toBe("Cliente Remoto");
      expect(orphan?.totals).toMatchObject({ operations: 2, totalCents: 1_500_000 });
      expect(overview.totals.totalCents).toBe(3_000_000);
    } finally {
      db.close();
    }
  });

  it("sums the installments due in the period per customer", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      // As parcelas da op-1 (R$ 9.000 em 30/60/90 dias a partir de 06/06) vencem em
      // julho, agosto e setembro; a janela de julho pega apenas a primeira.
      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-07-01",
        "2026-07-31",
        "unit-1",
        null,
        new Date(2026, 5, 15)
      );
      const alfa = overview.customers.find((row) => row.customer.id === "cust-1");

      expect(alfa?.installmentTotals.installments).toBeGreaterThan(0);
      expect(overview.installmentTotals.amountCents).toBe(
        overview.customers.reduce((sum, row) => sum + row.installmentTotals.amountCents, 0)
      );
    } finally {
      db.close();
    }
  });
});

describe("customers overview rendering", () => {
  function buildOverview(db: Database) {
    setupBaseData(db);
    seedCustomerOperations(db);
    return new CustomerReportService(db).getCustomersOverview(
      "2026-06-01",
      "2026-06-30",
      "unit-1",
      "Mes atual"
    );
  }

  it("renders the PDF with one row per customer and a total row", () => {
    const db = createDatabase();
    try {
      const html = renderCustomersOverviewHtml(buildOverview(db));

      expect(html).toContain("Todos os clientes");
      expect(html).toContain("Mes atual");
      expect(html).toContain("Beta");
      expect(html).toContain("Alfa");
      expect(html).toContain("TOTAL");
      // Lista larga: sai em paisagem para as colunas caberem.
      expect(html).toContain("size:A4 landscape");
      // Cada cliente com os materiais que carregou e os dias de cada um.
      expect(html).toContain("Materiais por cliente");
      expect(html).toContain("Brita 0");
      expect(html).toContain("06/06/2026");
    } finally {
      db.close();
    }
  });

  it("renders the spreadsheet with the period block and the customer list", () => {
    const db = createDatabase();
    try {
      const sheet = renderCustomersOverviewSpreadsheet(buildOverview(db));

      expect(sheet).toContain("Clientes no periodo");
      expect(sheet).toContain("Clientes com movimento");
      expect(sheet).toContain("Beta");
      expect(sheet).toContain("Materiais por cliente");
      expect(sheet).toContain("Brita 1");
    } finally {
      db.close();
    }
  });

  it("escapes customer data so a quote in the name cannot break the document", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare(`UPDATE customers SET trade_name = '<script>"Alfa"' WHERE id = 'cust-1'`).run();
      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const html = renderCustomersOverviewHtml(overview);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;&quot;Alfa&quot;");
    } finally {
      db.close();
    }
  });

  it("says the period is empty instead of rendering a headerless table", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      const overview = new CustomerReportService(db).getCustomersOverview(
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      expect(renderCustomersOverviewHtml(overview)).toContain(
        "Nenhum cliente com movimento no periodo."
      );
    } finally {
      db.close();
    }
  });

  it("builds a file name with the range", () => {
    const db = createDatabase();
    try {
      expect(customersOverviewFileBaseName(buildOverview(db))).toBe(
        "relatorio-clientes-2026-06-01-a-2026-06-30"
      );
    } finally {
      db.close();
    }
  });
});

describe("customer report installment schedule", () => {
  it("splits the total across the payment term days, from the exit date", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      // Condicao "30/60/90" sobre a op-1 (saida 06/06, total R$ 9.000,00).
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1",
        null,
        new Date("2026-07-28T12:00:00")
      );

      const opOne = report.installments.filter((item) => item.operationId === "op-1");
      expect(opOne.map((item) => item.dueDate)).toEqual(["2026-07-06", "2026-08-05", "2026-09-04"]);
      // Rateio por percentual igual (33,33%), com a ultima parcela absorvendo o resto —
      // exatamente o que a edge omie-sync envia no lista_parcelas do pedido.
      expect(opOne.map((item) => item.amountCents)).toEqual([299_970, 299_970, 300_060]);
      // O rateio nunca pode perder ou criar centavos.
      expect(opOne.reduce((sum, item) => sum + item.amountCents, 0)).toBe(900_000);
      expect(opOne.map((item) => `${item.number}/${item.installmentCount}`)).toEqual([
        "1/3",
        "2/3",
        "3/3"
      ]);
    } finally {
      db.close();
    }
  });

  it("shows future installments generated by operations older than the period", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      // Periodo inteiramente no futuro: nenhum carregamento, mas as parcelas de
      // setembro (compras de junho e julho) precisam aparecer.
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-09-01",
        "2026-09-30",
        "unit-1",
        "Proximos 90 dias",
        new Date("2026-07-28T12:00:00")
      );

      expect(report.operations).toEqual([]);
      expect(report.totals.operations).toBe(0);
      expect(report.installments.map((item) => item.dueDate)).toEqual([
        "2026-09-04",
        "2026-09-05",
        "2026-09-30"
      ]);
      expect(report.installments.every((item) => item.situation === "upcoming")).toBe(true);
      expect(report.installmentsByMonth).toEqual([
        // Ultima parcela da op-1 (04/09), da op-2 (05/09) e da op-3 (30/09).
        { period: "2026-09", installments: 3, amountCents: 300_060 + 200_040 + 400_080 }
      ]);
      expect(report.installmentTotals).toMatchObject({
        installments: 3,
        overdueInstallments: 0,
        upcomingInstallments: 3,
        nextDueDate: "2026-09-04"
      });
    } finally {
      db.close();
    }
  });

  it("classifies installments as overdue, today or upcoming against the reference day", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      // Hoje = 05/08/2026: 06/07 ja venceu, 05/08 vence hoje, 04/09 esta por vir.
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1",
        null,
        new Date("2026-08-05T09:00:00")
      );

      expect(report.referenceDate).toBe("2026-08-05");
      const byDate = new Map(report.installments.map((item) => [item.dueDate, item]));
      expect(byDate.get("2026-07-06")?.situation).toBe("overdue");
      expect(byDate.get("2026-07-06")?.daysUntilDue).toBe(-30);
      expect(byDate.get("2026-08-05")?.situation).toBe("today");
      expect(byDate.get("2026-08-05")?.daysUntilDue).toBe(0);
      expect(byDate.get("2026-09-04")?.situation).toBe("upcoming");
      expect(report.installmentTotals.overdueInstallments).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("never counts cancelled operations as installments to pay", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1",
        null,
        new Date("2026-07-28T12:00:00")
      );

      expect(report.installments.some((item) => item.operationId === "op-4")).toBe(false);
      // Nem as de outro cliente.
      expect(report.installments.some((item) => item.operationId === "op-5")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("falls back to monthly installments when the term has no explicit days", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare(
        `UPDATE payment_terms SET installment_days_json = NULL, first_installment_days = NULL,
           installment_count = NULL, installment_interval_days = NULL WHERE id = 'term-1'`
      ).run();
      db.prepare("UPDATE weighing_operations SET manual_installments = 2 WHERE id = 'op-1'").run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1",
        null,
        new Date("2026-07-28T12:00:00")
      );

      const opOne = report.installments.filter((item) => item.operationId === "op-1");
      // Saida 06/06 + 30 e + 60 dias.
      expect(opOne.map((item) => item.dueDate)).toEqual(["2026-07-06", "2026-08-05"]);
      expect(opOne.map((item) => item.amountCents)).toEqual([450_000, 450_000]);
      expect(opOne[0].paymentTermName).toBe("2 parcelas");

      // Sem parcelamento manual e sem dias na condicao: a vista, no dia da saida.
      const opTwo = report.installments.filter((item) => item.operationId === "op-2");
      expect(opTwo.map((item) => item.dueDate)).toEqual(["2026-06-07"]);
      expect(opTwo[0].amountCents).toBe(600_000);
    } finally {
      db.close();
    }
  });

  it("keeps a corrupted installment_days_json from breaking the schedule", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      db.prepare(
        "UPDATE payment_terms SET installment_days_json = '[oops' WHERE id = 'term-1'"
      ).run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-01-01",
        "2026-12-31",
        "unit-1",
        null,
        new Date("2026-07-28T12:00:00")
      );

      // Cai na derivacao por primeiro dia + intervalo x quantidade (30/60/90).
      const opOne = report.installments.filter((item) => item.operationId === "op-1");
      expect(opOne.map((item) => item.dueDate)).toEqual(["2026-07-06", "2026-08-05", "2026-09-04"]);
    } finally {
      db.close();
    }
  });

  it("renders the installments in both PDF variants and in the spreadsheet", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-09-01",
        "2026-09-30",
        "unit-1",
        "Proximos 90 dias",
        new Date("2026-07-28T12:00:00")
      );

      const simplified = renderCustomerReportHtml(report, "simplified", new Date("2026-07-28"));
      expect(simplified).toContain("Vencimentos no periodo");
      expect(simplified).toContain("A vencer no periodo");
      expect(simplified).toContain("09/2026");
      expect(simplified).toContain("A baixa dos titulos e feita no OMIE");
      // O detalhamento parcela a parcela e exclusivo do completo.
      expect(simplified).not.toContain("Parcelas a pagar (detalhado)");

      const complete = renderCustomerReportHtml(report, "complete", new Date("2026-07-28"));
      expect(complete).toContain("Parcelas a pagar (detalhado)");
      expect(complete).toContain("04/09/2026");
      expect(complete).toContain("A vencer");

      const sheet = renderCustomerReportSpreadsheet(report, "simplified");
      expect(sheet).toContain("Vencimentos por mes");
      expect(sheet).toContain("Parcelas a pagar");
    } finally {
      db.close();
    }
  });

  it("splits any total across N installments without losing cents", () => {
    // 100,01 em 3 parcelas: as duas primeiras 33,33 e a ultima absorve o resto.
    expect(splitInstallmentAmounts(10_001, 3)).toEqual([3333, 3333, 3335]);
    expect(splitInstallmentAmounts(10_001, 3).reduce((a, b) => a + b, 0)).toBe(10_001);
    expect(splitInstallmentAmounts(999, 1)).toEqual([999]);
    expect(splitInstallmentAmounts(999, 0)).toEqual([]);
    for (const count of [2, 4, 7, 12]) {
      expect(splitInstallmentAmounts(1_234_567, count).reduce((a, b) => a + b, 0)).toBe(1_234_567);
    }
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysToIsoDate("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDaysToIsoDate("2026-12-15", 30)).toBe("2027-01-14");
    expect(addDaysToIsoDate("nao-e-data", 30)).toBe("nao-e-data");
  });
});

describe("numero da nota fiscal no relatorio do cliente", () => {
  it("traz a nota de cada carga na tela, no PDF e na planilha", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      // Como a reconciliacao com o OMIE grava quando a nota sai.
      db.prepare(
        "UPDATE weighing_operations SET omie_invoice_number = '28727' WHERE id = 'op-1'"
      ).run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const withInvoice = report.operations.find((operation) => operation.id === "op-1");
      expect(withInvoice?.omieInvoiceNumber).toBe("28727");
      // Carga ainda sem nota emitida no OMIE volta nula, e nao com string vazia: e o que
      // deixa a coluna dizer "-" em vez de parecer um numero em branco.
      expect(
        report.operations.find((operation) => operation.id === "op-2")?.omieInvoiceNumber
      ).toBeNull();

      // O documento que vai para o cliente e o que ele confere: o numero precisa sair nos
      // dois formatos, nao so na tela.
      const html = renderCustomerReportHtml(report, "complete", new Date("2026-07-15T12:00:00Z"));
      expect(html).toContain("Nota fiscal");
      expect(html).toContain("28727");

      const sheet = renderCustomerReportSpreadsheet(
        report,
        "complete",
        new Date("2026-07-15T12:00:00Z")
      );
      expect(sheet).toContain("Nota fiscal");
      expect(sheet).toContain("28727");

      // E no SIMPLIFICADO tambem — que e o modelo que de fato vai por e-mail ao cliente.
      // A unica lista carga a carga dele e "Viagens por placa e motorista"; enquanto a nota
      // so aparecia na tabela "Operacoes (detalhado)" do modelo completo, o relatorio que o
      // cliente recebia nao trazia numero de nota nenhum.
      const simple = renderCustomerReportHtml(
        report,
        "simplified",
        new Date("2026-07-15T12:00:00Z")
      );
      expect(simple).toContain("Nota fiscal");
      expect(simple).toContain("28727");

      const simpleSheet = renderCustomerReportSpreadsheet(
        report,
        "simplified",
        new Date("2026-07-15T12:00:00Z")
      );
      expect(simpleSheet).toContain("Nota fiscal");
      expect(simpleSheet).toContain("28727");
    } finally {
      db.close();
    }
  });

  it("expoe a ordem de servico junto do pedido, para a tela saber o que ainda perguntar", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      seedCustomerOperations(db);
      // A venda interna vira OS no OMIE e emite NFS-e. Sem este campo, a tela nao tinha
      // como distinguir "interna ja no OMIE, falta a nota" de "carga que nem chegou la",
      // e o numero da NFS-e nunca era perguntado.
      db.prepare(
        "UPDATE weighing_operations SET operation_type = 'internal', omie_service_order_id = 11493172000 WHERE id = 'op-2'"
      ).run();

      const report = new CustomerReportService(db).getCustomerReport(
        "cust-1",
        "2026-06-01",
        "2026-06-30",
        "unit-1"
      );

      const internal = report.operations.find((operation) => operation.id === "op-2");
      expect(internal?.omieServiceOrderId).toBe(11493172000);
      expect(internal?.omieInvoiceNumber).toBeNull();
      expect(
        report.operations.find((operation) => operation.id === "op-1")?.omieServiceOrderId
      ).toBeNull();
    } finally {
      db.close();
    }
  });
});
