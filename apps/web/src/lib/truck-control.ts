/**
 * Controle de caminhoes: a mesma conta de `getTruckControlReport` e
 * `filterTruckControlReport` do desktop (`apps/desktop/src/services/reports.ts` e
 * `truck-control-report.ts`), lendo a pesagem da nuvem.
 *
 * O assunto aqui e o PATIO — quanto tempo cada placa ficou na pedreira —, entao o periodo e
 * recortado pela ENTRADA (`created_at`), nao pelo fechamento: a viagem pertence ao dia em que o
 * caminhao chegou (a mesma base do resumo de caminhoes do `daily-report-email`). Na nuvem a
 * entrada e a saida da balanca sao `created_at` e `closed_at` (o `desktop-sync` grava a saida
 * da balanca em `closed_at`).
 *
 * Os arquivos ("Gerar PDF" e "Baixar Excel") sao os do desktop: `truckControlDocument` monta o
 * mesmo HTML com a copia fiel do renderizador (`desktop/truck-control-report.ts`).
 */

import {
  renderTruckControlHtml,
  renderTruckControlSpreadsheet,
  truckControlFileBaseName
} from "./desktop/truck-control-report";
import { periodToIso } from "./format";
import type { ReportFile } from "./report-output";
import { supabase } from "./supabase";

// A busca por placa/motorista e o recorte sao os do desktop, copiados em
// `desktop/truck-control-report.ts`: a lista da tela, o PDF e o Excel partem do mesmo recorte.
export {
  filterTruckControlReport,
  normalizeTruckSearch,
  truckControlFileBaseName,
  truckMatchesSearch
} from "./desktop/truck-control-report";

export interface TruckProductWeight {
  productDescription: string;
  totalNetWeightKg: number;
  operations: number;
}

export interface TruckCustomerWeight {
  customerName: string;
  totalNetWeightKg: number;
  operations: number;
}

/** Uma carga da placa: para quem foi, o que levou e quanto tempo ficou na pedreira. */
export interface TruckControlTrip {
  operationId: string;
  entryAt: string | null;
  exitAt: string | null;
  minutes: number;
  customerName: string;
  productDescription: string;
  netWeightKg: number;
}

export interface TruckControlRow {
  plate: string;
  driverName: string | null;
  operations: number;
  totalMinutes: number;
  avgMinutes: number;
  totalNetWeightKg: number;
  lastOperationAt: string | null;
  products: TruckProductWeight[];
  /** Clientes atendidos pela placa no periodo, do maior peso para o menor. */
  customers: TruckCustomerWeight[];
  /** Carga a carga, em ordem de entrada. */
  trips: TruckControlTrip[];
}

export interface TruckControlReport {
  startDate: string;
  endDate: string;
  /** Busca de placa/motorista aplicada ao relatorio; `null` = periodo inteiro. */
  search: string | null;
  averageMinutes: number;
  totalOperations: number;
  totalNetWeightKg: number;
  trucks: TruckControlRow[];
}

/** Uma pesagem ja com os nomes resolvidos (a linha do SELECT do desktop). */
export interface TruckControlSourceRow {
  operationId: string;
  plate: string | null;
  driverName: string | null;
  customerName: string | null;
  productDescription: string | null;
  netWeightKg: number | null;
  entryAt: string | null;
  exitAt: string | null;
}

/** "1h 05min" / "42min" — o `formatMinutes` do desktop. */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}min`;
}

/** Minutos entre entrada e saida; saida antes da entrada vale 0, data invalida vale `null`. */
export function minutesBetween(
  entryIso: string | null | undefined,
  exitIso: string | null | undefined
): number | null {
  if (!entryIso || !exitIso) return null;
  const entry = new Date(entryIso).getTime();
  const exit = new Date(exitIso).getTime();
  if (Number.isNaN(entry) || Number.isNaN(exit)) return null;
  const minutes = (exit - entry) / 60_000;
  return minutes >= 0 ? minutes : 0;
}

/** Agrupa as pesagens por placa: a mesma conta de `getTruckControlReport`. */
export function buildTruckControlReport(
  rows: readonly TruckControlSourceRow[],
  startDate: string,
  endDate: string
): TruckControlReport {
  const byPlate = new Map<
    string,
    {
      plate: string;
      driverName: string | null;
      operations: number;
      totalMinutes: number;
      totalNetWeightKg: number;
      lastOperationAt: string | null;
      products: Map<string, TruckProductWeight>;
      customers: Map<string, TruckCustomerWeight>;
      trips: TruckControlTrip[];
    }
  >();

  let totalMinutesAll = 0;
  let totalOperations = 0;
  let totalNetWeightKg = 0;

  const ordered = [...rows].sort((a, b) => (a.entryAt ?? "").localeCompare(b.entryAt ?? ""));

  for (const row of ordered) {
    const plate = (row.plate ?? "").trim() || "SEM PLACA";
    const minutes = minutesBetween(row.entryAt, row.exitAt);
    if (minutes === null) continue;
    const weight = row.netWeightKg ?? 0;

    let entry = byPlate.get(plate);
    if (!entry) {
      entry = {
        plate,
        driverName: row.driverName,
        operations: 0,
        totalMinutes: 0,
        totalNetWeightKg: 0,
        lastOperationAt: null,
        products: new Map(),
        customers: new Map(),
        trips: []
      };
      byPlate.set(plate, entry);
    }

    entry.operations += 1;
    entry.totalMinutes += minutes;
    entry.totalNetWeightKg += weight;
    if (row.driverName) entry.driverName = row.driverName;
    if (row.exitAt && (!entry.lastOperationAt || row.exitAt > entry.lastOperationAt)) {
      entry.lastOperationAt = row.exitAt;
    }

    const productKey = (row.productDescription ?? "N/A").trim() || "N/A";
    const product = entry.products.get(productKey) ?? {
      productDescription: productKey,
      totalNetWeightKg: 0,
      operations: 0
    };
    product.totalNetWeightKg += weight;
    product.operations += 1;
    entry.products.set(productKey, product);

    const customerKey = (row.customerName ?? "").trim() || "N/A";
    const customer = entry.customers.get(customerKey) ?? {
      customerName: customerKey,
      totalNetWeightKg: 0,
      operations: 0
    };
    customer.totalNetWeightKg += weight;
    customer.operations += 1;
    entry.customers.set(customerKey, customer);

    entry.trips.push({
      operationId: row.operationId,
      entryAt: row.entryAt,
      exitAt: row.exitAt,
      minutes: Math.round(minutes),
      customerName: customerKey,
      productDescription: productKey,
      netWeightKg: weight
    });

    totalMinutesAll += minutes;
    totalOperations += 1;
    totalNetWeightKg += weight;
  }

  const trucks: TruckControlRow[] = Array.from(byPlate.values())
    .map((entry) => ({
      plate: entry.plate,
      driverName: entry.driverName,
      operations: entry.operations,
      totalMinutes: Math.round(entry.totalMinutes),
      avgMinutes: entry.operations > 0 ? Math.round(entry.totalMinutes / entry.operations) : 0,
      totalNetWeightKg: entry.totalNetWeightKg,
      lastOperationAt: entry.lastOperationAt,
      products: Array.from(entry.products.values()).sort(
        (a, b) => b.totalNetWeightKg - a.totalNetWeightKg
      ),
      customers: Array.from(entry.customers.values()).sort(
        (a, b) => b.totalNetWeightKg - a.totalNetWeightKg
      ),
      trips: entry.trips
    }))
    .sort((a, b) => b.operations - a.operations || b.totalNetWeightKg - a.totalNetWeightKg);

  return {
    startDate,
    endDate,
    search: null,
    averageMinutes: totalOperations > 0 ? Math.round(totalMinutesAll / totalOperations) : 0,
    totalOperations,
    totalNetWeightKg,
    trucks
  };
}

// ---------- datas ----------

/** AAAA-MM-DD `days` dias antes de `iso` (datas de calendario, sem fuso). */
export function isoDaysBefore(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Data (dd/mm/aaaa) e hora (hh:mm) da balanca, no fuso da pedreira. */
export function formatTripDay(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatClock(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo"
      });
}

// ---------- documentos (o `buildTruckControlDocument` do desktop) ----------

/**
 * O documento do controle de caminhoes no formato pedido, com o nome de arquivo do desktop:
 * o PDF e o A4 de `renderTruckControlHtml` e o Excel e o HTML de planilha de
 * `renderTruckControlSpreadsheet`, gravado como `.xls`. Recebe o relatorio JA recortado pela
 * busca (`filterTruckControlReport`), como o desktop — o arquivo traz o que esta na lista.
 */
export function truckControlDocument(
  format: "pdf" | "excel",
  report: TruckControlReport,
  generatedAt: Date = new Date()
): ReportFile {
  return {
    filename: `${truckControlFileBaseName(report)}.${format === "pdf" ? "pdf" : "xls"}`,
    html:
      format === "pdf"
        ? renderTruckControlHtml(report, generatedAt)
        : renderTruckControlSpreadsheet(report, generatedAt)
  };
}

// ---------- consulta ----------

const PAGE = 1000;

interface OperationRow {
  id: string;
  plate: string | null;
  driver_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  product_id: string | null;
  product_description: string | null;
  net_weight_kg: number | null;
  created_at: string;
  closed_at: string | null;
}

async function pages<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await query(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Pesagens da unidade que ENTRARAM no periodo e ja sairam (entrada e saida da balanca), sem as
 * canceladas. O nome do cliente segue o desktop: razao social primeiro, depois o fantasia e,
 * sem cadastro, o nome gravado na pesagem; o produto pela descricao do cadastro.
 */
export async function loadTruckControl(
  companyId: string,
  unitId: string,
  startDate: string,
  endDate: string
): Promise<TruckControlReport> {
  const { startIso, endIso } = periodToIso(startDate, endDate);
  const operations = await pages<OperationRow>((from, to) =>
    supabase
      .from("weighing_operations")
      .select(
        "id, plate, driver_name, customer_id, customer_name, product_id, product_description, net_weight_kg, created_at, closed_at"
      )
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .neq("status", "cancelled")
      .not("closed_at", "is", null)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  const customerIds = [...new Set(operations.map((op) => op.customer_id).filter(isId))];
  const productIds = [...new Set(operations.map((op) => op.product_id).filter(isId))];
  const [customers, products] = await Promise.all([
    byIds<{ id: string; legal_name: string | null; trade_name: string | null }>(
      "customers",
      "id, legal_name, trade_name",
      companyId,
      customerIds
    ),
    byIds<{ id: string; description: string | null }>(
      "products",
      "id, description",
      companyId,
      productIds
    )
  ]);
  const customerName = new Map(
    customers.map((c) => [c.id, (c.legal_name ?? "").trim() || (c.trade_name ?? "").trim()])
  );
  const productName = new Map(products.map((p) => [p.id, (p.description ?? "").trim()]));

  const rows: TruckControlSourceRow[] = operations.map((op) => ({
    operationId: op.id,
    plate: op.plate,
    driverName: op.driver_name,
    customerName:
      (op.customer_id ? customerName.get(op.customer_id) : null) || op.customer_name || null,
    productDescription:
      (op.product_id ? productName.get(op.product_id) : null) || op.product_description || null,
    netWeightKg: op.net_weight_kg,
    entryAt: op.created_at,
    exitAt: op.closed_at
  }));
  return buildTruckControlReport(rows, startDate, endDate);
}

function isId(value: string | null): value is string {
  return Boolean(value);
}

/** Linhas de um cadastro pelos ids, em lotes (a URL do PostgREST tem limite). */
async function byIds<T>(
  table: "customers" | "products",
  columns: string,
  companyId: string,
  ids: string[]
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 150) {
    const chunk = ids.slice(index, index + 150);
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .in("id", chunk);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as T[]));
  }
  return rows;
}
