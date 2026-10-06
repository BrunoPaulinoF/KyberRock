import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { PRICE_MASTER_DEVICE_IDS_KEY } from "./price-authority";
import {
  pullDesktopDataFromCloud,
  pushSharedCadastroToCloud,
  resetSharedCadastroPushState,
  upsertCloudCreditMovements
} from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

/**
 * O resto do cadastro que pendura no cliente ou na transportadora gemea.
 *
 * O cliente (e a transportadora) com dois cadastros na nuvem fica com um so em cada balanca. Ate
 * aqui, o que a outra balanca cadastrou pendurado no gemeo — vinculo com transportadora, placa,
 * preco especial, frete, nota de entrega futura, tabela de preco, extrato de credito — era
 * descartado nesta maquina. Agora entra com o cadastro equivalente daqui, e volta para a nuvem
 * com o id que ela tem (sem isso o eco repetiria um par unico la e derrubaria o lote).
 */
const CUSTOMER_DOCUMENT = "12.345.678/0001-95";
const CARRIER_DOCUMENT = "11.222.333/0001-81";
const CUSTOMER_TWIN = "omie_11488403507";
const CARRIER_TWIN = "omie_supplier_42";
const AT = "2026-09-10T12:00:00.000Z";

describe("cadastro pendurado no gemeo", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("vinculo cliente-transportadora dos gemeos entra com os cadastros daqui e volta com os da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      mockPull({
        ...cloudTwins(),
        customerCarriers: [
          { id: "cc-da-a", customer_id: CUSTOMER_TWIN, carrier_id: CARRIER_TWIN, is_active: true }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare("SELECT customer_id, carrier_id FROM customer_carriers WHERE id = 'cc-da-a'")
          .get()
      ).toEqual({ customer_id: "levisa-b", carrier_id: "transp-b" });

      const sent = await pushedRow(database, identity, "customerCarriers", "cc-da-a");
      expect(sent).toMatchObject({ customer_id: CUSTOMER_TWIN, carrier_id: CARRIER_TWIN });
    } finally {
      database.close();
    }
  });

  it("o vinculo traduzido que repete um par que esta maquina ja tem nao entra", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      database
        .prepare(
          `INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('cc-daqui', 'levisa-b', 'transp-b', 1, ?, ?)`
        )
        .run(AT, AT);
      mockPull({
        ...cloudTwins(),
        customerCarriers: [
          { id: "cc-da-a", customer_id: CUSTOMER_TWIN, carrier_id: CARRIER_TWIN, is_active: true }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare("SELECT id FROM customer_carriers WHERE customer_id = 'levisa-b'")
          .pluck()
          .all()
      ).toEqual(["cc-daqui"]);
    } finally {
      database.close();
    }
  });

  it("motorista, veiculo e placa ligados ao gemeo entram e voltam com os ids da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      mockPull({
        ...cloudTwins(),
        drivers: [{ id: "motorista-a", name: "JOAO", is_active: true, updated_at: AT }],
        vehicles: [
          {
            id: "veiculo-a",
            plate: "ABC1D23",
            carrier_id: CARRIER_TWIN,
            is_active: true,
            updated_at: AT
          }
        ],
        driverCarriers: [
          { id: "dc-a", driver_id: "motorista-a", carrier_id: CARRIER_TWIN, is_active: true }
        ],
        vehicleCarriers: [
          { id: "vc-a", vehicle_id: "veiculo-a", carrier_id: CARRIER_TWIN, is_active: true }
        ],
        customerVehicles: [
          { id: "cv-a", customer_id: CUSTOMER_TWIN, vehicle_id: "veiculo-a", is_active: true }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(column(database, "driver_carriers", "carrier_id", "dc-a")).toBe("transp-b");
      expect(column(database, "vehicle_carriers", "carrier_id", "vc-a")).toBe("transp-b");
      expect(column(database, "customer_vehicles", "customer_id", "cv-a")).toBe("levisa-b");
      expect(column(database, "vehicles", "carrier_id", "veiculo-a")).toBe("transp-b");

      resetSharedCadastroPushState(database);
      await pushSharedCadastroToCloud(database, identity);
      expect(sentRow("driverCarriers", "dc-a")?.carrier_id).toBe(CARRIER_TWIN);
      expect(sentRow("vehicleCarriers", "vc-a")?.carrier_id).toBe(CARRIER_TWIN);
      expect(sentRow("customerVehicles", "cv-a")?.customer_id).toBe(CUSTOMER_TWIN);
      expect(sentRow("vehicles", "veiculo-a")?.carrier_id).toBe(CARRIER_TWIN);
    } finally {
      database.close();
    }
  });

  it("trocar ou tirar a transportadora do veiculo aqui sobe a escolha, nao a gemea", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      insertCarrier(database, "outra-transp", "98.765.432/0001-98");
      mockPull({
        ...cloudTwins(),
        vehicles: [
          {
            id: "v-1",
            plate: "AAA1A11",
            carrier_id: CARRIER_TWIN,
            is_active: true,
            updated_at: AT
          },
          { id: "v-2", plate: "BBB2B22", carrier_id: CARRIER_TWIN, is_active: true, updated_at: AT }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);
      database.prepare("UPDATE vehicles SET carrier_id = 'outra-transp' WHERE id = 'v-1'").run();
      database.prepare("UPDATE vehicles SET carrier_id = NULL WHERE id = 'v-2'").run();

      resetSharedCadastroPushState(database);
      await pushSharedCadastroToCloud(database, identity);

      expect(sentRow("vehicles", "v-1")?.carrier_id).toBe("outra-transp");
      expect(sentRow("vehicles", "v-2")?.carrier_id).toBeNull();
    } finally {
      database.close();
    }
  });

  it("preco, frete, nota de entrega futura e tabela de preco do gemeo entram e voltam com o cliente da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      mockPull({
        ...cloudTwins(),
        products: [{ id: "brita-1", code: "B1", description: "BRITA 1", updated_at: AT }],
        priceTables: [{ id: "tabela-a", name: "TABELA A", is_active: true, updated_at: AT }],
        customerSpecialPrices: [
          {
            id: "preco-a",
            customer_id: CUSTOMER_TWIN,
            product_id: "brita-1",
            unit_price_cents: 9_500,
            unit: "ton",
            is_active: true,
            updated_at: AT
          }
        ],
        customerFreightRules: [
          {
            id: "frete-a",
            customer_id: CUSTOMER_TWIN,
            product_id: null,
            rule_json: { type: "per_ton", baseValueCents: 3_000 },
            is_active: true,
            updated_at: AT
          }
        ],
        customerFutureBillingInvoices: [
          {
            id: "nota-a",
            customer_id: CUSTOMER_TWIN,
            product_id: "brita-1",
            nfe_number: "1234",
            total_weight_kg: 300_000,
            is_active: true,
            updated_at: AT
          }
        ],
        customerPriceTables: [
          {
            id: "vinculo-tabela-a",
            customer_id: CUSTOMER_TWIN,
            price_table_id: "tabela-a",
            is_active: true,
            updated_at: AT
          }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(column(database, "customer_special_prices", "customer_id", "preco-a")).toBe(
        "levisa-b"
      );
      expect(column(database, "customer_freight_rules", "customer_id", "frete-a")).toBe("levisa-b");
      expect(column(database, "customer_future_billing_invoices", "customer_id", "nota-a")).toBe(
        "levisa-b"
      );
      expect(column(database, "customer_price_tables", "customer_id", "vinculo-tabela-a")).toBe(
        "levisa-b"
      );

      resetSharedCadastroPushState(database);
      await pushSharedCadastroToCloud(database, identity);
      expect(sentRow("customerSpecialPrices", "preco-a")?.customer_id).toBe(CUSTOMER_TWIN);
      expect(sentRow("customerFreightRules", "frete-a")?.customer_id).toBe(CUSTOMER_TWIN);
      expect(sentRow("customerFutureBillingInvoices", "nota-a")?.customer_id).toBe(CUSTOMER_TWIN);
      expect(sentRow("customerPriceTables", "vinculo-tabela-a")?.customer_id).toBe(CUSTOMER_TWIN);
    } finally {
      database.close();
    }
  });

  it("sem balanca principal, o preco e a tabela que esta maquina ja tem para o cliente ficam", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      mockPull({
        products: [{ id: "brita-1", code: "B1", description: "BRITA 1", updated_at: AT }],
        priceTables: [
          { id: "tabela-a", name: "TABELA A", is_active: true, updated_at: AT },
          { id: "tabela-b", name: "TABELA B", is_active: true, updated_at: AT }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);
      database
        .prepare(
          `INSERT INTO customer_special_prices
             (id, company_id, customer_id, product_id, unit_price_cents, unit, is_active, created_at, updated_at)
           VALUES ('preco-daqui', 'company-1', 'levisa-b', 'brita-1', 9900, 'ton', 1, ?, ?)`
        )
        .run(AT, AT);
      database
        .prepare(
          `INSERT INTO customer_price_tables
             (id, customer_id, price_table_id, is_active, created_at, updated_at)
           VALUES ('vinculo-daqui', 'levisa-b', 'tabela-b', 1, ?, ?)`
        )
        .run(AT, AT);

      mockPull({
        ...cloudTwins(),
        customerSpecialPrices: [
          {
            id: "preco-a",
            customer_id: CUSTOMER_TWIN,
            product_id: "brita-1",
            unit_price_cents: 9_500,
            is_active: true,
            updated_at: "2026-09-11T12:00:00.000Z"
          }
        ],
        customerPriceTables: [
          {
            id: "vinculo-tabela-a",
            customer_id: CUSTOMER_TWIN,
            price_table_id: "tabela-a",
            is_active: true,
            updated_at: "2026-09-11T12:00:00.000Z"
          }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare(
            `SELECT id, unit_price_cents FROM customer_special_prices
             WHERE customer_id = 'levisa-b' AND deleted_at IS NULL`
          )
          .all()
      ).toEqual([{ id: "preco-daqui", unit_price_cents: 9_900 }]);
      expect(
        database
          .prepare(
            `SELECT id FROM customer_price_tables
             WHERE customer_id = 'levisa-b' AND deleted_at IS NULL`
          )
          .pluck()
          .all()
      ).toEqual(["vinculo-daqui"]);
    } finally {
      database.close();
    }
  });

  it("na balanca secundaria, os precos dos dois gemeos disputam pelo mais recente em qualquer ordem", async () => {
    const twinPrice = {
      id: "preco-a",
      customer_id: CUSTOMER_TWIN,
      product_id: "brita-1",
      unit_price_cents: 9_500,
      is_active: true,
      updated_at: "2026-09-12T12:00:00.000Z"
    };
    const ownPrice = {
      id: "preco-b",
      customer_id: "levisa-b",
      product_id: "brita-1",
      unit_price_cents: 9_900,
      is_active: true,
      updated_at: "2026-09-11T12:00:00.000Z"
    };

    for (const order of [
      [ownPrice, twinPrice],
      [twinPrice, ownPrice]
    ]) {
      const database = createMachine("desktop-b");
      try {
        const identity = readIdentity(database);
        seedLocalTwins(database);
        // A principal e a outra balanca: esta e secundaria de preco.
        writeSetting(database, PRICE_MASTER_DEVICE_IDS_KEY, ["desktop-a"]);
        const payload = {
          ...cloudTwins(),
          products: [{ id: "brita-1", code: "B1", description: "BRITA 1", updated_at: AT }],
          customerSpecialPrices: order
        };
        // Duas passadas seguidas: o preco nao pode trocar de uma para a outra.
        for (let pass = 0; pass < 2; pass++) {
          mockPull(payload);
          await pullDesktopDataFromCloud(database, identity);
          expect(
            database
              .prepare(
                `SELECT id, unit_price_cents FROM customer_special_prices
                 WHERE customer_id = 'levisa-b' AND deleted_at IS NULL`
              )
              .all()
          ).toEqual([{ id: "preco-a", unit_price_cents: 9_500 }]);
        }
      } finally {
        database.close();
      }
    }
  });

  it("o extrato de credito do gemeo soma no saldo do cliente daqui e volta com o cliente da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      mockPull(cloudTwins());
      await pullDesktopDataFromCloud(database, identity);

      upsertCloudCreditMovements(database, "company-1", [
        creditMovement("credito-daqui", "levisa-b", "credit", 50_000),
        creditMovement("debito-da-a", CUSTOMER_TWIN, "debit_product", 20_000),
        // Mesmo titulo do OMIE com outro id: fica de fora em vez de derrubar o lote.
        { ...creditMovement("adiantamento-1", CUSTOMER_TWIN, "credit", 10_000), omie_title_id: 77 },
        { ...creditMovement("adiantamento-2", CUSTOMER_TWIN, "credit", 10_000), omie_title_id: 77 }
      ]);

      expect(
        database
          .prepare("SELECT balance_cents FROM customer_credit_balances WHERE customer_id = ?")
          .pluck()
          .get("levisa-b")
      ).toBe(40_000);
      expect(database.prepare("SELECT COUNT(*) FROM customer_credit_movements").pluck().get()).toBe(
        3
      );

      resetSharedCadastroPushState(database);
      await pushSharedCadastroToCloud(database, identity);
      expect(sentRow("customerCreditMovements", "debito-da-a")?.customer_id).toBe(CUSTOMER_TWIN);
      expect(sentRow("customerCreditMovements", "credito-daqui")?.customer_id).toBe("levisa-b");
    } finally {
      database.close();
    }
  });

  it("a transportadora padrao do cliente volta com o id da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalTwins(database);
      mockPull({
        ...cloudTwins(),
        customers: [
          ...cloudTwins().customers,
          {
            id: "cliente-da-a",
            company_id: "company-1",
            legal_name: "OUTRO CLIENTE LTDA",
            trade_name: "OUTRO",
            document: "98.765.432/0001-98",
            default_carrier_id: CARRIER_TWIN,
            commercial_published_at: "2026-08-01T10:00:00.000Z",
            is_active: true,
            updated_at: AT
          }
        ]
      });
      await pullDesktopDataFromCloud(database, identity);
      expect(column(database, "customers", "default_carrier_id", "cliente-da-a")).toBe("transp-b");

      resetSharedCadastroPushState(database);
      await pushSharedCadastroToCloud(database, identity);
      expect(sentRow("customers", "cliente-da-a")?.default_carrier_id).toBe(CARRIER_TWIN);
    } finally {
      database.close();
    }
  });
});

function mockPull(data: Record<string, unknown>): void {
  invokeMock.mockResolvedValueOnce({ data, error: null });
}

/** A ultima versao enviada de uma linha, entre todos os lotes do envio do cadastro. */
function sentRow(entity: string, id: string): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  for (const [, options] of invokeMock.mock.calls) {
    const rows = (options as { body?: Record<string, unknown> } | undefined)?.body?.[entity];
    if (!Array.isArray(rows)) continue;
    const row = (rows as Array<Record<string, unknown>>).find((candidate) => candidate.id === id);
    if (row) found = row;
  }
  return found;
}

async function pushedRow(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  entity: string,
  id: string
): Promise<Record<string, unknown> | undefined> {
  resetSharedCadastroPushState(database);
  await pushSharedCadastroToCloud(database, identity);
  return sentRow(entity, id);
}

function cloudTwins(): {
  customers: Array<Record<string, unknown>>;
  carriers: Array<Record<string, unknown>>;
} {
  return {
    customers: [
      {
        id: CUSTOMER_TWIN,
        company_id: "company-1",
        legal_name: "LEVISA COMERCIO LTDA",
        trade_name: "LEVISA",
        document: CUSTOMER_DOCUMENT,
        omie_customer_id: 11_488_403_507,
        is_active: true,
        updated_at: AT
      }
    ],
    carriers: [
      {
        id: CARRIER_TWIN,
        company_id: "company-1",
        name: "TRANSPORTES DA OUTRA BALANCA",
        document: CARRIER_DOCUMENT,
        source: "omie",
        is_active: true,
        updated_at: AT
      }
    ]
  };
}

function creditMovement(
  id: string,
  customerId: string,
  movementType: string,
  amountCents: number
): Record<string, unknown> {
  return {
    id,
    customer_id: customerId,
    movement_type: movementType,
    amount_cents: amountCents,
    balance_after_cents: 0,
    created_at: AT
  };
}

function seedLocalTwins(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
       VALUES ('levisa-b', 'company-1', 'local', 'LEVISA COMERCIO LTDA', 'LEVISA', ?, 1, ?, ?)`
    )
    .run(CUSTOMER_DOCUMENT, "2026-08-02T10:00:00.000Z", "2026-08-02T10:00:00.000Z");
  insertCarrier(database, "transp-b", CARRIER_DOCUMENT);
}

function insertCarrier(database: DesktopDatabase, id: string, document: string): void {
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, name, document, source, is_active, created_at, updated_at)
       VALUES (?, 'company-1', 'TRANSPORTES DAQUI', ?, 'local', 1, ?, ?)`
    )
    .run(id, document, "2026-08-02T10:00:00.000Z", "2026-08-02T10:00:00.000Z");
}

function column(database: DesktopDatabase, table: string, name: string, id: string): string | null {
  return (database.prepare(`SELECT ${name} FROM ${table} WHERE id = ?`).pluck().get(id) ?? null) as
    | string
    | null;
}

function writeSetting(database: DesktopDatabase, key: string, value: unknown): void {
  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
    )
    .run(key, JSON.stringify(value), AT);
}

/** O SQLite de uma maquina ja ativada na nuvem com o id de dispositivo dado. */
function createMachine(deviceId: string): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId,
    deviceName: `PC ${deviceId}`,
    installationId: `install-${deviceId}`,
    adoptDeviceId: true
  });
  for (const [key, value] of [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", deviceId],
    ["cloud_device_token", `token-${deviceId}`]
  ] as const) {
    writeSetting(database, key, value);
  }
  return database;
}

function readIdentity(database: DesktopDatabase): LocalDesktopIdentity {
  const deviceId = database
    .prepare("SELECT value_json FROM local_settings WHERE key = 'active_device_id'")
    .pluck()
    .get() as string;
  return {
    companyId: "company-1",
    unitId: "unit-1",
    deviceId: JSON.parse(deviceId) as string,
    installationId: "install"
  };
}
