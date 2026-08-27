import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { writeLocalSetting } from "./local-settings";
import {
  PRICE_MASTER_DEVICE_ID_KEY,
  PRICE_MASTER_DEVICE_NAME_KEY,
  PRICE_MASTER_REPUBLISH_KEY,
  PRICE_MASTER_RESYNC_KEY,
  isPriceMasterRepublishPending,
  isPriceMasterResyncPending
} from "./price-authority";
import { pullDesktopDataFromCloud, pushSharedCadastroToCloud } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

/**
 * Cadastro de preco com dono unico na pedreira.
 *
 * Antes disso, duas balancas que cadastravam o mesmo preco especial geravam ids
 * diferentes, e o pull de cada lado DESCARTAVA a linha da outra para nao violar o indice
 * unico local — cada computador ficava com o preco que ele mesmo digitou, para sempre.
 */
describe("balanca principal de precos (sincronizacao)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("na secundaria, o preco especial da principal vence o gemeo local", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      // Preco especial cadastrado NESTA maquina antes da eleicao: R$ 90,00/ton.
      insertSpecialPrice(database, { id: "local-price", unitPriceCents: 9000 });
      electMaster(database, "desktop-a");

      // A principal publicou o mesmo par (cliente, produto) sob outro id, por R$ 120,00.
      invokeMock.mockResolvedValueOnce({
        data: {
          customerSpecialPrices: [
            {
              id: "master-price",
              customer_id: "cust-1",
              product_id: "prod-1",
              unit_price_cents: 12000,
              unit: "ton",
              is_active: true,
              updated_at: "2026-08-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(livePrices(database)).toEqual([{ id: "master-price", unit_price_cents: 12000 }]);
    } finally {
      database.close();
    }
  });

  // Sem principal definida nada muda: a linha local continua tendo a ultima palavra, que e
  // o comportamento de todas as pedreiras que nao usarem o recurso.
  it("sem principal definida, o gemeo local continua vencendo", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      insertSpecialPrice(database, { id: "local-price", unitPriceCents: 9000 });

      invokeMock.mockResolvedValueOnce({
        data: {
          customerSpecialPrices: [
            {
              id: "outra-price",
              customer_id: "cust-1",
              product_id: "prod-1",
              unit_price_cents: 12000,
              unit: "ton",
              is_active: true,
              updated_at: "2026-08-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(livePrices(database)).toEqual([{ id: "local-price", unit_price_cents: 9000 }]);
    } finally {
      database.close();
    }
  });

  it("a secundaria nao publica cadastro de preco, mas continua publicando o resto", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      insertSpecialPrice(database, { id: "local-price", unitPriceCents: 9000 });
      electMaster(database, "desktop-a");

      await pushSharedCadastroToCloud(database, identity);

      expect(pushedKeys()).toContain("customers");
      expect(pushedKeys()).not.toContain("customerSpecialPrices");
      expect(pushedKeys()).not.toContain("productDefaultPrices");
      expect(pushedKeys()).not.toContain("customerFreightRules");
    } finally {
      database.close();
    }
  });

  // O preco que a principal ja tinha antes da eleicao esta "atras do cursor": sem zerar os
  // cursores de preco ele nunca chegaria as demais maquinas.
  it("a principal recem-eleita republica todo o cadastro de preco", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      insertSpecialPrice(database, { id: "master-price", unitPriceCents: 12000 });

      // Primeiro ciclo, ainda sem principal: o cursor avanca sobre o preco.
      await pushSharedCadastroToCloud(database, identity);
      invokeMock.mockClear();
      await pushSharedCadastroToCloud(database, identity);
      expect(pushedKeys()).not.toContain("customerSpecialPrices");

      // Painel elege ESTA maquina como principal.
      electMaster(database, "desktop-a");
      expect(isPriceMasterRepublishPending(database)).toBe(true);

      invokeMock.mockClear();
      await pushSharedCadastroToCloud(database, identity);

      expect(pushedKeys()).toContain("customerSpecialPrices");
      expect(isPriceMasterRepublishPending(database)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("a secundaria recem-criada puxa o cadastro INTEIRO, mesmo no ciclo incremental", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      insertSpecialPrice(database, { id: "local-price", unitPriceCents: 9000 });
      // Marca do pull incremental ja gravada: a passada da eleicao tem de ignora-la.
      writeLocalSetting(database, "cloud_cadastro_last_pull_at", "2026-08-27T09:00:00.000Z");
      electMaster(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: {
          serverTime: "2026-08-27T10:00:00.000Z",
          customerSpecialPrices: [
            {
              id: "master-price",
              customer_id: "cust-1",
              product_id: "prod-1",
              unit_price_cents: 12000,
              unit: "ton",
              is_active: true,
              updated_at: "2026-08-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity, { incremental: true });

      // O pull veio COMPLETO mesmo tendo sido pedido incremental...
      expect(invokeMock.mock.calls[0][1].body.cadastroSince).toBeUndefined();
      // ...o par disputado cedeu para a principal...
      expect(livePrices(database)).toEqual([{ id: "master-price", unit_price_cents: 12000 }]);
      // ...e a marca da eleicao foi consumida (o proximo ciclo volta a ser incremental).
      expect(isPriceMasterResyncPending(database)).toBe(false);
    } finally {
      database.close();
    }
  });

  /**
   * O preco que so existe NESTA maquina nao e apagado no pull.
   *
   * Apagar aqui abria uma janela de balanca sem preco: a secundaria descobre o papel em
   * segundos (heartbeat de 5 s) e puxa logo em seguida, enquanto a principal so republica
   * na proxima sincronizacao completa — ate 30 minutos depois. Quem resolve o par disputado
   * e o `desktop-sync`, derrubando a linha concorrente quando a PRINCIPAL publica a dela: o
   * tombstone chega junto com o preco novo, nunca antes dele.
   */
  it("nao apaga o preco local que a principal ainda nao publicou", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      insertSpecialPrice(database, { id: "so-daqui", productId: "prod-2", unitPriceCents: 7000 });
      electMaster(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: {
          serverTime: "2026-08-27T10:00:00.000Z",
          customerSpecialPrices: [
            {
              id: "master-price",
              customer_id: "cust-1",
              product_id: "prod-1",
              unit_price_cents: 12000,
              unit: "ton",
              is_active: true,
              updated_at: "2026-08-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(livePrices(database)).toEqual([
        { id: "master-price", unit_price_cents: 12000 },
        { id: "so-daqui", unit_price_cents: 7000 }
      ]);
    } finally {
      database.close();
    }
  });

  // Tirar de cena um preco continua sendo gesto do operador NA PRINCIPAL: a exclusao viaja
  // como tombstone e apaga a linha nas demais maquinas.
  it("aceita da principal a exclusao de um preco", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      insertSpecialPrice(database, { id: "master-price", unitPriceCents: 12000 });
      electMaster(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: {
          customerSpecialPrices: [
            {
              id: "master-price",
              customer_id: "cust-1",
              product_id: "prod-1",
              unit_price_cents: 12000,
              unit: "ton",
              is_active: false,
              deleted_at: "2026-08-27T11:00:00.000Z",
              updated_at: "2026-08-27T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(livePrices(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  // A regra de frete guarda duas coisas na mesma linha: o valor do cadastro (da principal)
  // e a memoria da ultima venda desta maquina, que so serve para pre-preencher a tela.
  it("mantem a memoria de frete desta maquina ao espelhar o cadastro da principal", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomerAndProduct(database);
      database
        .prepare(
          `INSERT INTO customer_freight_rules (id, customer_id, product_id, rule_json, is_active, created_at, updated_at)
           VALUES ('freight-local', 'cust-1', NULL, ?, 1, ?, ?)`
        )
        .run(
          JSON.stringify({
            id: "default",
            name: "Frete do cliente",
            type: "per_ton",
            baseValueCents: 0,
            unit: "ton",
            modalities: {
              cif: {
                type: "per_ton",
                baseValueCents: 3000,
                source: "last_used",
                updatedAt: "2026-08-20T10:00:00.000Z"
              }
            }
          }),
          "2026-08-20T10:00:00.000Z",
          "2026-08-20T10:00:00.000Z"
        );
      electMaster(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: {
          customerFreightRules: [
            {
              id: "freight-master",
              customer_id: "cust-1",
              product_id: null,
              rule_json: {
                id: "default",
                name: "Frete do cliente",
                type: "per_ton",
                baseValueCents: 0,
                unit: "ton",
                modalities: {
                  fob: {
                    type: "per_ton",
                    baseValueCents: 5000,
                    source: "manual",
                    updatedAt: "2026-08-27T10:00:00.000Z"
                  }
                }
              },
              is_active: true,
              updated_at: "2026-08-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      const row = database
        .prepare(
          "SELECT rule_json FROM customer_freight_rules WHERE id = 'freight-master' AND deleted_at IS NULL"
        )
        .pluck()
        .get() as string;
      const modalities = (JSON.parse(row) as { modalities: Record<string, { source: string }> })
        .modalities;
      // O cadastro da principal entrou...
      expect(modalities.fob).toMatchObject({ baseValueCents: 5000, source: "manual" });
      // ...e a memoria da ultima venda desta maquina sobreviveu.
      expect(modalities.cif).toMatchObject({ baseValueCents: 3000, source: "last_used" });
    } finally {
      database.close();
    }
  });
});

function pushedKeys(): string[] {
  return invokeMock.mock.calls.flatMap(([, options]) =>
    Object.keys(options?.body ?? {}).filter((key) => Array.isArray(options.body[key]))
  );
}

function livePrices(database: DesktopDatabase): Array<Record<string, unknown>> {
  return database
    .prepare(
      "SELECT id, unit_price_cents FROM customer_special_prices WHERE deleted_at IS NULL ORDER BY id"
    )
    .all() as Array<Record<string, unknown>>;
}

/** O painel elegeu `masterDeviceId` como principal de precos da pedreira. */
function electMaster(database: DesktopDatabase, masterDeviceId: string): void {
  writeLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY, masterDeviceId);
  writeLocalSetting(database, PRICE_MASTER_DEVICE_NAME_KEY, `PC ${masterDeviceId}`);
  const deviceId = database
    .prepare("SELECT value_json FROM local_settings WHERE key = 'cloud_device_id'")
    .pluck()
    .get() as string;
  if ((JSON.parse(deviceId) as string) === masterDeviceId) {
    writeLocalSetting(database, PRICE_MASTER_REPUBLISH_KEY, true);
  } else {
    writeLocalSetting(database, PRICE_MASTER_RESYNC_KEY, true);
  }
}

function seedCustomerAndProduct(database: DesktopDatabase): void {
  const now = "2026-08-20T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('cust-1', 'company-1', 'local', 'Cliente Um LTDA', 'Cliente Um', 1, ?, ?)`
    )
    .run(now, now);
  for (const productId of ["prod-1", "prod-2"]) {
    database
      .prepare(
        `INSERT INTO products (id, company_id, code, description, unit, is_active, created_at, updated_at)
         VALUES (?, 'company-1', ?, ?, 'TON', 1, ?, ?)`
      )
      .run(productId, productId.toUpperCase(), `Brita ${productId}`, now, now);
  }
}

function insertSpecialPrice(
  database: DesktopDatabase,
  input: { id: string; productId?: string; unitPriceCents: number }
): void {
  const now = "2026-08-20T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customer_special_prices (id, company_id, customer_id, product_id, unit_price_cents, unit, is_active, created_at, updated_at)
       VALUES (?, 'company-1', 'cust-1', ?, ?, 'ton', 1, ?, ?)`
    )
    .run(input.id, input.productId ?? "prod-1", input.unitPriceCents, now, now);
}

/** Cria o SQLite de uma maquina ja ativada na nuvem com o id de dispositivo dado. */
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
  const now = "2026-08-20T10:00:00.000Z";
  const settings: Array<[string, string]> = [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", deviceId],
    ["cloud_device_token", `token-${deviceId}`]
  ];
  for (const [key, value] of settings) {
    database
      .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), now);
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
    companyLegalName: "KyberRock Mineracao LTDA",
    companyTradeName: "KyberRock",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: JSON.parse(deviceId) as string,
    deviceName: "PC",
    installationId: "install"
  } as LocalDesktopIdentity;
}
