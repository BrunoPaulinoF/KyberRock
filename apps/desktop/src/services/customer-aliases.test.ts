import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import {
  CUSTOMER_ALIAS_RESYNC_KEY,
  cloudCustomerIdForPush,
  isCustomerAliasResyncPending,
  rememberCustomerAlias,
  resolveCloudOperationCustomer
} from "./customer-aliases";
import { mergeCustomerInto } from "./customer-merge";
import { InvoiceClosingService } from "./invoice-closing";
import {
  CADASTRO_LAST_PULL_KEY,
  pullDesktopDataFromCloud,
  syncOperationToSupabase
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
 * A Levisa tem dois cadastros na nuvem (mesmo CNPJ e codigo OMIE): `omie_11488403507` e um
 * criado numa balanca. Cada balanca guarda UM — o pull descarta o gemeo por documento. Estes
 * testes cobrem o que acontece com a pesagem que a OUTRA balanca fechou com o gemeo que esta
 * maquina nao tem.
 */
const LEVISA_DOCUMENT = "12.345.678/0001-95";
const OMIE_TWIN_ID = "omie_11488403507";

describe("clientes gemeos entre as balancas", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("a pesagem fechada com o gemeo da outra balanca aparece no cliente daqui", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);

      // Primeiro o cadastro (o gemeo chega e e descartado)...
      mockPull({ customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)] });
      await pullDesktopDataFromCloud(database, identity);
      // ...e a pesagem em outro ciclo: a equivalencia tem de sobreviver entre os pulls.
      mockPull({ operations: [cloudOperation("op-da-a", OMIE_TWIN_ID)] });
      await pullDesktopDataFromCloud(database, identity, { incremental: true });

      expect(
        database.prepare("SELECT COUNT(*) FROM customers WHERE id = ?").pluck().get(OMIE_TWIN_ID)
      ).toBe(0);
      expect(readOperation(database, "op-da-a")).toEqual({
        customer_id: "levisa-b",
        remote_customer_id: OMIE_TWIN_ID
      });

      // A tela da balanca, filtrando pelo cliente daqui, acha a carga da outra maquina.
      const closing = new InvoiceClosingService(database).getReport(
        "2026-09-01",
        "2026-09-30",
        "unit-1",
        { customerId: "levisa-b" }
      );
      expect(closing.rows.map((row) => row.operationId)).toEqual(["op-da-a"]);
    } finally {
      database.close();
    }
  });

  it("o reenvio leva o id que a nuvem tem, nao o gemeo daqui", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
      mockPull({
        customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)],
        operations: [cloudOperation("op-da-a", OMIE_TWIN_ID)]
      });
      await pullDesktopDataFromCloud(database, identity);

      // A conferencia da nota no OMIE reenvia a pesagem desta maquina.
      await syncOperationToSupabase(database, "op-da-a", identity);

      const pushed = lastDesktopSyncBody();
      expect(pushed.operations[0]?.customer_id).toBe(OMIE_TWIN_ID);
      // O gemeo daqui nao vai junto como dependencia: o cliente da nuvem ja existe la.
      expect(pushed.customers ?? []).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("a troca de cliente feita aqui sobe a troca, e nao o id antigo da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
      insertCustomer(database, "outro-cliente", "98.765.432/0001-98");
      mockPull({
        customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)],
        operations: [cloudOperation("op-da-a", OMIE_TWIN_ID)]
      });
      await pullDesktopDataFromCloud(database, identity);

      database
        .prepare("UPDATE weighing_operations SET customer_id = 'outro-cliente' WHERE id = ?")
        .run("op-da-a");
      await syncOperationToSupabase(database, "op-da-a", identity);

      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe("outro-cliente");
    } finally {
      database.close();
    }
  });

  it("a pesagem criada aqui com o cadastro daqui sobe com o id daqui", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
      mockPull({ customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)] });
      await pullDesktopDataFromCloud(database, identity);
      insertLocalOperation(database, "op-daqui", "levisa-b");

      await syncOperationToSupabase(database, "op-daqui", identity);

      // A equivalencia existe, mas a carga nasceu aqui: o id e o desta maquina.
      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe("levisa-b");
    } finally {
      database.close();
    }
  });

  it("as duas balancas trocam pesagens sem o cliente da nuvem alternar entre os gemeos", async () => {
    const machineA = createMachine("desktop-a");
    const machineB = createMachine("desktop-b");

    try {
      const identityA = readIdentity(machineA);
      const identityB = readIdentity(machineB);
      // A ficou com o cadastro do OMIE; B com o criado na balanca.
      insertCustomer(machineA, OMIE_TWIN_ID, LEVISA_DOCUMENT);
      insertCustomer(machineB, "levisa-b", LEVISA_DOCUMENT);
      const cloudCustomers = [
        cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT),
        cloudCustomer("levisa-b", LEVISA_DOCUMENT)
      ];

      insertLocalOperation(machineA, "op-da-a", OMIE_TWIN_ID);
      insertLocalOperation(machineB, "op-da-b", "levisa-b");
      await syncOperationToSupabase(machineA, "op-da-a", identityA);
      const fromA = lastDesktopSyncBody().operations[0];
      await syncOperationToSupabase(machineB, "op-da-b", identityB);
      const fromB = lastDesktopSyncBody().operations[0];
      expect(fromA?.customer_id).toBe(OMIE_TWIN_ID);
      expect(fromB?.customer_id).toBe("levisa-b");

      // Cada uma recebe a pesagem da outra junto com o cadastro inteiro da nuvem.
      mockPull({ customers: cloudCustomers, operations: [fromB] });
      await pullDesktopDataFromCloud(machineA, identityA);
      mockPull({ customers: cloudCustomers, operations: [fromA] });
      await pullDesktopDataFromCloud(machineB, identityB);

      expect(readOperation(machineA, "op-da-b").customer_id).toBe(OMIE_TWIN_ID);
      expect(readOperation(machineB, "op-da-a").customer_id).toBe("levisa-b");

      // E reenviam a pesagem da outra com o id de quem a criou.
      await syncOperationToSupabase(machineA, "op-da-b", identityA);
      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe("levisa-b");
      await syncOperationToSupabase(machineB, "op-da-a", identityB);
      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe(OMIE_TWIN_ID);
    } finally {
      machineA.close();
      machineB.close();
    }
  });

  it("id desconhecido mantem o cliente daqui e e reconhecido quando o gemeo chega", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
      insertLocalOperation(database, "op-da-a", "levisa-b");

      // A pesagem chega antes do cadastro do gemeo (o cadastro falhou neste pull).
      mockPull({ operations: [cloudOperation("op-da-a", OMIE_TWIN_ID)] });
      await pullDesktopDataFromCloud(database, identity);
      expect(readOperation(database, "op-da-a")).toEqual({
        customer_id: "levisa-b",
        remote_customer_id: OMIE_TWIN_ID
      });
      // Sem equivalencia ainda, o reenvio continua com o id daqui.
      await syncOperationToSupabase(database, "op-da-a", identity);
      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe("levisa-b");

      // O gemeo chega depois, sem a pesagem vir de novo: o reenvio ja o reconhece.
      mockPull({ customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)] });
      await pullDesktopDataFromCloud(database, identity);
      await syncOperationToSupabase(database, "op-da-a", identity);
      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe(OMIE_TWIN_ID);
    } finally {
      database.close();
    }
  });

  it("a pesagem sem cliente aqui reenvia o id que a nuvem tem", () => {
    const database = createMachine("desktop-b");

    try {
      expect(
        cloudCustomerIdForPush(database, { customer_id: null, remote_customer_id: OMIE_TWIN_ID })
      ).toBe(OMIE_TWIN_ID);
      expect(cloudCustomerIdForPush(database, { customer_id: "x", remote_customer_id: null })).toBe(
        "x"
      );
    } finally {
      database.close();
    }
  });

  it("o vazio da nuvem nao apaga o cliente nem o id lembrado", () => {
    const database = createMachine("desktop-b");

    try {
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
      rememberCustomerAlias(database, "company-1", OMIE_TWIN_ID, "levisa-b");

      expect(
        resolveCloudOperationCustomer(database, null, {
          customer_id: "levisa-b",
          remote_customer_id: OMIE_TWIN_ID
        })
      ).toEqual({ customerId: null, remoteCustomerId: OMIE_TWIN_ID });
      // O cliente que existe aqui nao precisa lembrar id nenhum.
      expect(
        resolveCloudOperationCustomer(database, "levisa-b", {
          customer_id: "levisa-b",
          remote_customer_id: OMIE_TWIN_ID
        })
      ).toEqual({ customerId: "levisa-b", remoteCustomerId: null });
    } finally {
      database.close();
    }
  });

  it("a unificacao daqui leva a equivalencia para o cadastro que fica", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
      insertCustomer(database, "levisa-antiga", LEVISA_DOCUMENT, "2026-01-01T00:00:00.000Z");
      mockPull({
        customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)],
        operations: [cloudOperation("op-da-a", OMIE_TWIN_ID)]
      });
      await pullDesktopDataFromCloud(database, identity);
      const twin = readOperation(database, "op-da-a").customer_id as string;
      const keeper = twin === "levisa-b" ? "levisa-antiga" : "levisa-b";

      mergeCustomerInto(database, { keeperId: keeper, loserId: twin });

      expect(
        database
          .prepare("SELECT local_id FROM customer_aliases WHERE remote_id = ?")
          .pluck()
          .get(OMIE_TWIN_ID)
      ).toBe(keeper);
      expect(readOperation(database, "op-da-a").customer_id).toBe(keeper);
      await syncOperationToSupabase(database, "op-da-a", identity);
      expect(lastDesktopSyncBody().operations[0]?.customer_id).toBe(OMIE_TWIN_ID);

      // E a proxima pesagem com o gemeo da nuvem chega no cadastro que ficou.
      mockPull({ operations: [cloudOperation("op-nova-da-a", OMIE_TWIN_ID)] });
      await pullDesktopDataFromCloud(database, identity);
      expect(readOperation(database, "op-nova-da-a").customer_id).toBe(keeper);
    } finally {
      database.close();
    }
  });

  describe("pesagens ja gravadas sem cliente", () => {
    it("a passada inteira pedida pela atualizacao cura a pesagem e registra o gemeo", async () => {
      const database = createMachine("desktop-b");

      try {
        const identity = readIdentity(database);
        insertCustomer(database, "levisa-b", LEVISA_DOCUMENT);
        // Como ficava antes desta versao: espelhada da outra balanca, sem cliente.
        insertLocalOperation(database, "op-da-a", null);
        writeSetting(database, CADASTRO_LAST_PULL_KEY, "2026-09-20T10:00:00.000Z");
        writeSetting(database, CUSTOMER_ALIAS_RESYNC_KEY, true);

        mockPull({
          serverTime: "2026-09-20T12:00:00.000Z",
          customers: [cloudCustomer(OMIE_TWIN_ID, LEVISA_DOCUMENT)],
          // Mesmo updated_at da copia local: e a projecao de sempre, nao uma edicao nova.
          operations: [cloudOperation("op-da-a", OMIE_TWIN_ID)]
        });
        await pullDesktopDataFromCloud(database, identity, { incremental: true });

        const body = invokeMock.mock.calls.at(-1)?.[1]?.body as Record<string, unknown>;
        expect(body).not.toHaveProperty("cadastroSince");
        expect(body).not.toHaveProperty("historySince");
        expect(readOperation(database, "op-da-a")).toEqual({
          customer_id: "levisa-b",
          remote_customer_id: OMIE_TWIN_ID
        });
        expect(isCustomerAliasResyncPending(database)).toBe(false);

        // Feita a passada, o pull frequente volta a ser incremental.
        mockPull({});
        await pullDesktopDataFromCloud(database, identity, { incremental: true });
        expect(invokeMock.mock.calls.at(-1)?.[1]?.body).toHaveProperty("cadastroSince");
      } finally {
        database.close();
      }
    });

    it("a passada com aviso nao vira passada inteira a cada pull", async () => {
      const database = createMachine("desktop-b");

      try {
        const identity = readIdentity(database);
        writeSetting(database, CADASTRO_LAST_PULL_KEY, "2026-09-20T10:00:00.000Z");
        writeSetting(database, CUSTOMER_ALIAS_RESYNC_KEY, true);

        // Uma migracao pendente na nuvem avisa em TODO pull: segurar a marca faria cada ciclo
        // de 15 s baixar o cadastro e o historico inteiros.
        mockPull({ warnings: ["customers: column customers.foo does not exist"] });
        await pullDesktopDataFromCloud(database, identity, { incremental: true });

        expect(isCustomerAliasResyncPending(database)).toBe(false);
        mockPull({});
        await pullDesktopDataFromCloud(database, identity, { incremental: true });
        expect(invokeMock.mock.calls.at(-1)?.[1]?.body).toHaveProperty("cadastroSince");
      } finally {
        database.close();
      }
    });
  });
});

function mockPull(data: Record<string, unknown>): void {
  invokeMock.mockResolvedValueOnce({ data, error: null });
}

function lastDesktopSyncBody(): {
  operations: Array<Record<string, unknown>>;
  customers?: Array<Record<string, unknown>>;
} {
  const call = invokeMock.mock.calls.filter(([name]) => name === "desktop-sync").at(-1);
  return (call?.[1] as { body: ReturnType<typeof lastDesktopSyncBody> }).body;
}

function cloudCustomer(id: string, document: string): Record<string, unknown> {
  return {
    id,
    company_id: "company-1",
    legal_name: "LEVISA COMERCIO LTDA",
    trade_name: "LEVISA",
    document,
    omie_customer_id: 11_488_403_507,
    is_active: true,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z"
  };
}

function cloudOperation(id: string, customerId: string | null): Record<string, unknown> {
  return {
    id,
    company_id: "company-1",
    unit_id: "unit-1",
    device_id: "desktop-a",
    status: "synced",
    operation_type: "invoice",
    customer_id: customerId,
    customer_name: "LEVISA",
    entry_weight_kg: 10_000,
    exit_weight_kg: 40_000,
    net_weight_kg: 30_000,
    total_cents: 150_000,
    created_at: "2026-09-10T11:00:00.000Z",
    closed_at: "2026-09-10T11:30:00.000Z",
    updated_at: "2026-09-10T12:00:00.000Z"
  };
}

function readOperation(
  database: DesktopDatabase,
  id: string
): { customer_id: string | null; remote_customer_id: string | null } {
  return database
    .prepare("SELECT customer_id, remote_customer_id FROM weighing_operations WHERE id = ?")
    .get(id) as { customer_id: string | null; remote_customer_id: string | null };
}

function insertCustomer(
  database: DesktopDatabase,
  id: string,
  document: string,
  createdAt = "2026-08-02T10:00:00.000Z"
): void {
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
       VALUES (?, 'company-1', 'local', 'LEVISA COMERCIO LTDA', 'LEVISA', ?, 1, ?, ?)`
    )
    .run(id, document, createdAt, createdAt);
}

function insertLocalOperation(
  database: DesktopDatabase,
  id: string,
  customerId: string | null
): void {
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id,
        entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents,
        exit_weight_captured_at, created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', 'desktop-a', 'synced', 'invoice', ?,
        10000, 40000, 30000, 150000,
        '2026-09-10T11:30:00.000Z', '2026-09-10T11:00:00.000Z', '2026-09-10T12:00:00.000Z')`
    )
    .run(id, customerId);
}

function writeSetting(database: DesktopDatabase, key: string, value: unknown): void {
  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
    )
    .run(key, JSON.stringify(value), "2026-09-20T10:00:00.000Z");
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
  // As duas maquinas se conhecem: a pesagem da outra aponta para o dispositivo dela.
  for (const id of ["desktop-a", "desktop-b"]) {
    database
      .prepare(
        `INSERT OR IGNORE INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
         VALUES (?, 'company-1', 'unit-1', ?, 'desktop_scale', ?, '2026-07-22T10:00:00.000Z', '2026-07-22T10:00:00.000Z')`
      )
      .run(id, `PC ${id}`, `remote-${id}`);
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
