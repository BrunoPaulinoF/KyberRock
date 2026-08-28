import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  countClosedWeighingOperations,
  listClosedOperationProductDescriptions,
  listClosedWeighingOperations,
  listClosedWeighingOperationsUpdatedSince
} from "./weighing-operations";
import type { DesktopDatabase } from "../database/sqlite";

/**
 * A listagem de concluidas passou a aceitar pagina e filtro em SQL, e ganhou consultas
 * dedicadas para o que antes exigia a lista INTEIRA em memoria (o alerta fiscal, o seletor
 * de produtos, os numeros do painel).
 *
 * O que estes testes travam: a chamada sem opcoes continua devolvendo tudo, na mesma ordem
 * de antes; a pagina e um recorte exato dessa mesma lista; e o recorte do alerta e um
 * SUPERCONJUNTO -- se ele estreitar demais, o alerta some da tela em silencio.
 */
describe("paginacao das operacoes concluidas", () => {
  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database.pragma("foreign_keys = OFF");
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('c1', 'K LTDA', 'K', datetime('now'), datetime('now'))`
      )
      .run();
    database
      .prepare(
        `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
         VALUES ('u1', 'c1', 'Unidade', 'America/Sao_Paulo', datetime('now'), datetime('now'))`
      )
      .run();
    return database;
  }

  interface Semente {
    id: string;
    produto: string;
    fechadaEm: string;
    status?: string;
    billing?: string | null;
    tipo?: string;
  }

  function inserir(database: DesktopDatabase, sementes: Semente[]): void {
    const stmt = database.prepare(
      `INSERT INTO weighing_operations
        (id, company_id, unit_id, device_id, operation_code, status, operation_type,
         remote_customer_name, remote_plate, remote_driver_name, remote_product_description,
         net_weight_kg, total_cents, omie_billing_status,
         exit_weight_captured_at, created_at, updated_at)
       VALUES (?, 'c1', 'u1', 'd1', ?, ?, ?, ?, ?, ?, ?, 25000, 150000, ?, ?, ?, ?)`
    );
    sementes.forEach((s, i) => {
      stmt.run(
        s.id,
        i + 1,
        s.status ?? "closed_local",
        s.tipo ?? "invoice",
        `Cliente ${i}`,
        `ABC${String(i).padStart(4, "0")}`,
        `Motorista ${i}`,
        s.produto,
        s.billing ?? null,
        s.fechadaEm,
        s.fechadaEm,
        s.fechadaEm
      );
    });
  }

  function seed(database: DesktopDatabase, quantidade = 10): void {
    inserir(
      database,
      Array.from({ length: quantidade }, (_, i) => ({
        id: `op-${String(i).padStart(3, "0")}`,
        produto: `Brita ${i % 3}`,
        fechadaEm: `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`
      }))
    );
  }

  it("sem opcoes continua devolvendo tudo, na mesma ordem", () => {
    const database = createDatabase();
    seed(database, 10);

    const todas = listClosedWeighingOperations(database);

    expect(todas).toHaveLength(10);
    // Da mais recente para a mais antiga, pela data em que a pesagem fechou.
    expect(todas.map((o) => o.id)).toEqual([
      "op-009",
      "op-008",
      "op-007",
      "op-006",
      "op-005",
      "op-004",
      "op-003",
      "op-002",
      "op-001",
      "op-000"
    ]);
    database.close();
  });

  it("a pagina e um recorte exato da lista inteira", () => {
    const database = createDatabase();
    seed(database, 10);
    const todas = listClosedWeighingOperations(database);

    expect(listClosedWeighingOperations(database, { limit: 4 })).toEqual(todas.slice(0, 4));
    expect(listClosedWeighingOperations(database, { limit: 4, offset: 4 })).toEqual(
      todas.slice(4, 8)
    );
    expect(listClosedWeighingOperations(database, { limit: 4, offset: 8 })).toEqual(
      todas.slice(8, 12)
    );
    // Pedir alem do fim nao inventa linha nem quebra.
    expect(listClosedWeighingOperations(database, { limit: 4, offset: 99 })).toEqual([]);
    database.close();
  });

  it("filtra por produto do jeito que a tela mostra, inclusive o espelhado", () => {
    const database = createDatabase();
    seed(database, 9);

    const brita1 = listClosedWeighingOperations(database, { productDescription: "Brita 1" });

    expect(brita1).toHaveLength(3);
    expect(brita1.every((o) => o.productDescription === "Brita 1")).toBe(true);
    // Mesma resposta que filtrar a lista inteira em memoria -- que e o que a tela fazia.
    const emMemoria = listClosedWeighingOperations(database).filter(
      (o) => o.productDescription === "Brita 1"
    );
    expect(brita1).toEqual(emMemoria);
    database.close();
  });

  it("o filtro de produto vale junto com a pagina", () => {
    const database = createDatabase();
    seed(database, 9);
    const doProduto = listClosedWeighingOperations(database, { productDescription: "Brita 0" });

    expect(
      listClosedWeighingOperations(database, { productDescription: "Brita 0", limit: 2 })
    ).toEqual(doProduto.slice(0, 2));
    database.close();
  });

  it("a contagem bate com o tamanho da lista, com e sem filtro", () => {
    const database = createDatabase();
    seed(database, 9);

    expect(countClosedWeighingOperations(database)).toBe(
      listClosedWeighingOperations(database).length
    );
    expect(countClosedWeighingOperations(database, { productDescription: "Brita 2" })).toBe(
      listClosedWeighingOperations(database, { productDescription: "Brita 2" }).length
    );
    database.close();
  });

  it("nao conta nem lista operacao apagada ou em andamento", () => {
    const database = createDatabase();
    seed(database, 5);
    inserir(database, [
      {
        id: "aberta",
        produto: "Brita 9",
        fechadaEm: "2026-09-01T10:00:00.000Z",
        status: "entry_registered"
      },
      {
        id: "cancelada",
        produto: "Brita 9",
        fechadaEm: "2026-09-02T10:00:00.000Z",
        status: "cancelled"
      }
    ]);
    database
      .prepare("UPDATE weighing_operations SET deleted_at = datetime('now') WHERE id = 'op-000'")
      .run();

    const ids = listClosedWeighingOperations(database).map((o) => o.id);
    expect(ids).not.toContain("aberta");
    expect(ids).not.toContain("cancelada");
    expect(ids).not.toContain("op-000");
    expect(countClosedWeighingOperations(database)).toBe(ids.length);
    // E o seletor de produtos nao oferece produto que so existe nelas.
    expect(listClosedOperationProductDescriptions(database)).not.toContain("Brita 9");
    database.close();
  });

  it("o seletor de produtos traz os distintos, em ordem", () => {
    const database = createDatabase();
    seed(database, 9);

    expect(listClosedOperationProductDescriptions(database)).toEqual([
      "Brita 0",
      "Brita 1",
      "Brita 2"
    ]);
    database.close();
  });

  it("a janela por data traz o periodo e mais os ids pedidos", () => {
    const database = createDatabase();
    seed(database, 10);

    const recentes = listClosedWeighingOperationsUpdatedSince(database, "2026-08-08T00:00:00.000Z");
    expect(recentes.map((o) => o.id)).toEqual(["op-009", "op-008", "op-007"]);

    // O id explicito entra mesmo estando fora da janela -- e o que torna o aviso de
    // envio ao OMIE exato: a operacao que estava pendente continua visivel no ciclo
    // em que ela muda de estado.
    const comAntiga = listClosedWeighingOperationsUpdatedSince(
      database,
      "2026-08-08T00:00:00.000Z",
      ["op-000"]
    );
    expect(comAntiga.map((o) => o.id)).toEqual(["op-009", "op-008", "op-007", "op-000"]);

    // Id repetido nao duplica linha.
    expect(
      listClosedWeighingOperationsUpdatedSince(database, "2026-08-08T00:00:00.000Z", [
        "op-000",
        "op-000",
        "op-009"
      ]).map((o) => o.id)
    ).toEqual(["op-009", "op-008", "op-007", "op-000"]);
    database.close();
  });
});
