import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { CustomerReportService } from "./customer-report";
import {
  customerReportFileBaseName,
  renderCustomerReportHtml,
  renderCustomerReportSpreadsheet
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
    INSERT INTO payment_terms (id, company_id, name, rules_json, created_at, updated_at)
    VALUES ('term-1', 'comp-1', '30 dias', '{}', datetime('now'), datetime('now'))
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
});

describe("CustomerReportService.getCustomerReport", () => {
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
        "CIF",
        "Transp. proprio do cliente"
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
        freightModalityLabel: "CIF",
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
      expect(html).toContain("Placas");
      expect(html).toContain("Compras por mes");
      expect(html).toContain("ABC1D23");
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
      expect(simplified).toContain("Placas");
      expect(simplified).not.toContain("Canceladas");

      const complete = renderCustomerReportSpreadsheet(report, "complete");
      expect(complete).toContain("Transporte");
      expect(complete).toContain("Operacoes");
      expect(complete).toContain("Canceladas");
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
