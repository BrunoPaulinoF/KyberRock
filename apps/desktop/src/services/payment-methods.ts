import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface PaymentMethodRow {
  id: string;
  company_id: string;
  code: string;
  name: string;
  alias: string | null;
  omie_code: string | null;
  account_id: string | null;
  is_system: number;
  is_customer_credit: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
}

export interface CreatePaymentMethodInput {
  companyId: string;
  code?: string;
  name: string;
  alias?: string | null;
  omieCode?: string | null;
  accountId?: string | null;
  isCustomerCredit?: boolean;
  sortOrder?: number;
}

/**
 * Campos editaveis localmente. Nome e codigo OMIE sao de propriedade do OMIE
 * (chegam pela sincronizacao) e nao podem ser alterados no desktop.
 */
export interface UpdatePaymentMethodInput {
  alias?: string | null;
  accountId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

/** Nome exibido da forma de pagamento: o apelido quando definido, senao o nome. */
export function paymentMethodDisplayName(row: {
  alias: string | null;
  name: string;
}): string {
  const alias = row.alias?.trim();
  return alias && alias.length > 0 ? alias : row.name;
}

interface DefaultPaymentMethod {
  code: string;
  name: string;
  isCustomerCredit: boolean;
  sortOrder: number;
  /**
   * Codigo do meio de pagamento no OMIE/NF-e (tPag) ja de fabrica, para o pedido levar
   * o meio mesmo sem sincronizar os meios do OMIE. Sao codigos padronizados: 01 dinheiro,
   * 17 PIX, 03 credito, 04 debito, 15 boleto. O credito do cliente (fiado) nao mapeia
   * para um meio direto do OMIE, entao fica sem codigo.
   */
  omieCode: string | null;
}

/** Formas de pagamento padrao que ja vem cadastradas com o sistema. */
export const DEFAULT_PAYMENT_METHODS: readonly DefaultPaymentMethod[] = [
  { code: "cash", name: "Dinheiro", isCustomerCredit: false, sortOrder: 1, omieCode: "01" },
  { code: "pix", name: "Pix", isCustomerCredit: false, sortOrder: 2, omieCode: "17" },
  { code: "credit_card", name: "Cartao de credito", isCustomerCredit: false, sortOrder: 3, omieCode: "03" },
  { code: "debit_card", name: "Cartao de debito", isCustomerCredit: false, sortOrder: 4, omieCode: "04" },
  { code: "boleto", name: "Boleto", isCustomerCredit: false, sortOrder: 5, omieCode: "15" },
  { code: "customer_credit", name: "Credito do cliente", isCustomerCredit: true, sortOrder: 6, omieCode: null }
];

/** Codigo da forma de pagamento "credito do cliente" (fiado). */
export const CUSTOMER_CREDIT_METHOD_CODE = "customer_credit";

/**
 * Garante que as formas de pagamento padrao existam para a empresa.
 * Idempotente: nao duplica formas ja presentes (mesmo codigo).
 */
export function ensureDefaultPaymentMethods(
  database: DesktopDatabase,
  companyId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  const insert = database.prepare(
    `INSERT INTO payment_methods
       (id, company_id, code, name, omie_code, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?
     WHERE EXISTS (SELECT 1 FROM companies WHERE id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM payment_methods
         WHERE company_id = ? AND code = ? AND deleted_at IS NULL
       )`
  );

  const seed = database.transaction(() => {
    for (const method of DEFAULT_PAYMENT_METHODS) {
      insert.run(
        randomUUID(),
        companyId,
        method.code,
        method.name,
        method.omieCode,
        method.isCustomerCredit ? 1 : 0,
        method.sortOrder,
        nowIso,
        nowIso,
        companyId,
        companyId,
        method.code
      );
    }
  });
  seed();
}

export function listPaymentMethods(
  database: DesktopDatabase,
  companyId: string
): PaymentMethodRow[] {
  return database
    .prepare(
      `SELECT * FROM payment_methods
       WHERE company_id = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC, name ASC`
    )
    .all(companyId) as PaymentMethodRow[];
}

function slugifyCode(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "forma";
}

export function createPaymentMethod(
  database: DesktopDatabase,
  input: CreatePaymentMethodInput,
  now: Date = new Date()
): PaymentMethodRow {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Informe o nome da forma de pagamento.");
  }

  const id = randomUUID();
  const nowIso = now.toISOString();

  let code = (input.code ?? slugifyCode(name)).trim();
  // Garante unicidade do codigo por empresa.
  const codeExists = database.prepare(
    "SELECT 1 FROM payment_methods WHERE company_id = ? AND code = ? AND deleted_at IS NULL"
  );
  if (codeExists.get(input.companyId, code)) {
    code = `${code}_${id.slice(0, 8)}`;
  }

  const sortOrder =
    input.sortOrder ??
    (
      database
        .prepare(
          "SELECT COALESCE(MAX(sort_order), 0) AS max FROM payment_methods WHERE company_id = ? AND deleted_at IS NULL"
        )
        .get(input.companyId) as { max: number }
    ).max + 1;

  database
    .prepare(
      `INSERT INTO payment_methods
         (id, company_id, code, name, alias, omie_code, account_id, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      code,
      name,
      input.alias?.trim() || null,
      input.omieCode?.trim() || null,
      input.accountId || null,
      input.isCustomerCredit ? 1 : 0,
      sortOrder,
      nowIso,
      nowIso
    );

  return database.prepare("SELECT * FROM payment_methods WHERE id = ?").get(id) as PaymentMethodRow;
}

export function updatePaymentMethod(
  database: DesktopDatabase,
  id: string,
  input: UpdatePaymentMethodInput,
  now: Date = new Date()
): PaymentMethodRow {
  const existing = database
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND deleted_at IS NULL")
    .get(id) as PaymentMethodRow | undefined;
  if (!existing) {
    throw new Error("Forma de pagamento nao encontrada.");
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.alias !== undefined) {
    sets.push("alias = ?");
    values.push(input.alias?.trim() || null);
  }
  if (input.accountId !== undefined) {
    sets.push("account_id = ?");
    values.push(input.accountId || null);
  }
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

  database.prepare(`UPDATE payment_methods SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return database.prepare("SELECT * FROM payment_methods WHERE id = ?").get(id) as PaymentMethodRow;
}

export function deletePaymentMethod(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND deleted_at IS NULL")
    .get(id) as PaymentMethodRow | undefined;
  if (!existing) {
    throw new Error("Forma de pagamento nao encontrada.");
  }
  if (existing.is_system) {
    throw new Error(
      "As formas de pagamento padrao do sistema nao podem ser excluidas. Desative-a se necessario."
    );
  }

  const nowIso = now.toISOString();
  database
    .prepare(
      "UPDATE payment_methods SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?"
    )
    .run(nowIso, nowIso, id);
}

/** Mapa padrao codigo-da-forma -> codigo-da-conta usado no pre-vinculo. */
const DEFAULT_METHOD_ACCOUNT_BINDINGS: ReadonlyArray<{ methodCode: string; accountCode: string }> = [
  { methodCode: "cash", accountCode: "caixinha" },
  { methodCode: "pix", accountCode: "omie_cash" },
  { methodCode: "boleto", accountCode: "omie_cash" },
  { methodCode: "debit_card", accountCode: "getnet" },
  { methodCode: "credit_card", accountCode: "getnet" },
  // Credito do cliente (fiado) e lancado uma unica vez no OMIE pela OMIE Cash.
  { methodCode: "customer_credit", accountCode: "omie_cash" }
];

/**
 * Aplica os vinculos padrao forma -> conta para uma empresa (idempotente: so
 * preenche formas que ainda estao sem conta). Espelha a migracao para empresas
 * criadas apos ela.
 */
export function applyDefaultAccountBindings(
  database: DesktopDatabase,
  companyId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  const bind = database.prepare(
    `UPDATE payment_methods SET
       account_id = (
         SELECT ac.id FROM accounts ac
         WHERE ac.company_id = ? AND ac.code = ? AND ac.deleted_at IS NULL
       ),
       updated_at = ?
     WHERE company_id = ? AND code = ? AND account_id IS NULL AND deleted_at IS NULL`
  );
  const apply = database.transaction(() => {
    for (const binding of DEFAULT_METHOD_ACCOUNT_BINDINGS) {
      bind.run(companyId, binding.accountCode, nowIso, companyId, binding.methodCode);
    }
  });
  apply();
}
