import "./reports.css";

import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Download,
  Info,
  Table2,
  Users
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DeskPanel, EmptyState, IconAction, PillTabs, SectionHead } from "../components/desk";
import { Picker } from "../components/Picker";
import { Alert } from "../components/ui";
import { useUser } from "../lib/auth";
import { firstDayOfMonth, formatMoney, formatTons, periodToIso, todayIso } from "../lib/format";
import { q } from "../lib/queries";
import {
  centsPerTon,
  dailyCsv,
  dailyLines,
  dailySeries,
  filterByUnit,
  formatDayLabel,
  monthRange,
  monthlyCsv,
  periodCsv,
  pivotCsv,
  pivotGroupColumns,
  PERIOD_PRESETS,
  presetRange,
  reportLines,
  reportUnits,
  salesPivot,
  sumLines,
  sumSeries,
  type ReportTotals,
  type SalesFreightFilter,
  type SalesPivotGroupBy
} from "../lib/reports";
import { useAsync } from "../lib/use-async";
import { ReportRecipients } from "./ReportRecipients";

type ReportTab = "daily" | "period" | "pivot" | "monthly" | "recipients";

const TABS: Array<{ id: ReportTab; label: string; icon: typeof CalendarDays }> = [
  { id: "daily", label: "Fechamento diario", icon: CalendarDays },
  { id: "period", label: "Carregamentos do periodo", icon: CalendarRange },
  { id: "pivot", label: "Tabela dinamica de vendas", icon: Table2 },
  { id: "monthly", label: "Relatorio mensal", icon: CalendarClock }
];

/** Quem recebe o fechamento diario: so quem grava (gestor, operacao, administrador) ve e edita. */
const RECIPIENTS_TAB = { id: "recipients" as const, label: "Destinatarios", icon: Users };

const TAB_DESCRIPTION: Record<ReportTab, string> = {
  daily: "As vendas do dia, pesagem a pesagem — o mesmo fechamento que a balanca envia.",
  period: "Cada carregamento do periodo, com o valor por tonelada do material e do frete.",
  pivot: "Vendas agrupadas por cliente, produto ou dia, com preco medio por tonelada.",
  monthly: "Total do mes e a evolucao dia a dia.",
  recipients: "Quem recebe o fechamento diario por e-mail ou WhatsApp."
};

function perTon(totalCents: number, netWeightKg: number): string {
  const cents = centsPerTon(totalCents, netWeightKg);
  return cents === null ? "-" : `${formatMoney(cents)}/t`;
}

function kg(value: number): string {
  return value.toLocaleString("pt-BR");
}

function downloadCsv(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** `?aba=vendas` abre direto a tabela dinamica (a entrada do comercial, que vinha do portal). */
function initialTab(param: string | null): ReportTab {
  if (param === "vendas" || param === "pivot") return "pivot";
  if (param === "periodo") return "period";
  if (param === "mensal") return "monthly";
  return "daily";
}

/**
 * Relatorios e fechamento diario: as contas de `services/reports.ts` do desktop, sobre a nuvem.
 * A tabela dinamica tambem e o antigo "Relatorio de vendas" do portal do comercial (atalhos de
 * periodo, filtro de frete, produto + frete + total), que deixou o portal e mora aqui.
 */
export function SalesReport() {
  const user = useUser();
  const today = todayIso();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<ReportTab>(() => initialTab(searchParams.get("aba")));
  const [freight, setFreight] = useState<SalesFreightFilter>("all");
  const [day, setDay] = useState(today);
  const [start, setStart] = useState(firstDayOfMonth(today));
  const [end, setEnd] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [unitId, setUnitId] = useState("");
  const [groupBy, setGroupBy] = useState<SalesPivotGroupBy>("customer");
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");

  const range = useMemo(() => {
    if (tab === "daily") return { start: day, end: day };
    if (tab === "monthly") return monthRange(month);
    return { start, end };
  }, [tab, day, month, start, end]);
  const period = useMemo(() => periodToIso(range.start, range.end), [range.start, range.end]);
  const validRange = Boolean(range.start && range.end && range.start <= range.end);

  const units = useAsync(() => reportUnits(user.companyId), [user.companyId]);
  const ops = useAsync(
    () =>
      validRange
        ? q.closedOperations(user.companyId, period.startIso, period.endIso)
        : Promise.resolve([]),
    [user.companyId, period.startIso, period.endIso, validRange]
  );
  const operations = useMemo(() => filterByUnit(ops.data ?? [], unitId), [ops.data, unitId]);

  // Trocar de periodo pode invalidar os filtros escolhidos (como no desktop).
  useEffect(() => {
    setCustomerId("");
    setProductId("");
  }, [range.start, range.end]);

  const lines = useMemo(
    () => (tab === "daily" ? dailyLines(operations, day) : reportLines(operations)),
    [operations, tab, day]
  );
  const totals = useMemo(() => sumLines(lines), [lines]);
  const pivot = useMemo(
    () => salesPivot(operations, groupBy, { customerId, productId, freight }),
    [operations, groupBy, customerId, productId, freight]
  );
  const series = useMemo(
    () => dailySeries(operations, range.start, range.end),
    [operations, range.start, range.end]
  );
  const monthTotals = useMemo(() => sumSeries(series), [series]);

  const periodLabel =
    tab === "daily"
      ? formatDayLabel(day)
      : `${formatDayLabel(range.start)} a ${formatDayLabel(range.end)}`;
  const unitName =
    (units.data ?? []).find((unit) => unit.id === unitId)?.name ?? "Todas as unidades";
  const hasData =
    tab === "pivot" ? pivot.rows.length > 0 : tab === "monthly" ? true : lines.length > 0;

  function exportCsv(): void {
    const suffix = tab === "daily" ? day : `${range.start}-a-${range.end}`;
    if (tab === "daily") downloadCsv(dailyCsv(day, lines), `relatorio-diario-${suffix}.csv`);
    if (tab === "period") downloadCsv(periodCsv(lines), `relatorio-periodo-${suffix}.csv`);
    if (tab === "pivot") {
      const freightSuffix = freight === "all" ? "" : `-${freight === "with" ? "com" : "sem"}-frete`;
      downloadCsv(pivotCsv(pivot, groupBy), `vendas-${groupBy}${freightSuffix}-${suffix}.csv`);
    }
    if (tab === "monthly") downloadCsv(monthlyCsv(series), `relatorio-mensal-${month}.csv`);
  }

  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <DeskPanel>
      <div className="reports-page">
        <div className="desk-title-row">
          <div>
            <p className="desk-kicker">Analise</p>
            <h1 className="desk-title">Relatorios e fechamento diario</h1>
          </div>
          <div className="reports-actions reports-no-print" hidden={tab === "recipients"}>
            <IconAction icon="printer" label="Imprimir" onClick={() => window.print()} />
            <button
              type="button"
              className="btn"
              onClick={exportCsv}
              disabled={ops.loading || !hasData}
            >
              <Download size={15} />
              Baixar CSV
            </button>
          </div>
        </div>

        <div className="reports-no-print">
          <PillTabs
            tabs={user.canManagePrices ? [...TABS, RECIPIENTS_TAB] : TABS}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === "recipients" ? (
          <ReportRecipients />
        ) : (
          <>
            <SectionHead title={activeTab.label} description={TAB_DESCRIPTION[tab]} />
            <p className="reports-print-head">
              {periodLabel} · {unitName}
            </p>

            <div className="op-filters reports-filters reports-no-print">
              {tab === "daily" && (
                <label className="op-filter">
                  Data
                  <input
                    className="input"
                    type="date"
                    value={day}
                    onChange={(event) => setDay(event.target.value)}
                  />
                </label>
              )}
              {(tab === "period" || tab === "pivot") && (
                <>
                  <div className="reports-presets" role="group" aria-label="Atalhos de periodo">
                    {PERIOD_PRESETS.map((preset) => {
                      const range = presetRange(preset.id, today);
                      const active = range.start === start && range.end === end;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`reports-preset${active ? " active" : ""}`}
                          aria-pressed={active}
                          onClick={() => {
                            setStart(range.start);
                            setEnd(range.end);
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <label className="op-filter">
                    De
                    <input
                      className="input"
                      type="date"
                      value={start}
                      onChange={(event) => setStart(event.target.value)}
                    />
                  </label>
                  <label className="op-filter">
                    Ate
                    <input
                      className="input"
                      type="date"
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  </label>
                </>
              )}
              {tab === "monthly" && (
                <label className="op-filter">
                  Mes
                  <input
                    className="input"
                    type="month"
                    value={month}
                    onChange={(event) => setMonth(event.target.value || today.slice(0, 7))}
                  />
                </label>
              )}
              {(units.data ?? []).length > 1 && (
                <label className="op-filter">
                  Unidade
                  <select
                    className="select"
                    value={unitId}
                    onChange={(event) => setUnitId(event.target.value)}
                  >
                    <option value="">Todas as unidades</option>
                    {(units.data ?? []).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {tab === "pivot" && (
                <>
                  <label className="op-filter">
                    Agrupar por
                    <select
                      className="select"
                      value={groupBy}
                      onChange={(event) => setGroupBy(event.target.value as SalesPivotGroupBy)}
                    >
                      <option value="customer">Cliente</option>
                      <option value="product">Produto</option>
                      <option value="customer_product">Cliente + Produto</option>
                      <option value="day">Dia</option>
                    </select>
                  </label>
                  <div className="op-filter reports-picker">
                    Cliente
                    <Picker
                      value={customerId}
                      options={pivot.customers.map((option) => ({
                        value: option.id,
                        label: option.name
                      }))}
                      onChange={setCustomerId}
                      placeholder="Buscar cliente..."
                      allowEmpty
                      emptyLabel="Todos"
                    />
                  </div>
                  <div className="op-filter reports-picker">
                    Produto
                    <Picker
                      value={productId}
                      options={pivot.products.map((option) => ({
                        value: option.id,
                        label: option.name
                      }))}
                      onChange={setProductId}
                      placeholder="Buscar produto..."
                      allowEmpty
                      emptyLabel="Todos"
                    />
                  </div>
                  <label className="op-filter">
                    Frete
                    <select
                      className="select"
                      value={freight}
                      onChange={(event) => setFreight(event.target.value as SalesFreightFilter)}
                    >
                      <option value="all">Todos</option>
                      <option value="with">Com frete</option>
                      <option value="without">Sem frete</option>
                    </select>
                  </label>
                </>
              )}
              {ops.loading && <span className="reports-loading">Carregando...</span>}
            </div>

            {!validRange && (
              <Alert kind="error">A data inicial precisa ser anterior a final.</Alert>
            )}
            {ops.error && <Alert kind="error">{ops.error}</Alert>}

            {tab === "daily" && <DailyReport lines={lines} totals={totals} />}
            {tab === "period" && <PeriodReport lines={lines} totals={totals} />}
            {tab === "pivot" && <PivotReport pivot={pivot} groupBy={groupBy} />}
            {tab === "monthly" && <MonthlyReport series={series} totals={monthTotals} />}

            <p className="reports-note reports-no-print">
              <Info size={14} />
              Periodo pela data de FECHAMENTO da pesagem (a mesma que o OMIE usa na nota). Os
              destinatarios ficam na aba Destinatarios (gestor); o horario dos envios automaticos e
              os canais (e-mail e WhatsApp) sao configurados na tela Relatorios da balanca.
            </p>
          </>
        )}
      </div>
    </DeskPanel>
  );
}

function Kpis({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="kpis reports-kpis">
      {items.map((item) => (
        <div key={item.label} className="kpi">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReportTable({
  head,
  children,
  foot
}: {
  head: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="table-wrap reports-table">
      <table className="data">
        <thead>{head}</thead>
        <tbody>{children}</tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  );
}

function totalsKpis(totals: ReportTotals) {
  return [
    { label: "Carregamentos", value: totals.operations.toLocaleString("pt-BR") },
    { label: "Tonelagem", value: formatTons(totals.netWeightKg) },
    { label: "Produto", value: formatMoney(totals.productTotalCents) },
    { label: "Frete", value: formatMoney(totals.freightTotalCents) },
    { label: "Total", value: formatMoney(totals.totalCents) }
  ];
}

function DailyReport({
  lines,
  totals
}: {
  lines: ReturnType<typeof reportLines>;
  totals: ReportTotals;
}) {
  return (
    <>
      <Kpis items={totalsKpis(totals)} />
      {lines.length === 0 ? (
        <EmptyState title="Nenhuma venda neste dia." />
      ) : (
        <ReportTable
          head={
            <tr>
              <th>Cliente</th>
              <th>Produto</th>
              <th className="num">Peso liquido (kg)</th>
              <th className="num">Valor produto</th>
              <th className="num">Frete</th>
              <th className="num">Total</th>
            </tr>
          }
          foot={
            <tr>
              <td colSpan={2}>TOTAL</td>
              <td className="num">{kg(totals.netWeightKg)}</td>
              <td className="num">{formatMoney(totals.productTotalCents)}</td>
              <td className="num">{formatMoney(totals.freightTotalCents)}</td>
              <td className="num">{formatMoney(totals.totalCents)}</td>
            </tr>
          }
        >
          {lines.map((line) => (
            <tr key={line.id}>
              <td>
                <strong>{line.customerName}</strong>
              </td>
              <td>{line.productDescription}</td>
              <td className="num">{kg(line.netWeightKg)}</td>
              <td className="num">{formatMoney(line.productTotalCents)}</td>
              <td className="num">{formatMoney(line.freightTotalCents)}</td>
              <td className="num">
                <strong>{formatMoney(line.totalCents)}</strong>
              </td>
            </tr>
          ))}
        </ReportTable>
      )}
    </>
  );
}

function PeriodReport({
  lines,
  totals
}: {
  lines: ReturnType<typeof reportLines>;
  totals: ReportTotals;
}) {
  return (
    <>
      <Kpis items={totalsKpis(totals)} />
      {lines.length === 0 ? (
        <EmptyState title="Nenhum carregamento no periodo." />
      ) : (
        <ReportTable
          head={
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Produto</th>
              <th className="num">Peso kg</th>
              <th className="num">Produto R$/t</th>
              <th className="num">Produto</th>
              <th className="num">Frete R$/t</th>
              <th className="num">Frete</th>
              <th className="num">Total</th>
            </tr>
          }
          foot={
            <tr>
              <td colSpan={3}>TOTAL</td>
              <td className="num">{kg(totals.netWeightKg)}</td>
              <td className="num">{perTon(totals.productTotalCents, totals.netWeightKg)}</td>
              <td className="num">{formatMoney(totals.productTotalCents)}</td>
              <td className="num">{perTon(totals.freightTotalCents, totals.netWeightKg)}</td>
              <td className="num">{formatMoney(totals.freightTotalCents)}</td>
              <td className="num">{formatMoney(totals.totalCents)}</td>
            </tr>
          }
        >
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{formatDayLabel(line.date)}</td>
              <td>
                <strong>{line.customerName}</strong>
              </td>
              <td>{line.productDescription}</td>
              <td className="num">{kg(line.netWeightKg)}</td>
              <td className="num">{perTon(line.productTotalCents, line.netWeightKg)}</td>
              <td className="num">{formatMoney(line.productTotalCents)}</td>
              <td className="num">{perTon(line.freightTotalCents, line.netWeightKg)}</td>
              <td className="num">{formatMoney(line.freightTotalCents)}</td>
              <td className="num">
                <strong>{formatMoney(line.totalCents)}</strong>
              </td>
            </tr>
          ))}
        </ReportTable>
      )}
    </>
  );
}

function PivotReport({
  pivot,
  groupBy
}: {
  pivot: ReturnType<typeof salesPivot>;
  groupBy: SalesPivotGroupBy;
}) {
  const columns = pivotGroupColumns(groupBy);
  return (
    <>
      <Kpis
        items={[
          { label: "Operacoes", value: pivot.totals.totalOperations.toLocaleString("pt-BR") },
          { label: "Quantidade", value: formatTons(pivot.totals.totalWeightKg) },
          { label: "Preco medio", value: `${formatMoney(pivot.totals.avgPriceCentsPerTon)}/t` },
          { label: "Valor produto", value: formatMoney(pivot.totals.totalValueCents) },
          { label: "Frete", value: formatMoney(pivot.totals.freightCents) },
          { label: "Total", value: formatMoney(pivot.totals.grandTotalCents) }
        ]}
      />
      {pivot.rows.length === 0 ? (
        <EmptyState title="Sem vendas no periodo com os filtros selecionados." />
      ) : (
        <ReportTable
          head={
            <tr>
              {columns.includes("day") && <th>Dia</th>}
              {columns.includes("customer") && <th>Cliente</th>}
              {columns.includes("product") && <th>Produto</th>}
              <th className="num">Operacoes</th>
              <th className="num">Quantidade</th>
              <th className="num">Preco medio</th>
              <th className="num">Valor produto</th>
              <th className="num">Frete</th>
              <th className="num">Total</th>
            </tr>
          }
          foot={
            <tr>
              <td colSpan={columns.length}>TOTAL</td>
              <td className="num">{pivot.totals.totalOperations.toLocaleString("pt-BR")}</td>
              <td className="num">{formatTons(pivot.totals.totalWeightKg)}</td>
              <td className="num">{formatMoney(pivot.totals.avgPriceCentsPerTon)}/t</td>
              <td className="num">{formatMoney(pivot.totals.totalValueCents)}</td>
              <td className="num">{formatMoney(pivot.totals.freightCents)}</td>
              <td className="num">{formatMoney(pivot.totals.grandTotalCents)}</td>
            </tr>
          }
        >
          {pivot.rows.map((row) => (
            <tr key={row.key}>
              {columns.includes("day") && <td>{row.date ? formatDayLabel(row.date) : "-"}</td>}
              {columns.includes("customer") && (
                <td>
                  <strong>{row.customerName ?? "N/A"}</strong>
                </td>
              )}
              {columns.includes("product") && <td>{row.productDescription ?? "N/A"}</td>}
              <td className="num">{row.totalOperations.toLocaleString("pt-BR")}</td>
              <td className="num">{formatTons(row.totalWeightKg)}</td>
              <td className="num">{formatMoney(row.avgPriceCentsPerTon)}/t</td>
              <td className="num">{formatMoney(row.totalValueCents)}</td>
              <td className="num">{formatMoney(row.freightCents)}</td>
              <td className="num">
                <strong>{formatMoney(row.grandTotalCents)}</strong>
              </td>
            </tr>
          ))}
        </ReportTable>
      )}
    </>
  );
}

function MonthlyReport({
  series,
  totals
}: {
  series: ReturnType<typeof dailySeries>;
  totals: ReportTotals;
}) {
  const ticket = totals.operations > 0 ? Math.round(totals.totalCents / totals.operations) : 0;
  return (
    <>
      <Kpis
        items={[
          { label: "Operacoes", value: totals.operations.toLocaleString("pt-BR") },
          { label: "Peso liquido", value: formatTons(totals.netWeightKg) },
          { label: "Produto", value: formatMoney(totals.productTotalCents) },
          { label: "Frete", value: formatMoney(totals.freightTotalCents) },
          { label: "Total", value: formatMoney(totals.totalCents) },
          { label: "Ticket medio", value: formatMoney(ticket) }
        ]}
      />
      <ReportTable
        head={
          <tr>
            <th>Data</th>
            <th className="num">Operacoes</th>
            <th className="num">Peso liquido</th>
            <th className="num">Produto</th>
            <th className="num">Frete</th>
            <th className="num">Total</th>
          </tr>
        }
        foot={
          <tr>
            <td>TOTAL</td>
            <td className="num">{totals.operations.toLocaleString("pt-BR")}</td>
            <td className="num">{formatTons(totals.netWeightKg)}</td>
            <td className="num">{formatMoney(totals.productTotalCents)}</td>
            <td className="num">{formatMoney(totals.freightTotalCents)}</td>
            <td className="num">{formatMoney(totals.totalCents)}</td>
          </tr>
        }
      >
        {series.map((point) => (
          <tr key={point.date} className={point.operations === 0 ? "inactive" : undefined}>
            <td>{formatDayLabel(point.date)}</td>
            <td className="num">{point.operations.toLocaleString("pt-BR")}</td>
            <td className="num">{formatTons(point.netWeightKg)}</td>
            <td className="num">{formatMoney(point.productTotalCents)}</td>
            <td className="num">{formatMoney(point.freightTotalCents)}</td>
            <td className="num">
              <strong>{formatMoney(point.totalCents)}</strong>
            </td>
          </tr>
        ))}
      </ReportTable>
    </>
  );
}
