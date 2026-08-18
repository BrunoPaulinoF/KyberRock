import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";

/**
 * O caminho de atualizacao real do release seguinte: a balanca esta na 54, com meses de
 * faturamento ja conferido no OMIE, e o instalador novo sobe para a 55 — o numero da nota
 * fiscal em coluna propria.
 *
 * O que se testa aqui e a RELEITURA do acervo. A conferencia so pergunta ao OMIE pelos
 * documentos que ainda nao constam faturados; o que ja esta faturado nunca mais volta a
 * ser perguntado. Sem o backfill, todo o historico estrearia no fechamento de faturas com
 * a coluna da nota vazia e nada jamais a preencheria.
 */
describe("atualizacao de um banco em uso (54 -> 55)", () => {
  it("recupera o numero da nota que estava preso na frase da conferencia", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 54);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(54);
      const identity = seedCadastro(database);

      // Como a balanca na 54 guardava: o numero da nota dentro do texto que o operador le.
      insertOperation(database, identity, "op-nfe", "Faturado no OMIE — NF-e 000028727.");
      insertOperation(database, identity, "op-nfse", "Faturado no OMIE — NFS-e 4512.");
      insertOperation(database, identity, "op-sem-numero", "Faturado no OMIE.");
      insertOperation(database, identity, "op-pendente", null);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(55);

      expect(invoiceNumber(database, "op-nfe")).toBe("000028727");
      expect(invoiceNumber(database, "op-nfse")).toBe("4512");
      // Faturado sem numero na frase continua sem numero: o backfill le o que existe, nao
      // inventa. A pesagem que nem faturada esta, idem.
      expect(invoiceNumber(database, "op-sem-numero")).toBeNull();
      expect(invoiceNumber(database, "op-pendente")).toBeNull();

      // O zero a esquerda e o que se digita na busca do OMIE — perde-lo seria perder a
      // razao de a coluna ser texto.
      expect(invoiceNumber(database, "op-nfe")).not.toBe("28727");

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("permite voltar para o build anterior: a coluna nova fica inerte", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const identity = seedCadastro(database);
      insertOperation(database, identity, "op-nfe", "Faturado no OMIE — NF-e 000028727.");

      // O instalador anterior so conhece ate a 54: runDesktopMigrations itera a PROPRIA
      // lista, entao a 55 gravada em schema_migrations e ignorada e o build antigo segue
      // lendo o numero da frase, como sempre leu.
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 54);
      expect(() => runDesktopMigrations(database, previous)).not.toThrow();
      expect(
        database
          .prepare("SELECT omie_billing_message FROM weighing_operations WHERE id = 'op-nfe'")
          .pluck()
          .get()
      ).toBe("Faturado no OMIE — NF-e 000028727.");
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      database.close();
    }
  });
});

type Identity = ReturnType<typeof ensureInitialDesktopIdentity>;

function invoiceNumber(database: DesktopDatabase, operationId: string): string | null {
  return database
    .prepare("SELECT omie_invoice_number FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(operationId) as string | null;
}

function seedCadastro(database: DesktopDatabase): Identity {
  const identity = ensureInitialDesktopIdentity(database, {
    companyId: "c1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "u1",
    unitName: "Pedreira Principal",
    deviceId: "d1",
    deviceName: "PC Balanca",
    installationId: "i1"
  });
  const at = "2026-08-13T09:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('cust-1', ?, 'local', 'Construtora', 'Construtora', 1, ?, ?)`
    )
    .run(identity.companyId, at, at);
  return identity;
}

function insertOperation(
  database: DesktopDatabase,
  identity: Identity,
  id: string,
  billingMessage: string | null
): void {
  const at = "2026-08-13T09:00:00.000Z";
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, customer_id,
          net_weight_kg, total_cents, omie_billing_status, omie_billing_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'synced', 'invoice', 'cust-1', 6500, 78000, ?, ?, ?, ?)`
    )
    .run(
      id,
      identity.companyId,
      identity.unitId,
      identity.deviceId,
      billingMessage ? "billed" : null,
      billingMessage,
      at,
      at
    );
}
