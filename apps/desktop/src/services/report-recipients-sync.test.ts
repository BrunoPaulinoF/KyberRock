import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import {
  createReportRecipient,
  deleteReportRecipient,
  listReportRecipients
} from "./report-recipients";
import { pullDesktopDataFromCloud, pushPendingReportRecipients } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

/**
 * Exclusao de destinatario na tela de Relatorios.
 *
 * O destinatario excluido voltava sozinho para a lista: o soft delete local ia
 * para a nuvem so como "inativo" e o pull seguinte — ja com o needs_push zerado
 * pelo proprio push — limpava o deleted_at recem-gravado. A exclusao agora viaja
 * como tombstone e o espelho da nuvem e aplicado como esta.
 */
describe("exclusao de destinatario de relatorio", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("nao traz de volta o destinatario excluido no pull seguinte", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      const recipient = createReportRecipient(database, {
        companyId: "company-1",
        email: "financeiro@pedreira.com.br",
        displayName: "Financeiro"
      });
      await pushPendingReportRecipients(database, identity);

      deleteReportRecipient(database, recipient.id);
      await pushPendingReportRecipients(database, identity);
      expect(listReportRecipients(database, "company-1")).toHaveLength(0);

      // A nuvem devolve o mesmo destinatario, agora com o tombstone que o push levou.
      mockPull([
        cloudRecipient({
          id: recipient.id,
          is_active: false,
          deleted_at: "2026-08-19T12:00:00.000Z"
        })
      ]);
      await pullDesktopDataFromCloud(database, identity);

      expect(listReportRecipients(database, "company-1")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("envia a exclusao como tombstone para as outras balancas", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      const recipient = createReportRecipient(database, {
        companyId: "company-1",
        email: "financeiro@pedreira.com.br"
      });
      await pushPendingReportRecipients(database, identity);

      deleteReportRecipient(database, recipient.id, new Date("2026-08-19T12:00:00.000Z"));
      invokeMock.mockClear();
      await pushPendingReportRecipients(database, identity);

      expect(pushedRecipients()).toMatchObject([
        { id: recipient.id, is_active: false, deleted_at: "2026-08-19T12:00:00.000Z" }
      ]);
    } finally {
      database.close();
    }
  });

  // Instalador novo chega antes da migracao do Supabase: a nuvem responde sem a
  // coluna deleted_at. Nessa janela a exclusao local e a unica que existe.
  it("mantem a exclusao local quando a nuvem ainda nao tem a coluna deleted_at", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      const recipient = createReportRecipient(database, {
        companyId: "company-1",
        email: "financeiro@pedreira.com.br"
      });
      await pushPendingReportRecipients(database, identity);
      deleteReportRecipient(database, recipient.id);
      await pushPendingReportRecipients(database, identity);

      const legacyRow = cloudRecipient({ id: recipient.id, is_active: false });
      delete legacyRow.deleted_at;
      mockPull([legacyRow]);
      await pullDesktopDataFromCloud(database, identity);

      expect(listReportRecipients(database, "company-1")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  // Quem foi excluido ANTES desta versao esta na nuvem so como is_active = false:
  // a exclusao nunca chegou la. Depois da migracao a coluna existe e vem nula —
  // aceita-la de volta ressuscitaria justamente o destinatario que o operador
  // apagou e que sumiu da tela.
  it("nao ressuscita o destinatario que a nuvem conhece apenas como inativo", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      const recipient = createReportRecipient(database, {
        companyId: "company-1",
        email: "financeiro@pedreira.com.br"
      });
      await pushPendingReportRecipients(database, identity);
      deleteReportRecipient(database, recipient.id, new Date("2026-08-19T12:00:00.000Z"));
      await pushPendingReportRecipients(database, identity);

      mockPull([cloudRecipient({ id: recipient.id, is_active: false, deleted_at: null })]);
      await pullDesktopDataFromCloud(database, identity);
      expect(listReportRecipients(database, "company-1")).toHaveLength(0);

      // E o tombstone volta para a fila: o proximo push conta a exclusao para a nuvem.
      invokeMock.mockClear();
      invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
      await pushPendingReportRecipients(database, identity);
      expect(pushedRecipients()).toMatchObject([
        { id: recipient.id, is_active: false, deleted_at: "2026-08-19T12:00:00.000Z" }
      ]);
    } finally {
      database.close();
    }
  });

  it("apaga aqui o destinatario excluido na outra balanca", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      mockPull([cloudRecipient({ id: "recipient-1" })]);
      await pullDesktopDataFromCloud(database, identity);
      expect(listReportRecipients(database, "company-1")).toHaveLength(1);

      mockPull([
        cloudRecipient({
          id: "recipient-1",
          is_active: false,
          deleted_at: "2026-08-19T12:00:00.000Z",
          updated_at: "2026-08-19T12:00:00.000Z"
        })
      ]);
      await pullDesktopDataFromCloud(database, identity);

      expect(listReportRecipients(database, "company-1")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("recadastra na outra balanca um contato que foi excluido aqui", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      mockPull([
        cloudRecipient({
          id: "recipient-1",
          is_active: false,
          deleted_at: "2026-08-19T12:00:00.000Z"
        })
      ]);
      await pullDesktopDataFromCloud(database, identity);
      expect(listReportRecipients(database, "company-1")).toHaveLength(0);

      // A outra balanca recadastrou o mesmo contato: a nuvem devolve a linha viva.
      mockPull([cloudRecipient({ id: "recipient-1", updated_at: "2026-08-19T13:00:00.000Z" })]);
      await pullDesktopDataFromCloud(database, identity);

      expect(listReportRecipients(database, "company-1")).toMatchObject([
        { id: "recipient-1", email: "financeiro@pedreira.com.br", isActive: true }
      ]);
    } finally {
      database.close();
    }
  });

  // O tombstone continua ocupando o e-mail nos indices unicos locais: sem solta-lo,
  // o destinatario recadastrado na outra maquina (id novo) nunca chegava aqui.
  it("aceita da nuvem um id novo para o e-mail que ficou em um tombstone ja sincronizado", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      mockPull([
        cloudRecipient({
          id: "recipient-1",
          is_active: false,
          deleted_at: "2026-08-19T12:00:00.000Z"
        })
      ]);
      await pullDesktopDataFromCloud(database, identity);

      mockPull([cloudRecipient({ id: "recipient-2", updated_at: "2026-08-19T13:00:00.000Z" })]);
      await pullDesktopDataFromCloud(database, identity);

      expect(listReportRecipients(database, "company-1")).toMatchObject([
        { id: "recipient-2", email: "financeiro@pedreira.com.br" }
      ]);
    } finally {
      database.close();
    }
  });
});

function cloudRecipient(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "recipient-1",
    company_id: "company-1",
    email: "financeiro@pedreira.com.br",
    whatsapp_phone: null,
    send_email: true,
    send_whatsapp: false,
    schedule_frequency: "daily",
    schedule_time: "20:00",
    report_types: "sales",
    send_financial: false,
    financial_schedule_time: null,
    display_name: "Financeiro",
    is_active: true,
    created_at: "2026-08-19T10:00:00.000Z",
    updated_at: "2026-08-19T11:00:00.000Z",
    deleted_at: null,
    ...overrides
  };
}

function mockPull(reportRecipients: Array<Record<string, unknown>>): void {
  invokeMock.mockResolvedValueOnce({ data: { reportRecipients }, error: null });
}

function pushedRecipients(): Array<Record<string, unknown>> {
  const call = invokeMock.mock.calls.find(([, options]) =>
    Array.isArray(options?.body?.reportRecipients)
  );
  return (call?.[1].body.reportRecipients ?? []) as Array<Record<string, unknown>>;
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
  const now = "2026-08-19T10:00:00.000Z";
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
