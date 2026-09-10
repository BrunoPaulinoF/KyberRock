import { describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { enqueueSyncJob, getSyncJobById } from "./sync-queue";
import { closeWeighingOperation, createSimulatedWeighingOperation } from "./weighing-operations";
import {
  listOperationsPendingOmiePush,
  reenqueueOperationsMissingOmieJob,
  OMIE_BILLING_STATUS_DO_NOT_SEND
} from "./supabase-sync";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ functions: { invoke: vi.fn() } }))
}));

/**
 * A rede de seguranca do OMIE existe porque, para o OMIE, o job da fila era o UNICO
 * registro de que a carga precisa subir. Some o job e a venda fica pesada, impressa e
 * sem pedido la — sem alarme e sem recuperacao. Estes testes fixam as duas metades da
 * regra: o que TEM de voltar sozinho, e o que nao pode voltar de jeito nenhum.
 */
describe("rede de seguranca do OMIE", () => {
  it("recoloca na fila o fechamento que ficou sem job nenhum", () => {
    const { database, identity } = criarBase();
    try {
      const operacao = fecharPesagem(database, identity, { documento: "12345678000199" });

      // O fechamento cria o job; simula o job apagado por engano na tela Cloud.
      expect(jobsOmieDaOperacao(database, operacao).length).toBe(1);
      database.prepare("DELETE FROM sync_queue WHERE target = 'omie'").run();
      expect(listOperationsPendingOmiePush(database).map((o) => o.id)).toContain(operacao);

      expect(reenqueueOperationsMissingOmieJob(database)).toBe(1);
      expect(jobsOmieDaOperacao(database, operacao).length).toBe(1);
    } finally {
      database.close();
    }
  });

  it("nao duplica: fechamento com job vivo fica de fora", () => {
    const { database, identity } = criarBase();
    try {
      const operacao = fecharPesagem(database, identity, { documento: "12345678000199" });
      expect(listOperationsPendingOmiePush(database).map((o) => o.id)).not.toContain(operacao);
      expect(reenqueueOperationsMissingOmieJob(database)).toBe(0);
      expect(jobsOmieDaOperacao(database, operacao).length).toBe(1);
    } finally {
      database.close();
    }
  });

  it("nao ressuscita job morto pelo DADO: dead_letter continua morto", () => {
    const { database, identity } = criarBase();
    try {
      fecharPesagem(database, identity, { documento: "12345678000199" });
      database
        .prepare(
          "UPDATE sync_queue SET status = 'dead_letter', last_error = ? WHERE target = 'omie'"
        )
        .run("Cliente nao cadastrado para o Codigo [codigo_cliente]");

      // O job existe (mesmo morto), entao a rede nao toca nele: re-tentar repetiria a
      // mesma recusa a cada ciclo, que e a tempestade de retry.
      expect(reenqueueOperationsMissingOmieJob(database)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("respeita a exclusao feita pelo operador (nao_enviar)", () => {
    const { database, identity } = criarBase();
    try {
      const operacao = fecharPesagem(database, identity, { documento: "12345678000199" });
      database.prepare("DELETE FROM sync_queue WHERE target = 'omie'").run();
      database
        .prepare("UPDATE weighing_operations SET omie_billing_status = ? WHERE id = ?")
        .run(OMIE_BILLING_STATUS_DO_NOT_SEND, operacao);

      expect(listOperationsPendingOmiePush(database).map((o) => o.id)).not.toContain(operacao);
      expect(reenqueueOperationsMissingOmieJob(database)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("nao envia o que ja tem pedido no OMIE nem o que foi cancelado", () => {
    const { database, identity } = criarBase();
    try {
      const comPedido = fecharPesagem(database, identity, { documento: "12345678000199" });
      const cancelada = fecharPesagem(database, identity, { documento: "12345678000199" });
      database.prepare("DELETE FROM sync_queue WHERE target = 'omie'").run();
      database
        .prepare("UPDATE weighing_operations SET omie_sales_order_id = 4321 WHERE id = ?")
        .run(comPedido);
      database
        .prepare("UPDATE weighing_operations SET status = 'cancelled' WHERE id = ?")
        .run(cancelada);

      const pendentes = listOperationsPendingOmiePush(database).map((o) => o.id);
      expect(pendentes).not.toContain(comPedido);
      expect(pendentes).not.toContain(cancelada);
    } finally {
      database.close();
    }
  });

  it("o fechamento sem documento volta sozinho assim que o cadastro e corrigido", () => {
    const { database, identity } = criarBase();
    try {
      // Sem documento e sem codigo OMIE o fechamento nasce SEM job, marcado
      // cadastro_incompleto. Antes, so o botao "Refaturar" o tirava dali.
      const operacao = fecharPesagem(database, identity, { documento: null });
      expect(jobsOmieDaOperacao(database, operacao).length).toBe(0);
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operacao)
      ).toBe("cadastro_incompleto");

      // Ninguem clica em nada: o escritorio so preenche o CNPJ do cliente.
      database
        .prepare(
          "UPDATE customers SET document = '12345678000199' WHERE id = (SELECT customer_id FROM weighing_operations WHERE id = ?)"
        )
        .run(operacao);

      expect(reenqueueOperationsMissingOmieJob(database)).toBe(1);
      expect(jobsOmieDaOperacao(database, operacao).length).toBe(1);
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operacao)
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("ignora job de OUTRA operacao: a chave e a operacao, nao a fila em geral", () => {
    const { database, identity } = criarBase();
    try {
      const operacao = fecharPesagem(database, identity, { documento: "12345678000199" });
      database.prepare("DELETE FROM sync_queue WHERE target = 'omie'").run();
      // Job de outra operacao qualquer nao pode "cobrir" esta.
      enqueueSyncJob(database, {
        target: "omie",
        action: "create_and_bill_order",
        entityType: "weighing_operation",
        entityId: "outra-operacao",
        idempotencyKey: "omie:outra-operacao:bill",
        payload: { operationId: "outra-operacao" }
      });

      expect(reenqueueOperationsMissingOmieJob(database)).toBe(1);
      expect(jobsOmieDaOperacao(database, operacao).length).toBe(1);
    } finally {
      database.close();
    }
  });

  it("nao volta o que fechou ha mais de 30 dias", () => {
    const { database, identity } = criarBase();
    try {
      const operacao = fecharPesagem(database, identity, { documento: "12345678000199" });
      database.prepare("DELETE FROM sync_queue WHERE target = 'omie'").run();
      database
        .prepare("UPDATE weighing_operations SET updated_at = ? WHERE id = ?")
        .run("2020-01-01T00:00:00.000Z", operacao);

      expect(listOperationsPendingOmiePush(database).map((o) => o.id)).not.toContain(operacao);
    } finally {
      database.close();
    }
  });
});

function criarBase(): { database: DesktopDatabase; identity: LocalDesktopIdentity } {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  const identity = ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return { database, identity };
}

let contador = 0;

function fecharPesagem(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { documento: string | null }
): string {
  contador += 1;
  const operacao = createSimulatedWeighingOperation(database, {
    identity,
    customerName: `Cliente ${contador}`,
    plate: `ABC1D${String(contador).padStart(2, "0")}`,
    driverName: `Motorista ${contador}`,
    productDescription: "Brita 1",
    entryWeightKg: 12_000
  });
  if (options.documento) {
    database
      .prepare("UPDATE customers SET document = ? WHERE id = ?")
      .run(options.documento, operacao.customerId);
  }
  closeWeighingOperation(database, { operationId: operacao.id, exitWeightKg: 18_500 });
  return operacao.id;
}

function jobsOmieDaOperacao(database: DesktopDatabase, operationId: string): string[] {
  return database
    .prepare(
      "SELECT id FROM sync_queue WHERE target = 'omie' AND entity_id = ? AND action IN ('create_order','create_and_bill_order')"
    )
    .pluck()
    .all(operationId) as string[];
}

// Mantem a importacao usada acima viva para o typecheck do workspace.
void getSyncJobById;
