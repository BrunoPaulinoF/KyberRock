import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface AccountRow {
  id: string;
  company_id: string;
  code: string | null;
  name: string;
  omie_code: string | null;
  is_system: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
}

export interface CreateAccountInput {
  companyId: string;
  name: string;
  omieCode?: string | null;
  sortOrder?: number;
}

/**
 * Campos editaveis localmente. Nome e codigo OMIE sao de propriedade do OMIE
 * (chegam pela sincronizacao) e nao podem ser alterados no desktop.
 */
export interface UpdateAccountInput {
  isActive?: boolean;
  sortOrder?: number;
}

interface DefaultAccount {
  code: string;
  name: string;
  sortOrder: number;
}

/** Contas padrao pre-configuradas (podem ser renomeadas, nao excluidas). */
export const DEFAULT_ACCOUNTS: readonly DefaultAccount[] = [
  { code: "caixinha", name: "Caixinha", sortOrder: 1 },
  { code: "omie_cash", name: "OMIE Cash", sortOrder: 2 },
  { code: "getnet", name: "GetNet", sortOrder: 3 }
];

/**
 * Garante que as contas padrao existam para a empresa. Idempotente: nao
 * duplica contas ja presentes (mesmo codigo).
 */
export function ensureDefaultAccounts(
  database: DesktopDatabase,
  companyId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  const insert = database.prepare(
    `INSERT INTO accounts
       (id, company_id, code, name, is_system, sort_order, is_active, created_at, updated_at)
     SELECT ?, ?, ?, ?, 1, ?, 1, ?, ?
     WHERE EXISTS (SELECT 1 FROM companies WHERE id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL
       )`
  );

  const seed = database.transaction(() => {
    for (const account of DEFAULT_ACCOUNTS) {
      insert.run(
        randomUUID(),
        companyId,
        account.code,
        account.name,
        account.sortOrder,
        nowIso,
        nowIso,
        companyId,
        companyId,
        account.code
      );
    }
  });
  seed();
}

export function listAccounts(database: DesktopDatabase, companyId: string): AccountRow[] {
  return database
    .prepare(
      `SELECT * FROM accounts
       WHERE company_id = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC, name ASC`
    )
    .all(companyId) as AccountRow[];
}

export function createAccount(
  database: DesktopDatabase,
  input: CreateAccountInput,
  now: Date = new Date()
): AccountRow {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Informe o nome da conta.");
  }

  const id = randomUUID();
  const nowIso = now.toISOString();
  const sortOrder =
    input.sortOrder ??
    ((
      database
        .prepare(
          "SELECT COALESCE(MAX(sort_order), 0) AS max FROM accounts WHERE company_id = ? AND deleted_at IS NULL"
        )
        .get(input.companyId) as { max: number }
    ).max +
      1);

  database
    .prepare(
      `INSERT INTO accounts
         (id, company_id, code, name, omie_code, is_system, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 0, ?, 1, ?, ?)`
    )
    .run(id, input.companyId, name, input.omieCode?.trim() || null, sortOrder, nowIso, nowIso);

  return database.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow;
}

export function updateAccount(
  database: DesktopDatabase,
  id: string,
  input: UpdateAccountInput,
  now: Date = new Date()
): AccountRow {
  const existing = database
    .prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(id) as AccountRow | undefined;
  if (!existing) {
    throw new Error("Conta nao encontrada.");
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }
  if (input.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(input.sortOrder);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  values.push(now.toISOString());
  values.push(id);

  database.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return database.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow;
}

export function deleteAccount(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(id) as AccountRow | undefined;
  if (!existing) {
    throw new Error("Conta nao encontrada.");
  }
  if (existing.is_system) {
    throw new Error("As contas padrao do sistema nao podem ser excluidas. Desative-a se necessario.");
  }

  const nowIso = now.toISOString();
  const unbindAndDelete = database.transaction(() => {
    // Formas de pagamento que apontavam para esta conta ficam sem conta.
    database
      .prepare("UPDATE payment_methods SET account_id = NULL, updated_at = ? WHERE account_id = ?")
      .run(nowIso, id);
    database
      .prepare("UPDATE accounts SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?")
      .run(nowIso, nowIso, id);
  });
  unbindAndDelete();
}
