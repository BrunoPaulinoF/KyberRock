import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  ensureDefaultPaymentMethods,
  listPaymentMethods,
  WALLET_METHOD_CODE
} from "./payment-methods.js";
import { getWalletReport, reopenWalletOperations, settleWalletOperations } from "./wallet.js";

const COMPANY_ID = "comp-1";

interface OperationSeed {
  id: string;
  customer: string;
  paymentMethodId: string | null;
  totalCents: number;
  soldAt: string;
  status?: string;
  /** Quanto da venda saiu do adiantamento do cliente no fechamento da balanca. */
  advanceAppliedCents?: number;
  /** Venda ja quitada pelo adiantamento (fechada sem forma de recebimento). */
  settledByAdvanceAt?: string;
}

function seedBaseData(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES (?, 'Pedreira LTDA', 'Pedreira', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  database
    .prepare(
      `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
       VALUES ('unit-1', ?, 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  database
    .prepare(
      `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
       VALUES ('dev-1', ?, 'unit-1', 'Balanca', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  database
    .prepare(
      `INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
       VALUES ('cust-1', ?, 'Construtora Alfa', 'Alfa', 'local', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  database
    .prepare(
      `INSERT INTO customers (id, company_id, legal_name, trade_name, source, created_at, updated_at)
       VALUES ('cust-2', ?, 'Beta Obras', 'Beta', 'local', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
       VALUES ('prod-1', ?, 'B0', 'Brita 0', 'TON', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
       VALUES ('veh-1', ?, 'ABC1D23', datetime('now'), datetime('now'))`
    )
    .run(COMPANY_ID);
  ensureDefaultPaymentMethods(database, COMPANY_ID);
}

function insertOperations(database: DesktopDatabase, seeds: OperationSeed[]): void {
  const insert = database.prepare(
    `INSERT INTO weighing_operations (
       id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
       vehicle_id, payment_method_id, entry_weight_kg, exit_weight_kg, net_weight_kg,
       unit_price_cents, product_total_cents, freight_total_cents, total_cents,
       omie_advance_settle_cents, wallet_settled_at,
       entry_weight_captured_at, exit_weight_captured_at, created_at, updated_at
     ) VALUES (?, ?, 'unit-1', 'dev-1', ?, 'invoice', ?, 'prod-1', 'veh-1', ?,
               10000, 40000, 30000, 5000, ?, 0, ?, ?, ?, datetime(?), datetime(?), datetime(?), datetime(?))`
  );
  for (const seed of seeds) {
    insert.run(
      seed.id,
      COMPANY_ID,
      seed.status ?? "closed_local",
      seed.customer,
      seed.paymentMethodId,
      seed.totalCents,
      seed.totalCents,
      seed.advanceAppliedCents ?? 0,
      seed.settledByAdvanceAt ?? null,
      seed.soldAt,
      seed.soldAt,
      seed.soldAt,
      seed.soldAt
    );
  }
}

function methodId(database: DesktopDatabase, code: string): string {
  const method = listPaymentMethods(database, COMPANY_ID).find((row) => row.code === code);
  if (!method) throw new Error(`Forma ${code} nao encontrada no seed.`);
  return method.id;
}

describe("wallet service", () => {
  let database: DesktopDatabase;
  let walletMethodId: string;
  let pixMethodId: string;

  beforeEach(() => {
    database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    seedBaseData(database);
    walletMethodId = methodId(database, WALLET_METHOD_CODE);
    pixMethodId = methodId(database, "pix");
  });

  afterEach(() => {
    database.close();
  });

  it("seeds the wallet method flagged and carrying the OMIE 'outros' code", () => {
    const wallet = listPaymentMethods(database, COMPANY_ID).find(
      (method) => method.code === WALLET_METHOD_CODE
    );
    expect(wallet?.is_wallet).toBe(1);
    expect(wallet?.is_customer_credit).toBe(0);
    expect(wallet?.name).toBe("Em carteira");
    // "99 - outros" faz o pedido sair sem boleto: a cobranca so nasce no fechamento.
    expect(wallet?.omie_code).toBe("99");
  });

  it("lists only wallet sales, grouped by customer and totalled", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      },
      {
        id: "op-2",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-12"
      },
      {
        id: "op-3",
        customer: "cust-2",
        paymentMethodId: walletMethodId,
        totalCents: 15000,
        soldAt: "2026-07-13"
      },
      // Venda em PIX: ja recebida, nao entra na carteira.
      {
        id: "op-4",
        customer: "cust-1",
        paymentMethodId: pixMethodId,
        totalCents: 90000,
        soldAt: "2026-07-14"
      },
      // Sem forma de pagamento escolhida: idem.
      {
        id: "op-5",
        customer: "cust-1",
        paymentMethodId: null,
        totalCents: 80000,
        soldAt: "2026-07-15"
      }
    ]);

    const report = getWalletReport(database);

    expect(report.summary.openCount).toBe(3);
    expect(report.summary.openTotalCents).toBe(65000);
    expect(report.groups).toHaveLength(2);
    expect(report.groups[0].customerName).toBe("Alfa");
    expect(report.groups[0].totalCents).toBe(50000);
    // Mais recente primeiro dentro do grupo.
    expect(report.groups[0].operations.map((op) => op.operationId)).toEqual(["op-2", "op-1"]);
    expect(report.groups[1].customerName).toBe("Beta");
  });

  it("leaves cancelled wallet sales out of the wallet", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10",
        status: "cancelled"
      }
    ]);

    expect(getWalletReport(database).summary.openCount).toBe(0);
  });

  it("settles the chosen sales with the receiving method and due date", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      },
      {
        id: "op-2",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-12"
      }
    ]);

    const settled = settleWalletOperations(
      database,
      {
        operationIds: ["op-1", "op-2"],
        settlementMethodId: pixMethodId,
        dueDate: "2026-08-05",
        note: "combinado com o financeiro"
      },
      new Date("2026-07-31T12:00:00.000Z")
    );

    expect(settled).toBe(2);
    expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(0);

    const closed = getWalletReport(database, { status: "settled" });
    expect(closed.summary.settledCount).toBe(2);
    expect(closed.summary.settledTotalCents).toBe(50000);
    const operation = closed.groups[0].operations[0];
    expect(operation.settlementMethodName).toBe("Pix");
    expect(operation.settlementDueDate).toBe("2026-08-05");
    expect(operation.settledAt).toBe("2026-07-31T12:00:00.000Z");
    expect(operation.settlementNote).toBe("combinado com o financeiro");
  });

  it("refuses to settle the wallet with another wallet method", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      }
    ]);

    expect(() =>
      settleWalletOperations(database, {
        operationIds: ["op-1"],
        settlementMethodId: walletMethodId
      })
    ).toThrow(/em carteira/i);
    expect(getWalletReport(database).summary.openCount).toBe(1);
  });

  it("refuses to settle a sale that was not sold on the wallet", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      },
      {
        id: "op-2",
        customer: "cust-1",
        paymentMethodId: pixMethodId,
        totalCents: 20000,
        soldAt: "2026-07-11"
      }
    ]);

    expect(() =>
      settleWalletOperations(database, {
        operationIds: ["op-1", "op-2"],
        settlementMethodId: pixMethodId
      })
    ).toThrow(/nao foi vendida em carteira/i);
    // Transacao: o fechamento parcial de op-1 tambem e desfeito.
    expect(getWalletReport(database).summary.openCount).toBe(1);
  });

  it("rejects an invalid due date and an empty selection", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      }
    ]);

    expect(() =>
      settleWalletOperations(database, {
        operationIds: ["op-1"],
        settlementMethodId: pixMethodId,
        dueDate: "05/08/2026"
      })
    ).toThrow(/AAAA-MM-DD/);
    expect(() =>
      settleWalletOperations(database, { operationIds: [], settlementMethodId: pixMethodId })
    ).toThrow(/ao menos uma venda/i);
  });

  it("reopens a settlement and puts the sale back in the wallet", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      }
    ]);
    settleWalletOperations(database, {
      operationIds: ["op-1"],
      settlementMethodId: pixMethodId,
      dueDate: "2026-08-05"
    });

    expect(reopenWalletOperations(database, ["op-1"])).toBe(1);

    const open = getWalletReport(database, { status: "open" });
    expect(open.summary.openCount).toBe(1);
    expect(open.groups[0].operations[0].settlementMethodName).toBeNull();
    expect(open.groups[0].operations[0].settlementDueDate).toBeNull();
    // Reabrir de novo nao muda nada (ja esta em aberto).
    expect(reopenWalletOperations(database, ["op-1"])).toBe(0);
  });

  it("filters by customer, period and free search", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      },
      {
        id: "op-2",
        customer: "cust-2",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-20"
      }
    ]);

    expect(getWalletReport(database, { customerId: "cust-2" }).summary.openCount).toBe(1);
    expect(
      getWalletReport(database, { startDate: "2026-07-15", endDate: "2026-07-31" }).summary
        .openCount
    ).toBe(1);
    expect(getWalletReport(database, { search: "alfa" }).groups[0].customerName).toBe("Alfa");
    expect(getWalletReport(database, { search: "ABC1D23" }).summary.openCount).toBe(2);
    expect(getWalletReport(database, { search: "inexistente" }).groups).toHaveLength(0);
  });

  it("shows both open and settled sales when asked for all", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        soldAt: "2026-07-10"
      },
      {
        id: "op-2",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-12"
      }
    ]);
    settleWalletOperations(database, { operationIds: ["op-1"], settlementMethodId: pixMethodId });

    const all = getWalletReport(database, { status: "all" });
    expect(all.summary.openCount).toBe(1);
    expect(all.summary.settledCount).toBe(1);
    expect(all.groups[0].operations).toHaveLength(2);
  });

  it("desconta do 'a receber' o que o adiantamento do cliente ja cobriu", () => {
    insertOperations(database, [
      // 300,00 de venda com 120,00 vindos do adiantamento: sobram 180,00 a receber.
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        advanceAppliedCents: 12000,
        soldAt: "2026-07-10"
      },
      {
        id: "op-2",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-12"
      }
    ]);

    const report = getWalletReport(database, { status: "open" });
    expect(report.summary).toMatchObject({
      openCount: 2,
      openTotalCents: 38000,
      advanceAppliedTotalCents: 12000
    });
    expect(report.groups[0]).toMatchObject({ totalCents: 50000, openTotalCents: 38000 });
    const abatida = report.groups[0].operations.find((op) => op.operationId === "op-1");
    expect(abatida).toMatchObject({
      totalCents: 30000,
      advanceAppliedCents: 12000,
      openAmountCents: 18000,
      settledByAdvance: false
    });
  });

  it("marca como fechada pelo adiantamento a venda que ele cobriu inteira", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        advanceAppliedCents: 30000,
        settledByAdvanceAt: "2026-07-10T12:00:00.000Z",
        soldAt: "2026-07-10"
      }
    ]);

    // Nao aparece mais como pendencia: o cliente ja tinha pago.
    expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(0);
    const settled = getWalletReport(database, { status: "settled" });
    expect(settled.summary).toMatchObject({ settledCount: 1, settledTotalCents: 30000 });
    expect(settled.groups[0].operations[0]).toMatchObject({
      settledByAdvance: true,
      settlementMethodName: null,
      openAmountCents: 0
    });
  });

  it("recusa reabrir a venda quitada pelo adiantamento", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        advanceAppliedCents: 30000,
        settledByAdvanceAt: "2026-07-10T12:00:00.000Z",
        soldAt: "2026-07-10"
      }
    ]);

    expect(() => reopenWalletOperations(database, ["op-1"])).toThrow(/adiantamento/i);
    expect(getWalletReport(database, { status: "settled" }).summary.settledCount).toBe(1);
  });

  it("reabre normalmente o fechamento manual do que passou do adiantamento", () => {
    insertOperations(database, [
      {
        id: "op-1",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 30000,
        advanceAppliedCents: 12000,
        soldAt: "2026-07-10"
      }
    ]);
    settleWalletOperations(database, { operationIds: ["op-1"], settlementMethodId: pixMethodId });

    expect(reopenWalletOperations(database, ["op-1"])).toBe(1);
    // O abatimento continua valendo: volta a receber so o que passou do adiantamento.
    expect(getWalletReport(database, { status: "open" }).summary.openTotalCents).toBe(18000);
  });

  it("junta num bloco so o cliente que esta cadastrado duas vezes", () => {
    // O caso real: o cadastro que veio do OMIE e o que nasceu na balanca, mesmo CNPJ. Cada
    // um virava um bloco na tela, com metade das vendas e metade do total a receber.
    database
      .prepare(
        `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
         VALUES ('omie_1', ?, 'Levisa', 'Levisa', '06020284000164', 'omie', datetime('now'), datetime('now'))`
      )
      .run(COMPANY_ID);
    database
      .prepare(
        `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
         VALUES ('local_1', ?, 'Levisa', 'Levisa', '06020284000164', 'local', datetime('now'), datetime('now'))`
      )
      .run(COMPANY_ID);
    insertOperations(database, [
      {
        id: "op-1",
        customer: "omie_1",
        paymentMethodId: walletMethodId,
        totalCents: 10000,
        soldAt: "2026-07-17"
      },
      {
        id: "op-2",
        customer: "local_1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-20"
      }
    ]);

    const report = getWalletReport(database, { status: "open" });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].operations.map((op) => op.operationId).sort()).toEqual([
      "op-1",
      "op-2"
    ]);
    expect(report.groups[0].totalCents).toBe(30000);
  });

  it("filtrar por um dos cadastros duplicados traz as vendas dos dois", () => {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
         VALUES ('omie_1', ?, 'Levisa', 'Levisa', '06020284000164', 'omie', datetime('now'), datetime('now'))`
      )
      .run(COMPANY_ID);
    database
      .prepare(
        `INSERT INTO customers (id, company_id, legal_name, trade_name, document, source, created_at, updated_at)
         VALUES ('local_1', ?, 'Levisa', 'Levisa', '06020284000164', 'local', datetime('now'), datetime('now'))`
      )
      .run(COMPANY_ID);
    insertOperations(database, [
      {
        id: "op-1",
        customer: "omie_1",
        paymentMethodId: walletMethodId,
        totalCents: 10000,
        soldAt: "2026-07-17"
      },
      {
        id: "op-2",
        customer: "local_1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-07-20"
      },
      {
        id: "op-outro",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 5000,
        soldAt: "2026-07-18"
      }
    ]);

    for (const chosen of ["omie_1", "local_1"]) {
      const report = getWalletReport(database, { status: "open", customerId: chosen });
      expect(report.groups).toHaveLength(1);
      expect(report.summary.openTotalCents).toBe(30000);
    }
  });

  it("o recorte por periodo usa a data da OPERACAO, a mesma do Fechamento de faturas", () => {
    insertOperations(database, [
      {
        id: "op-dentro",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 10000,
        soldAt: "2026-07-20"
      },
      {
        id: "op-fora",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 20000,
        soldAt: "2026-08-02"
      }
    ]);
    // Caminhao que entra dia 31 e sai dia 1: o fechamento conta pela ENTRADA, e a carteira
    // precisa concordar, senao a mesma quinzena da duas listas diferentes.
    database
      .prepare(
        "UPDATE weighing_operations SET exit_weight_captured_at = '2026-08-01T02:00:00.000Z' WHERE id = 'op-dentro'"
      )
      .run();

    const report = getWalletReport(database, {
      status: "open",
      startDate: "2026-07-16",
      endDate: "2026-07-31"
    });
    expect(report.groups.flatMap((group) => group.operations.map((op) => op.operationId))).toEqual([
      "op-dentro"
    ]);
    // A tela mostra as duas datas: a da operacao (que o filtro usa) e a da saida.
    expect(report.groups[0].operations[0].operationDate).toBe("2026-07-20");
    expect(report.groups[0].operations[0].soldAt).toContain("2026-08-01");
  });

  it("sem periodo, a venda antiga em aberto continua na tela", () => {
    insertOperations(database, [
      {
        id: "op-antiga",
        customer: "cust-1",
        paymentMethodId: walletMethodId,
        totalCents: 10000,
        soldAt: "2025-01-05"
      }
    ]);

    // A carteira responde "o que ainda esta para receber": recortar por padrao esconderia
    // justamente a venda mais atrasada.
    expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(1);
  });
});
