import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface ReportRecipientRow {
  id: string;
  company_id: string;
  email: string | null;
  whatsapp_phone: string | null;
  send_email: number;
  send_whatsapp: number;
  display_name: string | null;
  is_active: number;
  needs_push: number;
  sync_status: "synced" | "pending" | "error";
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ReportRecipient {
  id: string;
  companyId: string;
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  displayName: string | null;
  isActive: boolean;
  syncStatus: "synced" | "pending" | "error";
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportRecipientInput {
  companyId: string;
  email?: string | null;
  whatsappPhone?: string | null;
  sendEmail?: boolean;
  sendWhatsapp?: boolean;
  displayName?: string | null;
  isActive?: boolean;
}

export interface UpdateReportRecipientInput {
  email?: string | null;
  whatsappPhone?: string | null;
  sendEmail?: boolean;
  sendWhatsapp?: boolean;
  displayName?: string | null;
  isActive?: boolean;
}

function mapRow(row: ReportRecipientRow): ReportRecipient {
  return {
    id: row.id,
    companyId: row.company_id,
    email: row.email,
    whatsappPhone: row.whatsapp_phone,
    sendEmail: row.send_email === 1,
    sendWhatsapp: row.send_whatsapp === 1,
    displayName: row.display_name,
    isActive: row.is_active === 1,
    syncStatus: row.sync_status,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function isValidWhatsappPhone(phone: string): boolean {
  return /^\d{12,13}$/.test(phone);
}

function ensureValidRecipient(input: {
  email?: string | null;
  whatsappPhone?: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
}): { email: string | null; whatsappPhone: string | null } {
  const email = input.email?.trim().toLowerCase() || null;
  const whatsappPhone = input.whatsappPhone ? normalizePhone(input.whatsappPhone) : null;

  if (!input.sendEmail && !input.sendWhatsapp) {
    throw new Error("Selecione pelo menos um canal de envio.");
  }
  if (input.sendEmail && (!email || !isValidEmail(email))) {
    throw new Error("E-mail invalido.");
  }
  if (input.sendWhatsapp && (!whatsappPhone || !isValidWhatsappPhone(whatsappPhone))) {
    throw new Error("WhatsApp invalido. Informe DDD e numero, ou o codigo do pais.");
  }

  return { email, whatsappPhone };
}

function ensureRecipientsTable(database: DesktopDatabase): void {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS report_recipients (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      email TEXT,
      whatsapp_phone TEXT,
      send_email INTEGER NOT NULL DEFAULT 1 CHECK (send_email IN (0, 1)),
      send_whatsapp INTEGER NOT NULL DEFAULT 0 CHECK (send_whatsapp IN (0, 1)),
      display_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      needs_push INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('synced', 'pending', 'error')),
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(company_id, email)
    );`;
  database.exec(`
    ${createTableSql}
    CREATE INDEX IF NOT EXISTS idx_report_recipients_company_active
      ON report_recipients(company_id, is_active, deleted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_report_recipients_company_whatsapp
      ON report_recipients(company_id, whatsapp_phone)
      WHERE whatsapp_phone IS NOT NULL;
  `);
  const columns = database.prepare("PRAGMA table_info(report_recipients)").all() as Array<{
    name: string;
  }>;
  const existingColumns = new Set(columns.map((column) => column.name));
  if (!existingColumns.has("whatsapp_phone")) {
    database.prepare("ALTER TABLE report_recipients ADD COLUMN whatsapp_phone TEXT").run();
  }
  if (!existingColumns.has("send_email")) {
    database
      .prepare(
        "ALTER TABLE report_recipients ADD COLUMN send_email INTEGER NOT NULL DEFAULT 1 CHECK (send_email IN (0, 1))"
      )
      .run();
  }
  if (!existingColumns.has("send_whatsapp")) {
    database
      .prepare(
        "ALTER TABLE report_recipients ADD COLUMN send_whatsapp INTEGER NOT NULL DEFAULT 0 CHECK (send_whatsapp IN (0, 1))"
      )
      .run();
  }
  const currentColumns = database.prepare("PRAGMA table_info(report_recipients)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  if (currentColumns.some((column) => column.name === "email" && column.notnull === 1)) {
    database.exec(`
      ALTER TABLE report_recipients RENAME TO report_recipients_old;
      ${createTableSql}
      INSERT INTO report_recipients (
        id, company_id, email, whatsapp_phone, send_email, send_whatsapp, display_name, is_active,
        needs_push, sync_status, last_synced_at, last_error, created_at, updated_at, deleted_at
      )
      SELECT
        id, company_id, email, whatsapp_phone, send_email, send_whatsapp, display_name, is_active,
        needs_push, sync_status, last_synced_at, last_error, created_at, updated_at, deleted_at
      FROM report_recipients_old;
      DROP TABLE report_recipients_old;
      CREATE INDEX IF NOT EXISTS idx_report_recipients_company_active
        ON report_recipients(company_id, is_active, deleted_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_report_recipients_company_whatsapp
        ON report_recipients(company_id, whatsapp_phone)
        WHERE whatsapp_phone IS NOT NULL;
    `);
  }
}

export function listReportRecipients(
  database: DesktopDatabase,
  companyId: string
): ReportRecipient[] {
  ensureRecipientsTable(database);
  const rows = database
    .prepare(
      `SELECT * FROM report_recipients
       WHERE company_id = ? AND deleted_at IS NULL
       ORDER BY is_active DESC, display_name ASC, email ASC, whatsapp_phone ASC`
    )
    .all(companyId) as ReportRecipientRow[];
  return rows.map(mapRow);
}

export function createReportRecipient(
  database: DesktopDatabase,
  input: CreateReportRecipientInput,
  now: Date = new Date()
): ReportRecipient {
  ensureRecipientsTable(database);
  const sendEmail = input.sendEmail !== false;
  const sendWhatsapp = input.sendWhatsapp === true;
  const { email, whatsappPhone } = ensureValidRecipient({
    email: input.email,
    whatsappPhone: input.whatsappPhone,
    sendEmail,
    sendWhatsapp
  });
  const displayName = input.displayName?.trim() || null;
  const isActive = input.isActive === false ? 0 : 1;
  const timestamp = now.toISOString();

  const existing = database
    .prepare(
      `SELECT id FROM report_recipients
       WHERE company_id = ? AND email = ? AND deleted_at IS NULL`
    )
    .get(input.companyId, email) as { id: string } | undefined;
  if (email && existing) {
    throw new Error("Ja existe um destinatario com esse e-mail.");
  }
  const existingPhone = whatsappPhone
    ? (database
        .prepare(
          `SELECT id FROM report_recipients
           WHERE company_id = ? AND whatsapp_phone = ? AND deleted_at IS NULL`
        )
        .get(input.companyId, whatsappPhone) as { id: string } | undefined)
    : undefined;
  if (existingPhone) {
    throw new Error("Ja existe um destinatario com esse WhatsApp.");
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO report_recipients (
        id, company_id, email, whatsapp_phone, send_email, send_whatsapp, display_name, is_active,
        needs_push, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)`
    )
    .run(
      id,
      input.companyId,
      email,
      whatsappPhone,
      sendEmail ? 1 : 0,
      sendWhatsapp ? 1 : 0,
      displayName,
      isActive,
      timestamp,
      timestamp
    );

  return mapRow(
    database.prepare("SELECT * FROM report_recipients WHERE id = ?").get(id) as ReportRecipientRow
  );
}

export function updateReportRecipient(
  database: DesktopDatabase,
  id: string,
  input: UpdateReportRecipientInput,
  now: Date = new Date()
): ReportRecipient {
  ensureRecipientsTable(database);
  const existing = database
    .prepare("SELECT * FROM report_recipients WHERE id = ? AND deleted_at IS NULL")
    .get(id) as ReportRecipientRow | undefined;
  if (!existing) {
    throw new Error("Destinatario nao encontrado.");
  }

  const timestamp = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  const candidateSendEmail = input.sendEmail ?? existing.send_email === 1;
  const candidateSendWhatsapp = input.sendWhatsapp ?? existing.send_whatsapp === 1;
  const candidateEmail = input.email !== undefined ? input.email : existing.email;
  const candidateWhatsappPhone =
    input.whatsappPhone !== undefined ? input.whatsappPhone : existing.whatsapp_phone;
  const normalizedCandidate = ensureValidRecipient({
    email: candidateEmail,
    whatsappPhone: candidateWhatsappPhone,
    sendEmail: candidateSendEmail,
    sendWhatsapp: candidateSendWhatsapp
  });

  if (input.email !== undefined) {
    const email = normalizedCandidate.email;
    if (email !== existing.email) {
      const conflict = database
        .prepare(
          `SELECT id FROM report_recipients
           WHERE company_id = ? AND email = ? AND id <> ? AND deleted_at IS NULL`
        )
        .get(existing.company_id, email, id) as { id: string } | undefined;
      if (email && conflict) {
        throw new Error("Ja existe um destinatario com esse e-mail.");
      }
    }
    sets.push("email = ?");
    values.push(email);
  }

  if (input.whatsappPhone !== undefined) {
    const whatsappPhone = normalizedCandidate.whatsappPhone;
    if (whatsappPhone !== existing.whatsapp_phone) {
      const conflict = whatsappPhone
        ? (database
            .prepare(
              `SELECT id FROM report_recipients
               WHERE company_id = ? AND whatsapp_phone = ? AND id <> ? AND deleted_at IS NULL`
            )
            .get(existing.company_id, whatsappPhone, id) as { id: string } | undefined)
        : undefined;
      if (conflict) {
        throw new Error("Ja existe um destinatario com esse WhatsApp.");
      }
    }
    sets.push("whatsapp_phone = ?");
    values.push(whatsappPhone);
  }

  if (input.sendEmail !== undefined) {
    sets.push("send_email = ?");
    values.push(input.sendEmail ? 1 : 0);
  }

  if (input.sendWhatsapp !== undefined) {
    sets.push("send_whatsapp = ?");
    values.push(input.sendWhatsapp ? 1 : 0);
  }

  if (input.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(input.displayName?.trim() || null);
  }

  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }

  if (sets.length > 0) {
    sets.push("needs_push = 1");
    sets.push("sync_status = 'pending'");
    sets.push("last_error = NULL");
    sets.push("updated_at = ?");
    values.push(timestamp);
    values.push(id);
    database.prepare(`UPDATE report_recipients SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  } else {
    database.prepare("UPDATE report_recipients SET updated_at = ? WHERE id = ?").run(timestamp, id);
  }

  return mapRow(
    database.prepare("SELECT * FROM report_recipients WHERE id = ?").get(id) as ReportRecipientRow
  );
}

export function deleteReportRecipient(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  ensureRecipientsTable(database);
  const existing = database
    .prepare("SELECT id FROM report_recipients WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;
  if (!existing) {
    throw new Error("Destinatario nao encontrado.");
  }
  database
    .prepare("UPDATE report_recipients SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(now.toISOString(), now.toISOString(), id);
}

export function markRecipientSynced(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  database
    .prepare(
      `UPDATE report_recipients
       SET sync_status = 'synced', last_synced_at = ?, last_error = NULL,
           needs_push = 0, updated_at = ?
       WHERE id = ?`
    )
    .run(now.toISOString(), now.toISOString(), id);
}

export function markRecipientSyncError(database: DesktopDatabase, id: string, error: string): void {
  database
    .prepare(
      `UPDATE report_recipients
       SET sync_status = 'error', last_error = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(error, id);
}
