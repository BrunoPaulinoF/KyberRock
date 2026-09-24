import "./insights.css";

import { FileText, Lightbulb, RefreshCw, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Picker } from "../components/Picker";
import { Alert } from "../components/ui";
import { errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { localDay, periodToIso, todayIso } from "../lib/format";
import {
  INSIGHTS_PERIOD_OPTIONS,
  dailySeries,
  formatBRL,
  formatDayLabel,
  formatKg,
  formatShortDate,
  formatTonsShort,
  insightsReportHtml,
  loadInsightsOperations,
  loadProductCodes,
  monotonePath,
  niceTicks,
  operationMix,
  rangeSpreadsheetHtml,
  reportByProduct,
  resolveInsightsRange,
  salesPivot,
  seriesTotals,
  tickIndexes,
  type DailySeriesPoint,
  type InsightsPeriod,
  type ProductReport,
  type SalesPivotGroupBy
} from "../lib/insights";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";

const CHART_PALETTE = [
  "var(--kr-chart-1)",
  "var(--kr-chart-2)",
  "var(--kr-chart-3)",
  "var(--kr-chart-4)",
  "var(--kr-chart-5)",
  "var(--kr-chart-6)",
  "var(--kr-chart-7)"
] as const;

const TIPS = {
  title: "Acompanhe o andamento da operacao com KPIs, graficos e status de sincronizacao.",
  period:
    "Muda o periodo dos KPIs, graficos e relatorios exportados. Em 'Personalizado', escolha a data inicial e a final.",
  exportPdf: "Exporta um relatorio em PDF para o periodo selecionado.",
  exportExcel: "Exporta a planilha detalhada em Excel para o periodo selecionado."
};

/** Tela Insights do desktop (`InsightsView.tsx`), com as contas feitas sobre a nuvem. */
export function Insights() {
  const user = useUser();
  const [period, setPeriod] = useState<InsightsPeriod>("7d");
  const [customStart, setCustomStart] = useState(() => todayIso());
  const [customEnd, setCustomEnd] = useState(() => todayIso());
  const [pivotGroupBy, setPivotGroupBy] = useState<SalesPivotGroupBy>("customer");
  const [pivotCustomerId, setPivotCustomerId] = useState("");
  const [pivotProductId, setPivotProductId] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const range = useMemo(
    () => resolveInsightsRange(period, customStart, customEnd, new Date()),
    [period, customStart, customEnd]
  );
  const iso = useMemo(() => periodToIso(range.start, range.end), [range.start, range.end]);

  const operations = useAsync(
    () => loadInsightsOperations(user.companyId, user.unitId, iso.startIso, iso.endIso),
    [user.companyId, user.unitId, iso.startIso, iso.endIso]
  );
  const openOperations = useAsync(
    () => q.openOperations(user.companyId, user.unitId),
    [user.companyId, user.unitId]
  );

  // Trocar de periodo pode invalidar os filtros selecionados.
  useEffect(() => {
    setPivotCustomerId("");
    setPivotProductId("");
  }, [range.start, range.end]);

  const rows = useMemo(() => operations.data ?? [], [operations.data]);
  const loading = operations.loading;
  const series = useMemo(() => dailySeries(rows, range), [rows, range]);
  const topProducts = useMemo(() => reportByProduct(rows, range).slice(0, 5), [rows, range]);
  const mix = useMemo(() => operationMix(rows, range), [rows, range]);
  const totals = useMemo(() => seriesTotals(series), [series]);
  const pivot = useMemo(
    () =>
      salesPivot(rows, range, pivotGroupBy, {
        customerId: pivotCustomerId || null,
        productId: pivotProductId || null
      }),
    [rows, range, pivotGroupBy, pivotCustomerId, pivotProductId]
  );

  const mixData = [
    { name: "Com nota", value: mix.invoice.count, color: CHART_PALETTE[1] },
    { name: "Interna", value: mix.internal.count, color: CHART_PALETTE[2] },
    { name: "Cancelada", value: mix.cancelled.count, color: CHART_PALETTE[3] }
  ].filter((item) => item.value > 0);
  const mixTotal = mixData.reduce((sum, item) => sum + item.value, 0);

  const open = openOperations.data ?? [];
  const openCount = open.length;
  const oldestOpen = open.reduce<string | null>((oldest, op) => {
    if (!op.created_at) return oldest;
    if (!oldest || op.created_at < oldest) return op.created_at;
    return oldest;
  }, null);

  async function exportReport(kind: "pdf" | "excel") {
    setExporting(kind);
    setExportMessage(null);
    try {
      if (kind === "pdf") {
        const codes = await loadProductCodes(user.companyId).catch(() => new Map());
        printHtml(insightsReportHtml(rows, range, codes));
      } else {
        const blob = new Blob(["﻿" + rangeSpreadsheetHtml(rows, range)], {
          type: "application/vnd.ms-excel;charset=utf-8"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `relatorio-${range.start}-a-${range.end}.xls`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (caught) {
      setExportMessage(errorMessage(caught, "Falha ao exportar relatorio."));
    } finally {
      setExporting(null);
    }
  }

  const showCustomer = pivotGroupBy === "customer" || pivotGroupBy === "customer_product";
  const showProduct = pivotGroupBy === "product" || pivotGroupBy === "customer_product";

  return (
    <section className="insights">
      <header className="insights-header">
        <div className="insights-title-row">
          <h2 className="insights-title">Insights</h2>
          <Tip text={TIPS.title} />
        </div>
        <div className="insights-period-col">
          <div className="insights-period-row">
            {INSIGHTS_PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`insights-chip${period === opt.id ? " active" : ""}`}
                onClick={() => setPeriod(opt.id)}
              >
                {opt.label}
              </button>
            ))}
            <Tip text={TIPS.period} />
            <button
              type="button"
              className="icon-action primary"
              aria-label="Exportar PDF"
              title={exporting === "pdf" ? "Gerando PDF..." : TIPS.exportPdf}
              disabled={exporting !== null || loading}
              onClick={() => void exportReport("pdf")}
            >
              <FileText size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="icon-action primary"
              aria-label="Exportar Excel"
              title={exporting === "excel" ? "Gerando Excel..." : TIPS.exportExcel}
              disabled={exporting !== null || loading}
              onClick={() => void exportReport("excel")}
            >
              <Table2 size={16} strokeWidth={2} />
            </button>
          </div>
          {period === "custom" && (
            <div className="insights-custom-dates">
              <label>
                De
                <input
                  type="date"
                  className="input"
                  value={customStart}
                  max={customEnd || undefined}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label>
                Ate
                <input
                  type="date"
                  className="input"
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </label>
            </div>
          )}
          <p className="insights-period-hint">
            {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
          </p>
        </div>
      </header>

      {operations.error && <Alert kind="error">{operations.error}</Alert>}
      {exportMessage && <Alert kind="info">{exportMessage}</Alert>}

      <div className="insights-kpis">
        <KpiCard
          label="Operacoes"
          value={loading ? "-" : totals.operations.toLocaleString("pt-BR")}
          hint={range.label}
        />
        <KpiCard
          label="Peso liquido"
          value={loading ? "-" : formatTonsShort(totals.weightKg)}
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
          value={openOperations.loading ? "-" : openCount.toLocaleString("pt-BR")}
          hint={oldestOpen ? `Desde ${formatShortDate(localDay(oldestOpen))}` : "Nenhuma agora"}
        />
      </div>

      <div className="insights-charts">
        <ChartCard title="Peso liquido por dia" hint={range.label}>
          {series.length === 0 ? (
            <p className="insights-muted">Sem dados no periodo.</p>
          ) : (
            <WeightAreaChart series={series} />
          )}
        </ChartCard>
        <ChartCard title="Top 5 produtos por peso" hint={range.label}>
          {topProducts.length === 0 ? (
            <p className="insights-muted">Sem produtos vendidos no periodo.</p>
          ) : (
            <ProductBarChart products={topProducts} />
          )}
        </ChartCard>
        <ChartCard title="Mix de operacoes" hint={range.label}>
          {mixData.length === 0 || mixTotal === 0 ? (
            <p className="insights-muted">Sem operacoes no periodo.</p>
          ) : (
            <MixDonut data={mixData} total={mixTotal} />
          )}
        </ChartCard>
      </div>

      <div className="insights-bottom">
        <article className="insights-card insights-status">
          <header className="insights-card-head">
            <h3>Status operacional</h3>
            <span>Agora</span>
          </header>
          <div className="insights-sync-row">
            <div>
              <p className="insights-sync-label">Operacoes em aberto na balanca</p>
              <p className="insights-sync-value">
                {openOperations.loading
                  ? "-"
                  : openCount === 0
                    ? "Nenhuma em aberto"
                    : `${openCount} aguardando saida`}
              </p>
            </div>
            <button
              type="button"
              className="icon-action primary"
              aria-label="Atualizar"
              title="Atualizar"
              onClick={() => {
                void openOperations.reload();
                void operations.reload();
              }}
            >
              <RefreshCw size={16} strokeWidth={2} />
            </button>
          </div>
          {openOperations.error && (
            <p className="insights-sync-hint">Falha ao ler as abertas: {openOperations.error}</p>
          )}
        </article>

        <article className="insights-card insights-pivot">
          <header className="insights-card-head">
            <h3>Tabela dinamica de vendas</h3>
            <span>{range.label}</span>
          </header>
          <div className="insights-pivot-controls">
            <label>
              Agrupar por
              <select
                className="select"
                value={pivotGroupBy}
                onChange={(event) => setPivotGroupBy(event.target.value as SalesPivotGroupBy)}
              >
                <option value="customer">Cliente</option>
                <option value="product">Produto</option>
                <option value="customer_product">Cliente + Produto</option>
                <option value="day">Dia</option>
              </select>
            </label>
            <label>
              Cliente
              <Picker
                value={pivotCustomerId}
                options={pivot.customers.map((o) => ({ value: o.id, label: o.name }))}
                onChange={setPivotCustomerId}
                placeholder="Todos"
                allowEmpty
                emptyLabel="Todos"
              />
            </label>
            <label>
              Produto
              <Picker
                value={pivotProductId}
                options={pivot.products.map((o) => ({ value: o.id, label: o.name }))}
                onChange={setPivotProductId}
                placeholder="Todos"
                allowEmpty
                emptyLabel="Todos"
              />
            </label>
          </div>
          <div className="insights-pivot-scroll">
            <table className="insights-pivot-table">
              <thead>
                <tr>
                  {pivotGroupBy === "day" && <th>Dia</th>}
                  {showCustomer && <th>Cliente</th>}
                  {showProduct && <th>Produto</th>}
                  <th className="num">Operacoes</th>
                  <th className="num">Quantidade</th>
                  <th className="num">Preco medio</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="insights-pivot-empty">
                      {loading
                        ? "Carregando..."
                        : "Sem vendas no periodo com os filtros selecionados."}
                    </td>
                  </tr>
                ) : (
                  pivot.rows.map((row) => (
                    <tr key={row.key}>
                      {pivotGroupBy === "day" && (
                        <td>{row.date ? formatShortDate(row.date) : "-"}</td>
                      )}
                      {showCustomer && <td>{row.customerName ?? "N/A"}</td>}
                      {showProduct && <td>{row.productDescription ?? "N/A"}</td>}
                      <td className="num">{row.totalOperations.toLocaleString("pt-BR")}</td>
                      <td className="num">{formatTonsShort(row.totalWeightKg)}</td>
                      <td className="num">{formatBRL(row.avgPriceCentsPerTon)}/t</td>
                      <td className="num">{formatBRL(row.totalValueCents)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {pivot.rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={pivotGroupBy === "customer_product" ? 2 : 1}>TOTAL</td>
                    <td className="num">{pivot.totals.totalOperations.toLocaleString("pt-BR")}</td>
                    <td className="num">{formatTonsShort(pivot.totals.totalWeightKg)}</td>
                    <td className="num">{formatBRL(pivot.totals.avgPriceCentsPerTon)}/t</td>
                    <td className="num">{formatBRL(pivot.totals.totalValueCents)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </article>
      </div>
    </section>
  );
}

/** Abre a janela de impressao do navegador com o documento (la se escolhe "Salvar como PDF"). */
function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error("O navegador bloqueou a impressao.");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    // Navegador sem `afterprint`: tira o quadro depois de um minuto.
    setTimeout(() => frame.remove(), 60_000);
  }, 250);
}

function Tip({ text }: { text: string }) {
  return (
    <span className="insights-tip" role="img" aria-label="Dica" title={text}>
      <Lightbulb size={14} />
    </span>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="insights-kpi">
      <p className="insights-kpi-label">{label}</p>
      <p className="insights-kpi-value">{value}</p>
      <p className="insights-kpi-hint">{hint}</p>
    </article>
  );
}

function ChartCard({
  title,
  hint,
  children
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <article className="insights-card">
      <header className="insights-card-head">
        <h3>{title}</h3>
        <span>{hint}</span>
      </header>
      <div className="insights-chart-body">{children}</div>
    </article>
  );
}

/** Largura do elemento, acompanhando o redimensionamento (o `ResponsiveContainer`). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? element.clientWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

interface TooltipState {
  x: number;
  y: number;
  label?: string;
  lines: Array<{ text: string; color?: string }>;
}

function ChartTooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null;
  return (
    <div className="insights-tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.label && <div className="insights-tooltip-label">{tip.label}</div>}
      {tip.lines.map((line) => (
        <div key={line.text} style={line.color ? { color: line.color } : undefined}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

const CHART_HEIGHT = 240;
const tonTick = (value: number) => `${(value / 1000).toFixed(0)}t`;

function WeightAreaChart({ series }: { series: DailySeriesPoint[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 8, right: 16, bottom: 30, left: 48 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = CHART_HEIGHT - margin.top - margin.bottom;
  const max = Math.max(...series.map((p) => p.totalNetWeightKg), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const xOf = (i: number) =>
    margin.left + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
  const yOf = (v: number) => margin.top + plotH - (plotH * v) / top;
  const points = series.map((p, i) => ({ x: xOf(i), y: yOf(p.totalNetWeightKg) }));
  const line = monotonePath(points);
  const baseline = yOf(0);
  const area =
    points.length > 0
      ? `${line}L${points[points.length - 1].x},${baseline}L${points[0].x},${baseline}Z`
      : "";
  const labels = tickIndexes(series.length, plotW / 40);
  const point = hover !== null ? series[hover] : null;

  return (
    <div ref={ref} className="insights-chart" style={{ height: CHART_HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            if (x < margin.left - 8 || x > width - margin.right + 8 || series.length === 0) {
              setHover(null);
              return;
            }
            const step = series.length > 1 ? plotW / (series.length - 1) : plotW;
            const index = series.length > 1 ? Math.round((x - margin.left) / step) : 0;
            setHover(Math.max(0, Math.min(series.length - 1, index)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="insightsWeightFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--kr-chart-1)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--kr-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <g className="insights-grid">
            {ticks.map((t) => (
              <line key={t} x1={margin.left} x2={margin.left + plotW} y1={yOf(t)} y2={yOf(t)} />
            ))}
            {labels.map((i) => (
              <line key={i} x1={xOf(i)} x2={xOf(i)} y1={margin.top} y2={margin.top + plotH} />
            ))}
          </g>
          <path d={area} fill="url(#insightsWeightFill)" />
          <path d={line} fill="none" stroke="var(--kr-chart-1)" strokeWidth={2.5} />
          {/* Um dia so nao tem linha a desenhar: o ponto mostra onde ele esta. */}
          {points.length === 1 && (
            <circle cx={points[0].x} cy={points[0].y} r={4} fill="var(--kr-chart-1)" />
          )}
          <g className="insights-axis">
            <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotH} />
            <line
              x1={margin.left}
              x2={margin.left + plotW}
              y1={margin.top + plotH}
              y2={margin.top + plotH}
            />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={margin.left - 6} x2={margin.left} y1={yOf(t)} y2={yOf(t)} />
                <text x={margin.left - 9} y={yOf(t)} textAnchor="end" dominantBaseline="middle">
                  {tonTick(t)}
                </text>
              </g>
            ))}
            {labels.map((i) => (
              <g key={i}>
                <line x1={xOf(i)} x2={xOf(i)} y1={margin.top + plotH} y2={margin.top + plotH + 6} />
                <text x={xOf(i)} y={margin.top + plotH + 18} textAnchor="middle">
                  {formatShortDate(series[i].date)}
                </text>
              </g>
            ))}
          </g>
          {hover !== null && (
            <>
              <line
                className="insights-cursor"
                x1={xOf(hover)}
                x2={xOf(hover)}
                y1={margin.top}
                y2={margin.top + plotH}
              />
              <circle
                cx={points[hover].x}
                cy={points[hover].y}
                r={4}
                fill="var(--kr-chart-1)"
                stroke="var(--kr-card-bg)"
                strokeWidth={2}
              />
            </>
          )}
        </svg>
      )}
      <ChartTooltip
        tip={
          point && hover !== null
            ? {
                x: Math.min(points[hover].x + 12, Math.max(0, width - 170)),
                y: margin.top + 8,
                label: `Dia ${formatShortDate(point.date)}`,
                lines: [
                  {
                    text: `Peso liquido : ${formatKg(point.totalNetWeightKg)}`,
                    color: "var(--kr-chart-1)"
                  }
                ]
              }
            : null
        }
      />
    </div>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ProductBarChart({ products }: { products: ProductReport[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 8, right: 24, bottom: 30, left: 8 + 120 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = CHART_HEIGHT - margin.top - margin.bottom;
  const max = Math.max(...products.map((p) => p.totalWeightKg), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const band = plotH / products.length;
  const barH = band * 0.8;
  const xOf = (v: number) => margin.left + (plotW * v) / top;
  const product = hover !== null ? products[hover] : null;

  return (
    <div ref={ref} className="insights-chart" style={{ height: CHART_HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={CHART_HEIGHT} onMouseLeave={() => setHover(null)}>
          <g className="insights-grid">
            {ticks.map((t) => (
              <line key={t} x1={xOf(t)} x2={xOf(t)} y1={margin.top} y2={margin.top + plotH} />
            ))}
            {products.map((_, i) => (
              <line
                key={i}
                x1={margin.left}
                x2={margin.left + plotW}
                y1={margin.top + band * i + band / 2}
                y2={margin.top + band * i + band / 2}
              />
            ))}
          </g>
          {products.map((p, i) => (
            <g key={p.productDescription + i} onMouseEnter={() => setHover(i)}>
              <rect
                className="insights-band"
                x={margin.left}
                y={margin.top + band * i}
                width={plotW}
                height={band}
                fill={hover === i ? "var(--kr-card-hover)" : "transparent"}
              />
              <path
                d={barPath(
                  margin.left,
                  margin.top + band * i + (band - barH) / 2,
                  Math.max(0, xOf(p.totalWeightKg) - margin.left),
                  barH,
                  4
                )}
                fill={CHART_PALETTE[i % CHART_PALETTE.length]}
              />
            </g>
          ))}
          <g className="insights-axis">
            <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotH} />
            <line
              x1={margin.left}
              x2={margin.left + plotW}
              y1={margin.top + plotH}
              y2={margin.top + plotH}
            />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={xOf(t)} x2={xOf(t)} y1={margin.top + plotH} y2={margin.top + plotH + 6} />
                <text x={xOf(t)} y={margin.top + plotH + 18} textAnchor="middle">
                  {tonTick(t)}
                </text>
              </g>
            ))}
            {products.map((p, i) => (
              <g key={i}>
                <line
                  x1={margin.left - 6}
                  x2={margin.left}
                  y1={margin.top + band * i + band / 2}
                  y2={margin.top + band * i + band / 2}
                />
                <text
                  x={margin.left - 9}
                  y={margin.top + band * i + band / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  <title>{p.productDescription}</title>
                  {truncate(p.productDescription, 18)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
      <ChartTooltip
        tip={
          product && hover !== null
            ? {
                x: Math.min(xOf(product.totalWeightKg) + 8, Math.max(0, width - 190)),
                y: margin.top + band * hover + band / 2 - 20,
                label: product.productDescription,
                lines: [
                  {
                    text: `peso : ${formatKg(product.totalWeightKg)}`,
                    color: CHART_PALETTE[hover % CHART_PALETTE.length]
                  }
                ]
              }
            : null
        }
      />
    </div>
  );
}

/** Retangulo com os dois cantos da direita arredondados (`radius={[0, 4, 4, 0]}`). */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  if (w <= 0) return "";
  return `M${x},${y}H${x + w - radius}A${radius},${radius} 0 0 1 ${x + w},${y + radius}V${
    y + h - radius
  }A${radius},${radius} 0 0 1 ${x + w - radius},${y + h}H${x}Z`;
}

function MixDonut({
  data,
  total
}: {
  data: Array<{ name: string; value: number; color: string }>;
  total: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const legendH = 28;
  const cx = width / 2;
  const cy = (CHART_HEIGHT - legendH) / 2;
  const inner = 55;
  const outer = 90;
  const padding = data.length > 1 ? 2 : 0;
  const sweep = 360 - padding * data.length;
  let angle = 0;
  const slices = data.map((item) => {
    const size = (sweep * item.value) / total;
    const start = angle;
    angle += size + padding;
    return { ...item, start, end: start + size };
  });
  const active = hover !== null ? slices[hover] : null;

  return (
    <div ref={ref} className="insights-chart" style={{ height: CHART_HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT - legendH}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMouse({ x: event.clientX - rect.left, y: event.clientY - rect.top });
          }}
          onMouseLeave={() => {
            setHover(null);
            setMouse(null);
          }}
        >
          {slices.map((slice, i) => (
            <path
              key={slice.name}
              d={arcPath(cx, cy, inner, outer, slice.start, slice.end)}
              fill={slice.color}
              stroke="var(--kr-card-bg)"
              strokeWidth={2}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      <ul className="insights-legend">
        {data.map((item) => (
          <li key={item.name} style={{ color: item.color }}>
            <span style={{ background: item.color }} />
            {item.name}
          </li>
        ))}
      </ul>
      <ChartTooltip
        tip={
          active && mouse
            ? {
                x: Math.min(mouse.x + 12, Math.max(0, width - 170)),
                y: mouse.y + 12,
                lines: [
                  {
                    text: `${active.name} : ${active.value} (${((active.value / total) * 100).toFixed(1)}%)`,
                    color: active.color
                  }
                ]
              }
            : null
        }
      />
    </div>
  );
}

/**
 * Fatia da rosca. Angulo em graus a partir das 3 horas, girando no sentido anti-horario —
 * a mesma origem e o mesmo sentido do `Pie` do Recharts no desktop.
 */
function arcPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  const full = end - start >= 359.99;
  const clampedEnd = full ? start + 359.99 : end;
  const point = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${cx + r * Math.cos(rad)},${cy - r * Math.sin(rad)}`;
  };
  const large = clampedEnd - start > 180 ? 1 : 0;
  return [
    `M${point(outer, start)}`,
    `A${outer},${outer} 0 ${large} 0 ${point(outer, clampedEnd)}`,
    `L${point(inner, clampedEnd)}`,
    `A${inner},${inner} 0 ${large} 1 ${point(inner, start)}`,
    "Z"
  ].join("");
}
