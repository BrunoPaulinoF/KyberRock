import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { applyOmieReferenceData } from "./supabase-sync";

/**
 * Duas pedreiras ligadas na MESMA conta OMIE (ou a mesma maquina reativada em
 * outra pedreira) espelhavam o cadastro no mesmo id derivado (`omie_<id>`).
 * Como o upsert e `ON CONFLICT(id) DO UPDATE SET company_id = excluded.company_id`,
 * cada sincronizacao mudava a linha de dono em vez de criar a copia da pedreira
 * que sincronizou: a outra perdia o cliente sem erro nenhum aparecer, e o total
 * baixado nunca batia com o que existe no OMIE.
 */
describe("cadastro OMIE espelhado em duas pedreiras da mesma conta", () => {
  it("da a cada empresa a sua copia em vez de mudar a linha de dono", () => {
    const database = createDatabase();

    try {
      applyOmieReferenceData(database, "company-a", referenceData());
      applyOmieReferenceData(database, "company-b", referenceData());

      expect(countCustomers(database, "company-a")).toBe(1);
      expect(countCustomers(database, "company-b")).toBe(1);
      expect(countProducts(database, "company-a")).toBe(1);
      expect(countProducts(database, "company-b")).toBe(1);
      expect(countCarriers(database, "company-a")).toBe(1);
      expect(countCarriers(database, "company-b")).toBe(1);
      expect(countMirroredTerms(database, "company-a")).toBe(1);
      expect(countMirroredTerms(database, "company-b")).toBe(1);

      // Re-sincronizar a primeira empresa nao pode tomar de volta a copia da segunda.
      applyOmieReferenceData(database, "company-a", referenceData());
      expect(countCustomers(database, "company-b")).toBe(1);
      expect(countProducts(database, "company-b")).toBe(1);
      expect(countCarriers(database, "company-b")).toBe(1);
      expect(countMirroredTerms(database, "company-b")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("espelha a mesma condicao do OMIE nas duas pedreiras sem quebrar a pagina", () => {
    // Relato da pedreira: no notebook toda sincronizacao terminava com
    // "UNIQUE constraint failed: omie_payment_terms.id" e zero de tudo — o id da
    // parcela nao tinha empresa, a clausula de conflito so cobria (empresa,
    // codigo), e o erro derrubava a transacao da pagina inteira, clientes junto.
    const database = createDatabase();

    try {
      const first = applyOmieReferenceData(database, "company-a", referenceData());
      const second = applyOmieReferenceData(database, "company-b", referenceData());

      expect(first.errors).toEqual([]);
      expect(second.errors).toEqual([]);
      expect(second.customersPulled).toBe(1);
      expect(second.paymentTermsSynced).toBe(1);
      expect(countMirroredTerms(database, "company-a")).toBe(1);
      expect(countMirroredTerms(database, "company-b")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("espelho de parcelas nao adota linha da identidade provisoria", () => {
    // Diferente de cliente/produto, o upsert do espelho de parcelas casa por
    // (empresa, codigo) e nao por id. Adotar o id de outro dono — inclusive o
    // 'setup-company' de antes da ativacao — bate na chave primaria e estoura.
    const database = createDatabase();

    try {
      const at = "2026-07-29T10:00:00.000Z";
      database
        .prepare(
          "INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at) VALUES ('setup-company', 'Config Inicial', 'Config Inicial', ?, ?)"
        )
        .run(at, at);
      database
        .prepare(
          `INSERT INTO omie_payment_terms (id, company_id, code, description, is_active, visible, created_at, updated_at)
           VALUES ('omie_parcela_001', 'setup-company', '001', 'A Vista', 1, 1, ?, ?)`
        )
        .run(at, at);

      const result = applyOmieReferenceData(database, "company-a", referenceData());

      expect(result.errors).toEqual([]);
      expect(result.paymentTermsSynced).toBe(1);
      expect(countMirroredTerms(database, "company-a")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("bloco com falha nao apaga o que os outros blocos gravaram", () => {
    const database = createDatabase();

    try {
      // Espelho de parcelas travado: escrever nele falha, mas os clientes da
      // mesma pagina precisam continuar entrando.
      database.prepare("DROP TABLE omie_payment_terms").run();

      const result = applyOmieReferenceData(database, "company-a", referenceData());

      expect(result.customersPulled).toBe(1);
      expect(result.productsSynced).toBe(1);
      expect(result.suppliersSynced).toBe(1);
      expect(result.paymentTermsSynced).toBe(0);
      expect(result.errors.join(" ")).toContain("condicoes de pagamento");
      expect(countCustomers(database, "company-a")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("continua atualizando a linha que ja e da propria empresa", () => {
    const database = createDatabase();

    try {
      applyOmieReferenceData(database, "company-a", referenceData());
      const before = customerIds(database, "company-a");

      applyOmieReferenceData(database, "company-a", referenceData("Cliente Renomeado"));

      expect(customerIds(database, "company-a")).toEqual(before);
      expect(
        database
          .prepare("SELECT legal_name FROM customers WHERE company_id = 'company-a'")
          .pluck()
          .get()
      ).toBe("Cliente Renomeado");
    } finally {
      database.close();
    }
  });
});

/**
 * O cliente que nasce na balanca e depois sobe para o OMIE voltava no pull seguinte como
 * uma LINHA NOVA (`omie_<id>`), e o mesmo cliente passava a ter dois cadastros com as
 * pesagens divididas entre eles — foi assim que uma quinzena de quatro cargas apareceu com
 * duas no Fechamento de faturas.
 *
 * A causa era so a mascara: o OMIE devolve "12.345.678/0001-99" e a tela grava
 * "12345678000199" (o campo normaliza antes de salvar). O pull comparava os dois literal,
 * nunca casava, e criava o cadastro do lado.
 */
describe("cliente ja cadastrado aqui, com o documento em outro formato", () => {
  it("adota o cadastro local em vez de criar um `omie_<id>` do lado", () => {
    const database = createDatabase();

    try {
      // Como a balanca grava: so digitos.
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document,
                                  is_active, created_at, updated_at)
           VALUES ('local-uuid', 'company-a', 'local', 'Cliente Compartilhado',
                   'Cliente Compartilhado', '12345678000199', 1, datetime('now'), datetime('now'))`
        )
        .run();

      // Como o OMIE devolve: com mascara.
      const data = referenceData();
      data.customers[0].document = "12.345.678/0001-99";
      applyOmieReferenceData(database, "company-a", data);

      expect(countCustomers(database, "company-a")).toBe(1);
      const row = database
        .prepare("SELECT id, omie_customer_id FROM customers WHERE company_id = 'company-a'")
        .get() as { id: string; omie_customer_id: number };
      expect(row.id).toBe("local-uuid");
      expect(row.omie_customer_id).toBe(11455923824);
    } finally {
      database.close();
    }
  });

  it("vale nos dois sentidos: documento mascarado aqui e so digitos no OMIE", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document,
                                  is_active, created_at, updated_at)
           VALUES ('local-uuid', 'company-a', 'local', 'Cliente', 'Cliente',
                   '12.345.678/0001-99', 1, datetime('now'), datetime('now'))`
        )
        .run();

      // O fixture ja traz o documento so com digitos.
      applyOmieReferenceData(database, "company-a", referenceData());

      expect(countCustomers(database, "company-a")).toBe(1);
      expect(
        database
          .prepare("SELECT id FROM customers WHERE company_id = 'company-a'")
          .pluck()
          .get()
      ).toBe("local-uuid");
    } finally {
      database.close();
    }
  });

  it("a transportadora do OMIE adota o cadastro local pela mesma regra", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, document, source, is_active, created_at, updated_at)
           VALUES ('carr-local', 'company-a', 'Transportadora', '98765432000155', 'local', 1,
                   datetime('now'), datetime('now'))`
        )
        .run();

      const data = referenceData();
      data.suppliers[0].document = "98.765.432/0001-55";
      applyOmieReferenceData(database, "company-a", data);

      expect(countCarriers(database, "company-a")).toBe(1);
      expect(
        database.prepare("SELECT id FROM carriers WHERE company_id = 'company-a'").pluck().get()
      ).toBe("carr-local");
    } finally {
      database.close();
    }
  });

  it("documento diferente continua sendo cliente diferente", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document,
                                  is_active, created_at, updated_at)
           VALUES ('local-uuid', 'company-a', 'local', 'Outro', 'Outro', '99999999000191', 1,
                   datetime('now'), datetime('now'))`
        )
        .run();

      applyOmieReferenceData(database, "company-a", referenceData());

      // Normalizar a mascara nao pode virar "casa qualquer um": sao dois clientes mesmo.
      expect(countCustomers(database, "company-a")).toBe(2);
    } finally {
      database.close();
    }
  });

  it("cliente do OMIE sem documento nao adota o cadastro local sem documento", () => {
    const database = createDatabase();

    try {
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document,
                                  is_active, created_at, updated_at)
           VALUES ('sem-doc', 'company-a', 'local', 'Sem documento', 'Sem documento', NULL, 1,
                   datetime('now'), datetime('now'))`
        )
        .run();

      const data = referenceData();
      data.customers[0].document = null;
      applyOmieReferenceData(database, "company-a", data);

      // Documento vazio casaria com todo cadastro sem documento da base.
      expect(countCustomers(database, "company-a")).toBe(2);
    } finally {
      database.close();
    }
  });
});

function referenceData(
  customerName = "Cliente Compartilhado"
): Parameters<typeof applyOmieReferenceData>[2] {
  return {
    customers: [
      {
        id: 11455923824,
        name: customerName,
        tradeName: customerName,
        document: "12345678000199",
        email: null,
        phone: null,
        zipcode: null,
        addressStreet: null,
        addressNumber: null,
        neighborhood: null,
        city: null,
        state: null,
        isIndividual: false,
        isActive: true,
        defaultPaymentTermId: null
      }
    ],
    products: [
      {
        id: 999_001,
        code: "BRITA1",
        description: "Brita 1",
        unit: "TON",
        ncm: null,
        ean: null,
        unitPriceCents: 1000,
        itemType: "04",
        isActive: true
      }
    ],
    suppliers: [
      {
        id: 11455923999,
        name: "Transportadora Compartilhada",
        document: "98765432000155"
      }
    ],
    paymentTerms: [
      {
        id: 7001,
        code: "001",
        description: "A Vista",
        installmentCount: 1,
        isActive: true,
        visible: true
      }
    ],
    pageSize: 100,
    pagination: {
      customersPage: 1,
      customersReturned: 1,
      customersFinished: true,
      customersTotalPages: 1,
      customersTotalRecords: 1,
      productsPage: 1,
      productsReturned: 1,
      productsFinished: true,
      productsTotalPages: 1,
      productsTotalRecords: 1,
      paymentTermsPage: 1,
      paymentTermsReturned: 0,
      paymentTermsFinished: true,
      paymentTermsTotalPages: 1,
      paymentTermsTotalRecords: 0
    }
  } as Parameters<typeof applyOmieReferenceData>[2];
}

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  const at = "2026-07-29T10:00:00.000Z";
  const company = database.prepare(
    "INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  );
  company.run("company-a", "Pedreira A", "Pedreira A", at, at);
  company.run("company-b", "Pedreira B", "Pedreira B", at, at);
  return database;
}

function countCustomers(database: DesktopDatabase, companyId: string): number {
  return database
    .prepare("SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL")
    .pluck()
    .get(companyId) as number;
}

function countProducts(database: DesktopDatabase, companyId: string): number {
  return database
    .prepare("SELECT COUNT(*) FROM products WHERE company_id = ? AND deleted_at IS NULL")
    .pluck()
    .get(companyId) as number;
}

function countCarriers(database: DesktopDatabase, companyId: string): number {
  return database
    .prepare("SELECT COUNT(*) FROM carriers WHERE company_id = ? AND deleted_at IS NULL")
    .pluck()
    .get(companyId) as number;
}

function countMirroredTerms(database: DesktopDatabase, companyId: string): number {
  return database
    .prepare("SELECT COUNT(*) FROM omie_payment_terms WHERE company_id = ?")
    .pluck()
    .get(companyId) as number;
}

function customerIds(database: DesktopDatabase, companyId: string): string[] {
  return database
    .prepare("SELECT id FROM customers WHERE company_id = ? ORDER BY id")
    .pluck()
    .all(companyId) as string[];
}
