import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import type { DesktopDatabase } from "../database/sqlite";
import {
  getCustomerFreightRuleForProduct,
  getCustomerFreightRules,
  getLastCustomerFreightNote,
  rememberCustomerFreightValue,
  removeCustomerFreightModality,
  setCustomerFreightRule
} from "./customer-freight-rules";
import type { FreightRule } from "./freight";

function perTon(baseValueCents: number): FreightRule {
  return {
    id: "rule",
    name: "Frete",
    type: "per_ton",
    baseValueCents,
    unit: "ton"
  };
}

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
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('customer-1', 'company-1', 'local', 'Cliente 1', 'Cliente 1', 1, datetime('now'), datetime('now'))`
    )
    .run();
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
       VALUES ('product-1', 'company-1', 'P1', 'Brita 1', 'ton', datetime('now'), datetime('now'))`
    )
    .run();
  database
    .prepare(
      `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
       VALUES ('unit-1', 'company-1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
    )
    .run();
  database
    .prepare(
      `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
       VALUES ('device-1', 'company-1', 'unit-1', 'Desktop', 'desktop_scale', 'inst-1', datetime('now'), datetime('now'))`
    )
    .run();
  return database;
}

/** Entrada do cliente com (ou sem) observacao de frete, para a memoria por cliente. */
function insertEntry(
  database: DesktopDatabase,
  id: string,
  createdAt: string,
  freightJson: string | null,
  deletedAt: string | null = null
): void {
  database
    .prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, customer_id, product_id,
         freight_json, created_at, updated_at, deleted_at
       ) VALUES (?, 'company-1', 'unit-1', 'device-1', 'closed_local', 'invoice', 'customer-1',
         'product-1', ?, ?, ?, ?)`
    )
    .run(id, freightJson, createdAt, createdAt, deletedAt);
}

describe("observacao de frete da ultima entrada do cliente", () => {
  it("devolve a observacao da entrada mais recente que tinha uma", () => {
    const database = createDatabase();
    try {
      insertEntry(
        database,
        "op-1",
        "2026-08-01 08:00:00",
        JSON.stringify({ destination: "Obra antiga" })
      );
      insertEntry(
        database,
        "op-2",
        "2026-08-05 08:00:00",
        JSON.stringify({ destination: "Obra do centro" })
      );
      // Entrada mais recente sem observacao: nao apaga a memoria, so nao tem o que dizer.
      insertEntry(database, "op-3", "2026-08-06 08:00:00", JSON.stringify({ destination: "  " }));

      expect(getLastCustomerFreightNote(database, "customer-1")).toBe("Obra do centro");
    } finally {
      database.close();
    }
  });

  it("ignora entradas apagadas, frete sem observacao e json quebrado", () => {
    const database = createDatabase();
    try {
      insertEntry(
        database,
        "op-1",
        "2026-08-01 08:00:00",
        JSON.stringify({ destination: "Valida" })
      );
      insertEntry(database, "op-2", "2026-08-02 08:00:00", "{oops");
      insertEntry(database, "op-3", "2026-08-03 08:00:00", JSON.stringify({ rule: { id: "r" } }));
      insertEntry(
        database,
        "op-4",
        "2026-08-04 08:00:00",
        JSON.stringify({ destination: "Apagada" }),
        "2026-08-04 09:00:00"
      );

      expect(getLastCustomerFreightNote(database, "customer-1")).toBe("Valida");
    } finally {
      database.close();
    }
  });

  it("devolve nulo para o cliente que nunca escreveu observacao", () => {
    const database = createDatabase();
    try {
      insertEntry(database, "op-1", "2026-08-01 08:00:00", null);
      expect(getLastCustomerFreightNote(database, "customer-1")).toBeNull();
      expect(getLastCustomerFreightNote(database, "customer-2")).toBeNull();
    } finally {
      database.close();
    }
  });
});

describe("frete do cliente por tipo de frete", () => {
  it("guarda um unico valor para o grupo com frete, venha de que situacao vier", () => {
    const database = createDatabase();
    try {
      // "fob" e legado: com os dois tipos de hoje, todo valor cai em "com frete" (cif).
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "fob",
        rule: perTon(9000)
      });
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "cif",
        rule: perTon(12000)
      });

      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "cif")?.rule
          .baseValueCents
      ).toBe(12000);
      // As duas situacoes com valor compartilham a memoria: o frete do cliente e um so.
      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob")?.rule
          .baseValueCents
      ).toBe(12000);

      // Um so registro por (cliente, produto), com um unico tipo cobravel dentro dele.
      const rules = getCustomerFreightRules(database, "customer-1");
      expect(rules).toHaveLength(1);
      expect(Object.keys(rules[0].modalities)).toEqual(["cif"]);
    } finally {
      database.close();
    }
  });

  it("puxa o valor gravado numa modalidade antiga quando so ela existe", () => {
    const database = createDatabase();
    try {
      // Memoria gravada antes da simplificacao dos tipos de frete.
      database
        .prepare(
          `INSERT INTO customer_freight_rules (id, customer_id, product_id, rule_json, is_active, created_at, updated_at)
           VALUES ('legacy-rule', 'customer-1', NULL, ?, 1, datetime('now'), datetime('now'))`
        )
        .run(
          JSON.stringify({
            id: "default",
            name: "Frete do cliente",
            type: "per_ton",
            baseValueCents: 0,
            unit: "ton",
            modalities: {
              fob: {
                type: "per_ton",
                baseValueCents: 8800,
                source: "last_used",
                updatedAt: "2026-01-01T00:00:00.000Z",
                destination: "Obra do centro",
                showOnReceipt: false
              }
            }
          })
        );

      const resolved = getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "cif");
      expect(resolved?.rule.baseValueCents).toBe(8800);
      expect(resolved?.modality).toBe("cif");
      expect(resolved?.destination).toBe("Obra do centro");
      expect(resolved?.showOnReceipt).toBe(false);
    } finally {
      database.close();
    }
  });

  it("memoriza destino e a escolha de mostrar o frete no cupom", () => {
    const database = createDatabase();
    try {
      rememberCustomerFreightValue(database, {
        customerId: "customer-1",
        productId: "product-1",
        modality: "cif",
        rule: perTon(7700),
        destination: "Pedreira -> Obra Norte",
        showOnReceipt: false
      });

      const resolved = getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "cif");
      expect(resolved?.rule.baseValueCents).toBe(7700);
      expect(resolved?.destination).toBe("Pedreira -> Obra Norte");
      expect(resolved?.showOnReceipt).toBe(false);
      expect(resolved?.source).toBe("last_used");
    } finally {
      database.close();
    }
  });

  it("memoriza o valor da ultima venda quando o cadastro nao tem nada para o tipo", () => {
    const database = createDatabase();
    try {
      rememberCustomerFreightValue(database, {
        customerId: "customer-1",
        productId: "product-1",
        modality: "fob",
        rule: perTon(7500)
      });

      const resolved = getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob");
      expect(resolved?.rule.baseValueCents).toBe(7500);
      expect(resolved?.source).toBe("last_used");
    } finally {
      database.close();
    }
  });

  it("o valor configurado no cadastro vence a memoria da ultima venda", () => {
    const database = createDatabase();
    try {
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "fob",
        rule: perTon(9000)
      });
      rememberCustomerFreightValue(database, {
        customerId: "customer-1",
        modality: "fob",
        rule: perTon(1)
      });

      const resolved = getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob");
      expect(resolved?.rule.baseValueCents).toBe(9000);
      expect(resolved?.source).toBe("manual");
    } finally {
      database.close();
    }
  });

  it("memoriza a escolha de nao mostrar o frete no cupom mesmo com valor do cadastro", () => {
    const database = createDatabase();
    try {
      // O cadastro define o VALOR do frete, mas nao diz se ele sai na nota/cupom.
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "cif",
        rule: perTon(9000)
      });
      rememberCustomerFreightValue(database, {
        customerId: "customer-1",
        modality: "cif",
        rule: perTon(9000),
        showOnReceipt: false
      });

      const resolved = getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "cif");
      // O valor do cadastro continua mandando; so a escolha do cupom foi memorizada.
      expect(resolved?.rule.baseValueCents).toBe(9000);
      expect(resolved?.source).toBe("manual");
      expect(resolved?.showOnReceipt).toBe(false);
    } finally {
      database.close();
    }
  });

  it("o valor do produto vence o valor padrao do cliente no mesmo tipo", () => {
    const database = createDatabase();
    try {
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "fob",
        rule: perTon(9000)
      });
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        productId: "product-1",
        modality: "fob",
        rule: perTon(11000)
      });

      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob")?.rule
          .baseValueCents
      ).toBe(11000);
    } finally {
      database.close();
    }
  });

  it("mantem a regra unica antiga quando o tipo pedido nao tem valor proprio", () => {
    const database = createDatabase();
    try {
      setCustomerFreightRule(database, { customerId: "customer-1", rule: perTon(5000) });
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "cif",
        rule: perTon(13000)
      });

      // "Sem frete" nao tem valor proprio: cai na regra unica antiga.
      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "none")?.rule
          .baseValueCents
      ).toBe(5000);
      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1")?.rule.baseValueCents
      ).toBe(5000);
    } finally {
      database.close();
    }
  });

  it("nao preenche zero quando a regra so carrega valores de outros tipos", () => {
    const database = createDatabase();
    try {
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "cif",
        rule: perTon(13000)
      });

      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "none")
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("nao memoriza tipos de frete que nao comportam valor", () => {
    const database = createDatabase();
    try {
      rememberCustomerFreightValue(database, {
        customerId: "customer-1",
        modality: "own_recipient",
        rule: perTon(7500)
      });

      expect(getCustomerFreightRules(database, "customer-1")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("remove o valor do tipo e apaga a regra quando ela fica vazia", () => {
    const database = createDatabase();
    try {
      setCustomerFreightRule(database, {
        customerId: "customer-1",
        modality: "cif",
        rule: perTon(12000)
      });
      const ruleId = getCustomerFreightRules(database, "customer-1")[0].id;

      removeCustomerFreightModality(database, ruleId, "cif");
      expect(getCustomerFreightRules(database, "customer-1")).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
