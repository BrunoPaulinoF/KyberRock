import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type {
  DailySeriesPoint,
  OperationMix,
  ProductReport
} from "../services/reports";
import type { WeighingOperationSummary } from "../services/weighing-operations";
import { HelpTooltip } from "./Tooltip";
import { TIPS } from "./tooltip-messages";

type Period = "today" | "7d" | "30d" | "month" | "lastMonth";

interface DateRange {
  start: string;
  end: string;
  label: string;
}

interface InsightsProps {
  desktopApi: KyberRockDesktopApi | null;
  openOperations: WeighingOperationSummary[];
  cloudConnected: boolean;
  cloudSyncing: boolean;
  omieStatus: {
    configured: boolean;
    pendingPushCustomers: number;
    pendingOmieJobs: number;
    lastSyncAt: string | null;
  } | null;
  onSyncOmie: () => void | Promise<void>;
  onSyncCloud: () => void | Promise<void>;
}

const CHART_PALETTE = [
  "var(--kr-chart-1)",
  "var(--kr-chart-2)",
  "var(--kr-chart-3)",
  "var(--kr-chart-4)",
  "var(--kr-chart-5)",
  "var(--kr-chart-6)",
  "var(--kr-chart-7)"
] as const;

const CHART_AXIS = "var(--kr-chart-axis)";
const CHART_GRID = "var(--kr-chart-grid)";

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveRange(period: Period, now: Date): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "today") {
    return { start: toIsoDate(today), end: toIsoDate(today), label: "Hoje" };
  }
  if (period === "7d") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ultimos 7 dias" };
  }
  if (period === "30d") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ultimos 30 dias" };
  }
  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Mes atual" };
  }
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return {
    start: toIsoDate(lastMonthStart),
    end: toIsoDate(lastMonthEnd),
    label: "Mes anterior"
  };
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cents / 100);
}

function formatTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

function formatKg(kg: number): string {
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export function InsightsView({
  desktopApi,
  openOperations,
  cloudConnected,
  cloudSyncing,
  omieStatus,
  onSyncOmie,
  onSyncCloud
}: InsightsProps) {
  const [period, setPeriod] = useState<Period>("7d");
  const [series, setSeries] = useState<DailySeriesPoint[]>([]);
  const [topProducts, setTopProducts] = useState<ProductReport[]>([]);
  const [mix, setMix] = useState<OperationMix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const range = useMemo(() => resolveRange(period, new Date()), [period]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!desktopApi) return;
      setLoading(true);
      setError(null);
      try {
        const [seriesData, productsData, mixData] = await Promise.all([
          desktopApi.getDailySeries(range.start, range.end),
          desktopApi.getReportByProduct(range.start, range.end, 5),
          desktopApi.getOperationMix(range.start, range.end)
        ]);
        if (cancelled) return;
        setSeries(seriesData);
        setTopProducts(productsData);
        setMix(mixData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar insights");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [desktopApi, range.start, range.end]);

  async function exportReport(kind: "pdf" | "excel"): Promise<void> {
    if (!desktopApi) return;
    setExporting(kind);
    setExportMessage(null);
    try {
      const result =
        kind === "pdf"
          ? await desktopApi.exportReportPdf(range.start, range.end)
          : await desktopApi.exportReportExcel(range.start, range.end);
      if (result) {
        setExportMessage(`Arquivo salvo em ${result.path}`);
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao exportar relatorio.");
    } finally {
      setExporting(null);
    }
  }

  const totals = useMemo(() => {
    const operations = series.reduce((sum, point) => sum + point.totalOperations, 0);
    const weightKg = series.reduce((sum, point) => sum + point.totalNetWeightKg, 0);
    const totalCents = series.reduce((sum, point) => sum + point.totalCents, 0);
    const ticketCents = operations > 0 ? Math.round(totalCents / operations) : 0;
    return { operations, weightKg, totalCents, ticketCents };
  }, [series]);

  const mixData = useMemo(() => {
    if (!mix) return [];
    return [
      { name: "Com nota", value: mix.invoice.count, color: CHART_PALETTE[1] },
      { name: "Interna", value: mix.internal.count, color: CHART_PALETTE[2] },
      { name: "Cancelada", value: mix.cancelled.count, color: CHART_PALETTE[3] }
    ].filter((item) => item.value > 0);
  }, [mix]);

  const mixTotal = mixData.reduce((sum, item) => sum + item.value, 0);

  const openCount = openOperations.length;
  const oldestOpen = openOperations.reduce<string | null>((oldest, op) => {
    if (!op.createdAt) return oldest;
    if (!oldest || op.createdAt < oldest) return op.createdAt;
    return oldest;
  }, null);

  const syncBadge = (() => {
    if (!omieStatus) return { label: "OMIE nao configurado", color: "var(--kr-muted)" };
    if (!omieStatus.configured) return { label: "OMIE nao configurado", color: "var(--kr-muted)" };
    if (omieStatus.pendingOmieJobs > 0) {
      return {
        label: `${omieStatus.pendingOmieJobs} pendente(s) OMIE`,
        color: "#f59e0b"
      };
    }
    return { label: "OMIE em dia", color: "var(--kr-chart-5)" };
  })();

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>Insights</h2>
          <p style={styles.subtitle}>
            Acompanhe o andamento da operacao com KPIs, graficos e status de sincronizacao.
          </p>
        </div>
        <div style={styles.periodRow}>
          {(
            [
              { id: "today", label: "Hoje" },
              { id: "7d", label: "7 dias" },
              { id: "30d", label: "30 dias" },
              { id: "month", label: "Mes atual" },
              { id: "lastMonth", label: "Mes anterior" }
            ] as Array<{ id: Period; label: string }>
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPeriod(opt.id)}
              style={period === opt.id ? styles.periodChipActive : styles.periodChip}
            >
              {opt.label}
            </button>
          ))}
          <HelpTooltip content={TIPS.insights.period} placement="bottom" />
          <button
            type="button"
            onClick={() => void exportReport("pdf")}
            disabled={exporting !== null}
            style={styles.periodChip}
          >
            {exporting === "pdf" ? "Gerando PDF..." : "Exportar PDF"}
          </button>
          <HelpTooltip content={TIPS.insights.exportPdf} placement="bottom" />
          <button
            type="button"
            onClick={() => void exportReport("excel")}
            disabled={exporting !== null}
            style={styles.periodChip}
          >
            {exporting === "excel" ? "Gerando Excel..." : "Exportar Excel"}
          </button>
          <HelpTooltip content={TIPS.insights.exportExcel} placement="bottom" />
        </div>
      </header>

      {error ? <p style={styles.errorMessage}>{error}</p> : null}
      {exportMessage ? (
        <p style={styles.exportMessage}>{exportMessage}</p>
      ) : null}

      <div style={styles.kpiGrid}>
        <KpiCard
          label="Operacoes"
          value={loading ? "-" : totals.operations.toLocaleString("pt-BR")}
          hint={range.label}
        />
        <KpiCard
          label="Peso liquido"
          value={loading ? "-" : formatTons(totals.weightKg)}
          hint={formatKg(totals.weightKg)}
        />
        <KpiCard
          label="Faturamento"
          value={loading ? "-" : formatBRL(totals.totalCents)}
          hint="Operacoes fechadas"
        />
        <KpiCard
          label="Ticket medio"
          value={loading ? "-" : formatBRL(totals.ticketCents)}
          hint="Por operacao fechada"
        />
        <KpiCard
          label="Em aberto"
          value={openCount.toLocaleString("pt-BR")}
          hint={oldestOpen ? `Desde ${formatShortDate(oldestOpen)}` : "Nenhuma agora"}
        />
      </div>

      <div style={styles.chartGrid}>
        <article style={styles.chartCard}>
          <header style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>Peso liquido por dia</h3>
            <span style={styles.chartHint}>{range.label}</span>
          </header>
          <div style={styles.chartBody}>
            {series.length === 0 ? (
              <p style={styles.muted}>Sem dados no periodo.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--kr-chart-1)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--kr-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatShortDate}
                    stroke={CHART_AXIS}
                    fontSize={11}
                  />
                  <YAxis
                    tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}t`}
                    stroke={CHART_AXIS}
                    fontSize={11}
                    width={48}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => formatKg(value)}
                    labelFormatter={(label: string) => `Dia ${formatShortDate(label)}`}
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalNetWeightKg"
                    stroke="var(--kr-chart-1)"
                    strokeWidth={2.5}
                    fill="url(#weightFill)"
                    name="Peso liquido"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article style={styles.chartCard}>
          <header style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>Top 5 produtos por peso</h3>
            <span style={styles.chartHint}>{range.label}</span>
          </header>
          <div style={styles.chartBody}>
            {topProducts.length === 0 ? (
              <p style={styles.muted}>Sem produtos vendidos no periodo.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={topProducts.map((p) => ({
                    name: p.productDescription,
                    peso: p.totalWeightKg
                  }))}
                  layout="vertical"
                  margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}t`}
                    stroke={CHART_AXIS}
                    fontSize={11}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke={CHART_AXIS}
                    fontSize={11}
                    width={120}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => formatKg(value)}
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    cursor={{ fill: "var(--kr-card-hover)" }}
                  />
                  <Bar dataKey="peso" radius={[0, 4, 4, 0]}>
                    {topProducts.map((_, index) => (
                      <Cell key={`bar-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article style={styles.chartCard}>
          <header style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>Mix de operacoes</h3>
            <span style={styles.chartHint}>{range.label}</span>
          </header>
          <div style={styles.chartBody}>
            {mixData.length === 0 || mixTotal === 0 ? (
              <p style={styles.muted}>Sem operacoes no periodo.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={mixData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="var(--kr-card-bg)"
                    strokeWidth={2}
                  >
                    {mixData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [
                      `${value} (${((value / mixTotal) * 100).toFixed(1)}%)`,
                      name
                    ]}
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={28}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, color: "var(--kr-muted)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article style={styles.chartCard}>
          <header style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>Status operacional</h3>
            <span style={styles.chartHint}>Agora</span>
          </header>
          <div style={styles.syncBody}>
            <div style={styles.syncRow}>
              <div>
                <p style={styles.syncLabel}>Sincronizacao Cloud (Supabase)</p>
                <p style={styles.syncValue}>
                  {cloudSyncing
                    ? "Sincronizando..."
                    : cloudConnected
                      ? "Conectado"
                      : "Desconectado"}
                </p>
              </div>
              <div style={styles.syncActionGroup}>
                <button
                  type="button"
                  onClick={() => void onSyncCloud()}
                  disabled={!cloudConnected || cloudSyncing}
                  style={styles.syncButton}
                >
                  Sincronizar
                </button>
                <HelpTooltip content={TIPS.insights.syncCloud} placement="left" />
              </div>
            </div>

            <div style={styles.syncDivider} />

            <div style={styles.syncRow}>
              <div>
                <p style={styles.syncLabel}>Sincronizacao OMIE (ERP)</p>
                <p style={{ ...styles.syncValue, color: syncBadge.color }}>
                  {syncBadge.label}
                </p>
                {omieStatus?.lastSyncAt ? (
                  <p style={styles.syncHint}>
                    Ultima: {new Date(omieStatus.lastSyncAt).toLocaleString("pt-BR")}
                  </p>
                ) : null}
              </div>
              <div style={styles.syncActionGroup}>
                <button
                  type="button"
                  onClick={() => void onSyncOmie()}
                  disabled={!omieStatus?.configured}
                  style={styles.syncButton}
                >
                  Sincronizar
                </button>
                <HelpTooltip content={TIPS.insights.syncOmie} placement="left" />
              </div>
            </div>

            <div style={styles.syncDivider} />

            <div>
              <p style={styles.syncLabel}>Operacoes em aberto na balanca</p>
              <p style={styles.syncValue}>
                {openCount === 0
                  ? "Nenhuma em aberto"
                  : `${openCount} aguardando saida`}
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article style={styles.kpiCard}>
      <p style={styles.kpiLabel}>{label}</p>
      <p style={styles.kpiValue}>{value}</p>
      <p style={styles.kpiHint}>{hint}</p>
    </article>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--kr-chart-tooltip-bg)",
  border: "1px solid var(--kr-chart-tooltip-border)",
  borderRadius: "6px",
  fontSize: "12px",
  color: "var(--kr-chart-tooltip-text)",
  boxShadow: "var(--kr-shadow)"
};

const tooltipLabelStyle: React.CSSProperties = {
  color: "var(--kr-muted)",
  fontWeight: 600,
  marginBottom: "2px"
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap"
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: 0
  },
  subtitle: {
    fontSize: "13px",
    color: "var(--kr-muted)",
    margin: "4px 0 0 0"
  },
  periodRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap"
  },
  periodChip: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--kr-text)",
    background: "var(--kr-card-bg)",
    border: "1px solid var(--kr-card-border)",
    borderRadius: "999px",
    cursor: "pointer"
  },
  periodChipActive: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#ffffff",
    background: "var(--kr-chart-1)",
    border: "1px solid var(--kr-chart-1)",
    borderRadius: "999px",
    cursor: "pointer"
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px"
  },
  kpiCard: {
    background: "var(--kr-card-bg)",
    border: "1px solid var(--kr-card-border)",
    borderRadius: "10px",
    padding: "14px 16px",
    boxShadow: "var(--kr-shadow)"
  },
  kpiLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--kr-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0
  },
  kpiValue: {
    fontSize: "24px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: "4px 0 2px 0"
  },
  kpiHint: {
    fontSize: "12px",
    color: "var(--kr-muted)",
    margin: 0
  },
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "12px"
  },
  chartCard: {
    background: "var(--kr-card-bg)",
    border: "1px solid var(--kr-card-border)",
    borderRadius: "10px",
    padding: "14px 16px",
    boxShadow: "var(--kr-shadow)"
  },
  chartHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "6px"
  },
  chartTitle: {
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: 0
  },
  chartHint: {
    fontSize: "11px",
    color: "var(--kr-muted)"
  },
  chartBody: {
    width: "100%",
    minHeight: "240px"
  },
  muted: {
    color: "var(--kr-muted)",
    fontSize: "13px",
    margin: 0
  },
  errorMessage: {
    color: "var(--kr-chart-4)",
    fontSize: "13px",
    background: "color-mix(in srgb, var(--kr-chart-4) 12%, transparent)",
    border: "1px solid color-mix(in srgb, var(--kr-chart-4) 35%, transparent)",
    borderRadius: "8px",
    padding: "8px 12px",
    margin: 0
  },
  exportMessage: {
    color: "var(--kr-info-text)",
    background: "var(--kr-info-bg)",
    border: "1px solid var(--kr-info-border)",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    margin: 0
  },
  syncBody: {
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  syncRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px"
  },
  syncActionGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px"
  },
  syncLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--kr-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0
  },
  syncValue: {
    fontSize: "15px",
    fontWeight: 600,
    color: "var(--kr-text-strong)",
    margin: "4px 0 0 0"
  },
  syncHint: {
    fontSize: "11px",
    color: "var(--kr-muted)",
    margin: "2px 0 0 0"
  },
  syncButton: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#ffffff",
    background: "var(--kr-chart-1)",
    border: "1px solid var(--kr-chart-1)",
    borderRadius: "6px",
    cursor: "pointer"
  },
  syncDivider: {
    height: "1px",
    background: "var(--kr-border)"
  }
};
