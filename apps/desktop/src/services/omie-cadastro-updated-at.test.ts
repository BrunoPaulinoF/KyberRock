import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { applyOmieReferenceData } from "./supabase-sync";
import type { DesktopDatabase } from "../database/sqlite";

/**
 * O `updated_at` do cadastro vindo do OMIE nao e um detalhe de auditoria: o cursor do push
 * do cadastro compartilhado e keyset nessa coluna. Carimba-la a cada passada, mesmo sem
 * alteracao, fazia o cadastro INTEIRO ser republicado na nuvem toda vez -- e, do outro
 * lado, o pull incremental de 15 s das demais balancas rebaixar tudo em vez de nada.
 *
 * O que estes testes travam e a fronteira exata: passada sem mudanca nao mexe no carimbo;
 * QUALQUER mudanca real mexe. O segundo caso e o que importa para nao haver regressao --
 * uma coluna que deixasse de ser detectada continuaria sendo gravada localmente, mas
 * pararia de chegar nas outras maquinas.
 */
describe("upsert do cadastro OMIE: quando o updated_at anda", () => {
  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
      )
      .run();
    return database;
  }

  function omieCustomer(overrides: Record<string, unknown> = {}) {
    return {
      id: 4001,
      name: "PEDREIRA LEVISA LTDA",
      tradeName: "Levisa",
      document: "12345678000190",
      email: "contato@levisa.com.br",
      phone: "1533334444",
      zipcode: "18100000",
      addressStreet: "Avenida das Britas",
      addressNumber: "500",
      neighborhood: "Distrito Industrial",
      city: "Sorocaba",
      state: "SP",
      defaultPaymentTermId: null,
      ...overrides
    };
  }

  function applyPass(database: DesktopDatabase, overrides: Record<string, unknown> = {}): void {
    applyOmieReferenceData(database, "company-1", {
      customers: [omieCustomer(overrides)]
    } as Parameters<typeof applyOmieReferenceData>[2]);
  }

  function readRow(database: DesktopDatabase): Record<string, unknown> {
    return database
      .prepare("SELECT * FROM customers WHERE omie_customer_id = 4001")
      .get() as Record<string, unknown>;
  }

  /** Reescreve o carimbo para um valor antigo e reconhecivel, para o teste medir o efeito. */
  function backdate(database: DesktopDatabase): string {
    const marker = "2020-01-01T00:00:00.000Z";
    database
      .prepare("UPDATE customers SET updated_at = ? WHERE omie_customer_id = 4001")
      .run(marker);
    return marker;
  }

  it("NAO mexe no carimbo quando a passada nao traz nenhuma mudanca", () => {
    const database = createDatabase();
    applyPass(database);
    const marker = backdate(database);

    applyPass(database);

    expect(readRow(database).updated_at).toBe(marker);
    database.close();
  });

  it("mexe no carimbo quando QUALQUER coluna muda de valor", () => {
    // Uma coluna de cada familia do upsert: a que o OMIE manda sempre, a que cede para a
    // edicao local, a booleana e a de endereco. Se a deteccao perder uma delas, a mudanca
    // para de ser publicada para as outras balancas e este teste cai.
    const casos: Array<[string, Record<string, unknown>]> = [
      ["razao social", { name: "PEDREIRA LEVISA NORTE LTDA" }],
      ["nome fantasia", { tradeName: "Levisa Norte" }],
      ["documento", { document: "98765432000155" }],
      ["email", { email: "novo@levisa.com.br" }],
      ["telefone", { phone: "1599998888" }],
      ["cidade", { city: "Itu" }],
      ["logradouro", { addressStreet: "Rua Nova" }],
      ["numero", { addressNumber: "999" }],
      ["cep", { zipcode: "18200000" }],
      ["bloqueio de faturamento", { billingBlocked: true }],
      ["pessoa fisica", { isIndividual: true }],
      ["inscricao estadual", { stateRegistration: "110042490114" }],
      ["observacoes", { observations: "Retira sempre pela manha" }],
      ["codigo de integracao", { integrationCode: "KR-4001" }],
      ["vendedor", { salespersonId: 77 }],
      ["tipo de cadastro", { customerType: "C" }]
    ];

    for (const [rotulo, mudanca] of casos) {
      const database = createDatabase();
      applyPass(database);
      const marker = backdate(database);

      applyPass(database, mudanca);

      expect(readRow(database).updated_at, `mudanca de ${rotulo}`).not.toBe(marker);
      database.close();
    }
  });

  it("mexe no carimbo quando o cliente volta de uma exclusao logica", () => {
    const database = createDatabase();
    applyPass(database);
    const marker = backdate(database);
    database
      .prepare(
        "UPDATE customers SET deleted_at = '2020-06-01T00:00:00.000Z' WHERE omie_customer_id = 4001"
      )
      .run();
    database
      .prepare("UPDATE customers SET updated_at = ? WHERE omie_customer_id = 4001")
      .run(marker);

    applyPass(database);

    const row = readRow(database);
    expect(row.deleted_at).toBeNull();
    expect(row.updated_at).not.toBe(marker);
    database.close();
  });

  it("continua respeitando a edicao local ainda nao enviada ao OMIE", () => {
    // A protecao que ja existia: com needs_push = 1 o valor do OMIE nao sobrescreve o que
    // o operador digitou. Como o valor efetivo nao muda, o carimbo tambem nao anda.
    const database = createDatabase();
    applyPass(database);
    database
      .prepare(
        "UPDATE customers SET trade_name = 'Levisa (corrigido na balanca)', needs_push = 1 WHERE omie_customer_id = 4001"
      )
      .run();
    const marker = backdate(database);

    applyPass(database, { tradeName: "Levisa do OMIE" });

    const row = readRow(database);
    expect(row.trade_name).toBe("Levisa (corrigido na balanca)");
    expect(row.updated_at).toBe(marker);
    database.close();
  });

  it("grava a linha normalmente na primeira vez que o cliente chega", () => {
    const database = createDatabase();
    applyPass(database);

    const row = readRow(database);
    expect(row.trade_name).toBe("Levisa");
    expect(row.city).toBe("Sorocaba");
    expect(row.updated_at).toBeTruthy();
    database.close();
  });
});

describe("upsert de produtos OMIE: quando o updated_at anda", () => {
  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
      )
      .run();
    return database;
  }

  function omieProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: 9001,
      code: "BRITA1",
      description: "Brita 1",
      unit: "TON",
      ncm: "25171000",
      ean: null,
      unitPriceCents: 5500,
      itemType: "04",
      ...overrides
    };
  }

  function applyPass(database: DesktopDatabase, overrides: Record<string, unknown> = {}): void {
    applyOmieReferenceData(database, "company-1", {
      products: [omieProduct(overrides)]
    } as Parameters<typeof applyOmieReferenceData>[2]);
  }

  function readRow(database: DesktopDatabase): Record<string, unknown> {
    return database.prepare("SELECT * FROM products WHERE omie_product_id = 9001").get() as Record<
      string,
      unknown
    >;
  }

  function backdate(database: DesktopDatabase): string {
    const marker = "2020-01-01T00:00:00.000Z";
    database.prepare("UPDATE products SET updated_at = ? WHERE omie_product_id = 9001").run(marker);
    return marker;
  }

  it("NAO mexe no carimbo quando a passada nao traz nenhuma mudanca", () => {
    const database = createDatabase();
    applyPass(database);
    const marker = backdate(database);

    applyPass(database);

    expect(readRow(database).updated_at).toBe(marker);
    database.close();
  });

  it("mexe no carimbo quando QUALQUER coluna muda de valor", () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ["descricao", { description: "Brita 1 lavada" }],
      ["codigo", { code: "BRITA1L" }],
      ["preco", { unitPriceCents: 6200 }],
      ["unidade", { unit: "M3" }],
      ["ncm", { ncm: "25174100" }],
      ["ean", { ean: "7891234567890" }],
      ["marca", { brand: "Pedreira Sul" }],
      ["familia", { familyCode: "AGREG" }],
      ["peso liquido", { netWeightKg: 1600 }],
      ["observacoes internas", { internalNotes: "Estoque no patio 3" }],
      ["codigo de integracao", { integrationCode: "KR-9001" }],
      ["cest", { cest: "0100100" }],
      ["origem do icms", { icmsOrigin: "0" }]
    ];

    for (const [rotulo, mudanca] of casos) {
      const database = createDatabase();
      applyPass(database);
      const marker = backdate(database);

      applyPass(database, mudanca);

      expect(readRow(database).updated_at, `mudanca de ${rotulo}`).not.toBe(marker);
      database.close();
    }
  });

  it("mexe no carimbo quando o produto volta de uma exclusao logica", () => {
    const database = createDatabase();
    applyPass(database);
    database
      .prepare(
        "UPDATE products SET deleted_at = '2020-06-01T00:00:00.000Z' WHERE omie_product_id = 9001"
      )
      .run();
    const marker = backdate(database);

    applyPass(database);

    const row = readRow(database);
    expect(row.deleted_at).toBeNull();
    expect(row.updated_at).not.toBe(marker);
    database.close();
  });
});
