import "./monitor.css";

import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChartColumn,
  Clock,
  Hourglass,
  Inbox,
  LogOut,
  Minus,
  Moon,
  RefreshCw,
  Scale,
  Search,
  SlidersHorizontal,
  Sun,
  Table2,
  Timer,
  TriangleAlert,
  Truck,
  Weight,
  WifiOff,
  X,
  type LucideIcon
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { Link } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";
import { CLOSED_STATUSES } from "../lib/dashboard";
import { formatMoney, formatPlate } from "../lib/format";
import { tickIndexes } from "../lib/insights";
import {
  MONITOR_COLUMNS,
  MONITOR_FILTERS_STORAGE_KEY,
  MONITOR_FIT_QUERY,
  MONITOR_PERIODS,
  MONITOR_PHONE_ITEMS,
  MONITOR_WIDGETS,
  MONITOR_WIDGET_LABELS,
  NO_PAYMENT_LABEL,
  activeFilterChips,
  averageYardMinutes,
  buildYard,
  chartTicks,
  clearDimensionFilters,
  computeKpis,
  countActiveFilters,
  customerKeyOf,
  customerLabelOf,
  defaultMonitorFilters,
  deltaTone,
  detectNewIds,
  fitCapacity,
  fitCount,
  formatAgo,
  formatAxisValue,
  formatClock,
  formatDelta,
  formatDuration,
  formatMetric,
  formatMoneyShort,
  formatMoneyWhole,
  formatShare,
  formatTonnes,
  liveState,
  metricValue,
  parseMonitorFilters,
  paymentBreakdown,
  paymentOptions,
  productKeyOf,
  productLabelOf,
  productOptions,
  rankBy,
  rankLimitFor,
  removeFilterChip,
  resolvePeriodWindow,
  resolveUnitId,
  safeTimeZone,
  saleAt,
  salesSeries,
  serializeMonitorFilters,
  sliceSales,
  splitVisible,
  toggleValue,
  yardThresholds,
  zonedDayKey,
  type MonitorFilters,
  type MonitorKpis,
  type MonitorMetric,
  type MonitorOperation,
  type MonitorPaymentMethod,
  type MonitorUnit,
  type PaymentSegment,
  type PeriodWindow,
  type SalesSeries,
  type YardLevel,
  type YardThresholds,
  type YardTicket
} from "../lib/monitor";
import { OPEN_STATUS } from "../lib/operation";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

/*
 * Tela `/monitoramento`: o que a pedreira esta vendendo, em tempo real, estilo KDS. Fica FORA do
 * `Layout` (tela cheia, como a do carregador): serve para o celular do gestor e para a TV da
 * expedicao. `Monitor` le a nuvem e cuida do tempo real; `MonitorView` so desenha a partir de
 * dados simples (da para montar com dados de exemplo).
 *
 * Tela de parede, nao pagina: do notebook para cima (e no tablet deitado, `MONITOR_FIT_QUERY`) ela
 * cabe inteira no `100dvh` e nada rola. Cada painel tem a altura que a grade da; as listas medem
 * quantos cartoes cabem (`fitCount`) e fecham com "+N", os rankings viram "Outros" na ultima linha
 * que cabe e o grafico desenha na altura do painel. No celular a pagina rola, com listas curtas.
 *
 * Carga no banco (o projeto ja estourou cota): a leitura e so a janela do periodo (+ o anterior,
 * para a comparacao) com as colunas que a tela usa. Quem avisa que mudou algo e o Realtime de
 * `operation_change_pings` (uma linha por empresa, carimbada por gatilho a cada escrita em
 * `weighing_operations`) — o aviso nao carrega pesagem, so faz a tela reler, e varios avisos
 * seguidos viram uma leitura so. A releitura periodica e a rede de seguranca: 30 s enquanto o
 * aviso nao esta de pe e 90 s com ele funcionando, sempre parada com a aba escondida.
 */

const REALTIME_DEBOUNCE_MS = 1_500;
const POLL_FALLBACK_MS = 30_000;
/** Abaixo do `STALE_AFTER_MS` (2 min): com o aviso de pe e nada mudando, o "Ao vivo" nao pisca. */
const POLL_WITH_REALTIME_MS = 90_000;
const CLOCK_MS = 15_000;
const FRESH_HIGHLIGHT_MS = 8_000;
/** Voltar para a aba/foco nao rele se a ultima leitura comecou ha menos que isso. */
const WAKE_MIN_GAP_MS = 5_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
/** Itens da primeira pintura do painel de parede, antes de medir quantos cabem. */
const FIT_FALLBACK_ITEMS = 5;
/** Altura do rodape "+N" das listas (`.mon-fit-more`: 20 px + 5 px de margem). */
const FIT_FOOTER_PX = 25;
/** Etiquetas de filtro que aparecem no topo; o resto vira "+N" (abre a gaveta). */
const TOP_CHIPS = 2;

type RealtimeState = "connecting" | "live" | "down";

// ---------------------------------------------------------------------------
// Leitura da nuvem
// ---------------------------------------------------------------------------

/**
 * Vendas da unidade na janela: concluidas (sem as canceladas), pela data de FECHAMENTO, com a
 * pesagem antiga sem fechamento entrando pela criacao — o filtro de `q.closedOperations`.
 */
async function loadSales(
  companyId: string,
  unitId: string,
  startIso: string,
  endIso: string
): Promise<MonitorOperation[]> {
  const rows: MonitorOperation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select(MONITOR_COLUMNS)
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", [...CLOSED_STATUSES])
      .or(
        [
          `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
          `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
        ].join(",")
      )
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as MonitorOperation[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Caminhoes no patio da unidade: pesagem aberta (a mesma de `q.openOperations`). */
async function loadYard(companyId: string, unitId: string): Promise<MonitorOperation[]> {
  const { data, error } = await supabase
    .from("weighing_operations")
    .select(MONITOR_COLUMNS)
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .eq("status", OPEN_STATUS)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as MonitorOperation[];
}

async function loadUnits(companyId: string, userUnitId: string): Promise<MonitorUnit[]> {
  const { data, error } = await supabase
    .from("units")
    .select("id, name, timezone, avg_quarry_minutes, is_active")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((unit) => unit.is_active || unit.id === userUnitId)
    .map((unit) => {
      const average = Number(unit.avg_quarry_minutes ?? 0);
      return {
        id: unit.id,
        name: unit.name,
        timezone: unit.timezone,
        avgQuarryMinutes: Number.isFinite(average) && average > 0 ? average : null
      };
    });
}

/**
 * Todas as formas da empresa, inclusive as removidas (venda antiga ainda aponta para elas), na
 * ordem do cadastro — e essa ordem que da a cor fixa de cada uma no grafico.
 */
async function loadPaymentMethods(companyId: string): Promise<MonitorPaymentMethod[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id, name, sort_order, is_active, deleted_at")
    .eq("company_id", companyId)
    .limit(500);
  if (error) throw new Error(error.message);
  const rank = (row: { is_active: boolean; deleted_at: string | null }) =>
    row.deleted_at ? 2 : row.is_active ? 0 : 1;
  return (data ?? [])
    .slice()
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, "pt-BR") ||
        a.id.localeCompare(b.id)
    )
    .map((row) => ({ id: row.id, name: row.name }));
}

function readStoredFilters(): MonitorFilters {
  try {
    return parseMonitorFilters(window.localStorage.getItem(MONITOR_FILTERS_STORAGE_KEY));
  } catch {
    return defaultMonitorFilters();
  }
}

function storeFilters(filters: MonitorFilters): void {
  try {
    window.localStorage.setItem(MONITOR_FILTERS_STORAGE_KEY, serializeMonitorFilters(filters));
  } catch {
    // Navegador sem armazenamento (aba anonima, cota): os filtros valem so ate fechar a aba.
  }
}

interface Snapshot {
  key: string;
  sales: MonitorOperation[];
  yard: MonitorOperation[];
}

// ---------------------------------------------------------------------------
// Pagina (dados + tempo real)
// ---------------------------------------------------------------------------

export function Monitor() {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [filters, setFilters] = useState<MonitorFilters>(readStoredFilters);
  const [units, setUnits] = useState<MonitorUnit[]>([]);
  const [methods, setMethods] = useState<MonitorPaymentMethod[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [realtime, setRealtime] = useState<RealtimeState>("connecting");
  const [now, setNow] = useState(() => Date.now());
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());

  const unitId = resolveUnitId(filters.unitId, units, user.unitId);
  const unit = units.find((item) => item.id === unitId) ?? null;
  const timeZone = safeTimeZone(unit?.timezone);
  // A janela lida (e a chave dela) so muda quando o dia vira ou o periodo/fuso/unidade muda: o
  // tique do relogio nao gera leitura.
  const range = resolvePeriodWindow(filters.period, now, timeZone);
  const startIso = new Date(range.prevStart).toISOString();
  const endIso = new Date(range.end).toISOString();
  const fetchKey = `${unitId}|${startIso}|${endIso}`;

  const paramsRef = useRef({ companyId: user.companyId, unitId, startIso, endIso, fetchKey });
  paramsRef.current = { companyId: user.companyId, unitId, startIso, endIso, fetchKey };
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const lastStartRef = useRef(0);
  const seenRef = useRef<{ key: string; sales: Set<string>; yard: Set<string> } | null>(null);
  const freshTimerRef = useRef<number | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  /** Uma leitura por vez: quem chega com outra em andamento so pede a proxima. */
  const load = useCallback(async () => {
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }
    inFlightRef.current = true;
    lastStartRef.current = Date.now();
    const params = paramsRef.current;
    setRefreshing(true);
    try {
      const [sales, yard] = await Promise.all([
        loadSales(params.companyId, params.unitId, params.startIso, params.endIso),
        loadYard(params.companyId, params.unitId)
      ]);
      if (!mountedRef.current) return;
      // Trocou unidade/periodo no meio da leitura: esta resposta ja nao serve.
      if (params.fetchKey !== paramsRef.current.fetchKey) {
        queuedRef.current = true;
        return;
      }
      const seen = seenRef.current?.key === params.fetchKey ? seenRef.current : null;
      const salesIds = sales.map((row) => row.id);
      const yardIds = yard.map((row) => row.id);
      const fresh = new Set([
        ...detectNewIds(seen?.sales ?? null, salesIds),
        ...detectNewIds(seen?.yard ?? null, yardIds)
      ]);
      seenRef.current = { key: params.fetchKey, sales: new Set(salesIds), yard: new Set(yardIds) };
      setSnapshot({ key: params.fetchKey, sales, yard });
      setError(null);
      setLastSuccessAt(Date.now());
      if (fresh.size > 0) {
        setFreshIds(fresh);
        if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
        freshTimerRef.current = window.setTimeout(() => {
          freshTimerRef.current = null;
          if (mountedRef.current) setFreshIds(new Set());
        }, FRESH_HIGHLIGHT_MS);
      }
    } catch {
      if (mountedRef.current && params.fetchKey === paramsRef.current.fetchKey) {
        setError("Nao foi possivel atualizar as vendas. Confira a internet; tentamos de novo.");
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setRefreshing(false);
        if (queuedRef.current) {
          queuedRef.current = false;
          void load();
        }
      }
    }
  }, []);

  const scheduleRefresh = useCallback(
    (delayMs: number) => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void load();
      }, delayMs);
    },
    [load]
  );

  // Cadastros da tela: unidades (nome, fuso, media do patio) e formas de pagamento.
  useEffect(() => {
    let cancelled = false;
    loadUnits(user.companyId, user.unitId)
      .then((list) => !cancelled && setUnits(list))
      .catch(() => undefined);
    loadPaymentMethods(user.companyId)
      .then((list) => !cancelled && setMethods(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user.companyId, user.unitId]);

  useEffect(() => storeFilters(filters), [filters]);

  // Primeira leitura, e de novo a cada troca de unidade, periodo ou virada do dia.
  useEffect(() => {
    void load();
  }, [fetchKey, load]);

  // Aviso em tempo real: a balanca gravou pesagem da empresa -> rele (com folga de 1,5 s).
  useEffect(() => {
    let subscribedBefore = false;
    setRealtime("connecting");
    const channel = supabase
      .channel(`monitor-operation-pings:${user.companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_change_pings",
          filter: `company_id=eq.${user.companyId}`
        },
        () => scheduleRefresh(REALTIME_DEBOUNCE_MS)
      )
      .subscribe((status) => {
        if (!mountedRef.current) return;
        if (status === "SUBSCRIBED") {
          setRealtime("live");
          // O que mudou enquanto a inscricao esteve fora do ar nao volta sozinho.
          if (subscribedBefore) scheduleRefresh(REALTIME_DEBOUNCE_MS);
          subscribedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtime("down");
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user.companyId, scheduleRefresh]);

  // Rede de seguranca e relogio: so com a aba visivel; voltar para a aba, o foco e a internet
  // releem na hora.
  const pollMs = realtime === "live" ? POLL_WITH_REALTIME_MS : POLL_FALLBACK_MS;
  useEffect(() => {
    let poll: number | null = null;
    let clock: number | null = null;
    const start = () => {
      if (poll === null) poll = window.setInterval(() => void load(), pollMs);
      if (clock === null) clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    };
    const stop = () => {
      if (poll !== null) window.clearInterval(poll);
      if (clock !== null) window.clearInterval(clock);
      poll = null;
      clock = null;
    };
    const wake = (force: boolean) => {
      setNow(Date.now());
      if (force || Date.now() - lastStartRef.current >= WAKE_MIN_GAP_MS) scheduleRefresh(250);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      start();
      wake(false);
    };
    const onFocus = () => wake(false);
    const onOnline = () => {
      setOnline(true);
      wake(true);
    };
    const onOffline = () => setOnline(false);
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [load, pollMs, scheduleRefresh]);

  return (
    <MonitorView
      unitName={unit?.name ?? ""}
      unitId={unitId}
      units={units}
      defaultUnitId={user.unitId}
      timeZone={timeZone}
      now={now}
      theme={theme}
      onToggleTheme={toggle}
      onLogout={user.role === "monitoramento" ? () => void logout() : undefined}
      filters={filters}
      onFiltersChange={setFilters}
      operations={snapshot?.sales ?? []}
      yard={snapshot?.yard ?? []}
      paymentMethods={methods}
      unitAvgYardMinutes={unit?.avgQuarryMinutes ?? null}
      status={{
        // Sem nenhuma leitura boa ainda, o esqueleto fica (com o aviso de erro em cima): tela
        // vazia diria "nenhuma venda" sem saber.
        loading: snapshot === null,
        switching: snapshot !== null && snapshot.key !== fetchKey,
        refreshing,
        error,
        lastSuccessAt,
        online,
        realtime
      }}
      freshIds={freshIds}
      onRetry={() => void load()}
    />
  );
}

// ---------------------------------------------------------------------------
// Tela (so desenho)
// ---------------------------------------------------------------------------

export interface MonitorViewStatus {
  /** Primeira leitura ainda sem resposta: mostra o esqueleto. */
  loading: boolean;
  /** Trocou unidade/periodo e os dados na tela ainda sao os de antes (ficam esmaecidos). */
  switching: boolean;
  /** Ha leitura em andamento. */
  refreshing: boolean;
  /** Ultima leitura falhou (os dados bons de antes continuam na tela). */
  error: string | null;
  lastSuccessAt: number | null;
  online: boolean;
  realtime: RealtimeState;
}

export interface MonitorViewProps {
  unitName: string;
  unitId: string;
  units: MonitorUnit[];
  /** Unidade do usuario (o padrao do filtro). */
  defaultUnitId: string;
  /** Fuso da unidade (`safeTimeZone`). */
  timeZone: string;
  /** Relogio da tela (ms). */
  now: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** Presente = perfil so de monitoramento: mostra "Sair" em vez de "Voltar ao sistema". */
  onLogout?: () => void;
  filters: MonitorFilters;
  onFiltersChange: (next: MonitorFilters) => void;
  /** Vendas da janela lida (periodo + anterior), como vieram da nuvem. */
  operations: MonitorOperation[];
  /** Pesagens abertas da unidade. */
  yard: MonitorOperation[];
  paymentMethods: MonitorPaymentMethod[];
  unitAvgYardMinutes: number | null;
  status: MonitorViewStatus;
  /** Ids que acabaram de chegar (piscam). */
  freshIds: ReadonlySet<string>;
  onRetry: () => void;
}

const LEVEL_TEXT: Record<YardLevel, string> = {
  normal: "No tempo",
  attention: "Atencao",
  late: "Atrasado"
};

const BASIS_TEXT: Record<YardThresholds["basis"], string> = {
  unit: "media da unidade",
  period: "media do periodo",
  default: "limite padrao"
};

const METRIC_TEXT: Record<MonitorMetric, string> = {
  tons: "Toneladas",
  revenue: "Faturamento"
};

function slotColor(slot: number | null): string {
  return slot === null ? "var(--mon-other)" : `var(--mon-cat-${slot + 1})`;
}

export function MonitorView(props: MonitorViewProps) {
  const {
    filters,
    onFiltersChange,
    operations,
    yard,
    paymentMethods,
    timeZone,
    now,
    status,
    units,
    defaultUnitId
  } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Painel de parede (notebook, TV, tablet deitado): tudo cabe no `100dvh` e cada lista mostra o
  // que cabe no proprio painel. Fora dele (celular), a pagina rola uma vez e as listas sao curtas.
  const fit = useMediaQuery(MONITOR_FIT_QUERY);

  const periodWindow = useMemo(
    () => resolvePeriodWindow(filters.period, now, timeZone),
    [filters.period, now, timeZone]
  );
  const slices = useMemo(
    () => sliceSales(operations, periodWindow, now, filters),
    [operations, periodWindow, now, filters]
  );
  const thresholds = useMemo(
    () => yardThresholds(props.unitAvgYardMinutes, averageYardMinutes(slices.current)),
    [props.unitAvgYardMinutes, slices.current]
  );
  const yardTickets = useMemo(
    () => buildYard(yard, filters, now, thresholds),
    [yard, filters, now, thresholds]
  );
  const kpis = useMemo(() => computeKpis(slices, yardTickets), [slices, yardTickets]);
  const series = useMemo(
    () => salesSeries(slices, periodWindow, now, timeZone),
    [slices, periodWindow, now, timeZone]
  );
  const payments = useMemo(
    () => paymentBreakdown(slices.current, paymentMethods, filters.metric),
    [slices.current, paymentMethods, filters.metric]
  );
  const paymentNames = useMemo(
    () => new Map(paymentMethods.map((method) => [method.id, method.name])),
    [paymentMethods]
  );
  const chips = activeFilterChips(filters, {
    defaultUnitId,
    unitName: (id) => units.find((unit) => unit.id === id)?.name ?? null,
    paymentName: (key) => paymentNames.get(key) ?? null
  });
  const topChips = splitVisible(chips, TOP_CHIPS);
  const filterCount = countActiveFilters(filters, defaultUnitId);
  const widgets = filters.widgets;
  const showRanks = widgets.products || widgets.customers;
  const showCharts = widgets.hourly || showRanks || widgets.payments;
  const clearFilters = () => onFiltersChange(clearDimensionFilters(filters));
  const setMetric = (metric: MonitorMetric) => onFiltersChange({ ...filters, metric });

  // Tres zonas na tela larga (vendas | graficos | patio); as que estao desligadas saem da grade.
  const zones = [
    widgets.feed ? "minmax(0, 1fr)" : null,
    showCharts ? "minmax(0, 2fr)" : null,
    widgets.yard ? "minmax(0, 1fr)" : null
  ].filter(Boolean);
  const boardClass = [
    "mon-board",
    widgets.feed ? "" : "no-feed",
    widgets.yard ? "" : "no-yard",
    showCharts ? "" : "no-charts",
    widgets.feed !== widgets.yard ? "is-single-ticket" : "",
    widgets.products !== widgets.customers ? "is-single-rank" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`mon${fit ? " is-fit" : ""}`}>
      <header className="mon-top">
        <img src="./logo.png" alt="" className="mon-logo" />
        <div className="mon-title">
          <h1>Monitoramento</h1>
          <span>{props.unitName || "Unidade"}</span>
        </div>
        {/* Periodo, variacao e filtros ligados moram no topo: nenhuma linha a mais no corpo. */}
        <div className="mon-filterbar">
          <button
            type="button"
            className="mon-chip mon-chip-period"
            onClick={() => setDrawerOpen(true)}
            title="Trocar o periodo"
          >
            <CalendarDays size={14} aria-hidden="true" />
            {periodWindow.label}
          </button>
          {widgets.kpis && (
            <span className="mon-top-caption" title={`Variacao ${periodWindow.deltaLabel}`}>
              Variacao {periodWindow.deltaLabel}
            </span>
          )}
          {topChips.visible.map((chip) => (
            <span key={chip.id} className="mon-chip" title={chip.label}>
              <span className="mon-chip-text">{chip.label}</span>
              <button
                type="button"
                className="mon-chip-remove"
                onClick={() => onFiltersChange(removeFilterChip(filters, chip))}
                aria-label={`Remover filtro ${chip.label}`}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          {topChips.hidden > 0 && (
            <button
              type="button"
              className="mon-chip mon-chip-more"
              onClick={() => setDrawerOpen(true)}
              title={chips
                .slice(TOP_CHIPS)
                .map((chip) => chip.label)
                .join(", ")}
              aria-label={`Mais ${topChips.hidden} filtros: abrir filtros`}
            >
              +{topChips.hidden}
            </button>
          )}
          {chips.length > 1 && (
            <button type="button" className="mon-chip-clear" onClick={clearFilters}>
              Limpar
            </button>
          )}
          <Segmented
            className="mon-filterbar-metric"
            label="Medida dos graficos"
            value={filters.metric}
            options={[
              { value: "tons", label: "Toneladas" },
              { value: "revenue", label: "Faturamento" }
            ]}
            onChange={setMetric}
          />
        </div>
        <LiveIndicator status={status} now={now} />
        <div className="mon-top-actions">
          <button
            type="button"
            className="mon-top-btn"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            title="Filtros e paineis"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span className="mon-top-label">Filtros</span>
            {filterCount > 0 && (
              <span className="mon-count" aria-label={`${filterCount} filtros ativos`}>
                {filterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className="mon-top-btn"
            onClick={props.onToggleTheme}
            aria-label="Alternar tema"
            title={props.theme === "light" ? "Tema escuro" : "Tema claro"}
          >
            {props.theme === "light" ? (
              <Moon size={18} aria-hidden="true" />
            ) : (
              <Sun size={18} aria-hidden="true" />
            )}
          </button>
          {props.onLogout ? (
            <button
              type="button"
              className="mon-top-btn"
              onClick={props.onLogout}
              aria-label="Sair da conta"
              title="Sair da conta"
            >
              <LogOut size={18} aria-hidden="true" />
              <span className="mon-top-label">Sair</span>
            </button>
          ) : (
            <Link
              to="/"
              className="mon-top-btn"
              title="Voltar ao sistema"
              aria-label="Voltar ao sistema"
            >
              <ArrowLeft size={18} aria-hidden="true" />
              <span className="mon-top-label mon-top-label-long">Voltar ao sistema</span>
            </Link>
          )}
        </div>
      </header>

      <main className="mon-main">
        {status.error && (
          <div className="mon-alert" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <span>
              {status.error}
              {status.lastSuccessAt !== null && (
                <> Mostrando os dados de {formatClockMs(status.lastSuccessAt, timeZone)}.</>
              )}
            </span>
            <button type="button" className="mon-alert-btn" onClick={props.onRetry}>
              <RefreshCw size={14} aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        )}

        {status.loading ? (
          <MonitorSkeleton />
        ) : (
          <div
            className={`mon-content${status.switching ? " is-switching" : ""}`}
            aria-busy={status.switching || undefined}
          >
            {widgets.kpis && <KpiRow kpis={kpis} period={periodWindow} />}
            {(widgets.feed || showCharts || widgets.yard) && (
              <div
                className={boardClass}
                style={{ "--mon-zones": zones.join(" ") } as CSSProperties}
              >
                {widgets.feed && (
                  <FeedPanel
                    fit={fit}
                    sales={slices.current}
                    period={periodWindow}
                    timeZone={timeZone}
                    paymentNames={paymentNames}
                    freshIds={props.freshIds}
                    hasFilters={filterCount > 0}
                    onClearFilters={clearFilters}
                  />
                )}
                {showCharts && (
                  <div className="mon-col-charts">
                    {widgets.hourly && (
                      <SalesChart
                        fit={fit}
                        series={series}
                        metric={filters.metric}
                        period={periodWindow}
                      />
                    )}
                    {showRanks && (
                      <div className="mon-rank-pair">
                        {widgets.products && (
                          <RankPanel
                            fit={fit}
                            className="mon-w-products"
                            title="Por produto"
                            operations={slices.current}
                            keyOf={productKeyOf}
                            labelOf={productLabelOf}
                            metric={filters.metric}
                            emptyText="Nenhum produto vendido no periodo."
                          />
                        )}
                        {widgets.customers && (
                          <RankPanel
                            fit={fit}
                            className="mon-w-customers"
                            title="Top clientes"
                            operations={slices.current}
                            keyOf={customerKeyOf}
                            labelOf={customerLabelOf}
                            metric={filters.metric}
                            numbered
                            emptyText="Nenhum cliente comprou no periodo."
                          />
                        )}
                      </div>
                    )}
                    {widgets.payments && (
                      <PaymentsPanel segments={payments} metric={filters.metric} />
                    )}
                  </div>
                )}
                {widgets.yard && (
                  <YardPanel
                    fit={fit}
                    tickets={yardTickets}
                    thresholds={thresholds}
                    timeZone={timeZone}
                    freshIds={props.freshIds}
                  />
                )}
              </div>
            )}
            {!widgets.kpis && !widgets.feed && !showCharts && !widgets.yard && (
              <div className="mon-card mon-empty">
                <Inbox size={28} aria-hidden="true" />
                <strong>Nenhum painel ligado</strong>
                <span>Abra os filtros e escolha o que aparece nesta tela.</span>
                <button type="button" className="mon-btn" onClick={() => setDrawerOpen(true)}>
                  Escolher paineis
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {drawerOpen && (
        <FiltersDrawer
          filters={filters}
          onChange={onFiltersChange}
          onClose={() => setDrawerOpen(false)}
          units={units}
          unitId={props.unitId}
          defaultUnitId={defaultUnitId}
          productChoices={productOptions([...operations, ...yard], filters.products)}
          paymentChoices={paymentOptions(
            [...operations, ...yard],
            paymentMethods,
            filters.payments
          )}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medidas (painel que nao cresce)
// ---------------------------------------------------------------------------

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Largura e altura do elemento, acompanhando o redimensionamento. Ref de callback: o grafico sai
 * e volta (tabela <-> grafico) e o observador precisa seguir o elemento NOVO.
 */
function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref: setElement, ...size };
}

interface FitBox {
  /** Altura livre da area da lista (a caixa `.mon-fit`, que nao cresce com o conteudo). */
  available: number;
  /** Altura de um item (o primeiro da lista: os cartoes tem altura fixa, uma linha por campo). */
  item: number;
  /** Espaco entre os itens (`row-gap` da lista). */
  gap: number;
}

/**
 * Mede a area de uma lista do painel de parede: a caixa (`ref`) tem altura dada pela grade, a
 * lista e o primeiro filho dela e o item medido e o primeiro da lista. So devolve medida no modo
 * `fit`; fora dele a lista e curta e a pagina rola.
 */
function useFitBox(fit: boolean) {
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState<FitBox>({ available: 0, item: 0, gap: 0 });
  const measure = useCallback(() => {
    if (!box) return;
    const list = box.firstElementChild as HTMLElement | null;
    const first = list?.firstElementChild as HTMLElement | null | undefined;
    const available = box.clientHeight;
    const item = first ? first.getBoundingClientRect().height : 0;
    const gap = list ? Number.parseFloat(getComputedStyle(list).rowGap) || 0 : 0;
    setMetrics((prev) =>
      Math.abs(prev.available - available) < 0.5 &&
      Math.abs(prev.item - item) < 0.5 &&
      Math.abs(prev.gap - gap) < 0.5
        ? prev
        : { available, item, gap }
    );
  }, [box]);
  useEffect(() => {
    if (!box || !fit || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, [box, fit, measure]);
  // O primeiro item pode aparecer (ou mudar de altura) sem a caixa mudar de tamanho.
  useLayoutEffect(() => {
    if (fit) measure();
  });
  return { ref: setBox, metrics: fit ? metrics : null };
}

/** Quantos itens a lista mostra: o que cabe no painel (parede) ou os primeiros (celular). */
function useFitList(fit: boolean, total: number) {
  const { ref, metrics } = useFitBox(fit);
  const count = metrics
    ? fitCount({
        available: metrics.available,
        itemSize: metrics.item,
        gap: metrics.gap,
        total,
        footer: FIT_FOOTER_PX,
        fallback: FIT_FALLBACK_ITEMS
      })
    : Math.min(total, MONITOR_PHONE_ITEMS);
  return { ref, count };
}

function formatClockMs(ms: number, timeZone: string): string {
  if (!Number.isFinite(ms)) return "--:--";
  return formatClock(new Date(ms).toISOString(), timeZone);
}

/** "25/09" no fuso da unidade. */
function formatDayMs(ms: number, timeZone: string): string {
  if (!Number.isFinite(ms)) return "";
  const day = zonedDayKey(ms, timeZone);
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

// ---------------------------------------------------------------------------
// Topo
// ---------------------------------------------------------------------------

function LiveIndicator({ status, now }: { status: MonitorViewStatus; now: number }) {
  const state = liveState({ lastSuccessAt: status.lastSuccessAt, now, online: status.online });
  const text =
    state === "offline"
      ? "Sem internet"
      : state === "connecting"
        ? "Conectando"
        : state === "stale"
          ? "Desatualizado"
          : "Ao vivo";
  const detail =
    status.lastSuccessAt === null
      ? "aguardando dados"
      : `atualizado ${formatAgo(now - status.lastSuccessAt)}`;
  const title =
    status.realtime === "live"
      ? "Recebendo avisos da balanca em tempo real"
      : "Aviso em tempo real indisponivel: a tela confere a cada 30 s";
  const Icon = state === "offline" ? WifiOff : state === "stale" ? TriangleAlert : null;
  return (
    <div className={`mon-live is-${state}`} title={`${text}, ${detail}. ${title}`}>
      {Icon ? (
        <Icon size={14} aria-hidden="true" />
      ) : (
        <span className="mon-live-dot" aria-hidden="true" />
      )}
      <strong aria-live="polite">{text}</strong>
      <span className="mon-live-detail">{detail}</span>
      {status.refreshing && <RefreshCw size={12} className="mon-spin" aria-hidden="true" />}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`mon-segmented ${className ?? ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

function Delta({
  value,
  higherIsBetter = true,
  context
}: {
  value: number | null;
  higherIsBetter?: boolean;
  context: string;
}) {
  const tone = deltaTone(value, higherIsBetter);
  if (tone === "none" || value === null) {
    return (
      <span className="mon-delta is-none" title={`Sem base de comparacao (${context})`}>
        sem base
      </span>
    );
  }
  const Icon = tone === "flat" ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const text = formatDelta(value);
  return (
    <span className={`mon-delta is-${tone}`} title={`${text} ${context}`}>
      <Icon size={14} aria-hidden="true" />
      {text}
    </span>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  delta,
  foot,
  hero,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: ReactNode;
  foot?: ReactNode;
  hero?: boolean;
  tone?: "warning" | "danger";
}) {
  return (
    <div className={`mon-kpi${hero ? " is-hero" : ""}${tone ? ` is-${tone}` : ""}`}>
      <div className="mon-kpi-label">
        <Icon size={15} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mon-kpi-value" title={value}>
        {value}
      </div>
      <div className="mon-kpi-foot">
        {delta}
        {foot && (
          <span className="mon-kpi-note" title={typeof foot === "string" ? foot : undefined}>
            {foot}
          </span>
        )}
      </div>
    </div>
  );
}

function KpiRow({ kpis, period }: { kpis: MonitorKpis; period: PeriodWindow }) {
  const { current, previous, deltas } = kpis;
  const context = period.deltaLabel;
  const ticket = current.loads > 0 ? Math.round(current.totalCents / current.loads) : 0;
  const yardTone = kpis.yardLate > 0 ? "danger" : kpis.yardAttention > 0 ? "warning" : undefined;
  return (
    <section className="mon-kpis" aria-label={`Indicadores do periodo (variacao ${context})`}>
      <div className="mon-kpi-grid">
        <KpiTile
          hero
          icon={Weight}
          label="Toneladas vendidas"
          value={formatTonnes(current.kg)}
          delta={<Delta value={deltas.kg} context={context} />}
          foot={`${period.compareLabel}: ${formatTonnes(previous.kg)}`}
        />
        <KpiTile
          hero
          icon={Banknote}
          label="Faturamento"
          value={formatMoneyWhole(current.totalCents)}
          delta={<Delta value={deltas.totalCents} context={context} />}
          foot={
            kpis.freightShare === null
              ? "Material + frete"
              : `Frete ${formatShare(kpis.freightShare)} · ${formatMoneyShort(current.freightCents)}`
          }
        />
        <KpiTile
          icon={Truck}
          label="Cargas"
          value={current.loads.toLocaleString("pt-BR")}
          delta={<Delta value={deltas.loads} context={context} />}
          foot={current.loads > 0 ? `Ticket ${formatMoneyShort(ticket)}` : undefined}
        />
        <KpiTile
          icon={Scale}
          label="Preco medio / t"
          value={current.pricePerTonCents === null ? "--" : formatMoney(current.pricePerTonCents)}
          delta={<Delta value={deltas.pricePerTon} context={context} />}
          foot="So material"
        />
        <KpiTile
          icon={Hourglass}
          label="No patio agora"
          value={kpis.yardNow.toLocaleString("pt-BR")}
          tone={yardTone}
          foot={
            kpis.yardLate > 0 ? (
              <span className="mon-kpi-alert is-danger">
                <TriangleAlert size={13} aria-hidden="true" />
                {kpis.yardLate} atrasado{kpis.yardLate > 1 ? "s" : ""}
              </span>
            ) : kpis.yardAttention > 0 ? (
              <span className="mon-kpi-alert is-warning">
                <Clock size={13} aria-hidden="true" />
                {kpis.yardAttention} em atencao
              </span>
            ) : kpis.yardNow > 0 ? (
              "Todos no tempo"
            ) : (
              "Patio vazio"
            )
          }
        />
        <KpiTile
          icon={Timer}
          label="Media no patio"
          value={formatDuration(current.avgYardMinutes)}
          delta={<Delta value={deltas.avgYardMinutes} higherIsBetter={false} context={context} />}
          foot="Quem saiu no periodo"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cartoes (KDS)
// ---------------------------------------------------------------------------

function PanelHead({
  id,
  title,
  count,
  sub,
  below,
  children
}: {
  id: string;
  title: string;
  count?: number;
  sub?: ReactNode;
  /** Linha inteira embaixo do titulo (legenda). */
  below?: ReactNode;
  /** Acoes a direita. */
  children?: ReactNode;
}) {
  return (
    <header className="mon-card-head">
      <div className="mon-card-title">
        <h2 id={id}>{title}</h2>
        {count !== undefined && <span className="mon-card-count">{count}</span>}
      </div>
      {sub && <span className="mon-card-sub">{sub}</span>}
      {children && <div className="mon-card-actions">{children}</div>}
      {below && <div className="mon-card-below">{below}</div>}
    </header>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="mon-empty">
      <Inbox size={26} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{text}</span>
      {action}
    </div>
  );
}

/** Rodape "+N" de uma lista que mostra so o que cabe (texto, nao botao: nada a rolar). */
function MoreFooter({ hidden, text }: { hidden: number; text: string }) {
  if (hidden <= 0) return null;
  return (
    <p className="mon-fit-more">
      <b>+{hidden.toLocaleString("pt-BR")}</b> {text}
    </p>
  );
}

function FeedPanel({
  fit,
  sales,
  period,
  timeZone,
  paymentNames,
  freshIds,
  hasFilters,
  onClearFilters
}: {
  fit: boolean;
  sales: MonitorOperation[];
  period: PeriodWindow;
  timeZone: string;
  paymentNames: ReadonlyMap<string, string>;
  freshIds: ReadonlySet<string>;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const headingId = useId();
  const { ref, count } = useFitList(fit, sales.length);
  const { visible, hidden } = splitVisible(sales, count);
  const multiDay = period.granularity === "day";
  return (
    <section className="mon-card mon-w-feed" aria-labelledby={headingId}>
      <PanelHead
        id={headingId}
        title="Ultimas vendas"
        count={sales.length}
        sub="Mais nova primeiro"
      />
      {sales.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Nenhuma venda com estes filtros" : "Nenhuma venda no periodo"}
          text={
            hasFilters
              ? "Tire um filtro para ver mais vendas."
              : "Cada pesagem fechada na balanca aparece aqui na hora."
          }
          action={
            hasFilters ? (
              <button type="button" className="mon-btn" onClick={onClearFilters}>
                Limpar filtros
              </button>
            ) : undefined
          }
        />
      ) : (
        <div ref={ref} className="mon-fit">
          <ol className="mon-list">
            {visible.map((op) => {
              const at = saleAt(op) ?? Number.NaN;
              const fresh = freshIds.has(op.id);
              const payment = op.payment_method_id
                ? (paymentNames.get(op.payment_method_id) ?? "Forma removida")
                : NO_PAYMENT_LABEL;
              return (
                <li key={op.id} className={`mon-ticket mon-sale${fresh ? " is-fresh" : ""}`}>
                  <div className="mon-ticket-top">
                    <span className="mon-ticket-time">{formatClockMs(at, timeZone)}</span>
                    {multiDay && (
                      <span className="mon-ticket-date">{formatDayMs(at, timeZone)}</span>
                    )}
                    <span className="mon-plate">{formatPlate(op.plate) || "SEM PLACA"}</span>
                    <span className="mon-ticket-money">{formatMoney(op.total_cents)}</span>
                  </div>
                  {/* "Nova" na linha do cliente: na de cima ela disputaria lugar com o valor. */}
                  <div className="mon-ticket-mid">
                    <strong className="mon-ticket-customer" title={customerLabelOf(op)}>
                      {customerLabelOf(op)}
                    </strong>
                    {fresh && <span className="mon-new">Nova</span>}
                  </div>
                  <div className="mon-ticket-bottom">
                    <span className="mon-ticket-tons">{formatTonnes(op.net_weight_kg)}</span>
                    <span className="mon-ticket-product" title={productLabelOf(op)}>
                      {productLabelOf(op)}
                    </span>
                    <span className="mon-ticket-pay" title={payment}>
                      {payment}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <MoreFooter
            hidden={hidden}
            text={hidden === 1 ? "venda mais antiga" : "vendas mais antigas"}
          />
        </div>
      )}
    </section>
  );
}

const LEVEL_ICON: Record<YardLevel, LucideIcon> = {
  normal: Clock,
  attention: Hourglass,
  late: TriangleAlert
};

function YardPanel({
  fit,
  tickets,
  thresholds,
  timeZone,
  freshIds
}: {
  fit: boolean;
  tickets: YardTicket[];
  thresholds: YardThresholds;
  timeZone: string;
  freshIds: ReadonlySet<string>;
}) {
  const headingId = useId();
  const { ref, count } = useFitList(fit, tickets.length);
  // O mais antigo vem primeiro: quem fica de fora e quem chegou por ultimo (o atrasado aparece).
  const { visible, hidden } = splitVisible(tickets, count);
  return (
    <section className="mon-card mon-w-yard" aria-labelledby={headingId}>
      <PanelHead
        id={headingId}
        title="No patio agora"
        count={tickets.length}
        sub="Mais antigo primeiro"
        below={
          <ul
            className="mon-legend mon-levels"
            aria-label={`Limites do patio (${BASIS_TEXT[thresholds.basis]})`}
            title={`Limites pela ${BASIS_TEXT[thresholds.basis]}`}
          >
            <li className="is-normal">
              <Clock size={13} aria-hidden="true" />
              No tempo
            </li>
            <li className="is-attention">
              <Hourglass size={13} aria-hidden="true" />
              Atencao +{thresholds.attention} min
            </li>
            <li className="is-late">
              <TriangleAlert size={13} aria-hidden="true" />
              Atrasado +{thresholds.late} min
            </li>
          </ul>
        }
      />
      {tickets.length === 0 ? (
        <EmptyState title="Patio vazio" text="Nenhum caminhao aguardando carga agora." />
      ) : (
        <div ref={ref} className="mon-fit">
          <ol className="mon-list">
            {visible.map((ticket) => {
              const op = ticket.operation;
              const LevelIcon = LEVEL_ICON[ticket.level];
              return (
                <li
                  key={op.id}
                  className={`mon-ticket mon-yard is-${ticket.level}${freshIds.has(op.id) ? " is-fresh" : ""}`}
                >
                  <div className="mon-ticket-top">
                    <span className="mon-plate">{formatPlate(op.plate) || "SEM PLACA"}</span>
                    <span className={`mon-level is-${ticket.level}`}>
                      <LevelIcon size={13} aria-hidden="true" />
                      {LEVEL_TEXT[ticket.level]}
                    </span>
                    <span className="mon-yard-elapsed" title="Tempo desde a entrada">
                      {formatDuration(ticket.minutes)}
                    </span>
                  </div>
                  <div
                    className="mon-meter"
                    role="meter"
                    aria-label="Tempo no patio em relacao ao limite de atraso"
                    aria-valuemin={0}
                    aria-valuemax={thresholds.late}
                    aria-valuenow={Math.round(Math.min(ticket.minutes, thresholds.late))}
                  >
                    <span style={{ width: `${Math.max(3, ticket.progress * 100)}%` }} />
                  </div>
                  <strong className="mon-ticket-customer" title={customerLabelOf(op)}>
                    {customerLabelOf(op)}
                  </strong>
                  <div className="mon-ticket-bottom">
                    <span className="mon-ticket-product" title={productLabelOf(op)}>
                      {productLabelOf(op)}
                      {op.driver_name ? ` · ${op.driver_name}` : ""}
                    </span>
                    <span className="mon-yard-entry">
                      entrou {formatClock(op.created_at, timeZone)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <MoreFooter
            hidden={hidden}
            text={hidden === 1 ? "caminhao que chegou depois" : "caminhoes que chegaram depois"}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Graficos
// ---------------------------------------------------------------------------

/**
 * Linha reta ponto a ponto: hora a hora o movimento e aos saltos, e uma curva suave inventaria
 * vale e pico entre duas horas que nao existiram.
 */
function linePath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join("");
}

/** Coluna com os dois cantos de cima arredondados e a base reta (a base e o eixo). */
function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  if (w <= 0 || h <= 0) return "";
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}A${radius},${radius} 0 0 1 ${x + radius},${y}H${
    x + w - radius
  }A${radius},${radius} 0 0 1 ${x + w},${y + radius}V${y + h}Z`;
}

function SalesChart({
  fit,
  series,
  metric,
  period
}: {
  fit: boolean;
  series: SalesSeries;
  metric: MonitorMetric;
  period: PeriodWindow;
}) {
  const headingId = useId();
  const { ref, width, height: boxHeight } = useElementSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const buckets = series.buckets;
  const hourly = series.granularity === "hour";
  const title = hourly ? "Vendas por hora" : "Vendas por dia";

  const currentValues = buckets.map((bucket) =>
    bucket.current ? metricValue(bucket.current, metric) : null
  );
  const previousValues = buckets.map((bucket) =>
    bucket.previous ? metricValue(bucket.previous, metric) : null
  );
  const max = Math.max(
    0,
    ...currentValues.map((v) => v ?? 0),
    ...previousValues.map((v) => v ?? 0)
  );
  const hasData = max > 0;
  let peak = -1;
  currentValues.forEach((value, index) => {
    if (value !== null && value > 0 && (peak < 0 || value > (currentValues[peak] ?? 0))) {
      peak = index;
    }
  });
  const total = currentValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);

  // Parede: o grafico ocupa a altura que a grade da ao painel. Celular: altura propria, curta.
  const height = fit
    ? Math.max(90, boxHeight)
    : Math.round(Math.min(230, Math.max(160, width * 0.42)));
  const drawable = width > 0 && (!fit || boxHeight > 0);
  const ticks = chartTicks(max, 4);
  const top = ticks[ticks.length - 1] || 1;
  const tickLabels = ticks.map((tick) => formatAxisValue(tick, top, metric));
  const longestTick = Math.max(0, ...tickLabels.map((label) => label.length));
  const margin = { top: 22, right: 8, bottom: 26, left: Math.max(34, longestTick * 6.4 + 14) };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const band = buckets.length > 0 ? plotW / buckets.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const xCenter = (index: number) => margin.left + band * index + band / 2;
  const yOf = (value: number) => margin.top + plotH - (plotH * value) / top;
  const labelIndexes = tickIndexes(buckets.length, plotW / (hourly ? 30 : 40));
  const previousPoints = previousValues
    .map((value, index) => (value === null ? null : { x: xCenter(index), y: yOf(value) }))
    .filter((point): point is { x: number; y: number } => point !== null);
  const activeBucket = active !== null ? buckets[active] : null;

  const summary = hasData
    ? `${title} em ${METRIC_TEXT[metric].toLowerCase()}: total ${formatMetric(total, metric)}${
        peak >= 0
          ? `, pico de ${formatMetric(currentValues[peak] ?? 0, metric)} em ${buckets[peak].label}`
          : ""
      }.`
    : `${title}: sem vendas no periodo.`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (buckets.length === 0) return;
    const last = buckets.length - 1;
    const from = active ?? last;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(last, from + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") next = null;
    else return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <section className="mon-card mon-w-hourly" aria-labelledby={headingId}>
      <PanelHead
        id={headingId}
        title={title}
        sub={METRIC_TEXT[metric]}
        below={
          <ul className="mon-legend" aria-label="Legenda">
            <li>
              <span className="mon-key-rect" aria-hidden="true" />
              {period.seriesLabel}
            </li>
            <li>
              <span className="mon-key-line" aria-hidden="true" />
              {period.compareLabel}
            </li>
          </ul>
        }
      >
        <button
          type="button"
          className="mon-icon-btn"
          onClick={() => setShowTable((value) => !value)}
          aria-pressed={showTable}
          title={showTable ? "Ver como grafico" : "Ver como tabela"}
          aria-label={showTable ? "Ver como grafico" : "Ver como tabela"}
        >
          {showTable ? (
            <ChartColumn size={16} aria-hidden="true" />
          ) : (
            <Table2 size={16} aria-hidden="true" />
          )}
        </button>
      </PanelHead>

      {showTable ? (
        <div className="mon-table-wrap">
          <table className="mon-table">
            <caption className="mon-sr">{summary}</caption>
            <thead>
              <tr>
                <th scope="col">{hourly ? "Hora" : "Dia"}</th>
                <th scope="col">{period.seriesLabel}</th>
                <th scope="col">Cargas</th>
                <th scope="col">{period.compareLabel}</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, index) => (
                <tr key={bucket.key}>
                  <th scope="row">{bucket.label}</th>
                  <td>
                    {currentValues[index] === null
                      ? "--"
                      : formatMetric(currentValues[index] ?? 0, metric)}
                  </td>
                  <td>{bucket.current ? bucket.current.loads : "--"}</td>
                  <td>
                    {previousValues[index] === null
                      ? "--"
                      : formatMetric(previousValues[index] ?? 0, metric)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          className="mon-chart"
          style={fit ? undefined : { height }}
          tabIndex={0}
          role="group"
          aria-label={`${summary} Use as setas para ver cada ${hourly ? "hora" : "dia"}.`}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {drawable && (
            <svg
              width={width}
              height={height}
              aria-hidden="true"
              onPointerLeave={(event) => {
                // No toque o "leave" vem logo depois do toque: a dica fica ate tocar fora.
                if (event.pointerType === "mouse") setActive(null);
              }}
            >
              <g className="mon-grid">
                {ticks.map((tick) => (
                  <line
                    key={tick}
                    x1={margin.left}
                    x2={margin.left + plotW}
                    y1={yOf(tick)}
                    y2={yOf(tick)}
                  />
                ))}
              </g>
              <g className="mon-axis-text">
                {ticks.map((tick, index) => (
                  <text
                    key={tick}
                    x={margin.left - 8}
                    y={yOf(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {tickLabels[index]}
                  </text>
                ))}
              </g>
              {active !== null && (
                <rect
                  className="mon-hover-band"
                  x={margin.left + band * active}
                  y={margin.top}
                  width={band}
                  height={plotH}
                />
              )}
              <g>
                {currentValues.map((value, index) =>
                  value === null || value <= 0 ? null : (
                    <path
                      key={buckets[index].key}
                      className={`mon-bar${active !== null && active !== index ? " is-dim" : ""}`}
                      d={columnPath(
                        xCenter(index) - barW / 2,
                        yOf(value),
                        barW,
                        margin.top + plotH - yOf(value),
                        4
                      )}
                    />
                  )
                )}
              </g>
              <line
                className="mon-baseline"
                x1={margin.left}
                x2={margin.left + plotW}
                y1={margin.top + plotH}
                y2={margin.top + plotH}
              />
              {previousPoints.length > 1 && (
                <path className="mon-compare-line" d={linePath(previousPoints)} />
              )}
              {active !== null && previousValues[active] !== null && (
                <circle
                  className="mon-compare-dot"
                  cx={xCenter(active)}
                  cy={yOf(previousValues[active] ?? 0)}
                  r={4}
                />
              )}
              {peak >= 0 && active === null && (
                <text
                  className="mon-peak"
                  x={xCenter(peak)}
                  y={yOf(currentValues[peak] ?? 0) - 7}
                  textAnchor="middle"
                >
                  {formatMetric(currentValues[peak] ?? 0, metric)}
                </text>
              )}
              <g className="mon-axis-text">
                {labelIndexes.map((index) => (
                  <text
                    key={buckets[index].key}
                    className={buckets[index].isNow ? "is-now" : undefined}
                    x={xCenter(index)}
                    y={margin.top + plotH + 17}
                    textAnchor="middle"
                  >
                    {buckets[index].label}
                  </text>
                ))}
              </g>
              <g>
                {buckets.map((bucket, index) => (
                  <rect
                    key={bucket.key}
                    className="mon-hit"
                    x={margin.left + band * index}
                    y={margin.top}
                    width={band}
                    height={plotH}
                    onPointerEnter={() => setActive(index)}
                    onPointerDown={() => setActive(index)}
                  />
                ))}
              </g>
            </svg>
          )}
          {!hasData && drawable && (
            <div className="mon-chart-empty">Sem vendas para mostrar no periodo.</div>
          )}
          {activeBucket && drawable && (
            <div
              className="mon-tip"
              aria-live="polite"
              style={{
                left: Math.min(Math.max(xCenter(active ?? 0), 96), Math.max(96, width - 96))
              }}
            >
              <strong className="mon-tip-title">{activeBucket.title}</strong>
              <div className="mon-tip-row">
                <span className="mon-key-rect" aria-hidden="true" />
                <b>
                  {activeBucket.current
                    ? formatMetric(metricValue(activeBucket.current, metric), metric)
                    : "--"}
                </b>
                <span>
                  {period.seriesLabel}
                  {activeBucket.current
                    ? ` · ${activeBucket.current.loads} carga${activeBucket.current.loads === 1 ? "" : "s"}`
                    : " · ainda nao chegou"}
                </span>
              </div>
              <div className="mon-tip-row">
                <span className="mon-key-line" aria-hidden="true" />
                <b>
                  {activeBucket.previous
                    ? formatMetric(metricValue(activeBucket.previous, metric), metric)
                    : "--"}
                </b>
                <span>
                  {period.compareLabel}
                  {activeBucket.previousTitle ? ` (${activeBucket.previousTitle})` : ""}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RankPanel({
  fit,
  className,
  title,
  operations,
  keyOf,
  labelOf,
  metric,
  numbered,
  emptyText
}: {
  fit: boolean;
  className: string;
  title: string;
  operations: MonitorOperation[];
  keyOf: (op: MonitorOperation) => string;
  labelOf: (op: MonitorOperation) => string;
  metric: MonitorMetric;
  numbered?: boolean;
  emptyText: string;
}) {
  const headingId = useId();
  const { ref, metrics } = useFitBox(fit);
  // Tantas linhas quantas couberem, contando o "Outros" (a cauda somada) como uma delas.
  const capacity = metrics
    ? metrics.item > 0
      ? Math.max(1, fitCapacity(metrics.available, metrics.item, metrics.gap))
      : FIT_FALLBACK_ITEMS
    : MONITOR_PHONE_ITEMS;
  const limit = rankLimitFor(capacity);
  const rows = useMemo(
    () => rankBy(operations, keyOf, labelOf, metric, limit),
    [operations, keyOf, labelOf, metric, limit]
  );
  const max = Math.max(0, ...rows.map((row) => metricValue(row, metric)));
  const other: MonitorMetric = metric === "tons" ? "revenue" : "tons";
  return (
    <section className={`mon-card ${className}`} aria-labelledby={headingId}>
      <PanelHead id={headingId} title={title} sub={`por ${METRIC_TEXT[metric].toLowerCase()}`} />
      {rows.length === 0 ? (
        <EmptyState title="Sem vendas" text={emptyText} />
      ) : (
        <div ref={ref} className="mon-fit">
          <ol className="mon-bars">
            {rows.map((row, index) => {
              const value = metricValue(row, metric);
              const width = max > 0 ? (value / max) * 100 : 0;
              return (
                <li key={row.key} className={row.other ? "is-other" : undefined}>
                  <div className="mon-bar-line">
                    {numbered && (
                      <span className="mon-bar-rank" aria-hidden="true">
                        {row.other ? "+" : index + 1}
                      </span>
                    )}
                    <span className="mon-bar-label" title={row.label}>
                      {row.label}
                    </span>
                    <span className="mon-bar-value">{formatMetric(value, metric)}</span>
                    <span className="mon-bar-share">{formatShare(row.share)}</span>
                  </div>
                  <div className="mon-bar-sub">
                    <div className="mon-bar-track" aria-hidden="true">
                      <span style={{ width: `${width > 0 ? Math.max(1.5, width) : 0}%` }} />
                    </div>
                    <span className="mon-bar-meta">
                      {formatMetric(metricValue(row, other), other)} · {row.loads} carga
                      {row.loads === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function PaymentsPanel({
  segments,
  metric
}: {
  segments: PaymentSegment[];
  metric: MonitorMetric;
}) {
  const headingId = useId();
  const [active, setActive] = useState<string | null>(null);
  const withValue = segments.filter((segment) => metricValue(segment, metric) > 0);
  return (
    <section className="mon-card mon-w-payments" aria-labelledby={headingId}>
      <PanelHead
        id={headingId}
        title="Formas de pagamento"
        sub={`por ${METRIC_TEXT[metric].toLowerCase()}`}
      />
      {segments.length === 0 ? (
        <p className="mon-pay-empty">Nenhuma venda no periodo.</p>
      ) : (
        <>
          <div className="mon-stack" aria-hidden="true" onPointerLeave={() => setActive(null)}>
            {withValue.map((segment) => (
              <span
                key={segment.key}
                className={active !== null && active !== segment.key ? "is-dim" : undefined}
                style={{ flexGrow: segment.share, background: slotColor(segment.slot) }}
                title={`${segment.label}: ${formatShare(segment.share)}`}
                onPointerEnter={() => setActive(segment.key)}
              />
            ))}
          </div>
          <ul className="mon-pay-legend">
            {segments.map((segment) => (
              <li
                key={segment.key}
                className={active === segment.key ? "is-active" : undefined}
                onPointerEnter={() => setActive(segment.key)}
                onPointerLeave={() => setActive(null)}
              >
                <span
                  className="mon-swatch"
                  style={{ background: slotColor(segment.slot) }}
                  aria-hidden="true"
                />
                <span className="mon-pay-name" title={segment.label}>
                  {segment.label}
                </span>
                <span className="mon-pay-share">{formatShare(segment.share)}</span>
                <span className="mon-pay-meta">
                  {formatMetric(metricValue(segment, metric), metric)} · {segment.loads} carga
                  {segment.loads === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

function FiltersDrawer({
  filters,
  onChange,
  onClose,
  units,
  unitId,
  defaultUnitId,
  productChoices,
  paymentChoices
}: {
  filters: MonitorFilters;
  onChange: (next: MonitorFilters) => void;
  onClose: () => void;
  units: MonitorUnit[];
  unitId: string;
  defaultUnitId: string;
  productChoices: Array<{ key: string; label: string }>;
  paymentChoices: Array<{ key: string; label: string }>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // O foco nao sai da gaveta com Tab (ela e modal).
      const panel = panelRef.current;
      if (event.key !== "Tab" || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          "button, input, select, [tabindex]:not([tabindex='-1'])"
        )
      ].filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  const set = (patch: Partial<MonitorFilters>) => onChange({ ...filters, ...patch });

  return (
    <div
      className="mon-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="mon-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="mon-drawer-head">
          <h2 id={titleId}>Personalizar o monitor</h2>
          <button type="button" className="mon-icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="mon-drawer-body">
          <fieldset className="mon-fieldset">
            <legend>Periodo</legend>
            <div className="mon-options">
              {MONITOR_PERIODS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="mon-option"
                  aria-pressed={filters.period === option.id}
                  onClick={() => set({ period: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          {units.length > 1 && (
            <label className="mon-fieldset">
              <span className="mon-legend-text">Unidade</span>
              <select
                className="mon-select"
                value={unitId}
                onChange={(event) =>
                  set({ unitId: event.target.value === defaultUnitId ? null : event.target.value })
                }
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                    {unit.id === defaultUnitId ? " (sua unidade)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <fieldset className="mon-fieldset">
            <legend>Produtos</legend>
            {productChoices.length === 0 ? (
              <p className="mon-hint">Os produtos aparecem aqui quando houver venda no periodo.</p>
            ) : (
              <div className="mon-options">
                {productChoices.map((product) => (
                  <button
                    key={product.key}
                    type="button"
                    className="mon-option"
                    aria-pressed={filters.products.some((item) => item.key === product.key)}
                    onClick={() =>
                      set({
                        products: toggleValue(filters.products, product, (a, b) => a.key === b.key)
                      })
                    }
                  >
                    {product.label}
                  </button>
                ))}
              </div>
            )}
            <p className="mon-hint">Nenhum marcado = todos os produtos.</p>
          </fieldset>

          <label className="mon-fieldset">
            <span className="mon-legend-text">Cliente</span>
            <span className="mon-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={filters.customer}
                placeholder="Parte do nome do cliente"
                onChange={(event) => set({ customer: event.target.value.slice(0, 120) })}
              />
            </span>
          </label>

          <fieldset className="mon-fieldset">
            <legend>Formas de pagamento</legend>
            {paymentChoices.length === 0 ? (
              <p className="mon-hint">As formas aparecem aqui quando houver venda no periodo.</p>
            ) : (
              <div className="mon-options">
                {paymentChoices.map((payment) => (
                  <button
                    key={payment.key}
                    type="button"
                    className="mon-option"
                    aria-pressed={filters.payments.includes(payment.key)}
                    onClick={() =>
                      set({
                        payments: toggleValue(filters.payments, payment.key, (a, b) => a === b)
                      })
                    }
                  >
                    {payment.label}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="mon-fieldset">
            <legend>Medida dos graficos</legend>
            <Segmented
              label="Medida dos graficos"
              value={filters.metric}
              options={[
                { value: "tons", label: "Toneladas" },
                { value: "revenue", label: "Faturamento" }
              ]}
              onChange={(metric) => set({ metric })}
            />
          </fieldset>

          <fieldset className="mon-fieldset">
            <legend>O que aparece na tela</legend>
            <div className="mon-switches">
              {MONITOR_WIDGETS.map((widget) => (
                <label key={widget} className="mon-switch">
                  <input
                    type="checkbox"
                    checked={filters.widgets[widget]}
                    onChange={(event) =>
                      set({ widgets: { ...filters.widgets, [widget]: event.target.checked } })
                    }
                  />
                  <span className="mon-switch-track" aria-hidden="true" />
                  <span>{MONITOR_WIDGET_LABELS[widget]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <footer className="mon-drawer-foot">
          <button
            type="button"
            className="mon-btn"
            onClick={() => onChange(clearDimensionFilters(filters))}
          >
            Limpar filtros
          </button>
          <button type="button" className="mon-btn is-primary" onClick={onClose}>
            Pronto
          </button>
        </footer>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Esqueleto da primeira carga
// ---------------------------------------------------------------------------

function MonitorSkeleton() {
  return (
    <div className="mon-content" aria-busy="true" aria-label="Carregando vendas">
      <div className="mon-kpi-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={`mon-kpi mon-skeleton${index < 2 ? " is-hero" : ""}`}>
            <span className="mon-sk-line is-short" />
            <span className="mon-sk-line is-big" />
            <span className="mon-sk-line" />
          </div>
        ))}
      </div>
      <div
        className="mon-board"
        style={{ "--mon-zones": "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)" } as CSSProperties}
      >
        {["mon-w-feed", "mon-w-hourly mon-sk-charts", "mon-w-yard"].map((name) => (
          <div key={name} className={`mon-card mon-skeleton ${name}`}>
            <span className="mon-sk-line is-short" />
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} className="mon-sk-block" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
