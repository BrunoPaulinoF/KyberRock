/**
 * Ranking de clientes (tela `/ranking-clientes`, do perfil comercial): quem mais comprou no
 * periodo, do primeiro ao ultimo, comparado com o periodo anterior. As contas seguem as regras
 * do Insights e do relatorio de vendas, para os numeros baterem entre as telas:
 *
 * - so pesagem CONCLUIDA conta; o dia da venda e o do FECHAMENTO no fuso da pedreira
 *   (`saleDay`) — e a data que sobe ao OMIE como emissao do pedido;
 * - "Faturamento" e o `total_cents` (produto + frete), o que o cliente paga — produto e frete
 *   aparecem separados ao lado;
 * - o preco medio por tonelada e so do material (`product_total_cents`), como no Insights.
 *
 * O cliente e agrupado pelo id do cadastro (a pesagem sem cadastro cai no grupo do nome gravado
 * nela), igual a tabela dinamica do Insights.
 */

import {
  SPREADSHEET_HTML_ATTRS,
  SPREADSHEET_STYLE,
  documentStyle,
  escapeHtml,
  kpiCards,
  section,
  sheetTable,
  table
} from "./desktop/report-document";
import { formatDocument } from "./format";
import {
  CLOSED_STATUSES,
  addDays,
  avgPricePerTon,
  formatBRL,
  formatDayLabel,
  formatTonsShort,
  resolveInsightsRange,
  saleDay,
  type InsightsDateRange
} from "./insights";
import { supabase, type Tables } from "./supabase";

type Operation = Tables<"weighing_operations">;

/** Colunas que o ranking usa — menos bytes do que `select("*")` num ano inteiro de pesagens. */
export const RANKING_COLUMNS =
  "customer_id, customer_name, product_id, product_description, operation_type, net_weight_kg, product_total_cents, freight_total_cents, total_cents, closed_at, created_at";

export type RankingOperation = Pick<
  Operation,
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "operation_type"
  | "net_weight_kg"
  | "product_total_cents"
  | "freight_total_cents"
  | "total_cents"
  | "closed_at"
  | "created_at"
>;

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

export type RankingPeriod =
  | "today"
  | "7d"
  | "30d"
  | "90d"
  | "month"
  | "lastMonth"
  | "year"
  | "custom";

export type RankingRange = InsightsDateRange;

export const RANKING_PERIOD_OPTIONS: Array<{ id: RankingPeriod; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
  { id: "month", label: "Mês atual" },
  { id: "lastMonth", label: "Mês anterior" },
  { id: "year", label: "Ano atual" },
  { id: "custom", label: "Personalizado" }
];

/** Dias corridos entre duas datas AAAA-MM-DD (o fim conta: 01 a 01 e 1 dia). */
export function daysInRange(range: Pick<RankingRange, "start" | "end">): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Datas do periodo escolhido. Os atalhos que o Insights ja tem (e o personalizado, com datas
 * vazias virando hoje e invertidas trocando de lugar) saem de `resolveInsightsRange`; aqui
 * entram so os dois que o ranking acrescenta — 90 dias e o ano ate hoje.
 */
export function resolveRankingRange(
  period: RankingPeriod,
  customStart: string,
  customEnd: string,
  today: string
): RankingRange {
  if (period === "90d") return { start: addDays(today, -89), end: today, label: "Últimos 90 dias" };
  if (period === "year")
    return { start: `${today.slice(0, 4)}-01-01`, end: today, label: "Ano atual" };
  return resolveInsightsRange(period, customStart, customEnd, new Date(`${today}T12:00:00-03:00`));
}

/** Ultimo dia do mes de uma data AAAA-MM-DD. */
function lastDayOfMonth(iso: string): string {
  const next = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

/**
 * O periodo com que o ranking se compara. "Mes atual" e "Ano atual" comparam com o MESMO
 * pedaco do mes/ano anterior (01 a 15/10 contra 01 a 15/09) — comparar a primeira quinzena com
 * a segunda do mes passado poria o fechamento de mes de um lado so. "Mes anterior" compara com
 * o mes inteiro antes dele. O resto compara com os mesmos tantos dias logo antes do inicio.
 */
export function previousRankingRange(period: RankingPeriod, range: RankingRange): RankingRange {
  if (period === "month") {
    const end = addDays(range.start, -1);
    const start = `${end.slice(0, 7)}-01`;
    const day = Math.min(Number(range.end.slice(8, 10)), Number(end.slice(8, 10)));
    return {
      start,
      end: `${end.slice(0, 7)}-${String(day).padStart(2, "0")}`,
      label: "Mesmo período do mês anterior"
    };
  }
  if (period === "lastMonth") {
    const end = addDays(range.start, -1);
    return { start: `${end.slice(0, 7)}-01`, end, label: "Mês retrasado" };
  }
  if (period === "year") {
    const year = Number(range.start.slice(0, 4)) - 1;
    const sameDay = `${year}-${range.end.slice(5)}`;
    // 29/02 num ano que nao tem: o fim vira o ultimo dia de fevereiro.
    const end = sameDay.endsWith("-02-29") ? lastDayOfMonth(`${year}-02-01`) : sameDay;
    return { start: `${year}-01-01`, end, label: "Mesmo período do ano anterior" };
  }
  const days = Math.max(1, daysInRange(range));
  const end = addDays(range.start, -1);
  return {
    start: addDays(end, -(days - 1)),
    end,
    label: days === 1 ? "Dia anterior" : `${days} dias anteriores`
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** O que decide a posicao: dinheiro, tonelada ou numero de cargas. */
export type RankingMetric = "value" | "weight" | "loads";

export const RANKING_METRIC_OPTIONS: Array<{ id: RankingMetric; label: string }> = [
  { id: "value", label: "Faturamento" },
  { id: "weight", label: "Peso" },
  { id: "loads", label: "Cargas" }
];

/** Venda com nota, interna (ordem de servico) ou as duas. */
export type RankingTypeFilter = "all" | "invoice" | "internal";

export const RANKING_TYPE_OPTIONS: Array<{ id: RankingTypeFilter; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "invoice", label: "Com nota" },
  { id: "internal", label: "Interna" }
];

export interface RankingFilters {
  productId?: string | null;
  type?: RankingTypeFilter;
}

/** Curva ABC: A sao os que somam os primeiros 80%, B ate 95%, C o resto. */
export type AbcClass = "A" | "B" | "C";

export interface RankingProductLine {
  key: string;
  name: string;
  loads: number;
  weightKg: number;
  productCents: number;
  totalCents: number;
}

export interface RankingTotals {
  customers: number;
  loads: number;
  weightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

export interface RankingPrevious {
  position: number;
  loads: number;
  weightKg: number;
  totalCents: number;
}

export interface CustomerRankingRow {
  key: string;
  customerId: string | null;
  name: string;
  position: number;
  loads: number;
  weightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  /** Preco medio do material por tonelada (sem frete). */
  avgPriceCentsPerTon: number;
  /** Faturamento medio por carga. */
  ticketCents: number;
  /** Participacao na metrica escolhida, de 0 a 1. */
  share: number;
  /** Participacao somada do 1o lugar ate este, de 0 a 1. */
  cumulativeShare: number;
  abc: AbcClass;
  /** Dias diferentes em que comprou no periodo. */
  activeDays: number;
  firstDay: string;
  lastDay: string;
  /** O material que ele mais levou (em peso). */
  mainProduct: string | null;
  products: RankingProductLine[];
  /** Como estava no periodo anterior; `null` = nao comprou nele. */
  previous: RankingPrevious | null;
  /** Posicoes ganhas (positivo) ou perdidas (negativo); `null` = novo no ranking. */
  movement: number | null;
  /** Variacao da metrica contra o periodo anterior (0,25 = +25%); `null` = sem base. */
  change: number | null;
}

/** Comprou no periodo anterior e nao comprou neste. */
export interface LostCustomer {
  key: string;
  customerId: string | null;
  name: string;
  previousPosition: number;
  loads: number;
  weightKg: number;
  totalCents: number;
  lastDay: string;
}

export interface CustomerRanking {
  rows: CustomerRankingRow[];
  totals: RankingTotals;
  previousTotals: RankingTotals;
  lost: LostCustomer[];
  /** Quantos estao no ranking sem ter comprado no periodo anterior. */
  newCustomers: number;
  /** Quanto da metrica os 10 primeiros somam, de 0 a 1. */
  top10Share: number;
  abcCounts: Record<AbcClass, number>;
  /** Produtos vendidos nos dois periodos (opcoes do filtro), em ordem alfabetica. */
  products: Array<{ id: string; name: string }>;
}

interface Group {
  key: string;
  customerId: string | null;
  name: string;
  nameAt: string;
  loads: number;
  weightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  days: Set<string>;
  firstDay: string;
  lastDay: string;
  products: Map<string, RankingProductLine>;
}

const customerKey = (op: RankingOperation) =>
  op.customer_id ? `id:${op.customer_id}` : `nome:${op.customer_name?.trim() ?? ""}`;
const productKey = (op: RankingOperation) =>
  op.product_id ? `id:${op.product_id}` : `nome:${op.product_description?.trim() ?? ""}`;

function inRange(op: RankingOperation, range: Pick<RankingRange, "start" | "end">): boolean {
  const day = saleDay(op);
  return day >= range.start && day <= range.end;
}

function passes(op: RankingOperation, filters: RankingFilters): boolean {
  if (filters.productId && op.product_id !== filters.productId) return false;
  if (filters.type === "internal" && op.operation_type !== "internal") return false;
  if (filters.type === "invoice" && op.operation_type === "internal") return false;
  return true;
}

function groupByCustomer(
  operations: RankingOperation[],
  range: Pick<RankingRange, "start" | "end">,
  filters: RankingFilters
): Group[] {
  const map = new Map<string, Group>();
  for (const op of operations) {
    if (!inRange(op, range) || !passes(op, filters)) continue;
    const key = customerKey(op);
    const day = saleDay(op);
    const at = op.closed_at ?? op.created_at;
    const name = op.customer_name?.trim() || "";
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        customerId: op.customer_id,
        name,
        nameAt: at,
        loads: 0,
        weightKg: 0,
        productCents: 0,
        freightCents: 0,
        totalCents: 0,
        days: new Set(),
        firstDay: day,
        lastDay: day,
        products: new Map()
      };
      map.set(key, group);
    }
    // O nome que vale e o da pesagem mais recente: cadastro renomeado aparece com o nome novo.
    if (name && (!group.name || at > group.nameAt)) {
      group.name = name;
      group.nameAt = at;
    }
    const weight = op.net_weight_kg ?? 0;
    const product = op.product_total_cents ?? 0;
    const freight = op.freight_total_cents ?? 0;
    const total = op.total_cents ?? 0;
    group.loads += 1;
    group.weightKg += weight;
    group.productCents += product;
    group.freightCents += freight;
    group.totalCents += total;
    group.days.add(day);
    if (day < group.firstDay) group.firstDay = day;
    if (day > group.lastDay) group.lastDay = day;

    const pKey = productKey(op);
    const line = group.products.get(pKey) ?? {
      key: pKey,
      name: op.product_description?.trim() || "Produto não informado",
      loads: 0,
      weightKg: 0,
      productCents: 0,
      totalCents: 0
    };
    line.loads += 1;
    line.weightKg += weight;
    line.productCents += product;
    line.totalCents += total;
    group.products.set(pKey, line);
  }
  return [...map.values()];
}

/** O numero que decide a posicao. */
export function metricValue(
  item: { totalCents: number; weightKg: number; loads: number },
  metric: RankingMetric
): number {
  if (metric === "weight") return item.weightKg;
  if (metric === "loads") return item.loads;
  return item.totalCents;
}

/**
 * Do maior para o menor na metrica. Empate desempata pelo faturamento, depois pelo peso e por
 * fim pelo nome — a mesma lista sempre sai na mesma ordem.
 */
function sortGroups(groups: Group[], metric: RankingMetric): Group[] {
  return [...groups].sort(
    (a, b) =>
      metricValue(b, metric) - metricValue(a, metric) ||
      b.totalCents - a.totalCents ||
      b.weightKg - a.weightKg ||
      a.name.localeCompare(b.name, "pt-BR")
  );
}

function totalsOf(groups: Group[]): RankingTotals {
  return groups.reduce<RankingTotals>(
    (acc, group) => ({
      customers: acc.customers + 1,
      loads: acc.loads + group.loads,
      weightKg: acc.weightKg + group.weightKg,
      productCents: acc.productCents + group.productCents,
      freightCents: acc.freightCents + group.freightCents,
      totalCents: acc.totalCents + group.totalCents
    }),
    { customers: 0, loads: 0, weightKg: 0, productCents: 0, freightCents: 0, totalCents: 0 }
  );
}

/** Variacao relativa; sem base (anterior zero) nao ha porcentagem que faca sentido. */
export function relativeChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

/**
 * O ranking do periodo. `current` e `previous` sao as pesagens concluidas de cada periodo (as
 * fora do intervalo sao descartadas aqui de novo, pelo dia do fechamento no fuso da pedreira).
 */
export function buildCustomerRanking(
  current: RankingOperation[],
  previous: RankingOperation[],
  ranges: {
    current: Pick<RankingRange, "start" | "end">;
    previous: Pick<RankingRange, "start" | "end">;
  },
  metric: RankingMetric,
  filters: RankingFilters = {}
): CustomerRanking {
  const now = sortGroups(groupByCustomer(current, ranges.current, filters), metric);
  const before = sortGroups(groupByCustomer(previous, ranges.previous, filters), metric);
  const totals = totalsOf(now);
  const previousTotals = totalsOf(before);
  const metricTotal = metricValue(totals, metric);

  const beforeByKey = new Map(
    before.map((group, index) => [group.key, { group, position: index + 1 }])
  );
  const nowKeys = new Set(now.map((group) => group.key));

  let cumulative = 0;
  const abcCounts: Record<AbcClass, number> = { A: 0, B: 0, C: 0 };
  const rows = now.map<CustomerRankingRow>((group, index) => {
    const value = metricValue(group, metric);
    const share = metricTotal > 0 ? value / metricTotal : 0;
    // A classe olha o que veio ANTES dele: o 1o lugar e sempre A, mesmo sozinho com 90%.
    const abc: AbcClass =
      metricTotal <= 0 ? "C" : cumulative < 0.8 ? "A" : cumulative < 0.95 ? "B" : "C";
    cumulative += share;
    abcCounts[abc] += 1;
    const old = beforeByKey.get(group.key);
    const products = [...group.products.values()].sort(
      (a, b) => b.weightKg - a.weightKg || b.totalCents - a.totalCents
    );
    return {
      key: group.key,
      customerId: group.customerId,
      name: group.name || "Cliente não informado",
      position: index + 1,
      loads: group.loads,
      weightKg: group.weightKg,
      productCents: group.productCents,
      freightCents: group.freightCents,
      totalCents: group.totalCents,
      avgPriceCentsPerTon: avgPricePerTon(group.productCents, group.weightKg),
      ticketCents: group.loads > 0 ? Math.round(group.totalCents / group.loads) : 0,
      share,
      cumulativeShare: Math.min(1, cumulative),
      abc,
      activeDays: group.days.size,
      firstDay: group.firstDay,
      lastDay: group.lastDay,
      mainProduct: products[0]?.name ?? null,
      products,
      previous: old
        ? {
            position: old.position,
            loads: old.group.loads,
            weightKg: old.group.weightKg,
            totalCents: old.group.totalCents
          }
        : null,
      movement: old ? old.position - (index + 1) : null,
      change: old ? relativeChange(value, metricValue(old.group, metric)) : null
    };
  });

  const lost = before
    .map((group, index) => ({ group, position: index + 1 }))
    .filter(({ group }) => !nowKeys.has(group.key))
    .map<LostCustomer>(({ group, position }) => ({
      key: group.key,
      customerId: group.customerId,
      name: group.name || "Cliente não informado",
      previousPosition: position,
      loads: group.loads,
      weightKg: group.weightKg,
      totalCents: group.totalCents,
      lastDay: group.lastDay
    }));

  const top10Share = rows.slice(0, 10).reduce((sum, row) => sum + row.share, 0);

  // Opcoes do filtro de produto: o que foi vendido nos dois periodos, sem os filtros aplicados.
  const productNames = new Map<string, string>();
  for (const [ops, range] of [
    [current, ranges.current],
    [previous, ranges.previous]
  ] as const) {
    for (const op of ops) {
      if (!op.product_id || productNames.has(op.product_id) || !inRange(op, range)) continue;
      productNames.set(op.product_id, op.product_description?.trim() || "Produto não informado");
    }
  }
  const products = [...productNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return {
    rows,
    totals,
    previousTotals,
    lost,
    newCustomers: rows.filter((row) => row.previous === null).length,
    top10Share: Math.min(1, top10Share),
    abcCounts,
    products
  };
}

/** Busca por nome na lista, sem acento e sem caixa. A posicao continua a do ranking inteiro. */
export function filterRankingRows<T extends { name: string }>(rows: T[], search: string): T[] {
  const needle = normalize(search);
  if (!needle) return rows;
  return rows.filter((row) => normalize(row.name).includes(needle));
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------

/** 0,1234 -> "12,3%". */
export function formatShare(share: number): string {
  return `${(share * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

/** Variacao com sinal: "+12,3%", "-4,0%", "0,0%". `null` (sem base) vira "—". */
export function formatChange(change: number | null): string {
  if (change === null) return "—";
  const text = formatShare(Math.abs(change));
  if (Math.abs(change) < 0.0005) return text;
  return `${change > 0 ? "+" : "-"}${text}`;
}

/** Valor da metrica escrito do jeito dela: R$, toneladas ou numero de cargas. */
export function formatMetric(value: number, metric: RankingMetric): string {
  if (metric === "weight") return formatTonsShort(value);
  if (metric === "loads")
    return `${value.toLocaleString("pt-BR")} ${value === 1 ? "carga" : "cargas"}`;
  return formatBRL(value);
}

/** "Subiu 2", "Caiu 1", "Novo", "=". */
export function movementLabel(movement: number | null): string {
  if (movement === null) return "Novo";
  if (movement > 0) return `Subiu ${movement}`;
  if (movement < 0) return `Caiu ${Math.abs(movement)}`;
  return "Manteve";
}

// ---------------------------------------------------------------------------
// Leitura da nuvem
// ---------------------------------------------------------------------------

const PAGE = 1000;
/** Ate 50 mil pesagens por periodo; acima disso a tela avisa para reduzir o periodo. */
export const RANKING_MAX_PAGES = 50;
export const RANKING_MAX_ROWS = PAGE * RANKING_MAX_PAGES;

/**
 * Pesagens CONCLUIDAS da empresa no intervalo `[startIso, endIso)`, pela data de FECHAMENTO
 * (`closed_at`), com a pesagem antiga sem fechamento entrando pela criacao — o mesmo recorte
 * do relatorio de vendas da aba Comercial. Le a empresa inteira, como aquele relatorio: o
 * comercial vende para a pedreira, nao para uma balanca.
 */
export async function loadRankingOperations(
  companyId: string,
  startIso: string,
  endIso: string
): Promise<{ rows: RankingOperation[]; truncated: boolean }> {
  const rows: RankingOperation[] = [];
  for (let page = 0; page < RANKING_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select(RANKING_COLUMNS)
      .eq("company_id", companyId)
      .in("status", [...CLOSED_STATUSES])
      .or(
        [
          `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
          `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
        ].join(",")
      )
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as RankingOperation[]));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** O que o ranking mostra do cadastro, alem do nome: documento e cidade. */
export interface RankingCustomerInfo {
  document: string | null;
  city: string | null;
  state: string | null;
}

/** Documento e cidade de cada cliente da empresa (so as colunas que o ranking mostra). */
export async function loadRankingCustomerInfo(
  companyId: string
): Promise<Map<string, RankingCustomerInfo>> {
  const info = new Map<string, RankingCustomerInfo>();
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, document, city, state")
      .eq("company_id", companyId)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      info.set(row.id, { document: row.document, city: row.city, state: row.state });
    }
    if (!data || data.length < PAGE) break;
  }
  return info;
}

/** "12.345.678/0001-90 · Ibiúna/SP" — o que houver dos dois. */
export function customerInfoLine(info: RankingCustomerInfo | undefined): string {
  if (!info) return "";
  const place = [info.city?.trim(), info.state?.trim()].filter(Boolean).join("/");
  return [info.document ? formatDocument(info.document) : "", place].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Exportar (PDF e Excel)
// ---------------------------------------------------------------------------

export interface RankingExportInput {
  ranking: CustomerRanking;
  range: RankingRange;
  previousRange: RankingRange;
  metric: RankingMetric;
  /** Descricao dos filtros aplicados ("Produto: Brita 1 · Com nota"), ou vazio. */
  filtersLabel: string;
  info: ReadonlyMap<string, RankingCustomerInfo>;
  generatedAt?: Date;
}

const METRIC_LABEL: Record<RankingMetric, string> = {
  value: "faturamento",
  weight: "peso",
  loads: "cargas"
};

function periodLine(input: RankingExportInput): string {
  const base = `${formatDayLabel(input.range.start)} a ${formatDayLabel(input.range.end)} · ordenado por ${
    METRIC_LABEL[input.metric]
  } · comparado com ${formatDayLabel(input.previousRange.start)} a ${formatDayLabel(
    input.previousRange.end
  )}`;
  return input.filtersLabel ? `${base} · ${input.filtersLabel}` : base;
}

function infoOf(input: RankingExportInput, row: { customerId: string | null }) {
  return row.customerId ? input.info.get(row.customerId) : undefined;
}

function previousPositionLabel(row: CustomerRankingRow): string {
  return row.previous ? `${row.previous.position}º` : "Novo";
}

/** Nome do arquivo: `ranking-clientes-2026-09-01-a-2026-09-30`. */
export function rankingFileBase(range: Pick<RankingRange, "start" | "end">): string {
  return `ranking-clientes-${range.start}-a-${range.end}`;
}

/** O PDF A4 (paisagem) do botao Exportar PDF: resumo, a lista inteira e quem parou de comprar. */
export function rankingReportHtml(input: RankingExportInput): string {
  const { ranking } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const kpis = kpiCards([
    ["Clientes", ranking.totals.customers.toLocaleString("pt-BR")],
    ["Faturamento", formatBRL(ranking.totals.totalCents)],
    ["Peso", formatTonsShort(ranking.totals.weightKg)],
    ["Cargas", ranking.totals.loads.toLocaleString("pt-BR")]
  ]);
  const rows = ranking.rows.map((row) => [
    `${row.position}º`,
    row.name,
    customerInfoLine(infoOf(input, row)) || "-",
    row.abc,
    row.loads.toLocaleString("pt-BR"),
    formatTonsShort(row.weightKg),
    formatBRL(row.totalCents),
    formatShare(row.share),
    row.avgPriceCentsPerTon > 0 ? `${formatBRL(row.avgPriceCentsPerTon)}/t` : "-",
    formatDayLabel(row.lastDay),
    previousPositionLabel(row),
    formatChange(row.change)
  ]);
  const footer = [
    "Total",
    `${ranking.totals.customers.toLocaleString("pt-BR")} clientes`,
    "",
    "",
    ranking.totals.loads.toLocaleString("pt-BR"),
    formatTonsShort(ranking.totals.weightKg),
    formatBRL(ranking.totals.totalCents),
    ranking.rows.length ? "100,0%" : "",
    ranking.totals.weightKg > 0
      ? `${formatBRL(avgPricePerTon(ranking.totals.productCents, ranking.totals.weightKg))}/t`
      : "-",
    "",
    "",
    formatChange(
      relativeChange(
        metricValue(ranking.totals, input.metric),
        metricValue(ranking.previousTotals, input.metric)
      )
    )
  ];
  const lostRows = ranking.lost.map((lost) => [
    `${lost.previousPosition}º`,
    lost.name,
    lost.loads.toLocaleString("pt-BR"),
    formatTonsShort(lost.weightKg),
    formatBRL(lost.totalCents),
    formatDayLabel(lost.lastDay)
  ]);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Ranking de clientes</title><style>${documentStyle(
    "landscape"
  )}</style></head><body>
<div class="header"><div><h1>Ranking de clientes</h1><p class="period">${escapeHtml(
    periodLine(input)
  )}</p></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpis}
${section(
  "Clientes do periodo",
  table(
    [
      "#",
      "Cliente",
      "Documento / cidade",
      "Classe",
      "Cargas",
      "Peso",
      "Faturamento",
      "% do total",
      "Preco medio",
      "Ultima compra",
      "Antes",
      "Variacao"
    ],
    rows,
    rows.length ? footer : null,
    "Nenhuma venda concluida no periodo.",
    "detail"
  )
)}
${
  lostRows.length
    ? section(
        "Compraram no periodo anterior e nao compraram neste",
        table(
          ["Posicao antes", "Cliente", "Cargas", "Peso", "Faturamento", "Ultima compra"],
          lostRows,
          null,
          "",
          "detail"
        )
      )
    : ""
}
</body></html>`;
}

/** A planilha do botao Exportar Excel: a lista inteira com todas as colunas. */
export function rankingSpreadsheetHtml(input: RankingExportInput): string {
  const { ranking } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const blocks = [
    sheetTable(
      "Ranking de clientes",
      [
        "Posicao",
        "Cliente",
        "Documento",
        "Cidade/UF",
        "Classe ABC",
        "Cargas",
        "Peso (kg)",
        "Produto (R$)",
        "Frete (R$)",
        "Faturamento (R$)",
        "% do total",
        "% acumulado",
        "Preco medio (R$/t)",
        "Ticket por carga (R$)",
        "Dias com compra",
        "Primeira compra",
        "Ultima compra",
        "Produto principal",
        "Posicao anterior",
        "Variacao"
      ],
      ranking.rows.map((row) => {
        const info = infoOf(input, row);
        return [
          String(row.position),
          row.name,
          info?.document ? formatDocument(info.document) : "",
          [info?.city?.trim(), info?.state?.trim()].filter(Boolean).join("/"),
          row.abc,
          row.loads.toLocaleString("pt-BR"),
          row.weightKg.toLocaleString("pt-BR"),
          formatBRL(row.productCents),
          formatBRL(row.freightCents),
          formatBRL(row.totalCents),
          formatShare(row.share),
          formatShare(row.cumulativeShare),
          row.avgPriceCentsPerTon > 0 ? formatBRL(row.avgPriceCentsPerTon) : "-",
          formatBRL(row.ticketCents),
          row.activeDays.toLocaleString("pt-BR"),
          formatDayLabel(row.firstDay),
          formatDayLabel(row.lastDay),
          row.mainProduct ?? "",
          row.previous ? String(row.previous.position) : "Novo",
          formatChange(row.change)
        ];
      }),
      ranking.rows.length
        ? [
            "TOTAL",
            `${ranking.totals.customers.toLocaleString("pt-BR")} clientes`,
            "",
            "",
            "",
            ranking.totals.loads.toLocaleString("pt-BR"),
            ranking.totals.weightKg.toLocaleString("pt-BR"),
            formatBRL(ranking.totals.productCents),
            formatBRL(ranking.totals.freightCents),
            formatBRL(ranking.totals.totalCents),
            "100,0%",
            "",
            ranking.totals.weightKg > 0
              ? formatBRL(avgPricePerTon(ranking.totals.productCents, ranking.totals.weightKg))
              : "-",
            ranking.totals.loads > 0
              ? formatBRL(Math.round(ranking.totals.totalCents / ranking.totals.loads))
              : "-",
            "",
            "",
            "",
            "",
            "",
            ""
          ]
        : null
    )
  ];
  if (ranking.lost.length) {
    blocks.push(
      sheetTable(
        "Compraram no periodo anterior e nao compraram neste",
        ["Posicao anterior", "Cliente", "Cargas", "Peso (kg)", "Faturamento (R$)", "Ultima compra"],
        ranking.lost.map((lost) => [
          String(lost.previousPosition),
          lost.name,
          lost.loads.toLocaleString("pt-BR"),
          lost.weightKg.toLocaleString("pt-BR"),
          formatBRL(lost.totalCents),
          formatDayLabel(lost.lastDay)
        ])
      )
    );
  }
  return `<!doctype html><html ${SPREADSHEET_HTML_ATTRS}><head><meta charset="utf-8" /><title>Ranking de clientes</title><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Ranking de clientes</h1>
<p class="sub">${escapeHtml(`${periodLine(input)} - gerado em ${generatedAt.toLocaleString("pt-BR")}`)}</p>
${blocks.join("\n")}
</body></html>`;
}
