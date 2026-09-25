/**
 * Monitoramento de vendas em tempo real — a tela `/monitoramento` (estilo KDS: o que a pedreira
 * esta vendendo agora, em cartoes e graficos). Aqui ficam SO as contas puras; a leitura da nuvem
 * e o tempo real moram em `pages/Monitor.tsx`.
 *
 * Regras que vem de fora e nao podem se perder:
 *
 * - venda e pesagem CONCLUIDA (`CLOSED_STATUSES`, sem as canceladas), datada pelo FECHAMENTO:
 *   `closed_at`, com `created_at` so para a pesagem antiga sem horario de saida (CLAUDE.md, "Data
 *   da pesagem nos relatorios") — e a data que sobe ao OMIE como emissao do pedido;
 * - o patio ("No patio agora") e o conjunto das pesagens ABERTAS e conta pela ENTRADA
 *   (`created_at`), como `dashboard.ts` e o controle de caminhoes;
 * - "hoje", as horas do grafico e os dias saem no fuso da UNIDADE (`units.timezone`), nunca no
 *   do navegador de quem esta olhando;
 * - dinheiro no monitor e sempre `total_cents` (material + frete): e o que soma no "Faturamento"
 *   e o que faz as barras de produto, cliente e forma de pagamento baterem com ele.
 */

import { isOpenOperation } from "./dashboard";
import {
  addDays,
  avgPricePerTon,
  formatDayLabel,
  formatShortDate,
  isClosedStatus
} from "./insights";
import { DEFAULT_UNIT_TIMEZONE } from "./loading";
import type { Tables } from "./supabase";

type Operation = Tables<"weighing_operations">;

/** Colunas que a tela le — so o necessario, a tela fica aberta o dia inteiro. */
export const MONITOR_COLUMNS =
  "id, unit_id, status, created_at, closed_at, plate, driver_name, customer_id, customer_name, product_id, product_description, net_weight_kg, unit_price_cents, product_total_cents, freight_total_cents, total_cents, payment_method_id";

export type MonitorOperation = Pick<
  Operation,
  | "id"
  | "unit_id"
  | "status"
  | "created_at"
  | "closed_at"
  | "plate"
  | "driver_name"
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "net_weight_kg"
  | "unit_price_cents"
  | "product_total_cents"
  | "freight_total_cents"
  | "total_cents"
  | "payment_method_id"
>;

export interface MonitorUnit {
  id: string;
  name: string;
  timezone: string | null;
  /** Tempo medio dentro da pedreira (30 dias) que a balanca projeta na unidade. */
  avgQuarryMinutes: number | null;
}

export interface MonitorPaymentMethod {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Fuso da unidade
// ---------------------------------------------------------------------------

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Fuso valido da unidade; vazio ou desconhecido do navegador vira o padrao (Brasilia). */
export function safeTimeZone(value: string | null | undefined): string {
  const zone = value?.trim();
  if (!zone) return DEFAULT_UNIT_TIMEZONE;
  try {
    zoneFormatter(zone);
    return zone;
  } catch {
    return DEFAULT_UNIT_TIMEZONE;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Data e hora de parede de um instante no fuso pedido. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second")
  };
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Dia (AAAA-MM-DD) de um instante no fuso da unidade. */
export function zonedDayKey(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** Instante da meia-noite local de um dia AAAA-MM-DD (duas passadas: cobre horario de verao). */
export function zonedMidnight(dayKey: string, timeZone: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/** "14:32" no fuso da unidade. */
export function formatClock(iso: string | null | undefined, timeZone: string): string {
  const ms = toMs(iso);
  if (ms === null) return "--:--";
  const parts = zonedParts(ms, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

export type MonitorPeriod = "today" | "yesterday" | "7d" | "30d" | "month";

export const MONITOR_PERIODS: ReadonlyArray<{ id: MonitorPeriod; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "7d", label: "Ultimos 7 dias" },
  { id: "30d", label: "Ultimos 30 dias" },
  { id: "month", label: "Este mes" }
];

export interface PeriodWindow {
  period: MonitorPeriod;
  /** Nome do periodo ("Hoje", "Ultimos 7 dias"). */
  label: string;
  /** Legenda da serie do periodo no grafico. */
  seriesLabel: string;
  /** Legenda da serie de comparacao ("Ontem", "Mes anterior"). */
  compareLabel: string;
  /** Frase das variacoes dos indicadores ("vs ontem ate agora"). */
  deltaLabel: string;
  granularity: "hour" | "day";
  /** Periodo `[start, end)`, em milissegundos; `end` e o fim do ULTIMO dia, nao "agora". */
  start: number;
  end: number;
  /** Periodo anterior equivalente, inteiro. */
  prevStart: number;
  prevEnd: number;
  /** Dias do periodo (o eixo do grafico) e os do anterior, alinhados pela posicao. */
  days: string[];
  prevDays: string[];
  /** O periodo contem o instante atual (ainda esta acontecendo). */
  live: boolean;
}

function daySpan(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

function monthDays(firstDay: string): string[] {
  const days: string[] = [];
  const month = firstDay.slice(0, 7);
  for (let day = firstDay; day.slice(0, 7) === month; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * Janela do periodo no fuso da unidade. O fim e sempre o fim do ultimo dia (e nao "agora"): a
 * consulta pega tambem a venda que fechar enquanto a tela esta aberta, e a janela so muda quando
 * o dia vira.
 */
export function resolvePeriodWindow(
  period: MonitorPeriod,
  now: number,
  timeZone: string
): PeriodWindow {
  const today = zonedDayKey(now, timeZone);
  let resolved: MonitorPeriod = period;
  let days: string[];
  let prevDays: string[];
  let labels: Pick<PeriodWindow, "label" | "seriesLabel" | "compareLabel" | "deltaLabel">;
  switch (period) {
    case "yesterday":
      days = [addDays(today, -1)];
      prevDays = [addDays(today, -2)];
      labels = {
        label: "Ontem",
        seriesLabel: "Ontem",
        compareLabel: "Anteontem",
        deltaLabel: "vs anteontem"
      };
      break;
    case "7d":
      days = daySpan(addDays(today, -6), 7);
      prevDays = daySpan(addDays(today, -13), 7);
      labels = {
        label: "Ultimos 7 dias",
        seriesLabel: "Ultimos 7 dias",
        compareLabel: "7 dias anteriores",
        deltaLabel: "vs 7 dias anteriores ate a mesma hora"
      };
      break;
    case "30d":
      days = daySpan(addDays(today, -29), 30);
      prevDays = daySpan(addDays(today, -59), 30);
      labels = {
        label: "Ultimos 30 dias",
        seriesLabel: "Ultimos 30 dias",
        compareLabel: "30 dias anteriores",
        deltaLabel: "vs 30 dias anteriores ate a mesma hora"
      };
      break;
    case "month": {
      const first = `${today.slice(0, 7)}-01`;
      days = monthDays(first);
      prevDays = monthDays(`${addDays(first, -1).slice(0, 7)}-01`);
      labels = {
        label: "Este mes",
        seriesLabel: "Este mes",
        compareLabel: "Mes anterior",
        deltaLabel: "vs mes anterior ate o mesmo ponto"
      };
      break;
    }
    case "today":
    default:
      days = [today];
      prevDays = [addDays(today, -1)];
      labels = {
        label: "Hoje",
        seriesLabel: "Hoje",
        compareLabel: "Ontem",
        deltaLabel: "vs ontem ate a mesma hora"
      };
      resolved = "today";
  }
  const start = zonedMidnight(days[0], timeZone);
  const end = zonedMidnight(addDays(days[days.length - 1], 1), timeZone);
  const prevStart = zonedMidnight(prevDays[0], timeZone);
  const prevEnd = zonedMidnight(addDays(prevDays[prevDays.length - 1], 1), timeZone);
  return {
    period: resolved,
    ...labels,
    granularity: days.length === 1 ? "hour" : "day",
    start,
    end,
    prevStart,
    prevEnd,
    days,
    prevDays,
    live: now >= start && now < end
  };
}

/**
 * Ate onde o periodo anterior entra nos indicadores: periodo em andamento compara com o anterior
 * ATE O MESMO PONTO (hoje as 14h contra ontem ate as 14h); periodo fechado, com o anterior inteiro.
 */
export function compareCutoff(window: PeriodWindow, now: number): number {
  if (!window.live) return window.prevEnd;
  return Math.min(window.prevStart + Math.max(0, now - window.start), window.prevEnd);
}

// ---------------------------------------------------------------------------
// Datas da pesagem
// ---------------------------------------------------------------------------

export function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Instante da venda: o FECHAMENTO, com a criacao so para a pesagem antiga sem saida. */
export function saleAt(op: Pick<Operation, "closed_at" | "created_at">): number | null {
  return toMs(op.closed_at) ?? toMs(op.created_at);
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export type MonitorMetric = "tons" | "revenue";

export const MONITOR_WIDGETS = [
  "kpis",
  "feed",
  "yard",
  "hourly",
  "products",
  "customers",
  "payments"
] as const;
export type MonitorWidget = (typeof MONITOR_WIDGETS)[number];

export const MONITOR_WIDGET_LABELS: Record<MonitorWidget, string> = {
  kpis: "Indicadores",
  feed: "Ultimas vendas",
  yard: "No patio agora",
  hourly: "Vendas por hora",
  products: "Por produto",
  customers: "Top clientes",
  payments: "Formas de pagamento"
};

export interface MonitorProductRef {
  key: string;
  label: string;
}

export interface MonitorFilters {
  period: MonitorPeriod;
  /** Unidade escolhida; `null` = a do usuario. */
  unitId: string | null;
  products: MonitorProductRef[];
  /** Busca por nome de cliente (sem acento, sem caixa). */
  customer: string;
  /** Ids de forma de pagamento (`NO_PAYMENT_KEY` = venda sem forma). */
  payments: string[];
  /** O que as barras e o grafico medem. */
  metric: MonitorMetric;
  widgets: Record<MonitorWidget, boolean>;
}

export const NO_PAYMENT_KEY = "sem-forma";
export const NO_PAYMENT_LABEL = "Sem forma de pagamento";

export function defaultMonitorFilters(): MonitorFilters {
  return {
    period: "today",
    unitId: null,
    products: [],
    customer: "",
    payments: [],
    metric: "tons",
    widgets: Object.fromEntries(MONITOR_WIDGETS.map((widget) => [widget, true])) as Record<
      MonitorWidget,
      boolean
    >
  };
}

/** Texto para comparar: sem acento, sem caixa, espacos colapsados. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave do produto: o id do cadastro; pesagem sem cadastro cai no nome gravado nela. */
export function productKeyOf(op: Pick<Operation, "product_id" | "product_description">): string {
  return op.product_id || `nome:${normalizeText(op.product_description) || "-"}`;
}

export function productLabelOf(op: Pick<Operation, "product_description">): string {
  return op.product_description?.trim() || "Sem produto";
}

export function customerKeyOf(op: Pick<Operation, "customer_id" | "customer_name">): string {
  return op.customer_id || `nome:${normalizeText(op.customer_name) || "-"}`;
}

export function customerLabelOf(op: Pick<Operation, "customer_name">): string {
  return op.customer_name?.trim() || "Sem cliente";
}

export function paymentKeyOf(op: Pick<Operation, "payment_method_id">): string {
  return op.payment_method_id || NO_PAYMENT_KEY;
}

/** Produto, cliente e forma de pagamento (o periodo e a unidade ja vem da consulta). */
export function matchesFilters(op: MonitorOperation, filters: MonitorFilters): boolean {
  if (filters.products.length > 0) {
    const key = productKeyOf(op);
    if (!filters.products.some((product) => product.key === key)) return false;
  }
  const search = normalizeText(filters.customer);
  if (search && !normalizeText(op.customer_name).includes(search)) return false;
  if (filters.payments.length > 0 && !filters.payments.includes(paymentKeyOf(op))) return false;
  return true;
}

/** Unidade valida da tela: a escolhida se existir na empresa, senao a do usuario. */
export function resolveUnitId(
  chosen: string | null,
  units: ReadonlyArray<Pick<MonitorUnit, "id">>,
  userUnitId: string
): string {
  if (!chosen) return userUnitId;
  if (units.length === 0) return chosen;
  return units.some((unit) => unit.id === chosen) ? chosen : userUnitId;
}

/** Quantos filtros de recorte estao ligados (o botao "Filtros" mostra o numero). */
export function countActiveFilters(filters: MonitorFilters, defaultUnitId: string): number {
  return (
    (filters.unitId && filters.unitId !== defaultUnitId ? 1 : 0) +
    filters.products.length +
    (normalizeText(filters.customer) ? 1 : 0) +
    filters.payments.length
  );
}

export type FilterChipKind = "unit" | "product" | "customer" | "payment";

export interface FilterChip {
  id: string;
  kind: FilterChipKind;
  value: string;
  label: string;
}

/** Os filtros ligados, como etiquetas removiveis embaixo da barra do topo. */
export function activeFilterChips(
  filters: MonitorFilters,
  context: {
    defaultUnitId: string;
    unitName: (id: string) => string | null;
    paymentName: (key: string) => string | null;
  }
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.unitId && filters.unitId !== context.defaultUnitId) {
    chips.push({
      id: `unit:${filters.unitId}`,
      kind: "unit",
      value: filters.unitId,
      label: context.unitName(filters.unitId) ?? "Outra unidade"
    });
  }
  for (const product of filters.products) {
    chips.push({
      id: `product:${product.key}`,
      kind: "product",
      value: product.key,
      label: product.label
    });
  }
  const customer = filters.customer.trim();
  if (normalizeText(customer)) {
    chips.push({
      id: "customer",
      kind: "customer",
      value: customer,
      label: `Cliente: ${customer}`
    });
  }
  for (const key of filters.payments) {
    chips.push({
      id: `payment:${key}`,
      kind: "payment",
      value: key,
      label:
        context.paymentName(key) ?? (key === NO_PAYMENT_KEY ? NO_PAYMENT_LABEL : "Forma removida")
    });
  }
  return chips;
}

export function removeFilterChip(filters: MonitorFilters, chip: FilterChip): MonitorFilters {
  switch (chip.kind) {
    case "unit":
      return { ...filters, unitId: null };
    case "product":
      return { ...filters, products: filters.products.filter((p) => p.key !== chip.value) };
    case "customer":
      return { ...filters, customer: "" };
    case "payment":
      return { ...filters, payments: filters.payments.filter((key) => key !== chip.value) };
  }
}

/** "Limpar filtros": tira os recortes e mantem periodo, medida e paineis. */
export function clearDimensionFilters(filters: MonitorFilters): MonitorFilters {
  return { ...filters, unitId: null, products: [], customer: "", payments: [] };
}

/** Liga/desliga um item de uma lista de filtro. */
export function toggleValue<T>(list: readonly T[], value: T, same: (a: T, b: T) => boolean): T[] {
  return list.some((item) => same(item, value))
    ? list.filter((item) => !same(item, value))
    : [...list, value];
}

/** Produtos que aparecem nos dados (mais os ja escolhidos), em ordem alfabetica. */
export function productOptions(
  operations: readonly MonitorOperation[],
  selected: readonly MonitorProductRef[]
): MonitorProductRef[] {
  const map = new Map<string, string>();
  for (const op of operations) {
    const key = productKeyOf(op);
    if (!map.has(key)) map.set(key, productLabelOf(op));
  }
  for (const product of selected) if (!map.has(product.key)) map.set(product.key, product.label);
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || a.key.localeCompare(b.key));
}

/** Formas de pagamento que aparecem nos dados (mais as escolhidas), na ordem do cadastro. */
export function paymentOptions(
  operations: readonly MonitorOperation[],
  methods: readonly MonitorPaymentMethod[],
  selected: readonly string[]
): Array<{ key: string; label: string }> {
  const present = new Set<string>(selected);
  for (const op of operations) present.add(paymentKeyOf(op));
  const options: Array<{ key: string; label: string }> = [];
  for (const method of methods) {
    if (present.delete(method.id)) options.push({ key: method.id, label: method.name });
  }
  if (present.delete(NO_PAYMENT_KEY))
    options.push({ key: NO_PAYMENT_KEY, label: NO_PAYMENT_LABEL });
  for (const key of present) options.push({ key, label: "Forma removida" });
  return options;
}

// ---------------------------------------------------------------------------
// Guardar os filtros no navegador
// ---------------------------------------------------------------------------

export const MONITOR_FILTERS_STORAGE_KEY = "kr-monitor-filters-v1";

const MAX_LIST = 50;
const MAX_TEXT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text ? text : null;
}

/**
 * Le os filtros guardados. Qualquer coisa estranha (JSON quebrado, versao antiga, campo de outro
 * tipo) volta ao padrao campo a campo — a tela nunca deixa de abrir por causa do armazenamento.
 */
export function parseMonitorFilters(raw: string | null | undefined): MonitorFilters {
  const defaults = defaultMonitorFilters();
  if (!raw) return defaults;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isRecord(data)) return defaults;

  const period = MONITOR_PERIODS.some((option) => option.id === data.period)
    ? (data.period as MonitorPeriod)
    : defaults.period;

  const products: MonitorProductRef[] = [];
  if (Array.isArray(data.products)) {
    for (const item of data.products) {
      if (!isRecord(item)) continue;
      const key = cleanText(item.key);
      const label = cleanText(item.label);
      if (!key || !label || products.some((product) => product.key === key)) continue;
      products.push({ key, label });
      if (products.length >= MAX_LIST) break;
    }
  }

  const payments: string[] = [];
  if (Array.isArray(data.payments)) {
    for (const item of data.payments) {
      const key = cleanText(item);
      if (!key || payments.includes(key)) continue;
      payments.push(key);
      if (payments.length >= MAX_LIST) break;
    }
  }

  const widgets = { ...defaults.widgets };
  if (isRecord(data.widgets)) {
    for (const widget of MONITOR_WIDGETS) {
      const value = data.widgets[widget];
      if (typeof value === "boolean") widgets[widget] = value;
    }
  }

  return {
    period,
    unitId: cleanText(data.unitId, 100),
    products,
    customer: typeof data.customer === "string" ? data.customer.slice(0, 120) : "",
    payments,
    metric: data.metric === "revenue" ? "revenue" : "tons",
    widgets
  };
}

export function serializeMonitorFilters(filters: MonitorFilters): string {
  return JSON.stringify({
    period: filters.period,
    unitId: filters.unitId,
    products: filters.products,
    customer: filters.customer,
    payments: filters.payments,
    metric: filters.metric,
    widgets: filters.widgets
  });
}

// ---------------------------------------------------------------------------
// Recorte do periodo
// ---------------------------------------------------------------------------

export interface SalesSlices {
  /** Vendas do periodo, a mais nova primeiro. */
  current: MonitorOperation[];
  /** Vendas do periodo anterior inteiro (a linha de comparacao do grafico). */
  previous: MonitorOperation[];
  /** Do periodo anterior, so ate o mesmo ponto (a base das variacoes dos indicadores). */
  previousToDate: MonitorOperation[];
}

export function sliceSales(
  operations: readonly MonitorOperation[],
  window: PeriodWindow,
  now: number,
  filters: MonitorFilters
): SalesSlices {
  const cutoff = compareCutoff(window, now);
  const current: Array<{ op: MonitorOperation; at: number }> = [];
  const previous: MonitorOperation[] = [];
  const previousToDate: MonitorOperation[] = [];
  const seen = new Set<string>();
  for (const op of operations) {
    if (seen.has(op.id)) continue;
    seen.add(op.id);
    if (!isClosedStatus(op.status) || !matchesFilters(op, filters)) continue;
    const at = saleAt(op);
    if (at === null) continue;
    if (at >= window.start && at < window.end) current.push({ op, at });
    else if (at >= window.prevStart && at < window.prevEnd) {
      previous.push(op);
      if (at < cutoff) previousToDate.push(op);
    }
  }
  current.sort((a, b) => b.at - a.at || b.op.id.localeCompare(a.op.id));
  return { current: current.map((item) => item.op), previous, previousToDate };
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export interface KpiTotals {
  loads: number;
  kg: number;
  totalCents: number;
  productCents: number;
  freightCents: number;
  /** Preco do MATERIAL por tonelada (sem frete); `null` sem peso. */
  pricePerTonCents: number | null;
  /** Tempo medio no patio de quem SAIU no periodo; `null` sem saida medida. */
  avgYardMinutes: number | null;
}

/** Media de `closed_at - created_at` em minutos, ignorando saida antes da entrada. */
export function averageYardMinutes(
  operations: ReadonlyArray<Pick<Operation, "created_at" | "closed_at">>
): number | null {
  let sum = 0;
  let count = 0;
  for (const op of operations) {
    const entry = toMs(op.created_at);
    const exit = toMs(op.closed_at);
    if (entry === null || exit === null || exit < entry) continue;
    sum += (exit - entry) / 60_000;
    count++;
  }
  return count > 0 ? sum / count : null;
}

export function kpiTotals(operations: readonly MonitorOperation[]): KpiTotals {
  let kg = 0;
  let totalCents = 0;
  let productCents = 0;
  let freightCents = 0;
  for (const op of operations) {
    kg += op.net_weight_kg ?? 0;
    totalCents += op.total_cents ?? 0;
    productCents += op.product_total_cents ?? 0;
    freightCents += op.freight_total_cents ?? 0;
  }
  return {
    loads: operations.length,
    kg,
    totalCents,
    productCents,
    freightCents,
    pricePerTonCents: kg > 0 ? avgPricePerTon(productCents, kg) : null,
    avgYardMinutes: averageYardMinutes(operations)
  };
}

/** Variacao relativa (0,12 = +12%); `null` quando nao ha base para comparar. */
export function relativeDelta(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

export type DeltaTone = "good" | "bad" | "flat" | "none";

/** Cor da variacao: direcao x "subir e bom?" (tempo no patio subir e ruim). */
export function deltaTone(delta: number | null, higherIsBetter = true): DeltaTone {
  if (delta === null) return "none";
  if (Math.abs(delta) < 0.005) return "flat";
  return delta > 0 === higherIsBetter ? "good" : "bad";
}

export interface MonitorKpis {
  current: KpiTotals;
  previous: KpiTotals;
  /** Parte do faturamento que e frete (0..1); `null` sem faturamento. */
  freightShare: number | null;
  yardNow: number;
  yardAttention: number;
  yardLate: number;
  deltas: {
    kg: number | null;
    totalCents: number | null;
    loads: number | null;
    pricePerTon: number | null;
    avgYardMinutes: number | null;
  };
}

export function computeKpis(slices: SalesSlices, yard: readonly YardTicket[]): MonitorKpis {
  const current = kpiTotals(slices.current);
  const previous = kpiTotals(slices.previousToDate);
  return {
    current,
    previous,
    freightShare: current.totalCents > 0 ? current.freightCents / current.totalCents : null,
    yardNow: yard.length,
    yardAttention: yard.filter((ticket) => ticket.level === "attention").length,
    yardLate: yard.filter((ticket) => ticket.level === "late").length,
    deltas: {
      kg: relativeDelta(current.kg, previous.kg),
      totalCents: relativeDelta(current.totalCents, previous.totalCents),
      loads: relativeDelta(current.loads, previous.loads),
      pricePerTon: relativeDelta(current.pricePerTonCents, previous.pricePerTonCents),
      avgYardMinutes: relativeDelta(current.avgYardMinutes, previous.avgYardMinutes)
    }
  };
}

// ---------------------------------------------------------------------------
// Serie do grafico ("Vendas por hora" / por dia)
// ---------------------------------------------------------------------------

export interface Aggregate {
  loads: number;
  kg: number;
  cents: number;
}

export interface SeriesBucket {
  key: string;
  /** Rotulo curto do eixo ("07h", "25/09"). */
  label: string;
  /** Rotulo longo da dica ("07:00 as 07:59", "25/09/2026"). */
  title: string;
  /** Rotulo do ponto de comparacao ("24/09/2026"); `null` = mesma hora do dia anterior. */
  previousTitle: string | null;
  /** `null` = ainda nao aconteceu (hora ou dia futuro do periodo em andamento). */
  current: Aggregate | null;
  previous: Aggregate | null;
  /** E a hora/o dia de agora. */
  isNow: boolean;
}

export interface SalesSeries {
  granularity: "hour" | "day";
  buckets: SeriesBucket[];
}

/** Horas que o grafico do dia mostra no minimo: o expediente normal da pedreira. */
export const SERIES_FIRST_HOUR = 6;
export const SERIES_LAST_HOUR = 18;

const emptyAggregate = (): Aggregate => ({ loads: 0, kg: 0, cents: 0 });

function addTo(map: Map<string | number, Aggregate>, key: string | number, op: MonitorOperation) {
  const aggregate = map.get(key) ?? emptyAggregate();
  aggregate.loads += 1;
  aggregate.kg += op.net_weight_kg ?? 0;
  aggregate.cents += op.total_cents ?? 0;
  map.set(key, aggregate);
}

export function metricValue(aggregate: Pick<Aggregate, "kg" | "cents">, metric: MonitorMetric) {
  return metric === "tons" ? aggregate.kg : aggregate.cents;
}

/**
 * Um balde por hora (periodo de um dia) ou por dia (varios dias), com o periodo anterior
 * alinhado pela posicao. O dia mostra pelo menos 06h-18h e estica para qualquer hora com venda
 * (e ate a hora atual); balde que ainda nao aconteceu vem `null`, para nao desenhar zero.
 */
export function salesSeries(
  slices: Pick<SalesSlices, "current" | "previous">,
  window: PeriodWindow,
  now: number,
  timeZone: string
): SalesSeries {
  const current = new Map<string | number, Aggregate>();
  const previous = new Map<string | number, Aggregate>();

  if (window.granularity === "hour") {
    for (const op of slices.current) addTo(current, zonedParts(saleAt(op) ?? 0, timeZone).hour, op);
    for (const op of slices.previous) {
      addTo(previous, zonedParts(saleAt(op) ?? 0, timeZone).hour, op);
    }
    const nowHour = window.live ? zonedParts(now, timeZone).hour : null;
    const hours = [...current.keys(), ...previous.keys()] as number[];
    const first = Math.max(0, Math.min(SERIES_FIRST_HOUR, ...hours));
    const last = Math.min(23, Math.max(SERIES_LAST_HOUR, ...hours, nowHour ?? 0));
    const buckets: SeriesBucket[] = [];
    for (let hour = first; hour <= last; hour++) {
      const future = nowHour !== null && hour > nowHour;
      buckets.push({
        key: `h${hour}`,
        label: `${pad2(hour)}h`,
        title: `${pad2(hour)}:00 as ${pad2(hour)}:59`,
        previousTitle: null,
        current: future ? null : (current.get(hour) ?? emptyAggregate()),
        previous: previous.get(hour) ?? emptyAggregate(),
        isNow: hour === nowHour
      });
    }
    return { granularity: "hour", buckets };
  }

  for (const op of slices.current) addTo(current, zonedDayKey(saleAt(op) ?? 0, timeZone), op);
  for (const op of slices.previous) addTo(previous, zonedDayKey(saleAt(op) ?? 0, timeZone), op);
  const today = zonedDayKey(now, timeZone);
  const buckets = window.days.map((day, index): SeriesBucket => {
    const prevDay = window.prevDays[index] ?? null;
    return {
      key: day,
      label: formatShortDate(day),
      title: formatDayLabel(day),
      previousTitle: prevDay ? formatDayLabel(prevDay) : null,
      current: window.live && day > today ? null : (current.get(day) ?? emptyAggregate()),
      previous: prevDay ? (previous.get(prevDay) ?? emptyAggregate()) : null,
      isNow: window.live && day === today
    };
  });
  return { granularity: "day", buckets };
}

// ---------------------------------------------------------------------------
// Rankings (produto, cliente) e formas de pagamento
// ---------------------------------------------------------------------------

export interface RankRow {
  key: string;
  label: string;
  loads: number;
  kg: number;
  cents: number;
  /** Parte do total na medida escolhida (0..1). */
  share: number;
  /** Linha "Outros": a cauda somada. */
  other: boolean;
}

export const OTHER_KEY = "__outros__";

/**
 * Agrupa e ordena pela medida (maior primeiro; empate pelo nome, para a lista nao dancar a cada
 * atualizacao). Passando de `limit`, a cauda vira uma linha "Outros".
 */
export function rankBy(
  operations: readonly MonitorOperation[],
  keyOf: (op: MonitorOperation) => string,
  labelOf: (op: MonitorOperation) => string,
  metric: MonitorMetric,
  limit: number
): RankRow[] {
  const groups = new Map<string, RankRow>();
  let total = 0;
  for (const op of operations) {
    const key = keyOf(op);
    const row = groups.get(key) ?? {
      key,
      label: labelOf(op),
      loads: 0,
      kg: 0,
      cents: 0,
      share: 0,
      other: false
    };
    row.loads += 1;
    row.kg += op.net_weight_kg ?? 0;
    row.cents += op.total_cents ?? 0;
    groups.set(key, row);
    total += metricValue({ kg: op.net_weight_kg ?? 0, cents: op.total_cents ?? 0 }, metric);
  }
  const rows = [...groups.values()].sort(
    (a, b) =>
      metricValue(b, metric) - metricValue(a, metric) ||
      a.label.localeCompare(b.label, "pt-BR") ||
      a.key.localeCompare(b.key)
  );
  // Sobrando uma so, ela aparece com o proprio nome: "Outros (1)" esconderia um nome a toa.
  const cut = rows.length > limit + 1 ? Math.max(0, limit) : rows.length;
  const top = rows.slice(0, cut);
  const rest = rows.slice(cut);
  if (rest.length > 0) {
    top.push({
      key: OTHER_KEY,
      label: `Outros (${rest.length})`,
      loads: rest.reduce((sum, row) => sum + row.loads, 0),
      kg: rest.reduce((sum, row) => sum + row.kg, 0),
      cents: rest.reduce((sum, row) => sum + row.cents, 0),
      share: 0,
      other: true
    });
  }
  for (const row of top) row.share = total > 0 ? metricValue(row, metric) / total : 0;
  return top;
}

/** Quantas formas de pagamento ganham cor propria; o resto soma em "Outras". */
export const PAYMENT_SLOTS = 6;

export interface PaymentSegment {
  key: string;
  label: string;
  loads: number;
  kg: number;
  cents: number;
  share: number;
  /** Cor fixa da forma (0..PAYMENT_SLOTS-1); `null` = "Outras" (cinza). */
  slot: number | null;
}

/**
 * Formas de pagamento do periodo. A cor segue a FORMA, nao a posicao no ranking: o slot e a
 * ordem dela no cadastro, entao filtrar ou chegar venda nova nunca repinta as outras. Sem forma,
 * forma fora do cadastro e as que passam dos slots somam em "Outras". A ordem da barra tambem e
 * a do cadastro — a faixa nao troca de lugar a cada atualizacao.
 */
export function paymentBreakdown(
  operations: readonly MonitorOperation[],
  methods: readonly MonitorPaymentMethod[],
  metric: MonitorMetric
): PaymentSegment[] {
  const slotOf = new Map(
    methods.slice(0, PAYMENT_SLOTS).map((method, index) => [method.id, index])
  );
  const nameOf = new Map(methods.map((method) => [method.id, method.name]));
  const segments = new Map<string, PaymentSegment>();
  let total = 0;
  for (const op of operations) {
    const id = op.payment_method_id;
    const slot = id ? slotOf.get(id) : undefined;
    const key = slot === undefined ? OTHER_KEY : (id as string);
    const segment = segments.get(key) ?? {
      key,
      label: slot === undefined ? "Outras" : (nameOf.get(key) ?? "Forma removida"),
      loads: 0,
      kg: 0,
      cents: 0,
      share: 0,
      slot: slot ?? null
    };
    segment.loads += 1;
    segment.kg += op.net_weight_kg ?? 0;
    segment.cents += op.total_cents ?? 0;
    segments.set(key, segment);
    total += metricValue({ kg: op.net_weight_kg ?? 0, cents: op.total_cents ?? 0 }, metric);
  }
  const list = [...segments.values()].sort(
    (a, b) => (a.slot ?? PAYMENT_SLOTS) - (b.slot ?? PAYMENT_SLOTS)
  );
  for (const segment of list) {
    segment.share = total > 0 ? metricValue(segment, metric) / total : 0;
  }
  return list;
}

// ---------------------------------------------------------------------------
// Patio
// ---------------------------------------------------------------------------

export type YardLevel = "normal" | "attention" | "late";

export const DEFAULT_YARD_ATTENTION_MIN = 45;
export const DEFAULT_YARD_LATE_MIN = 90;

export interface YardThresholds {
  attention: number;
  late: number;
  /** De onde veio a media: da unidade (30 dias), do periodo na tela ou o padrao fixo. */
  basis: "unit" | "period" | "default";
}

/**
 * Limites do patio: "atencao" ao passar da media e "atrasado" ao passar do dobro dela. A media
 * preferida e a da unidade (30 dias, projetada pela balanca — a mesma do alerta do carregador);
 * sem ela, a das saidas do periodo; sem nenhuma, 45/90 min. A media e presa entre 10 min e 4 h
 * para um dia estranho nao deixar o patio todo vermelho (ou nunca vermelho).
 */
export function yardThresholds(
  unitAverage: number | null | undefined,
  periodAverage: number | null | undefined
): YardThresholds {
  const valid = (value: number | null | undefined) =>
    value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
  const unit = valid(unitAverage);
  const average = unit ?? valid(periodAverage);
  if (average === null) {
    return {
      attention: DEFAULT_YARD_ATTENTION_MIN,
      late: DEFAULT_YARD_LATE_MIN,
      basis: "default"
    };
  }
  const attention = Math.round(Math.min(240, Math.max(10, average)));
  return { attention, late: attention * 2, basis: unit !== null ? "unit" : "period" };
}

export function yardLevel(minutes: number, thresholds: YardThresholds): YardLevel {
  if (minutes >= thresholds.late) return "late";
  if (minutes >= thresholds.attention) return "attention";
  return "normal";
}

export interface YardTicket {
  operation: MonitorOperation;
  minutes: number;
  level: YardLevel;
  /** Quanto do limite de "atrasado" ja passou (0..1), para a barrinha do cartao. */
  progress: number;
}

/** Caminhoes no patio agora (abertas), o mais antigo primeiro — como a fila de um KDS. */
export function buildYard(
  open: readonly MonitorOperation[],
  filters: MonitorFilters,
  now: number,
  thresholds: YardThresholds
): YardTicket[] {
  const tickets: YardTicket[] = [];
  const seen = new Set<string>();
  for (const op of open) {
    if (seen.has(op.id) || !isOpenOperation(op) || !matchesFilters(op, filters)) continue;
    seen.add(op.id);
    const entry = toMs(op.created_at);
    const minutes = entry === null ? 0 : Math.max(0, (now - entry) / 60_000);
    tickets.push({
      operation: op,
      minutes,
      level: yardLevel(minutes, thresholds),
      progress: Math.min(1, minutes / Math.max(1, thresholds.late))
    });
  }
  return tickets.sort(
    (a, b) => b.minutes - a.minutes || a.operation.id.localeCompare(b.operation.id)
  );
}

// ---------------------------------------------------------------------------
// Tempo real
// ---------------------------------------------------------------------------

/** Ids que nao estavam na leitura anterior. Na primeira leitura (`null`) nada e novo. */
export function detectNewIds(
  previous: ReadonlySet<string> | null,
  ids: Iterable<string>
): Set<string> {
  const fresh = new Set<string>();
  if (!previous) return fresh;
  for (const id of ids) if (!previous.has(id)) fresh.add(id);
  return fresh;
}

/** Sem leitura boa ha mais que isso, o "Ao vivo" vira aviso. */
export const STALE_AFTER_MS = 2 * 60_000;

export type LiveState = "connecting" | "live" | "stale" | "offline";

export function liveState(input: {
  lastSuccessAt: number | null;
  now: number;
  online: boolean;
}): LiveState {
  if (!input.online) return "offline";
  if (input.lastSuccessAt === null) return "connecting";
  return input.now - input.lastSuccessAt > STALE_AFTER_MS ? "stale" : "live";
}

/** "agora", "ha 12 s", "ha 3 min", "ha 2 h". */
export function formatAgo(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 5) return "agora";
  if (seconds < 60) return `ha ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `ha ${minutes} min`;
  return `ha ${Math.floor(minutes / 60)} h`;
}

// ---------------------------------------------------------------------------
// Numeros na tela
// ---------------------------------------------------------------------------

/** "12 min", "1h05". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "--";
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)}h${pad2(total % 60)}`;
}

/** Toneladas com uma casa ("1.234,5 t"). */
export function formatTonnes(kg: number | null | undefined): string {
  return `${((kg ?? 0) / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

/** Dinheiro sem centavos para os numeros grandes ("R$ 60.971"). */
export function formatMoneyWhole(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  });
}

/** Dinheiro curto para rotulos de grafico ("R$ 950", "R$ 12,3 mil", "R$ 1,25 mi"). */
export function formatMoneyShort(cents: number | null | undefined): string {
  const reais = (cents ?? 0) / 100;
  const abs = Math.abs(reais);
  if (abs >= 1_000_000) {
    return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  }
  if (abs >= 10_000) {
    return `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return `R$ ${reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Valor na medida escolhida, no formato curto ("123,4 t" ou "R$ 12,3 mil"). */
export function formatMetric(value: number, metric: MonitorMetric): string {
  return metric === "tons" ? formatTonnes(value) : formatMoneyShort(value);
}

/** "+12%", "-3,4%", "0%". */
export function formatDelta(delta: number): string {
  const percent = delta * 100;
  const digits = Math.abs(percent) < 10 ? 1 : 0;
  if (Math.abs(percent) < 0.05) return "0%";
  return `${percent.toLocaleString("pt-BR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
    signDisplay: "exceptZero"
  })}%`;
}

/** "45%". */
export function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/**
 * Marcas do eixo em numeros redondos (passo 1, 2, 2,5 ou 5 vezes uma potencia de 10), de 0 ate
 * cobrir `max` — "0, 50, 100, 150, 200 t" le melhor numa TV do que "0, 65, 130, 195 t".
 */
export function chartTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((s) => s >= rough);
  const size = step ?? 10 * magnitude;
  const count = Math.ceil(Number((max / size).toFixed(9)));
  return Array.from({ length: count + 1 }, (_, index) => Number((index * size).toPrecision(12)));
}

/**
 * Rotulo do eixo na medida escolhida. Dinheiro usa a mesma unidade em todas as marcas (a da
 * maior), senao o eixo misturaria "R$ 5.000" com "R$ 10 mil".
 */
export function formatAxisValue(value: number, top: number, metric: MonitorMetric): string {
  if (metric === "tons") {
    const tons = value / 1000;
    return `${tons.toLocaleString("pt-BR", { maximumFractionDigits: top / 1000 <= 10 ? 1 : 0 })} t`;
  }
  const reais = value / 100;
  const topReais = top / 100;
  if (topReais >= 1_000_000) {
    return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  }
  if (topReais >= 10_000) {
    return `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return `R$ ${reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
