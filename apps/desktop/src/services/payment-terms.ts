import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import { parsePaymentCondition, type ParsedPaymentCondition } from "./payment-condition-parser.js";

export interface PaymentTermRow {
  id: string;
  company_id: string;
  omie_code: string | null;
  name: string;
  rules_json: string;
  first_installment_days: number | null;
  installment_interval_days: number | null;
  installment_count: number | null;
  installment_type: string | null;
  installment_days_json: string | null;
  visible: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
}

export interface CreatePaymentTermInput {
  companyId: string;
  name: string;
  /** Texto da condicao no padrao OMIE, ex: "10/20/30/40", "A Vista/40/60", "Para 93 dias", "50". */
  condition: string;
}

export interface UpdatePaymentTermInput {
  name?: string;
  condition?: string;
  isActive?: boolean;
}

interface PaymentTermRules {
  raw: string;
  kind: ParsedPaymentCondition["kind"];
  installmentCount: number;
  installments: ParsedPaymentCondition["installments"];
  intervalDays: number | null;
  summary: string;
}

function buildRules(parsed: ParsedPaymentCondition): PaymentTermRules {
  return {
    raw: parsed.raw,
    kind: parsed.kind,
    installmentCount: parsed.installmentCount,
    installments: parsed.installments,
    intervalDays: parsed.intervalDays,
    summary: parsed.summary
  };
}

export function listPaymentTerms(database: DesktopDatabase, companyId: string): PaymentTermRow[] {
  return database
    .prepare(
      `SELECT * FROM payment_terms
       WHERE company_id = ? AND deleted_at IS NULL
       ORDER BY name ASC`
    )
    .all(companyId) as PaymentTermRow[];
}

export function createPaymentTerm(
  database: DesktopDatabase,
  input: CreatePaymentTermInput,
  now: Date = new Date()
): PaymentTermRow {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Informe o nome da condicao de pagamento.");
  }
  const parsed = parsePaymentCondition(input.condition);
  const rules = buildRules(parsed);

  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO payment_terms (
        id, company_id, omie_code, name, rules_json,
        first_installment_days, installment_interval_days, installment_count,
        installment_type, installment_days_json, visible, is_active,
        created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      name,
      JSON.stringify(rules),
      parsed.installments[0]?.dueDays ?? null,
      parsed.intervalDays,
      parsed.installmentCount,
      parsed.kind,
      JSON.stringify(parsed.installments.map((i) => i.dueDays)),
      nowIso,
      nowIso
    );

  return database.prepare("SELECT * FROM payment_terms WHERE id = ?").get(id) as PaymentTermRow;
}

export function updatePaymentTerm(
  database: DesktopDatabase,
  id: string,
  input: UpdatePaymentTermInput,
  now: Date = new Date()
): PaymentTermRow {
  const existing = database
    .prepare("SELECT * FROM payment_terms WHERE id = ? AND deleted_at IS NULL")
    .get(id) as PaymentTermRow | undefined;
  if (!existing) {
    throw new Error("Condicao de pagamento nao encontrada.");
  }
  if (existing.omie_code || id.startsWith("omie_")) {
    throw new Error("Condicoes vindas do OMIE nao podem ser editadas.");
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Informe o nome da condicao de pagamento.");
    sets.push("name = ?");
    values.push(name);
  }
  if (input.condition !== undefined) {
    const parsed = parsePaymentCondition(input.condition);
    sets.push("rules_json = ?");
    values.push(JSON.stringify(buildRules(parsed)));
    sets.push("first_installment_days = ?");
    values.push(parsed.installments[0]?.dueDays ?? null);
    sets.push("installment_interval_days = ?");
    values.push(parsed.intervalDays);
    sets.push("installment_count = ?");
    values.push(parsed.installmentCount);
    sets.push("installment_type = ?");
    values.push(parsed.kind);
    sets.push("installment_days_json = ?");
    values.push(JSON.stringify(parsed.installments.map((i) => i.dueDays)));
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  values.push(now.toISOString());
  values.push(id);

  database.prepare(`UPDATE payment_terms SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return database.prepare("SELECT * FROM payment_terms WHERE id = ?").get(id) as PaymentTermRow;
}

export function deletePaymentTerm(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare("SELECT id FROM payment_terms WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;
  if (!existing) {
    throw new Error("Condicao de pagamento nao encontrada.");
  }
  const nowIso = now.toISOString();
  database
    .prepare("UPDATE payment_terms SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?")
    .run(nowIso, nowIso, id);
}
