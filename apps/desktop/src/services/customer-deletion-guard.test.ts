/**
 * A trava de exclusao de cliente e o Restaurar.
 *
 * O caso real que originou os dois: um cliente foi excluido com a quinzena inteira ainda
 * por faturar. Nenhuma pesagem foi apagada — a exclusao so marca `deleted_at` no cadastro
 * —, mas o cadastro sumiu de todas as telas e, com ele, o filtro por onde o Fechamento
 * chegava naquelas cargas. As pesagens ficaram no banco sem ninguem para cobrar.
 */

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import {
  createCustomer,
  deleteCustomer,
  findCustomerDeletionBlock,
  listDeletedCustomers,
  restoreCustomer
} from "./customers";

describe("trava de exclusao de cliente", () => {
  it("recusa excluir quem tem pesagem em aberto", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, { customerId, status: "awaiting_exit" });

      expect(() => deleteCustomer(database, customerId)).toThrow("1 pesagem em aberto");
      expect(isDeleted(database, customerId)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("recusa excluir quem tem pesagem concluida sem faturar", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, { customerId, status: "synced" });
      insertOperation(database, { customerId, status: "closed_local" });

      expect(() => deleteCustomer(database, customerId)).toThrow(
        "2 pesagens concluidas sem faturar"
      );
      expect(isDeleted(database, customerId)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("soma os dois motivos na mesma mensagem", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, { customerId, status: "entry_registered" });
      insertOperation(database, { customerId, status: "synced" });

      expect(() => deleteCustomer(database, customerId)).toThrow(
        "1 pesagem em aberto e 1 pesagem concluida sem faturar"
      );
    } finally {
      database.close();
    }
  });

  it("libera a exclusao quando tudo que fechou ja foi faturado", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, { customerId, status: "synced", omieBillingStatus: "billed" });

      expect(findCustomerDeletionBlock(database, customerId)).toBeNull();
      deleteCustomer(database, customerId);
      expect(isDeleted(database, customerId)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("nao deixa carga cancelada segurar o cadastro para sempre", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      // Cancelada nunca vira nota: se contasse, o cadastro ficaria intocavel.
      insertOperation(database, { customerId, status: "cancelled" });

      expect(findCustomerDeletionBlock(database, customerId)).toBeNull();
      deleteCustomer(database, customerId);
      expect(isDeleted(database, customerId)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("ignora pesagem que ja foi excluida", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, {
        customerId,
        status: "closed_local",
        deletedAt: "2026-08-20T10:00:00.000Z"
      });

      expect(findCustomerDeletionBlock(database, customerId)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("nao conta a pesagem de outro cliente", () => {
    const database = createDatabase();

    try {
      const alvo = createTestCustomer(database, { tradeName: "Alvo", document: "26463463000183" });
      const outro = createTestCustomer(database, {
        tradeName: "Outro",
        document: "05145413000109"
      });
      insertOperation(database, { customerId: outro, status: "closed_local" });

      expect(findCustomerDeletionBlock(database, alvo)).toBeNull();
      deleteCustomer(database, alvo);
      expect(isDeleted(database, alvo)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("conta em aberto e por faturar separadamente", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, { customerId, status: "draft" });
      insertOperation(database, { customerId, status: "loading_requested" });
      insertOperation(database, { customerId, status: "sync_error" });
      insertOperation(database, { customerId, status: "synced", omieBillingStatus: "billed" });

      expect(findCustomerDeletionBlock(database, customerId)).toEqual({
        openCount: 2,
        unbilledCount: 1
      });
    } finally {
      database.close();
    }
  });
});

describe("restaurar cliente excluido", () => {
  it("devolve o cadastro e as pesagens continuam apontando para ele", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      insertOperation(database, { customerId, status: "synced", omieBillingStatus: "billed" });
      deleteCustomer(database, customerId);
      expect(isDeleted(database, customerId)).toBe(true);

      restoreCustomer(database, customerId);

      expect(isDeleted(database, customerId)).toBe(false);
      // O vinculo nunca se perdeu: restaurar so limpou o `deleted_at`.
      const linked = database
        .prepare("SELECT COUNT(*) FROM weighing_operations WHERE customer_id = ?")
        .pluck()
        .get(customerId) as number;
      expect(linked).toBe(1);
    } finally {
      database.close();
    }
  });

  it("lista os excluidos para a tela oferecer o Restaurar", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database, { tradeName: "Polimix" });
      deleteCustomer(database, customerId);

      const deleted = listDeletedCustomers(database, "company-1");
      expect(deleted).toHaveLength(1);
      expect(deleted[0]?.id).toBe(customerId);
      expect(deleted[0]?.tradeName).toBe("Polimix");
      expect(deleted[0]?.deletedAt).toBeTruthy();

      restoreCustomer(database, customerId);
      expect(listDeletedCustomers(database, "company-1")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("recusa restaurar quando o CNPJ ja foi ocupado por outro cadastro", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database, { document: "26463463000183" });
      deleteCustomer(database, customerId);

      // Enquanto esteve excluido o documento ficou livre, e alguem recadastrou o cliente.
      createCustomer(database, {
        companyId: "company-1",
        legalName: "Recadastrado LTDA",
        tradeName: "Recadastrado",
        document: "26463463000183"
      });

      expect(() => restoreCustomer(database, customerId)).toThrow(
        "Ja existe um cliente com este CNPJ/CPF"
      );
      expect(isDeleted(database, customerId)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("recusa restaurar um cadastro que nao esta excluido", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      expect(() => restoreCustomer(database, customerId)).toThrow("nao esta excluido");
    } finally {
      database.close();
    }
  });

  it("destrava o cadastro vindo do OMIE em vez de congela-lo", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      database.prepare("UPDATE customers SET source = 'omie' WHERE id = ?").run(customerId);
      deleteCustomer(database, customerId);

      restoreCustomer(database, customerId);

      /*
       * `deleteCustomer` deixa `needs_push = 1`, mas o envio ao OMIE so olha
       * `source IN ('local','hybrid')`: mantido em 1, o cadastro nunca mais seria
       * reescrito pelo pull (que exige `needs_push = 0`) nem enviado pelo push.
       */
      const row = database
        .prepare("SELECT needs_push, sync_status FROM customers WHERE id = ?")
        .get(customerId) as { needs_push: number; sync_status: string };
      expect(row.needs_push).toBe(0);
      expect(row.sync_status).toBe("synced");
    } finally {
      database.close();
    }
  });

  it("mantem o envio pendente do cadastro que nasceu na balanca", () => {
    const database = createDatabase();

    try {
      const customerId = createTestCustomer(database);
      deleteCustomer(database, customerId);

      restoreCustomer(database, customerId);

      const row = database
        .prepare("SELECT source, needs_push FROM customers WHERE id = ?")
        .get(customerId) as { source: string; needs_push: number };
      expect(row.source).toBe("local");
      expect(row.needs_push).toBe(1);
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return database;
}

function createTestCustomer(
  database: DesktopDatabase,
  options: { tradeName?: string; document?: string } = {}
): string {
  const created = createCustomer(database, {
    companyId: "company-1",
    legalName: `${options.tradeName ?? "Cliente Teste"} LTDA`,
    tradeName: options.tradeName ?? "Cliente Teste",
    document: options.document
  }) as { id: string };
  return created.id;
}

let operationSeq = 0;

function insertOperation(
  database: DesktopDatabase,
  options: {
    customerId: string;
    status: string;
    omieBillingStatus?: string;
    deletedAt?: string;
  }
): void {
  operationSeq += 1;
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, customer_id,
          omie_billing_status, created_at, updated_at, deleted_at)
       VALUES (?, 'company-1', 'unit-1', 'device-1', ?, 'invoice', ?, ?, ?, ?, ?)`
    )
    .run(
      `op-${operationSeq}`,
      options.status,
      options.customerId,
      options.omieBillingStatus ?? null,
      "2026-08-12T10:00:00.000Z",
      "2026-08-12T10:00:00.000Z",
      options.deletedAt ?? null
    );
}

function isDeleted(database: DesktopDatabase, customerId: string): boolean {
  const row = database.prepare("SELECT deleted_at FROM customers WHERE id = ?").get(customerId) as {
    deleted_at: string | null;
  };
  return row.deleted_at !== null;
}
