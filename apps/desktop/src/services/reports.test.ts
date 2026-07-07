import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { ReportService } from "./reports";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  return db;
}

function setupBaseData(db: ReturnType<typeof createDatabase>) {
  db.prepare(`
    INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
    VALUES ('comp-1', 'Empresa', 'Empresa', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
    VALUES ('unit-1', 'comp-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
    VALUES ('dev-1', 'comp-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
    VALUES ('cust-1', 'comp-1', 'Cliente A', 'Cliente A', 'local', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
    VALUES ('cust-2', 'comp-1', 'Cliente B', 'Cliente B', 'local', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
    VALUES ('prod-1', 'comp-1', 'B0', 'Brita 0', 'M3', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
    VALUES ('prod-2', 'comp-1', 'B1', 'Brita 1', 'M3', datetime('now'), datetime('now'))
  `).run();
}

function insertOperations(db: ReturnType<typeof createDatabase>) {
  const ops = [
    {
      id: "op-1", customer_id: "cust-1", product_id: "prod-1", entry_weight: 10000, exit_weight: 25000,
      net_weight: 15000, unit_price_cents: 50000, product_total_cents: 750000, freight_total_cents: 150000, total_cents: 900000,
      date: "2026-06-06"
    },
    {
      id: "op-2", customer_id: "cust-1", product_id: "prod-2", entry_weight: 12000, exit_weight: 22000,
      net_weight: 10000, unit_price_cents: 60000, product_total_cents: 600000, freight_total_cents: 120000, total_cents: 720000,
      date: "2026-06-06"
    },
    {
      id: "op-3", customer_id: "cust-2", product_id: "prod-1", entry_weight: 8000, exit_weight: 18000,
      net_weight: 10000, unit_price_cents: 50000, product_total_cents: 500000, freight_total_cents: 100000, total_cents: 600000,
      date: "2026-06-07"
    },
    {
      id: "op-4", customer_id: "cust-1", product_id: "prod-1", entry_weight: 5000, exit_weight: 20000,
      net_weight: 15000, unit_price_cents: 50000, product_total_cents: 750000, freight_total_cents: 150000, total_cents: 900000,
      date: "2026-05-15"
    }
  ];

  for (const op of ops) {
    db.prepare(`
      INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
        entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents, product_total_cents,
        freight_total_cents, total_cents, created_at, updated_at
      ) VALUES (
        ?, 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'invoice', ?, ?,
        ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?)
      )
    `).run(
      op.id, op.customer_id, op.product_id,
      op.entry_weight, op.exit_weight, op.net_weight, op.unit_price_cents,
      op.product_total_cents, op.freight_total_cents, op.total_cents,
      op.date, op.date
    );
  }
}

function insertTruckOperations(db: ReturnType<typeof createDatabase>) {
  db.prepare(`
    INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
    VALUES ('veh-abc', 'comp-1', 'ABC1D23', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
    VALUES ('veh-xyz', 'comp-1', 'XYZ4E56', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO drivers (id, company_id, name, created_at, updated_at)
    VALUES ('drv-1', 'comp-1', 'Joao', datetime('now'), datetime('now'))
  `).run();

  const ops = [
    // ABC1D23: 30 min (prod-1, 15000 kg)
    { id: "t1", veh: "veh-abc", drv: "drv-1", prod: "prod-1", net: 15000, entry: "2026-06-06 08:00:00", exit: "2026-06-06 08:30:00" },
    // ABC1D23: 60 min (prod-2, 10000 kg)
    { id: "t2", veh: "veh-abc", drv: "drv-1", prod: "prod-2", net: 10000, entry: "2026-06-06 09:00:00", exit: "2026-06-06 10:00:00" },
    // XYZ4E56: 90 min (prod-1, 20000 kg)
    { id: "t3", veh: "veh-xyz", drv: "drv-1", prod: "prod-1", net: 20000, entry: "2026-06-07 08:00:00", exit: "2026-06-07 09:30:00" },
    // Fora do periodo (maio) - nao deve contar
    { id: "t4", veh: "veh-abc", drv: "drv-1", prod: "prod-1", net: 5000, entry: "2026-05-01 08:00:00", exit: "2026-05-01 08:20:00" }
  ];

  for (const op of ops) {
    db.prepare(`
      INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, vehicle_id, driver_id, product_id,
        net_weight_kg, entry_weight_captured_at, exit_weight_captured_at, created_at, updated_at
      ) VALUES (
        ?, 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'invoice', ?, ?, ?,
        ?, datetime(?), datetime(?), datetime(?), datetime(?)
      )
    `).run(op.id, op.veh, op.drv, op.prod, op.net, op.entry, op.exit, op.entry, op.exit);
  }
}

describe("ReportService truck control", () => {
  it("aggregates per-truck stats, weight per product and the average", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertTruckOperations(db);

      const service = new ReportService(db);
      const report = service.getTruckControlReport("2026-06-01", "2026-06-30", "unit-1");

      expect(report.totalOperations).toBe(3);
      expect(report.averageMinutes).toBe(60); // (30 + 60 + 90) / 3
      expect(report.trucks).toHaveLength(2);

      const abc = report.trucks.find((t) => t.plate === "ABC1D23");
      expect(abc?.operations).toBe(2);
      expect(abc?.avgMinutes).toBe(45); // (30 + 60) / 2
      expect(abc?.totalMinutes).toBe(90);
      expect(abc?.totalNetWeightKg).toBe(25000);
      expect(abc?.driverName).toBe("Joao");
      expect(abc?.products).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productDescription: "Brita 0", totalNetWeightKg: 15000 }),
          expect.objectContaining({ productDescription: "Brita 1", totalNetWeightKg: 10000 })
        ])
      );

      const xyz = report.trucks.find((t) => t.plate === "XYZ4E56");
      expect(xyz?.avgMinutes).toBe(90);
    } finally {
      db.close();
    }
  });

  it("renders the truck control report as HTML", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertTruckOperations(db);

      const service = new ReportService(db);
      const html = service.exportTruckControlToHtml("2026-06-01", "2026-06-30", "unit-1");

      expect(html).toContain("Controle de caminhoes");
      expect(html).toContain("ABC1D23");
      expect(html).toContain("Brita 0");
    } finally {
      db.close();
    }
  });
});

describe("ReportService", () => {
  it("generates daily report with totals", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const report = service.getDailyReport("2026-06-06", "unit-1");

      expect(report.totalOperations).toBe(2);
      expect(report.totalNetWeightKg).toBe(25000); // 15000 + 10000
      expect(report.totalProductCents).toBe(1_350_000); // 750000 + 600000
      expect(report.totalFreightCents).toBe(270_000); // 150000 + 120000
      expect(report.totalCents).toBe(1_620_000); // 900000 + 720000
    } finally {
      db.close();
    }
  });

  it("generates monthly report", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const report = service.getMonthlyReport(2026, 6, "unit-1");

      expect(report.totalOperations).toBe(3); // Junho tem 3 operações
      expect(report.totalNetWeightKg).toBe(35000); // 15000 + 10000 + 10000
    } finally {
      db.close();
    }
  });

  it("generates report by product", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const products = service.getReportByProduct("2026-06-01", "2026-06-30", "unit-1");

      const brita0 = products.find((p) => p.productCode === "B0");
      expect(brita0?.totalWeightKg).toBe(25000); // op-1 + op-3
      expect(brita0?.totalValueCents).toBe(1_250_000); // 750000 + 500000
    } finally {
      db.close();
    }
  });

  it("generates report by customer", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const customers = service.getReportByCustomer("2026-06-01", "2026-06-30", "unit-1");

      const clienteA = customers.find((c) => c.customerName === "Cliente A");
      expect(clienteA?.totalOperations).toBe(2);
      expect(clienteA?.totalWeightKg).toBe(25000);
    } finally {
      db.close();
    }
  });

  it("exports report to CSV format", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const csv = service.exportDailyToCSV("2026-06-06", "unit-1");

      expect(csv).toContain("Data,Cliente,Produto,Peso Liquido (kg),Valor Produto,Frete,Total");
      expect(csv).toContain("2026-06-06");
      expect(csv).toContain("Cliente A");
      expect(csv).toContain("Brita 0");
    } finally {
      db.close();
    }
  });

  it("generates a daily series filling gaps with zero", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const series = service.getDailySeries("2026-06-05", "2026-06-08", "unit-1");

      expect(series).toHaveLength(4);
      expect(series[0]).toMatchObject({ date: "2026-06-05", totalOperations: 0, totalNetWeightKg: 0 });
      expect(series[1]).toMatchObject({ date: "2026-06-06", totalOperations: 2, totalNetWeightKg: 25000 });
      expect(series[2]).toMatchObject({ date: "2026-06-07", totalOperations: 1, totalNetWeightKg: 10000 });
      expect(series[3]).toMatchObject({ date: "2026-06-08", totalOperations: 0, totalNetWeightKg: 0 });
    } finally {
      db.close();
    }
  });

  it("returns empty series when range is invalid", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      const service = new ReportService(db);

      expect(service.getDailySeries("invalid", "2026-06-06", "unit-1")).toEqual([]);
      expect(service.getDailySeries("2026-06-10", "2026-06-05", "unit-1")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("groups operations by type for the mix", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      db.prepare(`
        INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
          net_weight_kg, total_cents, created_at, updated_at
        ) VALUES (
          'op-5', 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'internal', 'cust-1', 'prod-1',
          5000, 250000, datetime('2026-06-06'), datetime('2026-06-06')
        )
      `).run();

      db.prepare(`
        INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, cancel_reason, created_at, updated_at
        ) VALUES (
          'op-6', 'comp-1', 'unit-1', 'dev-1', 'cancelled', 'invoice', 'Erro do operador',
          datetime('2026-06-06'), datetime('2026-06-06')
        )
      `).run();

      const service = new ReportService(db);
      const mix = service.getOperationMix("2026-06-01", "2026-06-30", "unit-1");

      expect(mix.invoice.count).toBe(3);
      expect(mix.internal.count).toBe(1);
      expect(mix.cancelled.count).toBe(1);
      expect(mix.invoice.totalCents).toBe(1_620_000 + 600_000);
      expect(mix.internal.totalCents).toBe(250_000);
    } finally {
      db.close();
    }
  });
});
