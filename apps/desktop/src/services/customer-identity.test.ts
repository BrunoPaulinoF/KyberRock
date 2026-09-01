import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  buildCustomerIdentityIndex,
  customerIdentityKey,
  identityKeyForOperation,
  resolveCustomerIdGroup
} from "./customer-identity";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  db.prepare(
    `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
     VALUES ('comp-1', 'Pedreira', 'Pedreira', datetime('now'), datetime('now'))`
  ).run();
  return db;
}

type Database = ReturnType<typeof createDatabase>;

function insertCustomer(
  db: Database,
  id: string,
  document: string | null,
  omieCustomerId: number | null = null,
  extra: { isActive?: boolean; deletedAt?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO customers
       (id, company_id, legal_name, trade_name, document, omie_customer_id, source,
        is_active, deleted_at, created_at, updated_at)
     VALUES (?, 'comp-1', ?, ?, ?, ?, 'local', ?, ?, datetime('now'), datetime('now'))`
  ).run(
    id,
    id,
    id,
    document,
    omieCustomerId,
    extra.isActive === false ? 0 : 1,
    extra.deletedAt ?? null
  );
}

describe("customerIdentityKey", () => {
  it("o documento manda, sem mascara", () => {
    expect(
      customerIdentityKey({ id: "a", document: "06.020.284/0001-64", omie_customer_id: 1 })
    ).toBe(customerIdentityKey({ id: "b", document: "06020284000164", omie_customer_id: 2 }));
  });

  it("nao confunde dois CNPJs alfanumericos que so diferem nas letras", () => {
    // Guardar "so os digitos" colapsaria os dois em "1234501"/"1245601": dois clientes
    // distintos cairiam na mesma fatura, e o pull adotaria o cadastro do outro.
    expect(
      customerIdentityKey({ id: "a", document: "12.ABC.345/01DE-35", omie_customer_id: null })
    ).not.toBe(
      customerIdentityKey({ id: "b", document: "12.DEF.456/01AB-72", omie_customer_id: null })
    );
    // A mascara e a caixa continuam nao importando.
    expect(
      customerIdentityKey({ id: "a", document: "12.abc.345/01de-35", omie_customer_id: null })
    ).toBe(customerIdentityKey({ id: "b", document: "12ABC34501DE35", omie_customer_id: null }));
  });

  it("sem documento, o codigo OMIE amarra os dois cadastros", () => {
    expect(customerIdentityKey({ id: "a", document: null, omie_customer_id: 99 })).toBe(
      customerIdentityKey({ id: "b", document: "", omie_customer_id: 99 })
    );
  });

  it("sem documento e sem codigo OMIE, cada cadastro responde por si", () => {
    // Nunca pelo nome: dois "Transportes Silva" diferentes viveriam fundidos numa fatura so.
    expect(customerIdentityKey({ id: "a", document: null, omie_customer_id: null })).not.toBe(
      customerIdentityKey({ id: "b", document: null, omie_customer_id: null })
    );
  });
});

describe("resolveCustomerIdGroup", () => {
  it("junta os cadastros duplicados do mesmo CNPJ", () => {
    const db = createDatabase();
    try {
      // O caso real: o cadastro que veio do OMIE e o que nasceu na balanca.
      insertCustomer(db, "omie_11488403507", "06020284000164", 11_488_403_507);
      insertCustomer(db, "28cbc2e5", "06020284000164", 11_488_403_507);
      insertCustomer(db, "outro", "11222333000155", null);

      expect(resolveCustomerIdGroup(db, "28cbc2e5").sort()).toEqual([
        "28cbc2e5",
        "omie_11488403507"
      ]);
      expect(resolveCustomerIdGroup(db, "omie_11488403507").sort()).toEqual([
        "28cbc2e5",
        "omie_11488403507"
      ]);
      expect(resolveCustomerIdGroup(db, "outro")).toEqual(["outro"]);
    } finally {
      db.close();
    }
  });

  it("inclui o cadastro desativado e o excluido", () => {
    const db = createDatabase();
    try {
      // Desativar o duplicado e o caminho normal quando alguem percebe a repeticao — e as
      // pesagens antigas continuam apontando para ele.
      insertCustomer(db, "ativo", "06020284000164", null);
      insertCustomer(db, "desativado", "06020284000164", null, { isActive: false });
      insertCustomer(db, "excluido", "06020284000164", null, {
        deletedAt: "2026-08-01T00:00:00.000Z"
      });

      expect(resolveCustomerIdGroup(db, "ativo").sort()).toEqual([
        "ativo",
        "desativado",
        "excluido"
      ]);
    } finally {
      db.close();
    }
  });

  it("cadastro sem documento e sem OMIE nao arrasta os outros iguais a ele", () => {
    const db = createDatabase();
    try {
      insertCustomer(db, "sem-doc-1", null, null);
      insertCustomer(db, "sem-doc-2", null, null);

      expect(resolveCustomerIdGroup(db, "sem-doc-1")).toEqual(["sem-doc-1"]);
    } finally {
      db.close();
    }
  });

  it("id inexistente volta como ele mesmo, sem quebrar a consulta", () => {
    const db = createDatabase();
    try {
      expect(resolveCustomerIdGroup(db, "nunca-existiu")).toEqual(["nunca-existiu"]);
    } finally {
      db.close();
    }
  });
});

describe("identityKeyForOperation", () => {
  it("os dois cadastros do mesmo cliente caem na mesma chave", () => {
    const db = createDatabase();
    try {
      insertCustomer(db, "omie_1", "06020284000164", 1);
      insertCustomer(db, "local-1", "06020284000164", 1);
      const index = buildCustomerIdentityIndex(db);

      expect(identityKeyForOperation(index, "omie_1")).toBe(
        identityKeyForOperation(index, "local-1")
      );
    } finally {
      db.close();
    }
  });

  it("operacao sem cliente, ou com cadastro que sumiu, responde por si mesma", () => {
    const db = createDatabase();
    try {
      const index = buildCustomerIdentityIndex(db);
      // Cadastro que sumiu: o id ainda distingue um cliente do outro.
      expect(identityKeyForOperation(index, "sumiu-a")).not.toBe(
        identityKeyForOperation(index, "sumiu-b")
      );
      // Sem cliente nenhum: nao ha o que distinguir, todas caem no mesmo "Sem cliente".
      expect(identityKeyForOperation(index, null)).toBe(identityKeyForOperation(index, ""));
    } finally {
      db.close();
    }
  });
});
