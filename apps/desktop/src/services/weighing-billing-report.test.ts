import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { WeighingBillingReportService } from "./weighing-billing-report";
import { resolveSituation } from "./weighing-billing-situation";
import {
  renderWeighingBillingReportHtml,
  renderWeighingBillingReportSpreadsheet,
  weighingBillingReportFileBaseName
} from "./weighing-billing-report-render";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  return db;
}

type Database = ReturnType<typeof createDatabase>;

function setupBaseData(db: Database): void {
  db.prepare(
    `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
     VALUES ('comp-1', 'Empresa', 'Empresa', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
     VALUES ('unit-1', 'comp-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
  ).run();
  // Segunda unidade: nenhuma consulta do relatorio pode atravessar a pedreira.
  db.prepare(
    `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
     VALUES ('unit-2', 'comp-1', 'Outra', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
     VALUES ('dev-1', 'comp-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
     VALUES ('cust-1', 'comp-1', 'Construtora Alfa LTDA', 'Alfa', '11222333000155', 'local', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
     VALUES ('cust-2', 'comp-1', 'Beta Obras', 'Beta', 'local', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
     VALUES ('prod-1', 'comp-1', 'B0', 'Brita 0', 'TON', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
     VALUES ('prod-2', 'comp-1', 'B1', 'Brita 1', 'TON', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
     VALUES ('veh-1', 'comp-1', 'ABC1D23', datetime('now'), datetime('now'))`
  ).run();
}

interface OperationSeed {
  id: string;
  code: number;
  customer: string | null;
  product: string | null;
  net: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  createdAt: string;
  status?: string;
  operationType?: "invoice" | "internal";
  unitId?: string;
  salesOrderId?: number | null;
  serviceOrderId?: number | null;
  billingStatus?: string | null;
  billingMessage?: string | null;
  orderNumber?: string | null;
  deletedAt?: string | null;
}

function insertOperations(db: Database, seeds: OperationSeed[]): void {
  for (const seed of seeds) {
    db.prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, operation_code,
         customer_id, product_id, vehicle_id,
         entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents, price_unit,
         product_total_cents, freight_total_cents, total_cents,
         omie_sales_order_id, omie_service_order_id, omie_order_number,
         omie_billing_status, omie_billing_message,
         entry_weight_captured_at, exit_weight_captured_at,
         deleted_at, created_at, updated_at
       ) VALUES (
         ?, 'comp-1', ?, 'dev-1', ?, ?, ?,
         ?, ?, 'veh-1',
         10000, ?, ?, 50000, 'ton',
         ?, ?, ?,
         ?, ?, ?,
         ?, ?,
         datetime(?), datetime(?),
         ?, datetime(?), datetime(?)
       )`
    ).run(
      seed.id,
      seed.unitId ?? "unit-1",
      seed.status ?? "closed_local",
      seed.operationType ?? "invoice",
      seed.code,
      seed.customer,
      seed.product,
      10000 + seed.net,
      seed.net,
      seed.productCents,
      seed.freightCents,
      seed.totalCents,
      seed.salesOrderId ?? null,
      seed.serviceOrderId ?? null,
      seed.orderNumber ?? null,
      seed.billingStatus ?? null,
      seed.billingMessage ?? null,
      seed.createdAt,
      seed.createdAt,
      seed.deletedAt ?? null,
      seed.createdAt,
      seed.createdAt
    );
  }
}

/**
 * Um periodo com uma pesagem de cada situacao — e o cenario que a conferencia existe para
 * resolver: metade faturada, metade parada por um motivo diferente.
 */
function seedPeriod(db: Database): void {
  insertOperations(db, [
    {
      id: "op-billed",
      code: 101,
      customer: "cust-1",
      product: "prod-1",
      net: 15000,
      productCents: 750000,
      freightCents: 150000,
      totalCents: 900000,
      createdAt: "2026-06-02 08:00:00",
      salesOrderId: 5001,
      billingStatus: "billed"
    },
    {
      id: "op-sent",
      code: 102,
      customer: "cust-2",
      product: "prod-2",
      net: 20000,
      productCents: 1000000,
      freightCents: 0,
      totalCents: 1000000,
      createdAt: "2026-06-03 09:00:00",
      salesOrderId: 5002
    },
    {
      id: "op-pending",
      code: 103,
      customer: "cust-1",
      product: "prod-1",
      net: 10000,
      productCents: 500000,
      freightCents: 50000,
      totalCents: 550000,
      createdAt: "2026-06-04 10:00:00"
    },
    {
      id: "op-failed",
      code: 104,
      customer: "cust-2",
      product: "prod-1",
      net: 12000,
      productCents: 600000,
      freightCents: 0,
      totalCents: 600000,
      createdAt: "2026-06-05 11:00:00",
      billingStatus: "failed",
      billingMessage: "OMIE recusou: CFOP invalido"
    },
    {
      id: "op-internal",
      code: 105,
      customer: "cust-1",
      product: "prod-2",
      net: 8000,
      productCents: 400000,
      freightCents: 0,
      totalCents: 400000,
      createdAt: "2026-06-06 12:00:00",
      operationType: "internal",
      serviceOrderId: 7001
    }
  ]);
}

function service(db: Database): WeighingBillingReportService {
  return new WeighingBillingReportService(db);
}

describe("WeighingBillingReportService", () => {
  it("traz uma linha por pesagem com cliente, data, produto, peso, frete e total", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.rows).toHaveLength(5);
    expect(report.rows[0]).toMatchObject({
      operationCode: 101,
      date: "2026-06-02",
      customerName: "Alfa",
      productDescription: "Brita 0",
      productCode: "B0",
      plate: "ABC1D23",
      netWeightKg: 15000,
      freightTotalCents: 150000,
      totalCents: 900000,
      situation: "billed"
    });
    // Ordem cronologica: a conferencia e lida de cima para baixo junto do extrato do OMIE.
    expect(report.rows.map((row) => row.operationCode)).toEqual([101, 102, 103, 104, 105]);
  });

  it("soma os totais do periodo e destaca o que nao foi faturado", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.totals).toEqual({
      operations: 5,
      netWeightKg: 65000,
      productCents: 3250000,
      freightCents: 200000,
      totalCents: 3450000
    });
    // Faturada e so a `op-billed`: tudo o mais ainda e dinheiro a faturar.
    expect(report.unbilled.operations).toBe(4);
    expect(report.unbilled.totalCents).toBe(3450000 - 900000);
    expect(report.unbilled.netWeightKg).toBe(65000 - 15000);
  });

  it("resume por situacao com o problema no topo", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.bySituation.map((row) => row.situation)).toEqual([
      "failed",
      "pending",
      "sent",
      "billed"
    ]);
    // "sent" junta o pedido de venda (op-sent) e a ordem de servico da interna (op-internal).
    const sent = report.bySituation.find((row) => row.situation === "sent");
    expect(sent).toMatchObject({ operations: 2, totalCents: 1400000, netWeightKg: 28000 });
  });

  it("guarda a recusa do OMIE como detalhe da linha", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");
    const failed = report.rows.find((row) => row.operationId === "op-failed");

    expect(failed?.situationDetail).toBe("OMIE recusou: CFOP invalido");
    // Sem mensagem gravada, sobra o numero pelo qual a pesagem e procurada no OMIE.
    expect(report.rows.find((row) => row.operationId === "op-sent")?.situationDetail).toBe(
      "Pedido OMIE 5002"
    );
    expect(report.rows.find((row) => row.operationId === "op-pending")?.situationDetail).toBeNull();
  });

  it("ignora canceladas, excluidas, em andamento e de outra unidade", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);
    insertOperations(db, [
      {
        id: "op-cancelled",
        code: 201,
        customer: "cust-1",
        product: "prod-1",
        net: 9000,
        productCents: 1,
        freightCents: 0,
        totalCents: 1,
        createdAt: "2026-06-07 08:00:00",
        status: "cancelled"
      },
      {
        id: "op-open",
        code: 202,
        customer: "cust-1",
        product: "prod-1",
        net: 9000,
        productCents: 1,
        freightCents: 0,
        totalCents: 1,
        createdAt: "2026-06-07 09:00:00",
        status: "awaiting_exit"
      },
      {
        id: "op-deleted",
        code: 203,
        customer: "cust-1",
        product: "prod-1",
        net: 9000,
        productCents: 1,
        freightCents: 0,
        totalCents: 1,
        createdAt: "2026-06-07 10:00:00",
        deletedAt: "2026-06-08 10:00:00"
      },
      {
        id: "op-other-unit",
        code: 204,
        customer: "cust-1",
        product: "prod-1",
        net: 9000,
        productCents: 1,
        freightCents: 0,
        totalCents: 1,
        createdAt: "2026-06-07 11:00:00",
        unitId: "unit-2"
      }
    ]);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.rows).toHaveLength(5);
    expect(report.totals.totalCents).toBe(3450000);
  });

  it("respeita o intervalo de datas pelas bordas", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);

    const report = service(db).getReport("2026-06-03", "2026-06-05", "unit-1");

    expect(report.rows.map((row) => row.operationCode)).toEqual([102, 103, 104]);
  });

  it("filtra por cliente, por situacao e pela busca livre", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);
    const reports = service(db);

    expect(
      reports
        .getReport("2026-06-01", "2026-06-30", "unit-1", { customerId: "cust-1" })
        .rows.map((row) => row.operationCode)
    ).toEqual([101, 103, 105]);

    expect(
      reports
        .getReport("2026-06-01", "2026-06-30", "unit-1", { situations: ["failed", "pending"] })
        .rows.map((row) => row.operationCode)
    ).toEqual([103, 104]);

    // Busca livre cobre cliente, produto, placa e o numero da operacao / do pedido OMIE.
    expect(
      reports
        .getReport("2026-06-01", "2026-06-30", "unit-1", { search: "brita 1" })
        .rows.map((row) => row.operationCode)
    ).toEqual([102, 105]);
    expect(
      reports
        .getReport("2026-06-01", "2026-06-30", "unit-1", { search: "5002" })
        .rows.map((row) => row.operationCode)
    ).toEqual([102]);
  });

  it("recalcula os totais sobre as linhas filtradas", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1", {
      situations: ["failed"]
    });

    expect(report.totals.operations).toBe(1);
    expect(report.totals.totalCents).toBe(600000);
    // Nada faturado sobrou no filtro: o "sem faturar" tem de acompanhar.
    expect(report.unbilled.totalCents).toBe(600000);
    expect(report.filters).toEqual({ customerId: null, situations: ["failed"], search: null });
  });

  it("lista sem quebrar quando faltam cliente e produto", () => {
    const db = createDatabase();
    setupBaseData(db);
    insertOperations(db, [
      {
        id: "op-orfa",
        code: 301,
        customer: null,
        product: null,
        net: 5000,
        productCents: 100000,
        freightCents: 0,
        totalCents: 100000,
        createdAt: "2026-06-02 08:00:00"
      }
    ]);

    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.rows[0]).toMatchObject({
      customerName: "Sem cliente",
      productDescription: "N/A",
      situation: "pending"
    });
  });
});

describe("resolveSituation", () => {
  it("le a venda com nota pelo pedido e pelo status de faturamento", () => {
    const base = { operation_type: "invoice" as const, omie_service_order_id: null };
    expect(
      resolveSituation({ ...base, omie_sales_order_id: 1, omie_billing_status: "billed" })
    ).toBe("billed");
    expect(resolveSituation({ ...base, omie_sales_order_id: 1, omie_billing_status: null })).toBe(
      "sent"
    );
    expect(
      resolveSituation({
        ...base,
        omie_sales_order_id: null,
        omie_billing_status: "cadastro_incompleto"
      })
    ).toBe("cadastro_incompleto");
    expect(
      resolveSituation({ ...base, omie_sales_order_id: null, omie_billing_status: "failed" })
    ).toBe("failed");
    expect(
      resolveSituation({ ...base, omie_sales_order_id: null, omie_billing_status: null })
    ).toBe("pending");
  });

  it("le a venda interna pela ordem de servico", () => {
    const base = { operation_type: "internal" as const, omie_sales_order_id: null };
    expect(resolveSituation({ ...base, omie_service_order_id: 9, omie_billing_status: null })).toBe(
      "sent"
    );
    expect(
      resolveSituation({
        ...base,
        omie_service_order_id: null,
        omie_billing_status: "service_order_failed"
      })
    ).toBe("failed");
    expect(
      resolveSituation({ ...base, omie_service_order_id: null, omie_billing_status: null })
    ).toBe("pending");
  });

  it("le a interna ja faturada no OMIE como faturada", () => {
    // A OS tambem e faturada dentro do OMIE (NFS-e), e a reconciliacao com o OMIE marca
    // 'billed' nela como marca no pedido de venda. Antes a interna ficava presa em "No
    // OMIE, falta faturar" mesmo depois da nota de servico sair.
    expect(
      resolveSituation({
        operation_type: "internal",
        omie_sales_order_id: null,
        omie_service_order_id: 9,
        omie_billing_status: "billed"
      })
    ).toBe("billed");
  });
});

describe("documentos da conferencia", () => {
  it("gera o PDF com a lista pesagem a pesagem e os totais", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);
    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1", {
      periodLabel: "Mes atual"
    });

    const html = renderWeighingBillingReportHtml(report, new Date("2026-07-01T12:00:00Z"));

    expect(html).toContain("Conferencia de faturamento");
    expect(html).toContain("Todos os clientes");
    expect(html).toContain("Pesagem a pesagem");
    expect(html).toContain("01/06/2026 a 30/06/2026");
    expect(html).toContain("Alfa");
    expect(html).toContain("Brita 0");
    expect(html).toContain("landscape");
    // Total do periodo. O Intl separa "R$" do numero com espaco nao-quebravel (U+00A0 ou
    // U+202F, conforme a versao do ICU): normalizar antes evita um teste que quebra sozinho
    // quando o Node troca de ICU.
    expect(html.replace(/[\u00a0\u202f]/g, " ")).toContain("R$ 34.500,00");
  });

  it("gera a planilha com as mesmas linhas", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);
    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    const sheet = renderWeighingBillingReportSpreadsheet(report, new Date("2026-07-01T12:00:00Z"));

    expect(sheet).toContain("Situacao do faturamento");
    expect(sheet).toContain("Pesagem a pesagem");
    expect(sheet).toContain("Pedido 5002");
    expect(sheet).toContain("OS 7001");
  });

  // O codigo grande da coluna e o da INTEGRACAO (nCodPed/nCodOS); digitar ele na busca do
  // OMIE nao acha nada. Quando a reconciliacao ja descobriu o numero visivel, ele entra ao
  // lado — e e por ele que se procura o documento la.
  it("mostra o numero visivel do pedido ao lado do codigo da integracao", () => {
    const db = createDatabase();
    setupBaseData(db);
    insertOperations(db, [
      {
        id: "op-numero",
        code: 201,
        customer: "cust-1",
        product: "prod-1",
        net: 15000,
        productCents: 750000,
        freightCents: 0,
        totalCents: 750000,
        createdAt: "2026-06-02 08:00:00",
        salesOrderId: 11489137846,
        orderNumber: "1234"
      }
    ]);
    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.rows[0].omieOrderNumber).toBe("1234");
    expect(
      renderWeighingBillingReportSpreadsheet(report, new Date("2026-07-01T12:00:00Z"))
    ).toContain("Pedido 11489137846 (nº 1234)");
    // E a busca livre tambem aceita esse numero: quem chega aqui vindo da tela do OMIE
    // tem ele na mao, nao o codigo da integracao.
    expect(
      service(db).getReport("2026-06-01", "2026-06-30", "unit-1", { search: "1234" }).rows
    ).toHaveLength(1);
  });

  it("nomeia o arquivo pelo escopo e pelo periodo", () => {
    const db = createDatabase();
    setupBaseData(db);
    seedPeriod(db);
    const reports = service(db);

    expect(
      weighingBillingReportFileBaseName(reports.getReport("2026-06-01", "2026-06-30", "unit-1"))
    ).toBe("conferencia-faturamento-geral-2026-06-01-a-2026-06-30");
    expect(
      weighingBillingReportFileBaseName(
        reports.getReport("2026-06-01", "2026-06-30", "unit-1", { customerId: "cust-1" })
      )
    ).toBe("conferencia-faturamento-alfa-2026-06-01-a-2026-06-30");
  });

  it("nao quebra num periodo sem pesagem", () => {
    const db = createDatabase();
    setupBaseData(db);
    const report = service(db).getReport("2026-06-01", "2026-06-30", "unit-1");

    expect(report.rows).toHaveLength(0);
    expect(report.totals.operations).toBe(0);
    expect(renderWeighingBillingReportHtml(report)).toContain("Sem pesagens no periodo.");
    expect(renderWeighingBillingReportSpreadsheet(report)).toContain("Sem dados no periodo.");
  });
});
