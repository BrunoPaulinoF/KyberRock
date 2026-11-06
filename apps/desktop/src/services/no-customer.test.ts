import { describe, expect, it } from "vitest";

import {
  NO_CUSTOMER_BILLING_STATUS,
  noCustomerExplosiveProductIdFor,
  noCustomerIdFor
} from "@kyberrock/shared";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { CacheStore } from "./cache-store";
import type { CustomerRow } from "./customers";
import { checkCustomerOmieReadiness } from "./omie-customer-readiness";
import { PricingService } from "./pricing";
import { listProductDefaultPriceSummaries } from "./product-prices";
import { upsertCloudCustomers, upsertCloudProducts } from "./supabase-sync";
import { resolveSituation } from "./weighing-billing-situation";
import {
  buildOmieBillingJob,
  closeWeighingOperation,
  createWeighingOperation,
  getOperationOmieIssue,
  listClosedOperationsNotInOmie,
  updateWeighingOperationCustomer,
  updateWeighingOperationProduct
} from "./weighing-operations";

/**
 * Pedreira Ibiuna: caminhao que so passa pela balanca (transporte interno, caminhao da
 * propria pedreira) precisava de um cliente "que nao e cliente nenhum". A pesagem tem que
 * passar sem preco, sem cadastro do OMIE e sem virar pedido la.
 */
describe("cadastro SEM CLIENTE", () => {
  it("chega da nuvem como um cliente comum, fora do envio ao OMIE", () => {
    const database = createDatabase();
    try {
      createIdentity(database);
      const carriersBefore = countRows(database, "carriers");

      const customer = receiveNoCustomerFromCloud(database);

      expect(customer.id).toBe(noCustomerIdFor("company-1"));
      expect(customer.trade_name).toBe("SEM CLIENTE");
      expect(customer.is_active).toBe(1);
      // needs_push = 0: o envio de cadastro ao OMIE nunca o pega.
      expect(customer.needs_push).toBe(0);
      expect(customer.nf_required).toBe(0);
      expect(countRows(database, "carriers")).toBe(carriersBefore);
    } finally {
      database.close();
    }
  });

  it("nao cobra cadastro do OMIE nem preco na entrada", () => {
    const database = createDatabase();
    try {
      createIdentity(database);
      const id = receiveNoCustomerFromCloud(database).id;
      insertCatalog(database);

      expect(checkCustomerOmieReadiness(database, id, "invoice")).toMatchObject({ ready: true });
      // O produto nao tem preco nenhum cadastrado: para um cliente de verdade a entrada seria
      // recusada. Para o SEM CLIENTE ela sai a zero.
      expect(
        new PricingService(database).getPriceDetailsForCustomerProduct(id, "product-1")
      ).toMatchObject({ appliedUnitPriceCents: 0, source: "no_customer" });
    } finally {
      database.close();
    }
  });

  it("fecha a pesagem sem valor, sem pedido no OMIE e fora da lista de pendentes", () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      const customerId = receiveNoCustomerFromCloud(database).id;
      insertCatalog(database);

      const opened = createWeighingOperation(database, {
        identity,
        customerId,
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      const closed = closeWeighingOperation(database, {
        operationId: opened.id,
        exitWeightKg: 30_000
      });

      expect(closed.netWeightKg).toBe(18_000);
      expect(closed.totalCents).toBe(0);
      expect(closed.omieBillingStatus).toBe(NO_CUSTOMER_BILLING_STATUS);

      const omieJobs = database
        .prepare("SELECT COUNT(*) AS total FROM sync_queue WHERE target = 'omie'")
        .get() as { total: number };
      expect(omieJobs.total).toBe(0);
      // Nem Refaturar/Reenviar nem o rearme da fila conseguem montar um pedido para ela.
      expect(buildOmieBillingJob(database, opened.id)).toBeNull();

      expect(listClosedOperationsNotInOmie(database).total).toBe(0);
      expect(getOperationOmieIssue(database, opened.id)).toMatchObject({
        pending: false,
        blocked: false,
        reasonLabel: "Sem cliente"
      });

      expect(
        resolveSituation({
          operation_type: "invoice",
          omie_sales_order_id: null,
          omie_service_order_id: null,
          omie_billing_status: closed.omieBillingStatus ?? null
        })
      ).toBe("no_customer");

      // A pesagem continua subindo para a nuvem normalmente.
      const cloudJobs = database
        .prepare(
          "SELECT COUNT(*) AS total FROM sync_queue WHERE target = 'cloud' AND entity_id = ?"
        )
        .get(opened.id) as { total: number };
      expect(cloudJobs.total).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });
});

/**
 * Pedreira Ibiuna, 28/10/2026: pesar o caminhao de explosivo e tirar o ticket com o peso, sem
 * valor, para arquivar com a documentacao da detonacao. O cliente e o SEM CLIENTE; o produto e
 * o EXPLOSIVO, que nao existe no OMIE e chega da nuvem.
 */
describe("produto EXPLOSIVO", () => {
  it("chega da nuvem e so aparece na lista de produto com o SEM CLIENTE", () => {
    const database = createDatabase();
    try {
      createIdentity(database);
      insertCatalog(database);
      const explosiveId = receiveExplosiveFromCloud(database);

      const store = new CacheStore(database);
      store.loadAll("company-1");
      const ids = (includeNoCustomerOnlyProducts: boolean) =>
        store
          .query({
            entityType: "product",
            productFiscalType: "finished_goods",
            includeNoCustomerOnlyProducts
          })
          .rows.map((row) => (row as { id: string }).id);

      expect(ids(true)).toEqual(expect.arrayContaining(["product-1", explosiveId]));
      expect(ids(false)).toEqual(["product-1"]);
      // Nao tem preco a cadastrar: fica fora da tela de precos.
      expect(
        listProductDefaultPriceSummaries(database, "company-1").map((row) => row.productId)
      ).not.toContain(explosiveId);
    } finally {
      database.close();
    }
  });

  it("pesa com o SEM CLIENTE: ticket com o peso, sem valor e sem OMIE", () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      const customerId = receiveNoCustomerFromCloud(database).id;
      insertCatalog(database);
      const explosiveId = receiveExplosiveFromCloud(database);

      const opened = createWeighingOperation(database, {
        identity,
        customerId,
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: explosiveId,
        entryWeightKg: 9_000
      });
      const closed = closeWeighingOperation(database, {
        operationId: opened.id,
        exitWeightKg: 6_500
      });

      expect(closed.productDescription).toBe("EXPLOSIVO");
      expect(closed.netWeightKg).toBe(2_500);
      expect(closed.totalCents).toBe(0);
      expect(closed.omieBillingStatus).toBe(NO_CUSTOMER_BILLING_STATUS);
      expect(buildOmieBillingJob(database, opened.id)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("recusa o EXPLOSIVO com cliente de verdade, na entrada e nas trocas", () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      const noCustomerId = receiveNoCustomerFromCloud(database).id;
      insertCatalog(database);
      const explosiveId = receiveExplosiveFromCloud(database);
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, sync_status, created_at, updated_at)
           VALUES ('cliente-1', 'company-1', 'local', 'Cliente Real', 'Cliente Real', 'synced', datetime('now'), datetime('now'))`
        )
        .run();

      expect(() =>
        createWeighingOperation(database, {
          identity,
          customerId: "cliente-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: explosiveId,
          entryWeightKg: 9_000
        })
      ).toThrow("so para registro");

      const opened = createWeighingOperation(database, {
        identity,
        customerId: noCustomerId,
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: explosiveId,
        entryWeightKg: 9_000
      });
      // Trocar o cliente de uma pesagem de EXPLOSIVO por um cliente de verdade.
      expect(() =>
        updateWeighingOperationCustomer(database, {
          operationId: opened.id,
          newCustomerId: "cliente-1"
        })
      ).toThrow("so para registro");
      // E o caminho de volta: SEM CLIENTE pode trocar para um produto de venda.
      expect(
        updateWeighingOperationProduct(database, {
          operationId: opened.id,
          newProductId: "product-1"
        }).productId
      ).toBe("product-1");
    } finally {
      database.close();
    }
  });
});

/** A linha que a migracao `202611060001_produto_explosivo` grava na nuvem, chegando pelo pull. */
function receiveExplosiveFromCloud(database: DesktopDatabase): string {
  const id = noCustomerExplosiveProductIdFor("company-1");
  upsertCloudProducts(database, "company-1", [
    {
      id,
      company_id: "company-1",
      omie_product_id: null,
      code: "EXPLOSIVO",
      description: "EXPLOSIVO",
      unit: "T",
      is_active: true,
      created_at: "2026-11-06T12:00:00.000Z",
      updated_at: "2026-11-06T12:00:00.000Z"
    }
  ]);
  return id;
}

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}

function createIdentity(database: DesktopDatabase) {
  return ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "Pedreira Teste LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
}

/**
 * A linha que a migracao `202610300001_cadastro_sem_cliente` grava na nuvem, chegando pelo
 * pull de cadastro — e assim que o SEM CLIENTE aparece na balanca.
 */
function receiveNoCustomerFromCloud(database: DesktopDatabase): CustomerRow {
  const id = noCustomerIdFor("company-1");
  upsertCloudCustomers(database, "company-1", [
    {
      id,
      company_id: "company-1",
      omie_customer_id: null,
      legal_name: "SEM CLIENTE",
      trade_name: "SEM CLIENTE",
      document: null,
      is_active: true,
      nf_required: false,
      credit_mode: "normal",
      credit_account_enabled: false,
      credit_periodicity: "monthly",
      commercial_published_at: "2026-10-30T12:00:00.000Z",
      created_at: "2026-10-30T12:00:00.000Z",
      updated_at: "2026-10-30T12:00:00.000Z",
      deleted_at: null
    }
  ]);
  return database.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
}

/** Placa, motorista e um produto acabado SEM preco nenhum (nem padrao, nem especial). */
function insertCatalog(database: DesktopDatabase): void {
  const now = "2026-10-30T12:00:00.000Z";
  database
    .prepare(
      "INSERT INTO vehicles (id, company_id, plate, created_at, updated_at) VALUES ('vehicle-1', 'company-1', 'ABC1D23', ?, ?)"
    )
    .run(now, now);
  database
    .prepare(
      "INSERT INTO drivers (id, company_id, name, created_at, updated_at) VALUES ('driver-1', 'company-1', 'Motorista Teste', ?, ?)"
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO products (
        id, company_id, omie_product_id, code, description, unit, item_type, created_at, updated_at
      ) VALUES ('product-1', 'company-1', 123, 'BRITA1', 'Brita 1', 'ton', '04 - Produtos Acabados', ?, ?)`
    )
    .run(now, now);
}

function countRows(database: DesktopDatabase, table: "customers" | "carriers"): number {
  return (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
    .total;
}
