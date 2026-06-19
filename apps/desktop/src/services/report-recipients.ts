import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface ReportRecipientRow {
  id: string;
  company_id: string;
  email: string;
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
  email: string;
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
  email: string;
  displayName?: string | null;
  isActive?: boolean;
}

export interface UpdateReportRecipientInput {
  email?: string;
  displayName?: string | null;
  isActive?: boolean;
}

function mapRow(row: ReportRecipientRow): ReportRecipient {
  return {
    id: row.id,
    companyId: row.company_id,
    email: row.email,
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

function ensureRecipientsTable(database: DesktopDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS report_recipients (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      email TEXT NOT NULL,
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
    );
    CREATE INDEX IF NOT EXISTS idx_report_recipients_company_active
      ON report_recipients(company_id, is_active, deleted_at);
  `);
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
       ORDER BY is_active DESC, display_name ASC, email ASC`
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
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("E-mail invalido.");
  }
  const displayName = input.displayName?.trim() || null;
  const isActive = input.isActive === false ? 0 : 1;
  const timestamp = now.toISOString();

  const existing = database
    .prepare(
      `SELECT id FROM report_recipients
       WHERE company_id = ? AND email = ? AND deleted_at IS NULL`
    )
    .get(input.companyId, email) as { id: string } | undefined;
  if (existing) {
    throw new Error("Ja existe um destinatario com esse e-mail.");
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO report_recipients (
        id, company_id, email, display_name, is_active,
        needs_push, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'pending', ?, ?)`
    )
    .run(id, input.companyId, email, displayName, isActive, timestamp, timestamp);

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

  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      throw new Error("E-mail invalido.");
    }
    if (email !== existing.email) {
      const conflict = database
        .prepare(
          `SELECT id FROM report_recipients
           WHERE company_id = ? AND email = ? AND id <> ? AND deleted_at IS NULL`
        )
        .get(existing.company_id, email, id) as { id: string } | undefined;
      if (conflict) {
        throw new Error("Ja existe um destinatario com esse e-mail.");
      }
    }
    sets.push("email = ?");
    values.push(email);
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

export function markRecipientSyncError(
  database: DesktopDatabase,
  id: string,
  error: string
): void {
  database
    .prepare(
      `UPDATE report_recipients
       SET sync_status = 'error', last_error = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(error, id);
}
