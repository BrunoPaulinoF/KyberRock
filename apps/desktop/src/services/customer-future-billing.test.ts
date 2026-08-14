import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import type { DesktopDatabase } from "../database/sqlite";
import {
  getCustomerFutureBillingInvoices,
  normalizeFutureBillingNfeNumber,
  normalizeFutureBillingTotalWeightKg,
  removeCustomerFutureBillingInvoice,
  resolveCustomerFutureBillingInvoice,
  setCustomerFutureBillingInvoice
} from "./customer-future-billing";

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
    )
    .run();
  database
    .prepare(
      `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
       VALUES ('unit-1', 'company-1', 'Pedreira', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
    )
    .run();
  database
    .prepare(
      `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
       VALUES ('device-1', 'company-1', 'unit-1', 'PC Balanca', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))`
    )
    .run();
  for (const [id, name] of [
    ["customer-1", "Concessionaria"],
    ["customer-2", "Construtora"]
  ]) {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
         VALUES (?, 'company-1', 'local', ?, ?, 1, datetime('now'), datetime('now'))`
      )
      .run(id, name, name);
  }
  for (const [id, code, description] of [
    ["product-rachao", "P1", "Rachao"],
    ["product-brita", "P2", "Brita 1"]
  ]) {
    database
      .prepare(
        `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
         VALUES (?, 'company-1', ?, ?, 'ton', datetime('now'), datetime('now'))`
      )
      .run(id, code, description);
  }
  return database;
}

/** Numero da nota que sairia carimbado numa pesagem daquele par. */
function resolveNfe(
  database: DesktopDatabase,
  customerId: string | null,
  productId: string | null
): string | null {
  return resolveCustomerFutureBillingInvoice(database, customerId, productId)?.nfeNumber ?? null;
}

let operationSequence = 0;

/** Uma carga ja fechada contra a nota, do jeito que o fechamento da pesagem grava. */
function registerWithdrawal(
  database: DesktopDatabase,
  input: {
    customerId: string;
    productId: string | null;
    netWeightKg: number;
    invoiceId?: string | null;
    nfeNumber?: string | null;
    status?: string;
  }
): void {
  operationSequence += 1;
  database
    .prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
         net_weight_kg, future_billing_invoice_id, future_billing_nfe_number, created_at, updated_at
       ) VALUES (?, 'company-1', 'unit-1', 'device-1', ?, 'invoice', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(
      `op-${operationSequence}`,
      input.status ?? "synced",
      input.customerId,
      input.productId,
      input.netWeightKg,
      input.invoiceId ?? null,
      input.nfeNumber ?? null
    );
}

describe("normalizeFutureBillingNfeNumber", () => {
  it("guarda so os digitos e trata vazio como ausencia de nota", () => {
    expect(normalizeFutureBillingNfeNumber("12.345")).toBe("12345");
    expect(normalizeFutureBillingNfeNumber(" 987 ")).toBe("987");
    expect(normalizeFutureBillingNfeNumber("NF 4321")).toBe("4321");
    expect(normalizeFutureBillingNfeNumber("")).toBeNull();
    expect(normalizeFutureBillingNfeNumber("   ")).toBeNull();
    expect(normalizeFutureBillingNfeNumber(null)).toBeNull();
    expect(normalizeFutureBillingNfeNumber(undefined)).toBeNull();
  });

  it("preserva zeros a esquerda (o numero e texto, nao inteiro)", () => {
    expect(normalizeFutureBillingNfeNumber("000045")).toBe("000045");
  });
});

describe("normalizeFutureBillingTotalWeightKg", () => {
  it("aceita o total digitado e trata o campo vazio como nota sem controle de saldo", () => {
    expect(normalizeFutureBillingTotalWeightKg("500000")).toBe(500_000);
    expect(normalizeFutureBillingTotalWeightKg(30_000)).toBe(30_000);
    expect(normalizeFutureBillingTotalWeightKg("30500,5")).toBe(30_500.5);
    expect(normalizeFutureBillingTotalWeightKg("")).toBeNull();
    expect(normalizeFutureBillingTotalWeightKg(null)).toBeNull();
    expect(normalizeFutureBillingTotalWeightKg(undefined)).toBeNull();
  });

  it("zero e negativo viram 'sem controle': nota que faturou nada nao existe", () => {
    expect(normalizeFutureBillingTotalWeightKg("0")).toBeNull();
    expect(normalizeFutureBillingTotalWeightKg(-100)).toBeNull();
    expect(normalizeFutureBillingTotalWeightKg("abc")).toBeNull();
  });
});

describe("notas de venda para entrega futura por produto", () => {
  it("a nota do produto e a que sai na pesagem daquele produto", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-brita",
      nfeNumber: "67890"
    });

    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("12345");
    expect(resolveNfe(database, "customer-1", "product-brita")).toBe("67890");
  });

  it("a nota do produto vence a nota geral do cliente", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, { customerId: "customer-1", nfeNumber: "111" });
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "222"
    });

    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("222");
    // Produto sem nota propria cai na geral do cliente.
    expect(resolveNfe(database, "customer-1", "product-brita")).toBe("111");
  });

  it("nao carimba a pesagem de um produto com a nota de OUTRO produto", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    // Sem nota geral, a brita nao pode herdar a nota do rachao.
    expect(resolveNfe(database, "customer-1", "product-brita")).toBeNull();
    // Pesagem sem produto tambem nao pega a nota de um produto especifico.
    expect(resolveNfe(database, "customer-1", null)).toBeNull();
  });

  it("a nota de um cliente nao vaza para outro", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    expect(resolveNfe(database, "customer-2", "product-rachao")).toBeNull();
    expect(resolveNfe(database, null, "product-rachao")).toBeNull();
  });

  it("cliente sem nota cadastrada nao carimba nada", () => {
    const database = createDatabase();
    expect(resolveNfe(database, "customer-1", "product-rachao")).toBeNull();
  });

  it("recusa numero em branco: uma nota sem numero nao referencia nada", () => {
    const database = createDatabase();
    expect(() =>
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-1",
        productId: "product-rachao",
        nfeNumber: "   "
      })
    ).toThrow(/numero da nota/i);
  });

  it("remover encerra a entrega futura sem apagar a linha (soft delete)", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    removeCustomerFutureBillingInvoice(database, invoice.id);

    expect(resolveNfe(database, "customer-1", "product-rachao")).toBeNull();
    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(0);
    // A linha continua na base com deleted_at, para a remocao atravessar para a outra
    // balanca em vez de a nota reaparecer no proximo pull.
    expect(
      database
        .prepare(
          "SELECT deleted_at FROM customer_future_billing_invoices WHERE id = ? AND deleted_at IS NOT NULL"
        )
        .get(invoice.id)
    ).toBeTruthy();
  });

  it("depois de remover, o mesmo numero pode ser cadastrado de novo", () => {
    const database = createDatabase();
    const first = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });
    removeCustomerFutureBillingInvoice(database, first.id);

    const second = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });

    expect(second.id).not.toBe(first.id);
    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("12345");
  });

  it("lista a nota geral primeiro e traz a descricao do produto para a tela", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "222"
    });
    setCustomerFutureBillingInvoice(database, { customerId: "customer-1", nfeNumber: "111" });

    expect(
      getCustomerFutureBillingInvoices(database, "customer-1").map((invoice) => ({
        productDescription: invoice.productDescription,
        nfeNumber: invoice.nfeNumber
      }))
    ).toEqual([
      { productDescription: null, nfeNumber: "111" },
      { productDescription: "Rachao", nfeNumber: "222" }
    ]);
  });

  it("normaliza o numero na gravacao (o operador digita com ponto)", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12.345"
    });

    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("12345");
  });
});

describe("saldo da nota de entrega futura", () => {
  it("o quadro mostra total, quanto ja foi tirado e o que resta", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345",
      totalWeightKg: 500_000
    });

    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 32_000,
      invoiceId: invoice.id,
      nfeNumber: "12345"
    });
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 28_500,
      invoiceId: invoice.id,
      nfeNumber: "12345"
    });

    const [row] = getCustomerFutureBillingInvoices(database, "customer-1");
    expect(row.totalWeightKg).toBe(500_000);
    expect(row.withdrawnWeightKg).toBe(60_500);
    expect(row.remainingWeightKg).toBe(439_500);
  });

  it("nota recem-cadastrada nasce com o saldo inteiro", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345",
      totalWeightKg: 120_000
    });

    expect(invoice.withdrawnWeightKg).toBe(0);
    expect(invoice.remainingWeightKg).toBe(120_000);
  });

  it("sem total declarado a nota nao controla saldo, mas ainda mostra o que ja saiu", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345"
    });
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 40_000,
      invoiceId: invoice.id,
      nfeNumber: "12345"
    });

    const [row] = getCustomerFutureBillingInvoices(database, "customer-1");
    expect(row.totalWeightKg).toBeNull();
    expect(row.withdrawnWeightKg).toBe(40_000);
    expect(row.remainingWeightKg).toBeNull();
    // E ela nunca esgota: continua carimbando as proximas pesagens.
    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("12345");
  });

  it("carga cancelada nao baixa saldo: aquela carga voltou", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345",
      totalWeightKg: 100_000
    });
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 30_000,
      invoiceId: invoice.id,
      nfeNumber: "12345",
      status: "cancelled"
    });

    const [row] = getCustomerFutureBillingInvoices(database, "customer-1");
    expect(row.withdrawnWeightKg).toBe(0);
    expect(row.remainingWeightKg).toBe(100_000);
  });

  it("pesagem de outra nota do mesmo cliente nao baixa desta", () => {
    const database = createDatabase();
    const rachao = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "111",
      totalWeightKg: 100_000
    });
    const brita = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-brita",
      nfeNumber: "222",
      totalWeightKg: 80_000
    });
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-brita",
      netWeightKg: 25_000,
      invoiceId: brita.id,
      nfeNumber: "222"
    });

    const rows = getCustomerFutureBillingInvoices(database, "customer-1");
    expect(rows.find((row) => row.id === rachao.id)?.withdrawnWeightKg).toBe(0);
    expect(rows.find((row) => row.id === brita.id)?.remainingWeightKg).toBe(55_000);
  });

  it("recupera o que ja saiu nas pesagens anteriores a coluna do vinculo", () => {
    const database = createDatabase();
    // Pesagem fechada por uma versao antiga: congelou o numero, mas nao o id da nota.
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 45_000,
      invoiceId: null,
      nfeNumber: "12345"
    });

    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345",
      totalWeightKg: 100_000
    });

    // Sem isso a nota estrearia no quadro dizendo que nada foi tirado.
    expect(invoice.withdrawnWeightKg).toBe(45_000);
    expect(invoice.remainingWeightKg).toBe(55_000);
  });

  it("a pesagem antiga de OUTRO produto nao entra na nota especifica pelo numero", () => {
    const database = createDatabase();
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-brita",
      netWeightKg: 20_000,
      invoiceId: null,
      nfeNumber: "12345"
    });

    const rachao = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345",
      totalWeightKg: 100_000
    });

    expect(rachao.withdrawnWeightKg).toBe(0);
  });
});

describe("varias notas por produto (a fila de retirada)", () => {
  it("guarda cinco notas do mesmo produto e consome uma de cada vez, da mais antiga", () => {
    const database = createDatabase();
    const notas = ["101", "102", "103", "104", "105"].map((nfeNumber, index) =>
      setCustomerFutureBillingInvoice(
        database,
        {
          customerId: "customer-1",
          productId: "product-rachao",
          nfeNumber,
          totalWeightKg: 30_000
        },
        // Cadastradas em minutos diferentes: e o created_at que define a ordem da fila.
        new Date(Date.UTC(2026, 7, 14, 9, index))
      )
    );

    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(5);
    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("101");

    // A primeira nota esgota; a proxima assume sozinha, sem ninguem trocar nada na tela.
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 30_000,
      invoiceId: notas[0].id,
      nfeNumber: "101"
    });
    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("102");

    // E a esgotada continua no quadro, como historico do que ja foi entregue.
    const rows = getCustomerFutureBillingInvoices(database, "customer-1");
    expect(rows.find((row) => row.nfeNumber === "101")?.remainingWeightKg).toBe(0);
    expect(rows.find((row) => row.nfeNumber === "102")?.remainingWeightKg).toBe(30_000);
  });

  it("nota parcialmente usada continua sendo a da vez", () => {
    const database = createDatabase();
    const primeira = setCustomerFutureBillingInvoice(
      database,
      {
        customerId: "customer-1",
        productId: "product-rachao",
        nfeNumber: "101",
        totalWeightKg: 100_000
      },
      new Date("2026-08-14T09:00:00.000Z")
    );
    setCustomerFutureBillingInvoice(
      database,
      {
        customerId: "customer-1",
        productId: "product-rachao",
        nfeNumber: "102",
        totalWeightKg: 100_000
      },
      new Date("2026-08-14T09:30:00.000Z")
    );
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 99_000,
      invoiceId: primeira.id,
      nfeNumber: "101"
    });

    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("101");
  });

  it("retirada acima do total aparece como saldo negativo e passa a vez", () => {
    const database = createDatabase();
    const primeira = setCustomerFutureBillingInvoice(
      database,
      {
        customerId: "customer-1",
        productId: "product-rachao",
        nfeNumber: "101",
        totalWeightKg: 30_000
      },
      new Date("2026-08-14T09:00:00.000Z")
    );
    setCustomerFutureBillingInvoice(
      database,
      {
        customerId: "customer-1",
        productId: "product-rachao",
        nfeNumber: "102",
        totalWeightKg: 30_000
      },
      new Date("2026-08-14T09:30:00.000Z")
    );
    // O caminhao saiu com mais do que restava: o peso ja foi para a rua, entao o quadro
    // mostra o excedido em vez de esconder atras de um zero.
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 32_000,
      invoiceId: primeira.id,
      nfeNumber: "101"
    });

    const rows = getCustomerFutureBillingInvoices(database, "customer-1");
    expect(rows.find((row) => row.nfeNumber === "101")?.remainingWeightKg).toBe(-2_000);
    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("102");
  });

  it("esgotadas as notas do produto, a geral do cliente assume", () => {
    const database = createDatabase();
    const doProduto = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "222",
      totalWeightKg: 20_000
    });
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      nfeNumber: "111",
      totalWeightKg: 50_000
    });
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 20_000,
      invoiceId: doProduto.id,
      nfeNumber: "222"
    });

    expect(resolveNfe(database, "customer-1", "product-rachao")).toBe("111");
  });

  it("esgotado tudo, a pesagem sai sem referencia — venda normal", () => {
    const database = createDatabase();
    const invoice = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "12345",
      totalWeightKg: 30_000
    });
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      netWeightKg: 30_000,
      invoiceId: invoice.id,
      nfeNumber: "12345"
    });

    expect(
      resolveCustomerFutureBillingInvoice(database, "customer-1", "product-rachao")
    ).toBeNull();
  });

  it("numero novo entra como mais uma nota; o mesmo numero so corrige o total", () => {
    const database = createDatabase();
    const primeira = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "101",
      totalWeightKg: 30_000
    });
    const segunda = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "102",
      totalWeightKg: 40_000
    });
    expect(segunda.id).not.toBe(primeira.id);
    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(2);

    // Operador digitou a quantidade errada e regrava a MESMA nota: corrige o total.
    const corrigida = setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "101",
      totalWeightKg: 35_000
    });
    expect(corrigida.id).toBe(primeira.id);
    expect(corrigida.totalWeightKg).toBe(35_000);
    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(2);
  });

  it("a mesma nota nao entra duas vezes no mesmo par", () => {
    const database = createDatabase();
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "101",
      totalWeightKg: 30_000
    });
    setCustomerFutureBillingInvoice(database, {
      customerId: "customer-1",
      productId: "product-rachao",
      nfeNumber: "101",
      totalWeightKg: 30_000
    });

    expect(getCustomerFutureBillingInvoices(database, "customer-1")).toHaveLength(1);
  });

  it("aceita varias notas gerais do cliente, tambem em fila", () => {
    const database = createDatabase();
    const primeira = setCustomerFutureBillingInvoice(
      database,
      { customerId: "customer-1", nfeNumber: "111", totalWeightKg: 10_000 },
      new Date("2026-08-14T09:00:00.000Z")
    );
    setCustomerFutureBillingInvoice(
      database,
      { customerId: "customer-1", nfeNumber: "112", totalWeightKg: 10_000 },
      new Date("2026-08-14T09:30:00.000Z")
    );

    expect(resolveNfe(database, "customer-1", "product-brita")).toBe("111");
    registerWithdrawal(database, {
      customerId: "customer-1",
      productId: "product-brita",
      netWeightKg: 10_000,
      invoiceId: primeira.id,
      nfeNumber: "111"
    });
    expect(resolveNfe(database, "customer-1", "product-brita")).toBe("112");
  });
});
