import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { ReportService } from "./reports";
import { renderTruckControlHtml } from "./truck-control-report";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  return db;
}

function setupBaseData(db: ReturnType<typeof createDatabase>) {
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
    INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
    VALUES ('cust-1', 'comp-1', 'Cliente A', 'Cliente A', 'local', datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
    VALUES ('cust-2', 'comp-1', 'Cliente B', 'Cliente B', 'local', datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
    VALUES ('prod-1', 'comp-1', 'B0', 'Brita 0', 'M3', datetime('now'), datetime('now'))
  `
  ).run();

  db.prepare(
    `
    INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
    VALUES ('prod-2', 'comp-1', 'B1', 'Brita 1', 'M3', datetime('now'), datetime('now'))
  `
  ).run();
}

function insertOperations(db: ReturnType<typeof createDatabase>) {
  const ops = [
    {
      id: "op-1",
      customer_id: "cust-1",
      product_id: "prod-1",
      entry_weight: 10000,
      exit_weight: 25000,
      net_weight: 15000,
      unit_price_cents: 50000,
      product_total_cents: 750000,
      freight_total_cents: 150000,
      total_cents: 900000,
      date: "2026-06-06"
    },
    {
      id: "op-2",
      customer_id: "cust-1",
      product_id: "prod-2",
      entry_weight: 12000,
      exit_weight: 22000,
      net_weight: 10000,
      unit_price_cents: 60000,
      product_total_cents: 600000,
      freight_total_cents: 120000,
      total_cents: 720000,
      date: "2026-06-06"
    },
    {
      id: "op-3",
      customer_id: "cust-2",
      product_id: "prod-1",
      entry_weight: 8000,
      exit_weight: 18000,
      net_weight: 10000,
      unit_price_cents: 50000,
      product_total_cents: 500000,
      freight_total_cents: 100000,
      total_cents: 600000,
      date: "2026-06-07"
    },
    {
      id: "op-4",
      customer_id: "cust-1",
      product_id: "prod-1",
      entry_weight: 5000,
      exit_weight: 20000,
      net_weight: 15000,
      unit_price_cents: 50000,
      product_total_cents: 750000,
      freight_total_cents: 150000,
      total_cents: 900000,
      date: "2026-05-15"
    }
  ];

  for (const op of ops) {
    db.prepare(
      `
      INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
        entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents, product_total_cents,
        freight_total_cents, total_cents, created_at, updated_at
      ) VALUES (
        ?, 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'invoice', ?, ?,
        ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?)
      )
    `
    ).run(
      op.id,
      op.customer_id,
      op.product_id,
      op.entry_weight,
      op.exit_weight,
      op.net_weight,
      op.unit_price_cents,
      op.product_total_cents,
      op.freight_total_cents,
      op.total_cents,
      op.date,
      op.date
    );
  }
}

function insertTruckOperations(db: ReturnType<typeof createDatabase>) {
  db.prepare(
    `
    INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
    VALUES ('veh-abc', 'comp-1', 'ABC1D23', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
    VALUES ('veh-xyz', 'comp-1', 'XYZ4E56', datetime('now'), datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO drivers (id, company_id, name, created_at, updated_at)
    VALUES ('drv-1', 'comp-1', 'Joao', datetime('now'), datetime('now'))
  `
  ).run();

  const ops = [
    // ABC1D23: 30 min (prod-1, 15000 kg) para o Cliente A
    {
      id: "t1",
      veh: "veh-abc",
      drv: "drv-1",
      cust: "cust-1",
      prod: "prod-1",
      net: 15000,
      entry: "2026-06-06 08:00:00",
      exit: "2026-06-06 08:30:00"
    },
    // ABC1D23: 60 min (prod-2, 10000 kg) para o Cliente B - a mesma placa carrega
    // para mais de um cliente no periodo
    {
      id: "t2",
      veh: "veh-abc",
      drv: "drv-1",
      cust: "cust-2",
      prod: "prod-2",
      net: 10000,
      entry: "2026-06-06 09:00:00",
      exit: "2026-06-06 10:00:00"
    },
    // XYZ4E56: 90 min (prod-1, 20000 kg)
    {
      id: "t3",
      veh: "veh-xyz",
      drv: "drv-1",
      cust: "cust-1",
      prod: "prod-1",
      net: 20000,
      entry: "2026-06-07 08:00:00",
      exit: "2026-06-07 09:30:00"
    },
    // Fora do periodo (maio) - nao deve contar
    {
      id: "t4",
      veh: "veh-abc",
      drv: "drv-1",
      cust: "cust-1",
      prod: "prod-1",
      net: 5000,
      entry: "2026-05-01 08:00:00",
      exit: "2026-05-01 08:20:00"
    }
  ];

  for (const op of ops) {
    db.prepare(
      `
      INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, vehicle_id, driver_id, customer_id, product_id,
        net_weight_kg, entry_weight_captured_at, exit_weight_captured_at, created_at, updated_at
      ) VALUES (
        ?, 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'invoice', ?, ?, ?, ?,
        ?, datetime(?), datetime(?), datetime(?), datetime(?)
      )
    `
    ).run(op.id, op.veh, op.drv, op.cust, op.prod, op.net, op.entry, op.exit, op.entry, op.exit);
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

      expect(abc?.customers).toEqual([
        { customerName: "Cliente A", totalNetWeightKg: 15000, operations: 1 },
        { customerName: "Cliente B", totalNetWeightKg: 10000, operations: 1 }
      ]);
      expect(abc?.trips.map((trip) => [trip.customerName, trip.productDescription])).toEqual([
        ["Cliente A", "Brita 0"],
        ["Cliente B", "Brita 1"]
      ]);
      expect(abc?.trips[0]?.minutes).toBe(30);
      expect(abc?.trips[0]?.netWeightKg).toBe(15000);

      const xyz = report.trucks.find((t) => t.plate === "XYZ4E56");
      expect(xyz?.avgMinutes).toBe(90);
      expect(xyz?.customers).toEqual([
        { customerName: "Cliente A", totalNetWeightKg: 20000, operations: 1 }
      ]);
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
      const html = renderTruckControlHtml(
        service.getTruckControlReport("2026-06-01", "2026-06-30", "unit-1")
      );

      expect(html).toContain("Controle de caminhoes");
      expect(html).toContain("ABC1D23");
      expect(html).toContain("Brita 0");
      expect(html).toContain("Clientes atendidos");
      expect(html).toContain("Cliente A");
      expect(html).toContain("Cliente B");
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

  it("keeps counting operations after they sync (closed_local -> synced/pending)", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);
      // Depois de fechar, a sincronizacao muda o status. As operacoes continuam concluidas
      // e nao podem desaparecer dos relatorios.
      db.prepare("UPDATE weighing_operations SET status = 'synced' WHERE id = 'op-1'").run();
      db.prepare("UPDATE weighing_operations SET status = 'pending_omie' WHERE id = 'op-2'").run();

      const service = new ReportService(db);
      const report = service.getDailyReport("2026-06-06", "unit-1");

      expect(report.totalOperations).toBe(2);
      expect(report.totalNetWeightKg).toBe(25000);
      expect(report.totalCents).toBe(1_620_000);
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

      // pt-BR: separador ";" e valor com virgula decimal, que e o que o Excel brasileiro
      // abre como numero (com virgula no separador, o valor quebrava em duas colunas).
      expect(csv).toContain(
        "Data;Cliente;Produto;Peso Liquido (kg);Valor Produto (R$);Frete (R$);Total (R$)"
      );
      expect(csv).toContain("06/06/2026;Cliente A;Brita 0;15000;7500,00;1500,00;9000,00");
      expect(csv).toContain("TOTAL;;;25000;13500,00;2700,00;16200,00");
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
      expect(series[0]).toMatchObject({
        date: "2026-06-05",
        totalOperations: 0,
        totalNetWeightKg: 0
      });
      expect(series[1]).toMatchObject({
        date: "2026-06-06",
        totalOperations: 2,
        totalNetWeightKg: 25000
      });
      expect(series[2]).toMatchObject({
        date: "2026-06-07",
        totalOperations: 1,
        totalNetWeightKg: 10000
      });
      expect(series[3]).toMatchObject({
        date: "2026-06-08",
        totalOperations: 0,
        totalNetWeightKg: 0
      });
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

  it("renders the insights report as structured HTML with KPIs and sections", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const html = service.exportInsightsToHtml(
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "Mes atual",
        new Date("2026-07-15T12:00:00Z")
      );

      // Cabecalho + periodo
      expect(html).toContain("Painel de Insights");
      expect(html).toContain("Mes atual");
      // Secoes estruturadas (nao e um print da tela)
      expect(html).toContain("Mix de operacoes");
      expect(html).toContain("Top 5 produtos por peso");
      expect(html).toContain("Evolucao diaria");
      // KPI de faturamento do periodo (junho): 900000 + 720000 + 600000 = 2.220.000 cents
      expect(html).toContain("R$");
      expect(html).toContain("Brita 0");
      // Datas em pt-BR (dd/mm/aaaa)
      expect(html).toContain("07/06/2026");
    } finally {
      db.close();
    }
  });

  it("renders the insights report with empty-state rows when there is no data", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);

      const service = new ReportService(db);
      const html = service.exportInsightsToHtml("2026-06-01", "2026-06-30", "unit-1");

      expect(html).toContain("Painel de Insights");
      expect(html).toContain("Sem produtos no periodo.");
      expect(html).toContain("Sem operacoes fechadas no periodo.");
    } finally {
      db.close();
    }
  });

  it("groups operations by type for the mix", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      db.prepare(
        `
        INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
          net_weight_kg, total_cents, created_at, updated_at
        ) VALUES (
          'op-5', 'comp-1', 'unit-1', 'dev-1', 'closed_local', 'internal', 'cust-1', 'prod-1',
          5000, 250000, datetime('2026-06-06'), datetime('2026-06-06')
        )
      `
      ).run();

      db.prepare(
        `
        INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, cancel_reason, created_at, updated_at
        ) VALUES (
          'op-6', 'comp-1', 'unit-1', 'dev-1', 'cancelled', 'invoice', 'Erro do operador',
          datetime('2026-06-06'), datetime('2026-06-06')
        )
      `
      ).run();

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

describe("getSalesPivot", () => {
  it("groups by customer with average price per ton", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const pivot = service.getSalesPivot("2026-06-01", "2026-06-30", "unit-1", "customer");

      expect(pivot.rows).toHaveLength(2);
      expect(pivot.rows[0]).toMatchObject({
        customerName: "Cliente A",
        totalOperations: 2,
        totalWeightKg: 25000,
        totalValueCents: 1_350_000,
        avgPriceCentsPerTon: 54_000
      });
      expect(pivot.rows[1]).toMatchObject({
        customerName: "Cliente B",
        totalOperations: 1,
        totalWeightKg: 10000,
        avgPriceCentsPerTon: 50_000
      });
      expect(pivot.totals).toMatchObject({
        totalOperations: 3,
        totalWeightKg: 35000,
        totalValueCents: 1_850_000
      });
      expect(pivot.customers.map((option) => option.name)).toEqual(["Cliente A", "Cliente B"]);
      expect(pivot.products.map((option) => option.name)).toEqual(["Brita 0", "Brita 1"]);
    } finally {
      db.close();
    }
  });

  it("applies customer/product filters and other groupings", () => {
    const db = createDatabase();
    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);

      const byProduct = service.getSalesPivot("2026-06-01", "2026-06-30", "unit-1", "product", {
        customerId: "cust-1"
      });
      expect(byProduct.rows).toHaveLength(2);
      expect(byProduct.rows.map((row) => row.productDescription).sort()).toEqual([
        "Brita 0",
        "Brita 1"
      ]);

      const filtered = service.getSalesPivot("2026-06-01", "2026-06-30", "unit-1", "customer", {
        productId: "prod-1"
      });
      expect(filtered.rows).toHaveLength(2);
      expect(filtered.totals.totalWeightKg).toBe(25000);

      const byDay = service.getSalesPivot("2026-06-01", "2026-06-30", "unit-1", "day");
      expect(byDay.rows.map((row) => row.date).sort()).toEqual(["2026-06-06", "2026-06-07"]);

      const byBoth = service.getSalesPivot(
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "customer_product"
      );
      expect(byBoth.rows).toHaveLength(3);
    } finally {
      db.close();
    }
  });
});

describe("ReportService com operacoes excluidas", () => {
  it("tira a operacao excluida de todos os relatorios", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);
      // Operador excluiu a operacao da lista de concluidas: ela nao pode continuar
      // somando no diario, no mensal, no mix nem nos rankings.
      db.prepare(
        "UPDATE weighing_operations SET deleted_at = datetime('now') WHERE id = 'op-1'"
      ).run();

      const service = new ReportService(db);

      const diario = service.getDailyReport("2026-06-06", "unit-1");
      expect(diario.totalOperations).toBe(1);
      expect(diario.totalNetWeightKg).toBe(10000);
      expect(diario.totalCents).toBe(720_000);
      expect(diario.operations.map((operation) => operation.id)).toEqual(["op-2"]);

      const mensal = service.getMonthlyReport(2026, 6, "unit-1");
      expect(mensal.totalOperations).toBe(2);

      const produtos = service.getReportByProduct("2026-06-01", "2026-06-30", "unit-1");
      expect(
        produtos.find((linha) => linha.productDescription === "Brita 0")?.totalOperations
      ).toBe(1);

      const clientes = service.getReportByCustomer("2026-06-01", "2026-06-30", "unit-1");
      expect(clientes.find((linha) => linha.customerName === "Cliente A")?.totalOperations).toBe(1);

      const pivo = service.getSalesPivot("2026-06-01", "2026-06-30", "unit-1", "customer");
      expect(pivo.totals.totalOperations).toBe(2);

      const serie = service.getDailySeries("2026-06-01", "2026-06-30", "unit-1");
      expect(serie.find((ponto) => ponto.date === "2026-06-06")?.totalOperations).toBe(1);
    } finally {
      db.close();
    }
  });

  it("tira a operacao excluida tambem das opcoes de filtro do pivo", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);
      // op-3 e a unica do Cliente B: excluida, o cliente sai da lista de opcoes.
      db.prepare(
        "UPDATE weighing_operations SET deleted_at = datetime('now') WHERE id = 'op-3'"
      ).run();

      const pivo = new ReportService(db).getSalesPivot(
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        "customer"
      );

      expect(pivo.customers.map((cliente) => cliente.name)).toEqual(["Cliente A"]);
    } finally {
      db.close();
    }
  });

  /**
   * O comercial fecha a fatura conferindo quanto deu a tonelada. O valor sai derivado do
   * total da propria carga, entao vale tambem para frete fixo e para preco digitado a mao.
   */
  it("o relatorio do periodo traz o valor por tonelada do material e do frete", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const html = service.exportRangeToHtml("2026-06-01", "2026-06-30", "unit-1");

      expect(html).toContain("<th>Produto R$/t</th>");
      expect(html).toContain("<th>Frete R$/t</th>");
      expect(html).toContain("/t</td>");
      // Cabecalho e rodape precisam ter a mesma largura, senao a planilha inteira desloca.
      // O rodape abre com um `colspan="3"`, entao ele tem duas celulas a menos.
      const headerCells = (html.match(/<thead><tr>([\s\S]*?)<\/tr>/)?.[1].match(/<th/g) ?? [])
        .length;
      const footerCells =
        (html.match(/<tfoot><tr>([\s\S]*?)<\/tr>/)?.[1].match(/<td/g) ?? []).length + 2;
      expect(footerCells).toBe(headerCells);
    } finally {
      db.close();
    }
  });

  /**
   * O "Exportar Excel" do painel. O arquivo existe justamente para somar, filtrar e fazer
   * formula — o que so acontece se peso, valor e data forem numero e data na celula, e nao
   * texto.
   */
  it("a planilha do periodo sai com peso, valor e data tipados para o Excel", () => {
    const db = createDatabase();

    try {
      setupBaseData(db);
      insertOperations(db);

      const service = new ReportService(db);
      const sheet = service.exportRangeToSpreadsheet(
        "2026-06-01",
        "2026-06-30",
        "unit-1",
        new Date("2026-07-01T12:00:00Z")
      );

      // Namespace do Excel: sem ele o `x:num` das celulas nao vale.
      expect(sheet).toContain('xmlns:x="urn:schemas-microsoft-com:office:excel"');
      // Peso como numero, valor em reais como numero e data como data.
      expect(sheet).toContain('x:num="15000">15.000<');
      // O espaco do "R$" vem do Intl (nao quebravel), entao a comparacao aceita qualquer um.
      expect(sheet).toMatch(/x:num="9000">R\$\s9\.000,00</);
      expect(sheet).toContain('x:num="46179">06/06/2026<');
      // O valor sai em pt-BR ("R$ 9.000,00"), e nao no formato interno "R$ 9000.00".
      expect(sheet).not.toContain("R$ 9000.00");
      expect(sheet).toContain("Carregamentos do periodo");
    } finally {
      db.close();
    }
  });
});
