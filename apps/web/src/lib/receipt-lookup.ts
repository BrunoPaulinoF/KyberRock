/**
 * Tela "Cupons": achar o cupom de uma pesagem pelo numero que esta no papel e mostrar a via como
 * foi impressa, com os dados da pesagem organizados ao lado.
 *
 * O cupom tem dois numeros, e quem liga para o escritorio le qualquer um deles:
 *   - `COD 003249`             o codigo da pesagem (`weighing_operations.operation_code`), no topo;
 *   - `COPIA NRO 000004038-4`  o numero da via (`print_receipts.receipt_number`) e, depois do
 *                              traco, o numero da balanca que imprimiu (`device_number`).
 * Numero solto (sem "COD" e sem traco) procura nos dois — a lista mostra de onde veio cada um.
 *
 * A via guarda a copia congelada do cupom (`content_snapshot_json.lines`, 48 colunas, exatamente
 * o que saiu no papel). Sem ela (via antiga ou que falhou) a tela mostra so os dados da pesagem.
 */

import type { Json } from "./database.types";
import { supabase, type Tables } from "./supabase";

export type ReceiptQuery =
  | { kind: "receipt"; receiptNumber: number; deviceNumber: number }
  | { kind: "code"; code: number }
  | { kind: "number"; value: number }
  | { kind: "invalid"; message: string };

/** Maior numero que cabe num `integer` do Postgres — acima disso a consulta falharia. */
const MAX_NUMBER = 2_147_483_647;

function toNumber(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_NUMBER ? value : null;
}

/**
 * Le o que a pessoa digitou. Aceita o texto copiado do cupom ("COD 003249",
 * "COPIA NRO 000004038-4") e so os numeros ("3249", "4038-4").
 */
export function parseReceiptQuery(input: string): ReceiptQuery {
  const text = input.trim().toUpperCase();
  if (!text) return { kind: "invalid", message: "Digite o codigo do cupom." };

  const receipt = /^(?:COPIA\s*)?(?:NRO\.?\s*)?(\d+)\s*-\s*(\d+)$/.exec(text);
  if (receipt) {
    const receiptNumber = toNumber(receipt[1]);
    const deviceNumber = toNumber(receipt[2]);
    if (receiptNumber && deviceNumber) return { kind: "receipt", receiptNumber, deviceNumber };
    return { kind: "invalid", message: "Numero da via invalido." };
  }

  const code = /^COD\.?\s*(\d+)$/.exec(text);
  if (code) {
    const value = toNumber(code[1]);
    return value ? { kind: "code", code: value } : { kind: "invalid", message: "Codigo invalido." };
  }

  if (/^\d+$/.test(text)) {
    const value = toNumber(text);
    return value ? { kind: "number", value } : { kind: "invalid", message: "Codigo invalido." };
  }

  return {
    kind: "invalid",
    message: "Use o COD do cupom (ex.: 3249) ou o numero da via (ex.: 4038-4)."
  };
}

/** "COD 003249" — como o topo do cupom mostra. */
export function operationCodeLabel(code: number | null | undefined): string {
  return code ? `COD ${String(code).padStart(6, "0")}` : "Sem codigo";
}

/** "000004038-4" — como a linha "COPIA NRO" do cupom mostra. */
export function receiptNumberLabel(
  receiptNumber: number,
  deviceNumber: number | null | undefined
): string {
  const base = String(receiptNumber).padStart(9, "0");
  return deviceNumber ? `${base}-${deviceNumber}` : base;
}

/** "1a via", "2a via". */
export function copyLabel(copyNumber: number): string {
  return `${copyNumber}a via`;
}

function asRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** As linhas do cupom como sairam no papel; `[]` quando a via nao guardou a copia. */
export function receiptLines(snapshot: Json | undefined): string[] {
  let lines = asRecord(snapshot)?.lines;
  if (typeof lines === "string") {
    try {
      lines = JSON.parse(lines) as Json;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => (typeof line === "string" ? line : ""));
}

/** Um texto da copia congelada (nome da forma de pagamento, telefone...), se houver. */
export function snapshotText(snapshot: Json | undefined, key: string): string | null {
  const value = asRecord(snapshot)?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/** Tempo entre a entrada e a saida, "1h 25min". */
export function permanenceLabel(
  createdAt: string | null | undefined,
  closedAt: string | null | undefined
): string | null {
  if (!createdAt || !closedAt) return null;
  const minutes = Math.round((Date.parse(closedAt) - Date.parse(createdAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}min` : `${Math.floor(minutes / 60)}h`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** O cupom pronto para a impressao do navegador: as mesmas linhas, em papel de 80 mm. */
export function receiptPrintHtml(lines: readonly string[], title: string): string {
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(title)}</title><style>` +
    `@page{size:80mm auto;margin:4mm}body{margin:0}` +
    `pre{margin:0;font:11px/1.35 "Courier New",monospace;white-space:pre}` +
    `</style></head><body><pre>${lines.map(escapeHtml).join("\n")}</pre></body></html>`
  );
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

export type ReceiptOperation = Tables<"weighing_operations">;
export type ReceiptCopy = Tables<"print_receipts">;

/** Uma pesagem achada pela busca e por qual numero ela foi achada. */
export interface ReceiptMatch {
  operation: Pick<
    ReceiptOperation,
    | "id"
    | "operation_code"
    | "status"
    | "customer_name"
    | "product_description"
    | "plate"
    | "net_weight_kg"
    | "total_cents"
    | "created_at"
    | "closed_at"
  >;
  foundBy: "code" | "receipt";
  /** A via achada, quando a busca foi pelo numero da via. */
  receiptLabel: string | null;
}

const MATCH_COLUMNS =
  "id, operation_code, status, customer_name, product_description, plate, net_weight_kg, " +
  "total_cents, created_at, closed_at";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** Procura as pesagens do numero digitado, mais recentes primeiro. */
export async function findReceipts(
  companyId: string,
  query: Exclude<ReceiptQuery, { kind: "invalid" }>
): Promise<ReceiptMatch[]> {
  const matches = new Map<string, ReceiptMatch>();

  const code = query.kind === "code" ? query.code : query.kind === "number" ? query.value : null;
  if (code !== null) {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select(MATCH_COLUMNS)
      .eq("company_id", companyId)
      .eq("operation_code", code)
      .order("created_at", { ascending: false })
      .limit(20);
    fail(error);
    for (const operation of (data ?? []) as unknown as ReceiptMatch["operation"][]) {
      matches.set(operation.id, { operation, foundBy: "code", receiptLabel: null });
    }
  }

  const receiptNumber =
    query.kind === "receipt" ? query.receiptNumber : query.kind === "number" ? query.value : null;
  if (receiptNumber !== null) {
    let receipts = supabase
      .from("print_receipts")
      .select("operation_id, receipt_number, device_number")
      .eq("receipt_number", receiptNumber);
    if (query.kind === "receipt") receipts = receipts.eq("device_number", query.deviceNumber);
    const { data: copies, error } = await receipts.limit(50);
    fail(error);
    const labels = new Map<string, string>();
    for (const copy of copies ?? []) {
      labels.set(copy.operation_id, receiptNumberLabel(copy.receipt_number, copy.device_number));
    }
    const ids = [...labels.keys()].filter((id) => !matches.has(id));
    if (ids.length > 0) {
      const { data, error: opError } = await supabase
        .from("weighing_operations")
        .select(MATCH_COLUMNS)
        .eq("company_id", companyId)
        .in("id", ids);
      fail(opError);
      for (const operation of (data ?? []) as unknown as ReceiptMatch["operation"][]) {
        matches.set(operation.id, {
          operation,
          foundBy: "receipt",
          receiptLabel: labels.get(operation.id) ?? null
        });
      }
    }
  }

  return [...matches.values()].sort((a, b) =>
    b.operation.created_at.localeCompare(a.operation.created_at)
  );
}

/** Tudo o que a tela mostra de uma pesagem. */
export interface ReceiptDetail {
  operation: ReceiptOperation;
  /** As vias impressas, da mais antiga para a mais nova. */
  copies: ReceiptCopy[];
  unitName: string | null;
  customer: Pick<
    Tables<"customers">,
    "document" | "phone" | "city" | "state" | "email" | "legal_name" | "trade_name"
  > | null;
  productCode: string | null;
  paymentMethodName: string | null;
  paymentTermName: string | null;
}

export async function loadReceiptDetail(
  companyId: string,
  operationId: string
): Promise<ReceiptDetail> {
  const { data: operation, error } = await supabase
    .from("weighing_operations")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", operationId)
    .single();
  fail(error);
  if (!operation) throw new Error("Pesagem nao encontrada.");

  const [copies, unit, customer, product, method, term] = await Promise.all([
    supabase
      .from("print_receipts")
      .select("*")
      .eq("operation_id", operationId)
      .order("receipt_number")
      .order("copy_number"),
    supabase.from("units").select("name").eq("id", operation.unit_id).maybeSingle(),
    operation.customer_id
      ? supabase
          .from("customers")
          .select("document, phone, city, state, email, legal_name, trade_name")
          .eq("id", operation.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    operation.product_id
      ? supabase.from("products").select("code").eq("id", operation.product_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    operation.payment_method_id
      ? supabase
          .from("payment_methods")
          .select("name")
          .eq("id", operation.payment_method_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    operation.payment_term_id
      ? supabase
          .from("payment_terms")
          .select("name")
          .eq("id", operation.payment_term_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  fail(copies.error);

  const snapshot = copies.data?.[0]?.content_snapshot_json;
  return {
    operation,
    copies: copies.data ?? [],
    unitName: unit.data?.name ?? snapshotText(snapshot, "unitName"),
    customer: customer.data ?? null,
    productCode: product.data?.code ?? snapshotText(snapshot, "productCode"),
    paymentMethodName: method.data?.name ?? snapshotText(snapshot, "paymentMethodName"),
    paymentTermName: term.data?.name ?? snapshotText(snapshot, "paymentTermName")
  };
}
