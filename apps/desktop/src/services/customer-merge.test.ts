/**
 * A unificacao de cadastros duplicados.
 *
 * O caso real: "MORAES - AREIA E PEDRA LTDA" com duas linhas na tela — uma marcada LOCAL
 * (criada na balanca do comercial, depois enviada ao OMIE) e outra OMIE (a mesma empresa
 * voltando do ERP como linha nova, porque a maquina que fala com o OMIE ainda nao tinha
 * recebido o cadastro da outra). Mesmo CNPJ, mesmo telefone, mesmo e-mail, mesmo codigo OMIE.
 */

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { mergeCustomerInto, mergeDuplicateCustomersByDocument } from "./customer-merge";

describe("unificacao de cadastros de cliente", () => {
  it("leva as pesagens da perdedora para a sobrevivente", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, { id: "loser", document: "61.241.889/0001-93" });
      insertOperation(database, { id: "op-1", customerId: keeper });
      insertOperation(database, { id: "op-2", customerId: loser });
      insertOperation(database, { id: "op-3", customerId: loser });

      const result = mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      expect(result.counts.operations).toBe(2);
      expect(operationOwners(database, keeper)).toEqual(["op-1", "op-2", "op-3"]);
    } finally {
      database.close();
    }
  });

  it("deixa a perdedora como tombstone pronto para subir", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, { id: "loser", document: "61241889000193" });

      mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      const row = database
        .prepare("SELECT deleted_at, is_active, needs_push FROM customers WHERE id = ?")
        .get(loser) as { deleted_at: string | null; is_active: number; needs_push: number };
      expect(row.deleted_at).not.toBeNull();
      expect(row.is_active).toBe(0);
      /*
       * `needs_push = 1` e o que impede o pull da nuvem de ressuscitar a perdedora enquanto a
       * exclusao nao chegou la — era exatamente assim que a limpeza anterior (migracao 39, com
       * `needs_push = 0`) se desfazia sozinha no ciclo seguinte.
       */
      expect(row.needs_push).toBe(1);
    } finally {
      database.close();
    }
  });

  it("a sobrevivente herda o codigo OMIE que so a perdedora tinha", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, {
        id: "loser",
        document: "61241889000193",
        omieCustomerId: 11489145762,
        omieIntegrationCode: "KRR7SUMV5GYZX7"
      });

      mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      const row = database
        .prepare("SELECT omie_customer_id, omie_integration_code FROM customers WHERE id = ?")
        .get(keeper) as { omie_customer_id: number | null; omie_integration_code: string | null };
      // Sem o codigo, o proximo pedido tentaria IncluirCliente de quem ja existe no OMIE.
      expect(row.omie_customer_id).toBe(11489145762);
      expect(row.omie_integration_code).toBe("KRR7SUMV5GYZX7");
    } finally {
      database.close();
    }
  });

  it("nao marca a sobrevivente para envio ao OMIE", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, {
        id: "loser",
        document: "61241889000193",
        omieCustomerId: 42
      });

      mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      const row = database.prepare("SELECT needs_push FROM customers WHERE id = ?").get(keeper) as {
        needs_push: number;
      };
      // Limpar cadastro duplicado aqui nao pode virar escrita no ERP.
      expect(row.needs_push).toBe(0);
    } finally {
      database.close();
    }
  });

  it("recusa unificar cadastros com documentos diferentes", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, { id: "loser", document: "29067113049870" });

      expect(() => mergeCustomerInto(database, { keeperId: keeper, loserId: loser })).toThrow(
        "CNPJ/CPF diferentes"
      );
      // Nada pode ter sido tocado: a recusa e antes da transacao.
      const row = database.prepare("SELECT deleted_at FROM customers WHERE id = ?").get(loser) as {
        deleted_at: string | null;
      };
      expect(row.deleted_at).toBeNull();
    } finally {
      database.close();
    }
  });

  it("aceita unificar quando so um dos lados tem documento", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      // O "cadastro da correria", aberto so com o nome para nao segurar o caminhao.
      const loser = insertCustomer(database, { id: "loser", document: null });

      expect(() => mergeCustomerInto(database, { keeperId: keeper, loserId: loser })).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("descarta o vinculo que a sobrevivente ja tem e reponta o que falta", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, { id: "loser", document: "61241889000193" });
      insertSpecialPrice(database, { id: "sp-keeper", customerId: keeper, productId: "prod-1" });
      insertSpecialPrice(database, { id: "sp-loser-dup", customerId: loser, productId: "prod-1" });
      insertSpecialPrice(database, { id: "sp-loser-new", customerId: loser, productId: "prod-2" });

      const result = mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      expect(result.counts.discardedLinks).toBe(1);
      expect(result.counts.links).toBe(1);
      expect(specialPriceOwner(database, "sp-loser-new")).toBe(keeper);
      expect(isLinkDeleted(database, "customer_special_prices", "sp-loser-dup")).toBe(true);
    } finally {
      database.close();
    }
  });

  it("nao deixa dois precos vivos para o mesmo produto (o indice unico recusaria)", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, { id: "loser", document: "61241889000193" });
      insertSpecialPrice(database, { id: "sp-keeper", customerId: keeper, productId: "prod-1" });
      insertSpecialPrice(database, { id: "sp-loser", customerId: loser, productId: "prod-1" });

      mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      const vivos = database
        .prepare(
          `SELECT COUNT(*) AS total FROM customer_special_prices
            WHERE customer_id = ? AND product_id = 'prod-1' AND deleted_at IS NULL`
        )
        .get(keeper) as { total: number };
      expect(vivos.total).toBe(1);
    } finally {
      database.close();
    }
  });

  it("recalcula o saldo de credito pelo extrato unificado", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      const loser = insertCustomer(database, { id: "loser", document: "61241889000193" });
      insertCreditMovement(database, {
        id: "mv-1",
        customerId: keeper,
        type: "credit",
        cents: 500
      });
      insertCreditMovement(database, {
        id: "mv-2",
        customerId: loser,
        type: "debit_product",
        cents: 200
      });

      const result = mergeCustomerInto(database, { keeperId: keeper, loserId: loser });

      expect(result.counts.creditMovements).toBe(1);
      const balance = database
        .prepare("SELECT balance_cents FROM customer_credit_balances WHERE customer_id = ?")
        .get(keeper) as { balance_cents: number };
      expect(balance.balance_cents).toBe(300);
      expect(
        database
          .prepare("SELECT COUNT(*) AS total FROM customer_credit_balances WHERE customer_id = ?")
          .get(loser)
      ).toEqual({ total: 0 });
    } finally {
      database.close();
    }
  });

  it("recusa unificar um cadastro com ele mesmo", () => {
    const database = createDatabase();
    try {
      const keeper = insertCustomer(database, { id: "keeper", document: "61241889000193" });
      expect(() => mergeCustomerInto(database, { keeperId: keeper, loserId: keeper })).toThrow(
        "dois cadastros diferentes"
      );
    } finally {
      database.close();
    }
  });
});

describe("unificacao automatica por documento", () => {
  it("junta o par LOCAL + OMIE do mesmo CNPJ, mesmo com mascara diferente", () => {
    const database = createDatabase();
    try {
      // Exatamente o par relatado: a linha local (sem mascara) e a que voltou do OMIE (com).
      const local = insertCustomer(database, {
        id: "04bc46fc",
        document: "61241889000193",
        omieCustomerId: 11489145762,
        createdAt: "2026-08-01T12:44:48.000Z"
      });
      const fromOmie = insertCustomer(database, {
        id: "omie_11489145762",
        document: "61.241.889/0001-93",
        omieCustomerId: 11489145762,
        createdAt: "2026-08-01T13:50:15.000Z"
      });

      const results = mergeDuplicateCustomersByDocument(database, "company-1");

      expect(results).toHaveLength(1);
      // Os dois tem codigo OMIE: desempata o mais antigo, que e a linha criada na balanca.
      expect(results[0].keeperId).toBe(local);
      expect(results[0].loserId).toBe(fromOmie);
      expect(activeCustomerIds(database)).toEqual([local]);
    } finally {
      database.close();
    }
  });

  it("prefere quem ja tem codigo OMIE, mesmo sendo mais novo", () => {
    const database = createDatabase();
    try {
      const semOmie = insertCustomer(database, {
        id: "sem-omie",
        document: "61241889000193",
        createdAt: "2026-07-01T10:00:00.000Z"
      });
      const comOmie = insertCustomer(database, {
        id: "com-omie",
        document: "61241889000193",
        omieCustomerId: 99,
        createdAt: "2026-08-01T10:00:00.000Z"
      });

      const results = mergeDuplicateCustomersByDocument(database, "company-1");

      expect(results[0].keeperId).toBe(comOmie);
      expect(results[0].loserId).toBe(semOmie);
    } finally {
      database.close();
    }
  });

  it("nao encosta em cadastro sem documento, nem em nomes parecidos", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, { id: "a", document: null, tradeName: "TRANSPORTES SILVA" });
      insertCustomer(database, { id: "b", document: null, tradeName: "TRANSPORTES SILVA" });

      // Matriz e filial dividem o nome e sao clientes diferentes: aqui so o documento manda.
      expect(mergeDuplicateCustomersByDocument(database, "company-1")).toEqual([]);
      expect(activeCustomerIds(database)).toEqual(["a", "b"]);
    } finally {
      database.close();
    }
  });

  it("junta o grupo de tres numa sobrevivente so", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, {
        id: "a",
        document: "61241889000193",
        omieCustomerId: 1,
        createdAt: "2026-06-01T10:00:00.000Z"
      });
      insertCustomer(database, {
        id: "b",
        document: "61241889000193",
        createdAt: "2026-07-01T10:00:00.000Z"
      });
      insertCustomer(database, {
        id: "c",
        document: "61.241.889/0001-93",
        createdAt: "2026-08-01T10:00:00.000Z"
      });
      insertOperation(database, { id: "op-b", customerId: "b" });
      insertOperation(database, { id: "op-c", customerId: "c" });

      const results = mergeDuplicateCustomersByDocument(database, "company-1");

      expect(results).toHaveLength(2);
      expect(activeCustomerIds(database)).toEqual(["a"]);
      expect(operationOwners(database, "a")).toEqual(["op-b", "op-c"]);
    } finally {
      database.close();
    }
  });

  it("e idempotente: rodar de novo nao mexe em nada", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, { id: "a", document: "61241889000193", omieCustomerId: 1 });
      insertCustomer(database, { id: "b", document: "61241889000193" });

      expect(mergeDuplicateCustomersByDocument(database, "company-1")).toHaveLength(1);
      // Roda na abertura do programa: a segunda vez tem de ser uma consulta e nada mais.
      expect(mergeDuplicateCustomersByDocument(database, "company-1")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("nao mistura empresas diferentes", () => {
    const database = createDatabase();
    try {
      insertCompany(database, "company-2");
      insertCustomer(database, { id: "a", document: "61241889000193" });
      insertCustomer(database, { id: "b", document: "61241889000193", companyId: "company-2" });

      expect(mergeDuplicateCustomersByDocument(database, "company-1")).toEqual([]);
      expect(activeCustomerIds(database)).toEqual(["a", "b"]);
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return database;
}

function insertCompany(database: DesktopDatabase, companyId: string): void {
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, document, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      "Outra Pedreira LTDA",
      "Outra Pedreira",
      "00000000000191",
      "2026-06-01T10:00:00.000Z",
      "2026-06-01T10:00:00.000Z"
    );
}

function insertCustomer(
  database: DesktopDatabase,
  options: {
    id: string;
    document: string | null;
    omieCustomerId?: number;
    omieIntegrationCode?: string;
    createdAt?: string;
    tradeName?: string;
    companyId?: string;
  }
): string {
  const createdAt = options.createdAt ?? "2026-08-01T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers
         (id, company_id, legal_name, trade_name, document, omie_customer_id,
          omie_integration_code, source, is_active, sync_status, needs_push, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'local', 1, 'synced', 0, ?, ?)`
    )
    .run(
      options.id,
      options.companyId ?? "company-1",
      `${options.tradeName ?? "MORAES - AREIA E PEDRA"} LTDA`,
      options.tradeName ?? "MORAES - AREIA E PEDRA LTDA",
      options.document,
      options.omieCustomerId ?? null,
      options.omieIntegrationCode ?? null,
      createdAt,
      createdAt
    );
  return options.id;
}

function insertOperation(
  database: DesktopDatabase,
  options: { id: string; customerId: string }
): void {
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, customer_id, created_at, updated_at)
       VALUES (?, 'company-1', 'unit-1', 'device-1', 'synced', 'invoice', ?, ?, ?)`
    )
    .run(options.id, options.customerId, "2026-08-12T10:00:00.000Z", "2026-08-12T10:00:00.000Z");
}

function insertProduct(database: DesktopDatabase, id: string): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO products (id, company_id, code, description, unit, is_active, created_at, updated_at)
       VALUES (?, 'company-1', ?, ?, 'ton', 1, ?, ?)`
    )
    .run(id, id, `Produto ${id}`, "2026-06-01T10:00:00.000Z", "2026-06-01T10:00:00.000Z");
}

function insertSpecialPrice(
  database: DesktopDatabase,
  options: { id: string; customerId: string; productId: string }
): void {
  insertProduct(database, options.productId);
  database
    .prepare(
      `INSERT INTO customer_special_prices
         (id, company_id, customer_id, product_id, unit_price_cents, is_active, created_at, updated_at)
       VALUES (?, 'company-1', ?, ?, 1000, 1, ?, ?)`
    )
    .run(
      options.id,
      options.customerId,
      options.productId,
      "2026-08-01T10:00:00.000Z",
      "2026-08-01T10:00:00.000Z"
    );
}

function insertCreditMovement(
  database: DesktopDatabase,
  options: { id: string; customerId: string; type: string; cents: number }
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements
         (id, company_id, customer_id, movement_type, amount_cents, balance_after_cents, created_at)
       VALUES (?, 'company-1', ?, ?, ?, 0, ?)`
    )
    .run(options.id, options.customerId, options.type, options.cents, "2026-08-10T10:00:00.000Z");
}

function operationOwners(database: DesktopDatabase, customerId: string): string[] {
  return (
    database
      .prepare("SELECT id FROM weighing_operations WHERE customer_id = ? ORDER BY id")
      .all(customerId) as Array<{ id: string }>
  ).map((row) => row.id);
}

function activeCustomerIds(database: DesktopDatabase): string[] {
  return (
    database
      .prepare("SELECT id FROM customers WHERE deleted_at IS NULL ORDER BY id")
      .all() as Array<{ id: string }>
  ).map((row) => row.id);
}

function specialPriceOwner(database: DesktopDatabase, id: string): string {
  return (
    database.prepare("SELECT customer_id FROM customer_special_prices WHERE id = ?").get(id) as {
      customer_id: string;
    }
  ).customer_id;
}

function isLinkDeleted(database: DesktopDatabase, table: string, id: string): boolean {
  const row = database.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id) as {
    deleted_at: string | null;
  };
  return row.deleted_at !== null;
}
