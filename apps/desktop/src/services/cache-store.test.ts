import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { CacheStore } from "./cache-store";
import type { DesktopDatabase } from "../database/sqlite";

/**
 * O cache e o motor de TODA busca de cadastro do desktop: os seletores da nova entrada, o
 * modal de troca de cliente/material e as telas de cadastro chegam aqui pelo mesmo
 * `query()`. O que estes testes fixam e o que o operador enxerga: a ordem da lista, o corte
 * honesto e o filtro por vinculo.
 */
describe("cache store query", () => {
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

  function insertCustomer(
    database: DesktopDatabase,
    id: string,
    tradeName: string,
    options: { legalName?: string; document?: string; city?: string } = {}
  ): void {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, city, is_active, created_at, updated_at)
         VALUES (?, 'company-1', 'local', ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
      )
      .run(
        id,
        options.legalName ?? tradeName,
        tradeName,
        options.document ?? null,
        options.city ?? null
      );
  }

  function loadedStore(database: DesktopDatabase): CacheStore {
    const store = new CacheStore(database);
    store.loadAll("company-1");
    return store;
  }

  it("poe no topo o cadastro que mais se aproxima do que foi digitado", () => {
    const database = createDatabase();
    try {
      // Inseridos ao contrario da ordem esperada de proposito: sem pontuacao, a lista sairia
      // na ordem de insercao do banco — que foi o que fez o operador rolar atras da Levisa.
      insertCustomer(database, "c1", "Transportadora Levisa Norte");
      insertCustomer(database, "c2", "Levisa Transportes e Locacoes");
      insertCustomer(database, "c3", "Levisa");
      insertCustomer(database, "c4", "Pedreira Sul");

      const result = loadedStore(database).query({ entityType: "customer", search: "levisa" });

      expect(result.rows.map((row) => row.id)).toEqual(["c3", "c2", "c1"]);
      expect(result.total).toBe(3);
    } finally {
      database.close();
    }
  });

  it("em repouso a lista sai em ordem alfabetica, e nao na de insercao", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, "c1", "Zeta");
      insertCustomer(database, "c2", "Alfa");
      insertCustomer(database, "c3", "Meia Encosta");

      const result = loadedStore(database).query({ entityType: "customer" });

      expect(result.rows.map((row) => row.tradeName)).toEqual(["Alfa", "Meia Encosta", "Zeta"]);
    } finally {
      database.close();
    }
  });

  it("total conta o que casou, nao o que coube no limite", () => {
    const database = createDatabase();
    try {
      for (let index = 0; index < 12; index += 1) {
        insertCustomer(database, `c${index}`, `Pedreira ${String(index).padStart(2, "0")}`);
      }

      const result = loadedStore(database).query({
        entityType: "customer",
        search: "pedreira",
        limit: 5
      });

      // E esta diferenca que a tela usa para dizer "mostrando 5 de 12" em vez de esconder
      // o corte e deixar o operador achar que o cadastro nao existe.
      expect(result.rows).toHaveLength(5);
      expect(result.total).toBe(12);
    } finally {
      database.close();
    }
  });

  it("o filtro por vinculo vale ANTES do corte", () => {
    const database = createDatabase();
    try {
      for (let index = 0; index < 30; index += 1) {
        insertCustomer(database, `c${index}`, `Cliente ${String(index).padStart(2, "0")}`);
      }

      // O vinculado esta no fim da ordem alfabetica: aplicado depois do corte, ele sumia do
      // seletor sem aviso e o operador concluia que o vinculo nao existia.
      const result = loadedStore(database).query({
        entityType: "customer",
        ids: ["c29"],
        limit: 5
      });

      expect(result.rows.map((row) => row.id)).toEqual(["c29"]);
      expect(result.total).toBe(1);
    } finally {
      database.close();
    }
  });

  it("ids vazio nao devolve nada — e diferente de nao filtrar", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, "c1", "Alfa");

      expect(loadedStore(database).query({ entityType: "customer", ids: [] }).total).toBe(0);
      expect(loadedStore(database).query({ entityType: "customer" }).total).toBe(1);
    } finally {
      database.close();
    }
  });

  it("o campo principal pesa mais que o de apoio", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, "c1", "Levisa", { city: "Sorocaba" });
      insertCustomer(database, "c2", "Sorocaba Mineracao", { city: "Ibiuna" });

      const result = loadedStore(database).query({ entityType: "customer", search: "sorocaba" });

      // Quem se CHAMA Sorocaba vem antes de quem apenas FICA em Sorocaba.
      expect(result.rows.map((row) => row.id)).toEqual(["c2", "c1"]);
    } finally {
      database.close();
    }
  });

  it("acha o documento digitado com pontuacao e sem ela", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, "c1", "Levisa", { document: "12345678000190" });
      insertCustomer(database, "c2", "Outro", { document: "98765432000155" });

      const store = loadedStore(database);
      expect(store.query({ entityType: "customer", search: "12.345.678/0001-90" }).rows[0].id).toBe(
        "c1"
      );
      expect(store.query({ entityType: "customer", search: "12345678000190" }).rows[0].id).toBe(
        "c1"
      );
    } finally {
      database.close();
    }
  });

  it("digitar mais termos so pode diminuir a lista", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, "c1", "Joao Silva Transportes");
      insertCustomer(database, "c2", "Joao Pedro Cargas");
      insertCustomer(database, "c3", "Maria Silva Ltda");

      const store = loadedStore(database);
      expect(store.query({ entityType: "customer", search: "joao" }).total).toBe(2);
      expect(store.query({ entityType: "customer", search: "joao silva" }).total).toBe(1);
      // A ordem dos termos nao importa: o operador lembra o nome como lembra.
      expect(store.query({ entityType: "customer", search: "silva joao" }).total).toBe(1);
    } finally {
      database.close();
    }
  });

  it("a placa e achada com ou sem o traco", () => {
    const database = createDatabase();
    try {
      database
        .prepare(
          `INSERT INTO vehicles (id, company_id, plate, is_active, created_at, updated_at)
           VALUES ('v1', 'company-1', 'ABC1D23', 1, datetime('now'), datetime('now'))`
        )
        .run();

      const store = loadedStore(database);
      expect(store.query({ entityType: "vehicle", search: "ABC-1D23" }).total).toBe(1);
      expect(store.query({ entityType: "vehicle", search: "abc1d23" }).total).toBe(1);
    } finally {
      database.close();
    }
  });
});
