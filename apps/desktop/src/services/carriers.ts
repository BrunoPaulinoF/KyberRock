import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateCarrierInput {
  companyId: string;
  name: string;
  document?: string;
  omieCustomerId?: number;
}

export interface UpdateCarrierInput {
  name?: string;
  document?: string;
  omieCustomerId?: number | null;
  isActive?: boolean;
}

export function createCarrier(
  database: DesktopDatabase,
  input: CreateCarrierInput,
  now: Date = new Date()
): unknown {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO carriers (id, company_id, omie_customer_id, name, document, source, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'local', 1, ?, ?)`
    )
    .run(id, input.companyId, input.omieCustomerId ?? null, input.name, input.document ?? null, nowIso, nowIso);

  return database.prepare("SELECT * FROM carriers WHERE id = ?").get(id);
}

export function updateCarrier(
  database: DesktopDatabase,
  id: string,
  input: UpdateCarrierInput,
  now: Date = new Date()
): unknown {
  const existing = database
    .prepare("SELECT * FROM carriers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as Record<string, unknown> | undefined;

  if (!existing) throw new Error("Transportadora nao encontrada.");

  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); values.push(input.name); }
  if (input.document !== undefined) { sets.push("document = ?"); values.push(input.document); }
  if (input.omieCustomerId !== undefined) { sets.push("omie_customer_id = ?"); values.push(input.omieCustomerId); }
  if (input.isActive !== undefined) { sets.push("is_active = ?"); values.push(input.isActive ? 1 : 0); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  values.push(nowIso);
  values.push(id);

  database.prepare(`UPDATE carriers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return database.prepare("SELECT * FROM carriers WHERE id = ?").get(id);
}

export function deleteCarrier(database: DesktopDatabase, id: string, now: Date = new Date()): void {
  database
    .prepare("UPDATE carriers SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(now.toISOString(), now.toISOString(), id);
}
