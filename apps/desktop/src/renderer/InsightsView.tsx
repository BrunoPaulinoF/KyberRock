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
import { Tooltip } from "./Tooltip";
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

const CHART_COLORS = {
  primary: "#2563eb",
  primaryFill: "rgba(37, 99, 235, 0.15)",
  invoice: "#0ea5e9",
  internal: "#f59e0b",
  cancelled: "#94a3b8"
} as const;

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
      { name: "Com nota", value: mix.invoice.count, color: CHART_COLORS.invoice },
      { name: "Interna", value: mix.internal.count, color: CHART_COLORS.internal },
      { name: "Cancelada", value: mix.cancelled.count, color: CHART_COLORS.cancelled }
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
    if (!omieStatus) return { label: "OMIE nao configurado", color: "#94a3b8" };
    if (!omieStatus.configured) return { label: "OMIE nao configurado", color: "#94a3b8" };
    if (omieStatus.pendingOmieJobs > 0) {
      return {
        label: `${omieStatus.pendingOmieJobs} pendente(s) OMIE`,
        color: "#b45309"
      };
    }
    return { label: "OMIE em dia", color: "#047857" };
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
            <Tooltip key={opt.id} content={TIPS.insights.period} placement="bottom">
              <button
                type="button"
                onClick={() => setPeriod(opt.id)}
                style={period === opt.id ? styles.periodChipActive : styles.periodChip}
              >
                {opt.label}
              </button>
            </Tooltip>
          ))}
          <Tooltip content={TIPS.insights.exportPdf} placement="bottom">
            <button
              type="button"
              onClick={() => void exportReport("pdf")}
              disabled={exporting !== null}
              style={styles.periodChip}
            >
              {exporting === "pdf" ? "Gerando PDF..." : "Exportar PDF"}
            </button>
          </Tooltip>
          <Tooltip content={TIPS.insights.exportExcel} placement="bottom">
            <button
              type="button"
              onClick={() => void exportReport("excel")}
              disabled={exporting !== null}
              style={styles.periodChip}
            >
              {exporting === "excel" ? "Gerando Excel..." : "Exportar Excel"}
            </button>
          </Tooltip>
        </div>
      </header>

      {error ? <p style={styles.errorMessage}>{error}</p> : null}
      {exportMessage ? (
        <p
          style={{
            color: "#1d4ed8",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            padding: "8px 12px",
            borderRadius: "8px",
            fontSize: "13px"
          }}
        >
          {exportMessage}
        </p>
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
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatShortDate}
                    stroke="#64748b"
                    fontSize={11}
                  />
                  <YAxis
                    tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}t`}
                    stroke="#64748b"
                    fontSize={11}
                    width={48}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => formatKg(value)}
                    labelFormatter={(label: string) => `Dia ${formatShortDate(label)}`}
                    contentStyle={tooltipStyle}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalNetWeightKg"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
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
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}t`}
                    stroke="#64748b"
                    fontSize={11}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#64748b"
                    fontSize={11}
                    width={120}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => formatKg(value)}
                    contentStyle={tooltipStyle}
                  />
                  <Bar dataKey="peso" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
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
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={28}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, color: "#475569" }}
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
              <Tooltip content={TIPS.insights.syncCloud} placement="left">
                <button
                  type="button"
                  onClick={() => void onSyncCloud()}
                  disabled={!cloudConnected || cloudSyncing}
                  style={styles.syncButton}
                >
                  Sincronizar
                </button>
              </Tooltip>
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
              <Tooltip content={TIPS.insights.syncOmie} placement="left">
                <button
                  type="button"
                  onClick={() => void onSyncOmie()}
                  disabled={!omieStatus?.configured}
                  style={styles.syncButton}
                >
                  Sincronizar
                </button>
              </Tooltip>
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
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "6px",
  fontSize: "12px",
  color: "#0f172a"
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
    color: "#0f172a",
    margin: 0
  },
  subtitle: {
    fontSize: "13px",
    color: "#64748b",
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
    color: "#475569",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "999px",
    cursor: "pointer"
  },
  periodChipActive: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#ffffff",
    background: "#0f172a",
    border: "1px solid #0f172a",
    borderRadius: "999px",
    cursor: "pointer"
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px"
  },
  kpiCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "14px 16px"
  },
  kpiLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0
  },
  kpiValue: {
    fontSize: "24px",
    fontWeight: 700,
    color: "#0f172a",
    margin: "4px 0 2px 0"
  },
  kpiHint: {
    fontSize: "12px",
    color: "#64748b",
    margin: 0
  },
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "12px"
  },
  chartCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "14px 16px"
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
    color: "#0f172a",
    margin: 0
  },
  chartHint: {
    fontSize: "11px",
    color: "#64748b"
  },
  chartBody: {
    width: "100%",
    minHeight: "240px"
  },
  muted: {
    color: "#94a3b8",
    fontSize: "13px",
    margin: 0
  },
  errorMessage: {
    color: "#b91c1c",
    fontSize: "13px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    padding: "8px 12px",
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
  syncLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0
  },
  syncValue: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#0f172a",
    margin: "4px 0 0 0"
  },
  syncHint: {
    fontSize: "11px",
    color: "#94a3b8",
    margin: "2px 0 0 0"
  },
  syncButton: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#ffffff",
    background: "#0f172a",
    border: "1px solid #0f172a",
    borderRadius: "6px",
    cursor: "pointer"
  },
  syncDivider: {
    height: "1px",
    background: "#e2e8f0"
  }
};
