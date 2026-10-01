import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { resolveSituation } from "../services/weighing-billing-situation";
import {
  listClosedOperationsNotInOmie,
  listClosedWeighingOperations,
  OMIE_ATTENTION_BILLING_STATUSES
} from "../services/weighing-operations";
import { getFiscalBillingStatus } from "./App";
import type { DesktopDatabase } from "../database/sqlite";
import type { WeighingOperationSummary } from "../services/weighing-operations";

/**
 * O aviso do topo da tela Operacoes ("nao enviadas ao OMIE") parte de um recorte em SQL
 * (`listClosedOperationsNotInOmie`), enquanto a coluna Fiscal OMIE da tabela le a mesma
 * operacao por `getFiscalBillingStatus`. Se os dois divergissem, o aviso diria "tudo
 * enviado" com a linha da tabela ainda cinza -- ou o contrario.
 *
 * Este teste monta uma operacao para CADA combinacao de status fiscal x tipo x presenca de
 * pedido/OS e exige que o recorte seja EXATAMENTE o conjunto que a tela nao pinta de verde.
 */
describe("recorte das concluidas que nao chegaram ao OMIE", () => {
  const STATUS_FISCAIS = [
    null,
    "pending",
    "billed",
    "failed",
    "cadastro_incompleto",
    "service_order_failed",
    "valor_zerado",
    "qualquer_coisa_nova"
  ];
  const TIPOS = ["invoice", "internal"];
  const PEDIDOS: Array<[number | null, number | null]> = [
    [null, null],
    [12345, null],
    [null, 67890],
    [12345, 67890]
  ];

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

  function insertOperation(
    database: DesktopDatabase,
    input: {
      id: string;
      code: number;
      status?: string;
      tipo: string;
      billing: string | null;
      pedido: number | null;
      os: number | null;
      quando: string;
      deletedAt?: string | null;
    }
  ): void {
    database
      .prepare(
        `INSERT INTO weighing_operations
          (id, company_id, unit_id, device_id, operation_code, status, operation_type,
           remote_customer_name, remote_plate, remote_driver_name, remote_product_description,
           net_weight_kg, total_cents, omie_billing_status, omie_billing_message,
           omie_sales_order_id, omie_service_order_id,
           exit_weight_captured_at, created_at, updated_at, deleted_at)
         VALUES (?, 'c1', 'u1', 'd1', ?, ?, ?, 'Cliente', 'ABC1D23', 'Motorista',
                 'Brita 1', 25000, 150000, ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.code,
        input.status ?? "closed_local",
        input.tipo,
        input.billing,
        input.pedido,
        input.os,
        input.quando,
        input.quando,
        input.quando,
        input.deletedAt ?? null
      );
  }

  function seedCombinations(database: DesktopDatabase): void {
    let n = 0;
    for (const billing of STATUS_FISCAIS) {
      for (const tipo of TIPOS) {
        for (const [pedido, os] of PEDIDOS) {
          n += 1;
          const quando = `2026-08-01T10:${String(n % 60).padStart(2, "0")}:00.000Z`;
          insertOperation(database, { id: `op-${n}`, code: n, tipo, billing, pedido, os, quando });
        }
      }
    }
  }

  const naoVerde = (o: WeighingOperationSummary) => getFiscalBillingStatus(o).tone !== "success";

  it("e exatamente o conjunto que a tela nao pinta de verde", () => {
    const database = createDatabase();
    seedCombinations(database);

    const esperado = listClosedWeighingOperations(database)
      .filter(naoVerde)
      .map((o) => o.id)
      .sort();
    const { operations, total } = listClosedOperationsNotInOmie(database);

    // O cenario precisa ter dos dois lados, senao o teste passaria vazio.
    expect(esperado.length).toBeGreaterThan(0);
    expect(esperado.length).toBeLessThan(listClosedWeighingOperations(database).length);
    expect(operations.map((o) => o.id).sort()).toEqual(esperado);
    expect(total).toBe(esperado.length);
    database.close();
  });

  it("bate com a situacao da Conferencia de faturamento", () => {
    // `resolveSituation` e a mesma regra no lado dos relatorios: "pending",
    // "cadastro_incompleto" e "failed" sao justamente o que ainda nao esta no OMIE.
    const database = createDatabase();
    seedCombinations(database);

    for (const operation of listClosedOperationsNotInOmie(database).operations) {
      const situacao = resolveSituation({
        operation_type: operation.operationType,
        omie_sales_order_id: operation.omieSalesOrderId,
        omie_service_order_id: operation.omieServiceOrderId,
        omie_billing_status: operation.omieBillingStatus
      });
      expect(["pending", "cadastro_incompleto", "failed"]).toContain(situacao);
    }
    database.close();
  });

  it("toda operacao que a tela marca warning ou danger tem status de atencao", () => {
    // Sustenta a ordem do aviso (recusadas primeiro): se um ramo novo de warning/danger
    // surgir sem entrar em `OMIE_ATTENTION_BILLING_STATUSES`, ele iria para o fim da lista.
    const database = createDatabase();
    seedCombinations(database);

    const comAtencao = listClosedWeighingOperations(database).filter((o) => {
      const tom = getFiscalBillingStatus(o).tone;
      return tom === "warning" || tom === "danger";
    });
    expect(comAtencao.length).toBeGreaterThan(0);
    for (const operation of comAtencao) {
      expect(OMIE_ATTENTION_BILLING_STATUSES).toContain(operation.omieBillingStatus);
    }
    database.close();
  });

  it("poe as que precisam do operador primeiro e, dentro de cada grupo, a mais recente", () => {
    const database = createDatabase();
    insertOperation(database, {
      id: "pendente-antiga",
      code: 1,
      tipo: "invoice",
      billing: null,
      pedido: null,
      os: null,
      quando: "2026-08-01T08:00:00.000Z"
    });
    insertOperation(database, {
      id: "pendente-nova",
      code: 2,
      tipo: "invoice",
      billing: null,
      pedido: null,
      os: null,
      quando: "2026-08-01T12:00:00.000Z"
    });
    insertOperation(database, {
      id: "recusada-antiga",
      code: 3,
      tipo: "invoice",
      billing: "failed",
      pedido: null,
      os: null,
      quando: "2026-08-01T07:00:00.000Z"
    });

    expect(listClosedOperationsNotInOmie(database).operations.map((o) => o.id)).toEqual([
      "recusada-antiga",
      "pendente-nova",
      "pendente-antiga"
    ]);
    database.close();
  });

  it("o limite encurta a lista mas o total continua contando todas", () => {
    const database = createDatabase();
    for (let n = 1; n <= 5; n += 1) {
      insertOperation(database, {
        id: `op-${n}`,
        code: n,
        tipo: "internal",
        billing: null,
        pedido: null,
        os: null,
        quando: `2026-08-01T10:0${n}:00.000Z`
      });
    }

    const { operations, total } = listClosedOperationsNotInOmie(database, 2);
    expect(operations).toHaveLength(2);
    expect(total).toBe(5);
    database.close();
  });

  it("deixa de fora aberta, cancelada e concluida excluida da lista", () => {
    const database = createDatabase();
    const base = { tipo: "invoice", billing: null, pedido: null, os: null };
    insertOperation(database, {
      ...base,
      id: "aberta",
      code: 1,
      status: "entry_registered",
      quando: "2026-08-01T10:00:00.000Z"
    });
    insertOperation(database, {
      ...base,
      id: "cancelada",
      code: 2,
      status: "cancelled",
      quando: "2026-08-01T10:01:00.000Z"
    });
    insertOperation(database, {
      ...base,
      id: "excluida",
      code: 3,
      quando: "2026-08-01T10:02:00.000Z",
      deletedAt: "2026-08-01T11:00:00.000Z"
    });
    insertOperation(database, {
      ...base,
      id: "fechada",
      code: 4,
      quando: "2026-08-01T10:03:00.000Z"
    });

    const { operations, total } = listClosedOperationsNotInOmie(database);
    expect(operations.map((o) => o.id)).toEqual(["fechada"]);
    expect(total).toBe(1);
    database.close();
  });
});
