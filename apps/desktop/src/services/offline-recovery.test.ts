import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import {
  listRunnableSyncJobs,
  rearmJobsDeadLetteredByOutage,
  releaseOutageBackoff
} from "./sync-queue";
import { closeWeighingOperation, createSimulatedWeighingOperation } from "./weighing-operations";
import {
  listOperationsPendingCloudPush,
  processCloudSyncQueue,
  processOmieSyncQueue,
  pushSharedCadastroToCloud,
  reenqueueOperationsMissingOmieJob,
  syncOperationToSupabase
} from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ functions: { invoke: invokeMock } }))
}));

/**
 * O ensaio da queda inteira, ponta a ponta.
 *
 * Reproduz o dia 09/09/2026 e o requisito que ele gerou: a pedreira trabalha com a
 * nuvem fora, tudo fica no SQLite, e quando a conexao volta o que foi feito sobe
 * SOZINHO — para a nuvem e para o OMIE, sem clique de operador e sem ninguem do
 * suporte precisar saber que ha algo parado.
 *
 * A queda e simulada com a mensagem REAL que a nuvem passou a devolver quando o
 * Postgres nao responde ("Cadastro indisponivel no momento (HTTP 503)"), porque e
 * justamente essa classificacao que decide se o envio sobrevive ou morre.
 */
describe("a pedreira atravessa a queda e se recupera sozinha", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("fecha pesagens offline e entrega tudo a nuvem e ao OMIE quando a conexao volta", async () => {
    const { database, identity } = criarBalanca();

    try {
      // ---------- 14h: a nuvem cai ----------
      const quedaDoBanco = () =>
        Promise.resolve({
          data: null,
          error: new Error("Cadastro indisponivel no momento (HTTP 503)")
        });
      invokeMock.mockImplementation(quedaDoBanco);

      // O operador segue trabalhando: tres caminhoes entram, carregam e saem.
      const operacoes = [1, 2, 3].map((n) => fecharPesagem(database, identity, n));

      // A gravacao local nao depende da nuvem: as tres estao fechadas no SQLite.
      expect(
        database
          .prepare(
            "SELECT COUNT(*) FROM weighing_operations WHERE exit_weight_captured_at IS NOT NULL"
          )
          .pluck()
          .get()
      ).toBe(3);

      // E o escritorio cadastra uma transportadora nova durante a queda.
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, document, source, is_active, needs_push, created_at, updated_at)
           VALUES ('carrier-queda', ?, 'Transportes da Queda', '11222333000144', 'local', 1, 1, ?, ?)`
        )
        .run(identity.companyId, "2026-09-09T14:30:00.000Z", "2026-09-09T14:30:00.000Z");

      // Durante a queda, TODA tentativa falha — de proposito, muitas vezes: com o
      // backoff antigo, 10 falhas bastavam para o envio morrer e sair da rotacao.
      //
      // O TEMPO precisa andar entre os ciclos. Sem isso o backoff empurra o
      // `next_attempt_at` para a frente, `listRunnableSyncJobs` nao devolve mais nada e
      // as 15 passadas viram uma so: o ensaio passava mesmo com a protecao desligada,
      // que e o pior tipo de teste — o que da confianca sem cobrir nada.
      const deixarOTempoPassar = () =>
        database
          .prepare("UPDATE sync_queue SET next_attempt_at = ? WHERE status = 'failed'")
          .run(new Date().toISOString());

      for (let ciclo = 0; ciclo < 15; ciclo++) {
        await processCloudSyncQueue(database, identity);
        await processOmieSyncQueue(database, identity, { delayMs: 0 });
        deixarOTempoPassar();
      }

      // A prova de que o tempo andou: os envios acumularam MAIS tentativas do que o
      // limite que antes os matava.
      const tentativas = database
        .prepare("SELECT MAX(attempt_count) FROM sync_queue")
        .pluck()
        .get() as number;
      expect(tentativas).toBeGreaterThanOrEqual(10);

      // Nada morreu: os envios continuam na rotacao automatica, esperando a nuvem.
      expect(
        database
          .prepare("SELECT COUNT(*) FROM sync_queue WHERE status = 'dead_letter'")
          .pluck()
          .get()
      ).toBe(0);

      // ---------- 18h: a conexao volta ----------
      const enviadosAoSync: Array<Record<string, unknown>> = [];
      const operacoesEnviadasAoOmie: string[] = [];
      invokeMock.mockImplementation((nome: string, options: { body: Record<string, unknown> }) => {
        if (nome === "omie-sync") {
          const payload = options.body.payload as { localOperationId?: string } | undefined;
          if (payload?.localOperationId) operacoesEnviadasAoOmie.push(payload.localOperationId);
          return Promise.resolve({ error: null, data: { orderId: 900 } });
        }
        enviadosAoSync.push(options.body);
        return Promise.resolve({ error: null, data: { ok: true } });
      });

      // O ciclo automatico, na mesma ordem em que `syncCloudNow` o executa.
      rearmJobsDeadLetteredByOutage(database);
      // A nuvem respondeu ao ping: o backoff acumulado na queda perde o motivo. Sem
      // isto o envio ficava ate 15 min parado depois de a internet voltar.
      releaseOutageBackoff(database);
      await processCloudSyncQueue(database, identity);
      reenqueueOperationsMissingOmieJob(database, "device-1");
      await processOmieSyncQueue(database, identity, { delayMs: 0 });
      for (const pendente of listOperationsPendingCloudPush(database)) {
        await syncOperationToSupabase(database, pendente.id, identity);
      }
      await pushSharedCadastroToCloud(database, identity);

      // 1) As tres pesagens chegaram a nuvem.
      const operacoesNaNuvem = new Set(
        enviadosAoSync.flatMap((body) =>
          ((body.operations as Array<{ id: string }> | undefined) ?? []).map((o) => o.id)
        )
      );
      for (const operacao of operacoes) expect(operacoesNaNuvem).toContain(operacao);

      // 2) As tres subiram ao OMIE — sem nenhum clique.
      for (const operacao of operacoes) expect(operacoesEnviadasAoOmie).toContain(operacao);

      // 3) A transportadora cadastrada durante a queda tambem subiu.
      const transportadorasNaNuvem = enviadosAoSync.flatMap((body) =>
        ((body.carriers as Array<{ id: string }> | undefined) ?? []).map((c) => c.id)
      );
      expect(transportadorasNaNuvem).toContain("carrier-queda");

      // 4) A fila esvaziou: nada ficou esperando gente.
      expect(listRunnableSyncJobs(database, { limit: 100 })).toHaveLength(0);
      expect(
        database
          .prepare("SELECT COUNT(*) FROM sync_queue WHERE status NOT IN ('done')")
          .pluck()
          .get()
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("mesmo perdendo o job do OMIE na queda, o pedido sobe quando a conexao volta", async () => {
    const { database, identity } = criarBalanca();

    try {
      invokeMock.mockImplementation(() =>
        Promise.resolve({
          data: null,
          error: new Error("Cadastro indisponivel no momento (HTTP 503)")
        })
      );
      const operacao = fecharPesagem(database, identity, 9);

      // Durante a queda a tela Cloud fica cheia de linhas vermelhas e alguem apaga
      // uma delas achando que e lixo de sincronizacao travada. Antes, essa pesagem
      // simplesmente nunca mais chegaria ao OMIE: o job era o unico registro de que
      // ela precisava subir.
      database.prepare("DELETE FROM sync_queue WHERE target = 'omie'").run();

      const enviadasAoOmie: string[] = [];
      invokeMock.mockImplementation((nome: string, options: { body: Record<string, unknown> }) => {
        if (nome === "omie-sync") {
          const payload = options.body.payload as { localOperationId?: string } | undefined;
          if (payload?.localOperationId) enviadasAoOmie.push(payload.localOperationId);
        }
        return Promise.resolve({ error: null, data: { orderId: 901, ok: true } });
      });

      reenqueueOperationsMissingOmieJob(database, "device-1");
      await processOmieSyncQueue(database, identity, { delayMs: 0 });

      expect(enviadasAoOmie).toContain(operacao);
    } finally {
      database.close();
    }
  });
});

function criarBalanca(): { database: DesktopDatabase; identity: LocalDesktopIdentity } {
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
  for (const [key, value] of [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", "device-1"],
    ["cloud_device_token", "device-token-1"]
  ] as Array<[string, string]>) {
    database
      .prepare(
        `INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      )
      .run(key, JSON.stringify(value), "2026-09-09T12:00:00.000Z");
  }
  return { database, identity };
}

function fecharPesagem(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  n: number
): string {
  const operacao = createSimulatedWeighingOperation(database, {
    identity,
    customerName: `Cliente ${n}`,
    plate: `ABC1D${String(n).padStart(2, "0")}`,
    driverName: `Motorista ${n}`,
    productDescription: "Brita 1",
    entryWeightKg: 12_000
  });
  database
    .prepare("UPDATE customers SET document = ?, omie_customer_id = ? WHERE id = ?")
    .run("12345678000199", 5000 + n, operacao.customerId);
  closeWeighingOperation(database, { operationId: operacao.id, exitWeightKg: 18_500 });
  return operacao.id;
}
