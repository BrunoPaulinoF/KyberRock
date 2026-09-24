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
 */

import { periodToIso } from "./format";
import { supabase } from "./supabase";

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

// ---------- busca por placa ou motorista (o `filterTruckControlReport` do desktop) ----------

/** Sem acento, minusculo, pontuacao vira espaco (o `normalizeSearchText` do desktop). */
function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Busca normalizada (maiuscula, sem espaco nas pontas). Vazio = sem filtro. */
export function normalizeTruckSearch(search: string | null | undefined): string {
  return (search ?? "").trim().toUpperCase();
}

/**
 * A linha entra no recorte quando a placa OU o motorista casa com o que foi digitado: por
 * termo, sem acento e sem pontuacao ("ABC-1D23" acha "ABC1D23", "joao" acha "João").
 */
export function truckMatchesSearch(truck: TruckControlRow, term: string): boolean {
  const terms = normalizeSearchText(term).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(
    [truck.plate, truck.driverName ?? ""].filter(Boolean).join(" ")
  );
  const compact = haystack.replace(/\s+/g, "");
  return terms.every((token) => haystack.includes(token) || compact.includes(token));
}

/**
 * Recorte do relatorio pela busca, com os totais refeitos para os caminhoes que sobraram. A
 * media do recorte e ponderada por operacao, igual a do periodo.
 */
export function filterTruckControlReport(
  report: TruckControlReport,
  search: string | null | undefined
): TruckControlReport {
  const term = normalizeTruckSearch(search);
  if (!term) return report.search === null ? report : { ...report, search: null };

  const trucks = report.trucks.filter((truck) => truckMatchesSearch(truck, term));
  const totalOperations = trucks.reduce((sum, truck) => sum + truck.operations, 0);
  const totalMinutes = trucks.reduce((sum, truck) => sum + truck.totalMinutes, 0);

  return {
    ...report,
    search: term,
    trucks,
    totalOperations,
    totalNetWeightKg: trucks.reduce((sum, truck) => sum + truck.totalNetWeightKg, 0),
    averageMinutes: totalOperations > 0 ? Math.round(totalMinutes / totalOperations) : 0
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

// ---------- planilha (CSV no lugar do Excel do desktop) ----------

function csvCell(value: string | number): string {
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function kgNumber(kg: number): string {
  return Math.round(kg).toLocaleString("pt-BR");
}

function tonsNumber(kg: number): string {
  return (kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function dayLabel(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/**
 * O recorte em CSV (separador ";", pt-BR, com BOM para o Excel abrir os acentos), com as
 * mesmas quatro tabelas da planilha do desktop: caminhoes, clientes atendidos, peso por
 * produto e carga a carga.
 */
export function truckControlCsv(report: TruckControlReport): string {
  const line = (cells: Array<string | number>) => cells.map(csvCell).join(";");
  const totalMinutes = report.trucks.reduce((sum, truck) => sum + truck.totalMinutes, 0);
  const hasRows = report.trucks.length > 0;
  const lines: string[] = [
    line(["Controle de caminhoes"]),
    line(["Periodo", `${dayLabel(report.startDate)} a ${dayLabel(report.endDate)}`]),
    line(["Filtro (placa ou motorista)", report.search ?? "-"]),
    "",
    line(["Caminhoes no periodo"]),
    line([
      "Placa",
      "Motorista",
      "Operacoes",
      "Tempo medio",
      "Tempo total",
      "Peso (kg)",
      "Tonelagem (t)"
    ]),
    ...report.trucks.map((truck) =>
      line([
        truck.plate,
        truck.driverName ?? "-",
        truck.operations,
        formatMinutes(truck.avgMinutes),
        formatMinutes(truck.totalMinutes),
        kgNumber(truck.totalNetWeightKg),
        tonsNumber(truck.totalNetWeightKg)
      ])
    ),
    ...(hasRows
      ? [
          line([
            "TOTAL",
            "",
            report.totalOperations,
            formatMinutes(report.averageMinutes),
            formatMinutes(totalMinutes),
            kgNumber(report.totalNetWeightKg),
            tonsNumber(report.totalNetWeightKg)
          ])
        ]
      : []),
    "",
    line(["Clientes atendidos"]),
    line(["Placa", "Motorista", "Cliente", "Operacoes", "Peso (kg)"]),
    ...report.trucks.flatMap((truck) =>
      truck.customers.map((customer) =>
        line([
          truck.plate,
          truck.driverName ?? "-",
          customer.customerName,
          customer.operations,
          kgNumber(customer.totalNetWeightKg)
        ])
      )
    ),
    "",
    line(["Peso por produto"]),
    line(["Placa", "Motorista", "Produto", "Operacoes", "Peso (kg)"]),
    ...report.trucks.flatMap((truck) =>
      truck.products.map((product) =>
        line([
          truck.plate,
          truck.driverName ?? "-",
          product.productDescription,
          product.operations,
          kgNumber(product.totalNetWeightKg)
        ])
      )
    ),
    "",
    line(["Cargas do periodo"]),
    line([
      "Data",
      "Placa",
      "Motorista",
      "Cliente",
      "Produto",
      "Peso (kg)",
      "Entrada",
      "Saida",
      "Tempo"
    ]),
    ...report.trucks
      .flatMap((truck) => truck.trips.map((trip) => ({ truck, trip })))
      .sort((a, b) =>
        (a.trip.entryAt ?? a.trip.exitAt ?? "").localeCompare(b.trip.entryAt ?? b.trip.exitAt ?? "")
      )
      .map(({ truck, trip }) =>
        line([
          formatTripDay(trip.entryAt),
          truck.plate,
          truck.driverName ?? "-",
          trip.customerName,
          trip.productDescription,
          kgNumber(trip.netWeightKg),
          formatClock(trip.entryAt),
          formatClock(trip.exitAt),
          formatMinutes(trip.minutes)
        ])
      )
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function truckControlFileBaseName(report: TruckControlReport): string {
  const scope = report.search
    ? report.search
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "filtro"
    : "geral";
  return `controle-caminhoes-${scope}-${report.startDate}-a-${report.endDate}`;
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
