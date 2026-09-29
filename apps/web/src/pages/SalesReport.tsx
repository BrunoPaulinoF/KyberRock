import "./reports.css";

import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Download,
  Eye,
  Info,
  Printer,
  Table2,
  Users
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CustomerInfoModal, CustomerWeighingsModal } from "../components/CustomerPanels";
import { DeskPanel, SectionHead } from "../components/desk";
import { Picker } from "../components/Picker";
import {
  Alert,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  Tabs,
  type TabItem
} from "../components/ui";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { sumWeighings, type CustomerRef } from "../lib/customer-weighings";
import { invoiceNumberLabel } from "../lib/desktop/invoice-number-label";
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
  saleInstant,
  salesPivot,
  sumLines,
  sumSeries,
  type ReportLine,
  type ReportOperation,
  type PeriodPreset,
  type ReportTotals,
  type SalesFreightFilter,
  type SalesPivotGroupBy
} from "../lib/reports";
import { useAsync } from "../lib/use-async";
import { useUrlState } from "../lib/url-state";
import { ReportRecipients } from "./ReportRecipients";
import { FilterInput, isoDayOr, isoMonthOr, usePeriodParams } from "./url-filters";

type ReportTab = "daily" | "period" | "pivot" | "monthly" | "recipients";

const TABS: Array<TabItem<ReportTab>> = [
  { id: "daily", label: "Fechamento diário", icon: CalendarDays },
  { id: "period", label: "Carregamentos do período", icon: CalendarRange },
  { id: "pivot", label: "Tabela dinâmica de vendas", icon: Table2 },
  { id: "monthly", label: "Relatório mensal", icon: CalendarClock }
];

/** Quem recebe o fechamento diario: so quem grava (gestor, operacao, administrador) ve e edita. */
const RECIPIENTS_TAB: TabItem<ReportTab> = {
  id: "recipients",
  label: "Destinatários",
  icon: Users
};

const TAB_DESCRIPTION: Record<ReportTab, string> = {
  daily: "As vendas do dia, pesagem a pesagem — o mesmo fechamento que a balança envia.",
  period: "Cada carregamento do período, com o valor por tonelada do material e do frete.",
  pivot:
    "Vendas agrupadas por cliente, produto ou dia. Clique no cliente para ver as pesagens; o olho (Info) mostra o cadastro e o preço médio.",
  monthly: "Total do mês e a evolução dia a dia.",
  recipients: "Quem recebe o fechamento diário por e-mail ou WhatsApp."
};

/** O que abre ao clicar num cliente: as pesagens dele ou o cartao Info. */
interface CustomerPanel {
  kind: "weighings" | "info";
  customer: CustomerRef;
}

/** Cliente clicavel so quando da para acha-lo: com cadastro ou, sem cadastro, com nome. */
function customerRef(id: string | null, name: string | null): CustomerRef | null {
  if (id) return { id, name: name || "Cliente" };
  if (name && name !== "N/A") return { id: null, name };
  return null;
}

function belongsTo(op: ReportOperation, customer: CustomerRef): boolean {
  return customer.id
    ? op.customer_id === customer.id
    : !op.customer_id && op.customer_name === customer.name;
}

/** Nome do cliente que abre as pesagens dele. */
function CustomerName({
  id,
  name,
  onOpen
}: {
  id: string | null;
  name: string | null;
  onOpen: (customer: CustomerRef) => void;
}) {
  const ref = customerRef(id, name);
  if (!ref) return <strong>{name ?? "N/A"}</strong>;
  return (
    <button
      type="button"
      className="report-customer"
      title="Ver as pesagens deste cliente"
      onClick={() => onOpen(ref)}
    >
      {name}
    </button>
  );
}

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

/**
 * O `?aba=` de cada aba; o fechamento diario e a padrao (sem `aba`). `?aba=vendas` abre direto a
 * tabela dinamica (a entrada do comercial, que vinha do portal).
 */
const TAB_PARAM: Record<ReportTab, string> = {
  daily: "",
  period: "periodo",
  pivot: "vendas",
  monthly: "mensal",
  recipients: "destinatarios"
};

function tabFromParam(param: string, canSeeRecipients: boolean): ReportTab {
  if (param === "vendas" || param === "pivot") return "pivot";
  if (param === "periodo") return "period";
  if (param === "mensal") return "monthly";
  if (param === "destinatarios" && canSeeRecipients) return "recipients";
  return "daily";
}

/** Os atalhos de periodo e o "custom" (datas digitadas em De/Ate), no `?periodo=`. */
type SalesPeriod = PeriodPreset | "custom";
const SALES_PERIODS: readonly SalesPeriod[] = [
  ...PERIOD_PRESETS.map((preset) => preset.id),
  "custom"
];

/**
 * Relatorios e fechamento diario: as contas de `services/reports.ts` do desktop, sobre a nuvem.
 * A tabela dinamica tambem e o antigo "Relatorio de vendas" do portal do comercial (atalhos de
 * periodo, filtro de frete, produto + frete + total), que deixou o portal e mora aqui.
 */
export function SalesReport() {
  const user = useUser();
  const today = todayIso();
  // Aba, dia, mes, periodo, cliente e produto ficam no endereco e voltam quando a pessoa sai e
  // volta pelo menu (`useUrlState`).
  const [tabParam, setTabParam] = useUrlState("aba");
  const tab = tabFromParam(tabParam, user.canManagePrices);
  const setTab = (next: ReportTab) => setTabParam(TAB_PARAM[next]);
  const [freight, setFreight] = useState<SalesFreightFilter>("all");
  const [dayParam, setDay] = useUrlState("dia", today);
  const day = isoDayOr(dayParam, today);
  const periodParams = usePeriodParams(SALES_PERIODS, "month", firstDayOfMonth(today), today);
  const preset = periodParams.period;
  const presetDates = preset === "custom" ? null : presetRange(preset, today);
  const start = presetDates?.start ?? periodParams.customStart;
  const end = presetDates?.end ?? periodParams.customEnd;
  const [monthParam, setMonth] = useUrlState("mes", today.slice(0, 7));
  const month = isoMonthOr(monthParam, today.slice(0, 7));
  const [unitId, setUnitId] = useState("");
  const [groupBy, setGroupBy] = useState<SalesPivotGroupBy>("customer");
  const [customerId, setCustomerId] = useUrlState("cliente");
  const [productId, setProductId] = useUrlState("produto");
  const [panel, setPanel] = useState<CustomerPanel | null>(null);

  /** Digitar uma data sai do atalho: vira "personalizado", a partir das datas que estavam na tela. */
  function changeStart(next: string): void {
    if (preset !== "custom" && periodParams.customEnd !== end) periodParams.setCustomEnd(end);
    periodParams.setCustomStart(next);
    if (preset !== "custom") periodParams.setPeriod("custom");
  }
  function changeEnd(next: string): void {
    if (preset !== "custom" && periodParams.customStart !== start) {
      periodParams.setCustomStart(start);
    }
    periodParams.setCustomEnd(next);
    if (preset !== "custom") periodParams.setPeriod("custom");
  }

  const range = useMemo(() => {
    if (tab === "daily") return { start: day, end: day };
    if (tab === "monthly") return monthRange(month);
    return { start, end };
  }, [tab, day, month, start, end]);
  const period = useMemo(() => periodToIso(range.start, range.end), [range.start, range.end]);
  const validRange = Boolean(range.start && range.end && range.start <= range.end);

  const units = useAsync(() => reportUnits(user.companyId), [user.companyId], {
    key: `relatorios:unidades:${user.companyId}`
  });
  const ops = useAsync(
    () =>
      validRange
        ? q.closedOperations(user.companyId, period.startIso, period.endIso)
        : Promise.resolve([]),
    [user.companyId, period.startIso, period.endIso, validRange],
    // Unidade, cliente, produto e frete filtram na tela: a leitura e so empresa + periodo.
    {
      key: validRange
        ? `relatorios:pesagens:${user.companyId}:${period.startIso}:${period.endIso}`
        : null
    }
  );
  // Pesagem fechada, editada ou cancelada na balanca entra na tela na hora.
  useOnCadastroChange(ops.refresh, CADASTRO_TABLES.operations);
  const operations = useMemo(() => filterByUnit(ops.data ?? [], unitId), [ops.data, unitId]);

  // Trocar de periodo pode invalidar os filtros escolhidos (como no desktop). Na abertura da tela
  // nao: o cliente e o produto que vieram no endereco (ou lembrados) continuam valendo.
  const rangeKey = `${range.start}|${range.end}`;
  const previousRange = useRef(rangeKey);
  useEffect(() => {
    if (previousRange.current === rangeKey) return;
    previousRange.current = rangeKey;
    if (customerId) setCustomerId("");
    if (productId) setProductId("");
  }, [rangeKey]);

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
  const openWeighings = (customer: CustomerRef) => setPanel({ kind: "weighings", customer });
  const openInfo = (customer: CustomerRef) => setPanel({ kind: "info", customer });
  const panelOps = useMemo(
    () => (panel ? operations.filter((op) => belongsTo(op, panel.customer)) : []),
    [operations, panel]
  );

  return (
    <DeskPanel>
      <div className="reports-page">
        <PageHeader
          kicker="Análise"
          title="Relatórios"
          description="Fechamento diário, carregamentos do período, vendas por cliente e produto e o relatório mensal."
          actions={
            tab === "recipients" ? undefined : (
              <>
                <button type="button" className="btn" onClick={() => window.print()}>
                  <Printer size={16} aria-hidden="true" />
                  Imprimir
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={exportCsv}
                  disabled={ops.loading || !hasData}
                >
                  <Download size={15} />
                  Baixar CSV
                </button>
              </>
            )
          }
        />

        <div className="reports-no-print">
          <Tabs
            label="Relatórios"
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
                  <FilterInput
                    className="input"
                    type="date"
                    value={day}
                    onValue={setDay}
                    keepLastValid
                  />
                </label>
              )}
              {(tab === "period" || tab === "pivot") && (
                <>
                  <div className="reports-presets" role="group" aria-label="Atalhos de período">
                    {PERIOD_PRESETS.map((option) => {
                      const active = preset === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`reports-preset${active ? " active" : ""}`}
                          aria-pressed={active}
                          onClick={() => periodParams.setPeriod(option.id)}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <label className="op-filter">
                    De
                    <FilterInput
                      className="input"
                      type="date"
                      value={start}
                      onValue={changeStart}
                      keepLastValid
                    />
                  </label>
                  <label className="op-filter">
                    Até
                    <FilterInput
                      className="input"
                      type="date"
                      value={end}
                      onValue={changeEnd}
                      keepLastValid
                    />
                  </label>
                </>
              )}
              {tab === "monthly" && (
                <label className="op-filter">
                  Mês
                  <FilterInput
                    className="input"
                    type="month"
                    value={month}
                    onValue={setMonth}
                    keepLastValid
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
            </div>

            {!validRange && (
              <Alert kind="error">A data inicial precisa ser anterior à final.</Alert>
            )}

            {ops.error ? (
              <ErrorState message={ops.error} onRetry={() => void ops.reload()} />
            ) : ops.loading ? (
              <SkeletonRows rows={6} columns={6} />
            ) : (
              <>
                {tab === "daily" && (
                  <DailyReport lines={lines} totals={totals} onCustomer={openWeighings} />
                )}
                {tab === "period" && (
                  <PeriodReport lines={lines} totals={totals} onCustomer={openWeighings} />
                )}
                {tab === "pivot" && (
                  <PivotReport
                    pivot={pivot}
                    groupBy={groupBy}
                    onCustomer={openWeighings}
                    onInfo={openInfo}
                  />
                )}
                {tab === "monthly" && <MonthlyReport series={series} totals={monthTotals} />}
              </>
            )}

            <p className="reports-note reports-no-print">
              <Info size={14} />
              Período pela data de FECHAMENTO da pesagem (a mesma que o OMIE usa na nota). Os
              destinatários ficam na aba Destinatários (gestor); o horário dos envios automáticos e
              os canais (e-mail e WhatsApp) são configurados na tela Relatórios da balança.
            </p>
          </>
        )}

        {panel?.kind === "weighings" && (
          <CustomerWeighingsModal
            customer={panel.customer}
            start={range.start}
            end={range.end}
            unitId={unitId}
            onInfo={() => openInfo(panel.customer)}
            onClose={() => setPanel(null)}
          />
        )}
        {panel?.kind === "info" && (
          <CustomerInfoModal
            customer={panel.customer}
            summary={{
              periodLabel,
              totals: sumWeighings(panelOps),
              lastSale: panelOps.reduce<string | null>((last, op) => {
                const instant = saleInstant(op);
                return !last || instant > last ? instant : last;
              }, null)
            }}
            onWeighings={() => openWeighings(panel.customer)}
            onClose={() => setPanel(null)}
          />
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
  totals,
  onCustomer
}: {
  lines: ReportLine[];
  totals: ReportTotals;
  onCustomer: (customer: CustomerRef) => void;
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
              <th>Nota fiscal</th>
              <th className="num">Peso líquido (kg)</th>
              <th className="num">Valor produto</th>
              <th className="num">Frete</th>
              <th className="num">Total</th>
            </tr>
          }
          foot={
            <tr>
              <td colSpan={3}>TOTAL</td>
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
                <CustomerName id={line.customerId} name={line.customerName} onOpen={onCustomer} />
              </td>
              <td>{line.productDescription}</td>
              <td>
                <InvoiceCell line={line} />
              </td>
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

/** A nota da pesagem: o numero, "Sem nota" (venda com nota ainda sem numero) ou "—" (interna). */
function InvoiceCell({ line }: { line: Pick<ReportLine, "invoiceNumber" | "operationType"> }) {
  const label = invoiceNumberLabel(line.invoiceNumber, line.operationType);
  return (
    <span
      className={label.state === "number" ? "report-nf" : "report-nf muted"}
      title={label.title ?? undefined}
    >
      {label.state === "number" ? `NF ${label.text}` : label.text}
    </span>
  );
}

function PeriodReport({
  lines,
  totals,
  onCustomer
}: {
  lines: ReportLine[];
  totals: ReportTotals;
  onCustomer: (customer: CustomerRef) => void;
}) {
  return (
    <>
      <Kpis items={totalsKpis(totals)} />
      {lines.length === 0 ? (
        <EmptyState title="Nenhum carregamento no período." />
      ) : (
        <ReportTable
          head={
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Produto</th>
              <th>Nota fiscal</th>
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
              <td colSpan={4}>TOTAL</td>
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
                <CustomerName id={line.customerId} name={line.customerName} onOpen={onCustomer} />
              </td>
              <td>{line.productDescription}</td>
              <td>
                <InvoiceCell line={line} />
              </td>
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
  groupBy,
  onCustomer,
  onInfo
}: {
  pivot: ReturnType<typeof salesPivot>;
  groupBy: SalesPivotGroupBy;
  onCustomer: (customer: CustomerRef) => void;
  onInfo: (customer: CustomerRef) => void;
}) {
  const columns = pivotGroupColumns(groupBy);
  // Linha de cliente troca o preco medio pelo olho (Info): o medio passa a morar no cartao.
  const byCustomer = columns.includes("customer");
  return (
    <>
      <Kpis
        items={[
          { label: "Operações", value: pivot.totals.totalOperations.toLocaleString("pt-BR") },
          { label: "Quantidade", value: formatTons(pivot.totals.totalWeightKg) },
          { label: "Preço médio", value: `${formatMoney(pivot.totals.avgPriceCentsPerTon)}/t` },
          { label: "Valor produto", value: formatMoney(pivot.totals.totalValueCents) },
          { label: "Frete", value: formatMoney(pivot.totals.freightCents) },
          { label: "Total", value: formatMoney(pivot.totals.grandTotalCents) }
        ]}
      />
      {pivot.rows.length === 0 ? (
        <EmptyState title="Sem vendas no período com os filtros selecionados." />
      ) : (
        <ReportTable
          head={
            <tr>
              {columns.includes("day") && <th>Dia</th>}
              {columns.includes("customer") && <th>Cliente</th>}
              {columns.includes("product") && <th>Produto</th>}
              <th className="num">Operações</th>
              <th className="num">Quantidade</th>
              {byCustomer ? (
                <th className="report-info-col">Info</th>
              ) : (
                <th className="num">Preço médio</th>
              )}
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
              {byCustomer ? (
                <td />
              ) : (
                <td className="num">{formatMoney(pivot.totals.avgPriceCentsPerTon)}/t</td>
              )}
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
                  <CustomerName id={row.customerId} name={row.customerName} onOpen={onCustomer} />
                </td>
              )}
              {columns.includes("product") && <td>{row.productDescription ?? "N/A"}</td>}
              <td className="num">{row.totalOperations.toLocaleString("pt-BR")}</td>
              <td className="num">{formatTons(row.totalWeightKg)}</td>
              {byCustomer ? (
                <td className="report-info-col">
                  <InfoButton
                    customer={customerRef(row.customerId, row.customerName)}
                    onInfo={onInfo}
                  />
                </td>
              ) : (
                <td className="num">{formatMoney(row.avgPriceCentsPerTon)}/t</td>
              )}
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

/** O botao de olho da tabela dinamica: abre o cartao com o cadastro do cliente. */
function InfoButton({
  customer,
  onInfo
}: {
  customer: CustomerRef | null;
  onInfo: (customer: CustomerRef) => void;
}) {
  if (!customer) return <span className="reports-muted">—</span>;
  return (
    <button
      type="button"
      className="btn small report-info-btn"
      title="Ver as informações do cliente"
      aria-label={`Info de ${customer.name}`}
      onClick={() => onInfo(customer)}
    >
      <Eye size={14} />
      Info
    </button>
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
          { label: "Operações", value: totals.operations.toLocaleString("pt-BR") },
          { label: "Peso líquido", value: formatTons(totals.netWeightKg) },
          { label: "Produto", value: formatMoney(totals.productTotalCents) },
          { label: "Frete", value: formatMoney(totals.freightTotalCents) },
          { label: "Total", value: formatMoney(totals.totalCents) },
          { label: "Ticket médio", value: formatMoney(ticket) }
        ]}
      />
      <ReportTable
        head={
          <tr>
            <th>Data</th>
            <th className="num">Operações</th>
            <th className="num">Peso líquido</th>
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
