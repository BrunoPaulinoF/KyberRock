import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateDriverInput {
  companyId: string;
  name: string;
  document?: string;
  phone?: string;
  isIndependent?: boolean;
}

export interface UpdateDriverInput {
  name?: string;
  document?: string;
  phone?: string;
  isActive?: boolean;
  isIndependent?: boolean;
}

export interface DriverRow {
  id: string;
  company_id: string;
  name: string;
  document: string | null;
  phone: string | null;
  is_active: number;
  is_independent: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function createDriver(
  database: DesktopDatabase,
  input: CreateDriverInput,
  now: Date = new Date()
): DriverRow {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO drivers (id, company_id, name, document, phone, is_independent, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.name,
      input.document ?? null,
      input.phone ?? null,
      input.isIndependent ? 1 : 0,
      nowIso,
      nowIso
    );

  return database.prepare("SELECT * FROM drivers WHERE id = ?").get(id) as DriverRow;
}

export function updateDriver(
  database: DesktopDatabase,
  id: string,
  input: UpdateDriverInput,
  now: Date = new Date()
): DriverRow {
  const existing = database
    .prepare("SELECT * FROM drivers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as DriverRow | undefined;

  if (!existing) throw new Error("Motorista nao encontrado.");

  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(input.name);
  }
  if (input.document !== undefined) {
    sets.push("document = ?");
    values.push(input.document);
  }
  if (input.phone !== undefined) {
    sets.push("phone = ?");
    values.push(input.phone);
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }
  if (input.isIndependent !== undefined) {
    sets.push("is_independent = ?");
    values.push(input.isIndependent ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  values.push(nowIso);
  values.push(id);

  database.prepare(`UPDATE drivers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return database.prepare("SELECT * FROM drivers WHERE id = ?").get(id) as DriverRow;
}

export function deleteDriver(database: DesktopDatabase, id: string, now: Date = new Date()): void {
  const existing = database
    .prepare("SELECT id FROM drivers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;

  if (!existing) throw new Error("Motorista nao encontrado.");

  database
    .prepare(
      "UPDATE drivers SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    )
    .run(now.toISOString(), now.toISOString(), id);
}

export function findOrCreateDriver(
  database: DesktopDatabase,
  companyId: string,
  name: string,
  now: Date = new Date()
): DriverRow {
  const normalized = name.trim();
  const existing = database
    .prepare("SELECT * FROM drivers WHERE company_id = ? AND name = ? AND deleted_at IS NULL")
    .get(companyId, normalized) as DriverRow | undefined;

  if (existing) return existing;

  return createDriver(database, { companyId, name: normalized }, now);
}

export function listDrivers(database: DesktopDatabase, companyId: string): DriverRow[] {
  return database
    .prepare("SELECT * FROM drivers WHERE company_id = ? AND deleted_at IS NULL ORDER BY name ASC")
    .all(companyId) as DriverRow[];
}
