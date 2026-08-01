import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import type { DesktopDatabase } from "../database/sqlite";
import {
  getCustomerFreightRuleForProduct,
  getCustomerFreightRules,
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
  return database;
}

describe("frete do cliente por tipo de frete", () => {
  it("guarda um valor por tipo de frete e devolve o do tipo pedido", () => {
    const database = createDatabase();
    try {
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
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob")?.rule
          .baseValueCents
      ).toBe(9000);
      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "cif")?.rule
          .baseValueCents
      ).toBe(12000);

      // Um so registro por (cliente, produto): os tipos convivem dentro dele.
      const rules = getCustomerFreightRules(database, "customer-1");
      expect(rules).toHaveLength(1);
      expect(Object.keys(rules[0].modalities).sort()).toEqual(["cif", "fob"]);
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

      expect(
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob")?.rule
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
        getCustomerFreightRuleForProduct(database, "customer-1", "product-1", "fob")
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

  it("remove so o tipo pedido e apaga a regra quando ela fica vazia", () => {
    const database = createDatabase();
    try {
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
      const ruleId = getCustomerFreightRules(database, "customer-1")[0].id;

      removeCustomerFreightModality(database, ruleId, "fob");
      const remaining = getCustomerFreightRules(database, "customer-1");
      expect(Object.keys(remaining[0].modalities)).toEqual(["cif"]);

      removeCustomerFreightModality(database, ruleId, "cif");
      expect(getCustomerFreightRules(database, "customer-1")).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
