import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  listClosedOperationsNeedingOmieAttention,
  listClosedWeighingOperations,
  OMIE_ATTENTION_BILLING_STATUSES
} from "../services/weighing-operations";
import { getFiscalBillingStatus } from "./App";
import type { DesktopDatabase } from "../database/sqlite";

/**
 * O alerta do topo da aba Concluidas deixou de varrer a lista INTEIRA em memoria e passou
 * a partir de um recorte em SQL (`listClosedOperationsNeedingOmieAttention`).
 *
 * Quem decide o tom continua sendo `getFiscalBillingStatus`, com seus nove ramos -- o SQL
 * so estreita o conjunto sobre o qual ela roda. Este teste e a prova de que estreitar nao
 * perde nada: ele monta uma operacao para CADA combinacao de status fiscal x tipo x
 * presenca de pedido/OS, aplica a funcao de verdade e exige que toda operacao em
 * `warning` ou `danger` esteja no recorte.
 *
 * Se alguem adicionar um ramo `warning`/`danger` novo a funcao sem incluir o status
 * correspondente em `OMIE_ATTENTION_BILLING_STATUSES`, o alerta sumiria da tela em
 * silencio -- e este teste quebra antes disso.
 */
describe("recorte do alerta fiscal e superconjunto do que a tela marca", () => {
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

    const stmt = database.prepare(
      `INSERT INTO weighing_operations
        (id, company_id, unit_id, device_id, operation_code, status, operation_type,
         remote_customer_name, remote_plate, remote_driver_name, remote_product_description,
         net_weight_kg, total_cents, omie_billing_status, omie_billing_message,
         omie_sales_order_id, omie_service_order_id,
         exit_weight_captured_at, created_at, updated_at)
       VALUES (?, 'c1', 'u1', 'd1', ?, 'closed_local', ?, 'Cliente', 'ABC1D23', 'Motorista',
               'Brita 1', 25000, 150000, ?, ?, ?, ?, ?, ?, ?)`
    );

    let n = 0;
    for (const billing of STATUS_FISCAIS) {
      for (const tipo of TIPOS) {
        for (const [pedido, os] of PEDIDOS) {
          n += 1;
          const quando = `2026-08-01T10:${String(n % 60).padStart(2, "0")}:00.000Z`;
          stmt.run(`op-${n}`, n, tipo, billing, null, pedido, os, quando, quando, quando);
        }
      }
    }
    return database;
  }

  it("toda operacao que a tela marca warning ou danger esta no recorte", () => {
    const database = createDatabase();

    const todas = listClosedWeighingOperations(database);
    const precisamAtencao = todas.filter((operacao) => {
      const tom = getFiscalBillingStatus(operacao).tone;
      return tom === "warning" || tom === "danger";
    });
    const recorte = listClosedOperationsNeedingOmieAttention(database);
    const idsNoRecorte = new Set(recorte.map((o) => o.id));

    // O cenario precisa ter casos dos dois tons, senao o teste passaria vazio.
    expect(precisamAtencao.length).toBeGreaterThan(0);
    expect(precisamAtencao.some((o) => getFiscalBillingStatus(o).tone === "warning")).toBe(true);
    expect(precisamAtencao.some((o) => getFiscalBillingStatus(o).tone === "danger")).toBe(true);

    const perdidas = precisamAtencao.filter((o) => !idsNoRecorte.has(o.id));
    expect(
      perdidas.map((o) => ({
        id: o.id,
        billing: o.omieBillingStatus,
        tipo: o.operationType,
        tom: getFiscalBillingStatus(o).tone
      }))
    ).toEqual([]);
    database.close();
  });

  it("aplicar a funcao no recorte da o MESMO resultado de varrer a lista inteira", () => {
    const database = createDatabase();

    const porListaInteira = listClosedWeighingOperations(database).filter((o) => {
      const tom = getFiscalBillingStatus(o).tone;
      return tom === "warning" || tom === "danger";
    });
    const porRecorte = listClosedOperationsNeedingOmieAttention(database).filter((o) => {
      const tom = getFiscalBillingStatus(o).tone;
      return tom === "warning" || tom === "danger";
    });

    expect(porRecorte).toEqual(porListaInteira);
    database.close();
  });

  it("o recorte nao depende de status fiscal desconhecido dar warning", () => {
    // Documenta a invariante que sustenta o recorte: os unicos status que produzem
    // warning/danger sao os tres listados. Um status novo que precisasse de alerta
    // teria de entrar nesta lista -- e o primeiro teste falha se nao entrar.
    const database = createDatabase();
    const comAtencao = new Set(
      listClosedWeighingOperations(database)
        .filter((o) => {
          const tom = getFiscalBillingStatus(o).tone;
          return tom === "warning" || tom === "danger";
        })
        .map((o) => o.omieBillingStatus)
    );

    for (const status of comAtencao) {
      expect(OMIE_ATTENTION_BILLING_STATUSES).toContain(status);
    }
    database.close();
  });
});
