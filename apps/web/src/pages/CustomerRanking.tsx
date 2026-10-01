import "./customer-ranking.css";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Medal,
  Minus,
  Search,
  Table2,
  Trophy,
  UserX
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Picker } from "../components/Picker";
import {
  Alert,
  EmptyState,
  ErrorState,
  HelpTip,
  LoadMore,
  PageHeader,
  Pill,
  Skeleton,
  SkeletonRows,
  Tabs,
  useShowMore,
  useToast,
  type PillTone
} from "../components/ui";
import { errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  RANKING_MAX_ROWS,
  RANKING_METRIC_OPTIONS,
  RANKING_PERIOD_OPTIONS,
  RANKING_TYPE_OPTIONS,
  buildCustomerRanking,
  customerInfoLine,
  filterRankingRows,
  formatChange,
  formatMetric,
  formatShare,
  loadRankingCustomerInfo,
  loadRankingOperations,
  metricValue,
  movementLabel,
  previousRankingRange,
  rankingFileBase,
  rankingReportHtml,
  rankingSpreadsheetHtml,
  relativeChange,
  resolveRankingRange,
  type AbcClass,
  type CustomerRankingRow,
  type RankingCustomerInfo,
  type RankingExportInput,
  type RankingMetric,
  type RankingPeriod,
  type RankingTypeFilter
} from "../lib/customer-ranking";
import { periodToIso, todayIso } from "../lib/format";
import { formatBRL, formatDayLabel, formatShortDate, formatTonsShort } from "../lib/insights";
import { downloadSpreadsheet, printReportHtml } from "../lib/report-output";
import { useAsync } from "../lib/use-async";
import { useUrlState } from "../lib/url-state";
import { FilterInput, oneOf, usePeriodParams } from "./url-filters";

const HELP =
  "Mostra os clientes que mais compraram no período, do primeiro ao último, e compara com o período anterior: quem subiu, quem caiu, quem é novo e quem parou de comprar. Escolha se a posição vale pelo faturamento, pelo peso ou pelo número de cargas. A classe ABC separa os clientes que somam os primeiros 80% (A), até 95% (B) e o resto (C). Vale a data em que a pesagem FECHOU, a mesma que vai ao OMIE. Clique num cliente para ver os materiais que ele levou.";

const METRIC_HINT: Record<RankingMetric, string> = {
  value: "do faturamento",
  weight: "do peso",
  loads: "das cargas"
};

const ABC_TONE: Record<AbcClass, PillTone> = { A: "success", B: "info", C: "neutral" };
const ABC_HINT: Record<AbcClass, string> = {
  A: "Classe A: os clientes que somam os primeiros 80%",
  B: "Classe B: os que levam a soma de 80% a 95%",
  C: "Classe C: os 5% finais"
};

/** Linhas que a tabela mostra antes do "Ver mais". */
const PAGE = 25;

/** "1 novo", "3 novos". */
function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
}

/** Endereco do relatorio do cliente no mesmo periodo do ranking. */
function customerReportLink(customerId: string, start: string, end: string): string {
  const params = new URLSearchParams({
    cliente: customerId,
    periodo: "custom",
    de: start,
    ate: end
  });
  return `/relatorio-cliente?${params.toString()}`;
}

/**
 * Ranking de clientes (perfil comercial): quem mais comprou no periodo escolhido, com a
 * comparacao contra o periodo anterior, o podio, a curva ABC, os materiais de cada cliente e a
 * lista de quem parou de comprar. As contas moram em `lib/customer-ranking.ts`.
 */
export function CustomerRanking() {
  const user = useUser();
  const toast = useToast();
  const today = todayIso();
  // Periodo e filtros no endereco: voltar pelo menu (ou mandar o link) abre do mesmo jeito.
  const { period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd } =
    usePeriodParams<RankingPeriod>(
      RANKING_PERIOD_OPTIONS.map((option) => option.id),
      "30d",
      today,
      today
    );
  const [metricParam, setMetric] = useUrlState("ordem", "value");
  const metric = oneOf<RankingMetric>(
    metricParam,
    RANKING_METRIC_OPTIONS.map((option) => option.id),
    "value"
  );
  const [typeParam, setType] = useUrlState("tipo", "all");
  const type = oneOf<RankingTypeFilter>(
    typeParam,
    RANKING_TYPE_OPTIONS.map((option) => option.id),
    "all"
  );
  const [productId, setProductId] = useUrlState("produto");
  const [search, setSearch] = useUrlState("busca");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const range = useMemo(
    () => resolveRankingRange(period, customStart, customEnd, today),
    [period, customStart, customEnd, today]
  );
  const previousRange = useMemo(() => previousRankingRange(period, range), [period, range]);
  const iso = useMemo(() => periodToIso(range.start, range.end), [range.start, range.end]);
  const previousIso = useMemo(
    () => periodToIso(previousRange.start, previousRange.end),
    [previousRange.start, previousRange.end]
  );

  // Memoria entre telas: a chave leva a empresa e o intervalo lido.
  const current = useAsync(
    () => loadRankingOperations(user.companyId, iso.startIso, iso.endIso),
    [user.companyId, iso.startIso, iso.endIso],
    { key: `ranking:${user.companyId}:${iso.startIso}:${iso.endIso}` }
  );
  const previous = useAsync(
    () => loadRankingOperations(user.companyId, previousIso.startIso, previousIso.endIso),
    [user.companyId, previousIso.startIso, previousIso.endIso],
    { key: `ranking:${user.companyId}:${previousIso.startIso}:${previousIso.endIso}` }
  );
  const info = useAsync(() => loadRankingCustomerInfo(user.companyId), [user.companyId], {
    key: `ranking:cadastro:${user.companyId}`
  });
  // Pesagem fechada, editada ou cancelada na balanca entra no ranking na hora.
  useOnCadastroChange(current.refresh, CADASTRO_TABLES.operations);
  useOnCadastroChange(previous.refresh, CADASTRO_TABLES.operations);
  useOnCadastroChange(info.refresh, CADASTRO_TABLES.customers);

  // Trocar de periodo pode tirar o produto escolhido da lista; na abertura da tela, nao.
  const rangeKey = `${range.start}|${range.end}`;
  const previousRangeKey = useRef(rangeKey);
  useEffect(() => {
    if (previousRangeKey.current === rangeKey) return;
    previousRangeKey.current = rangeKey;
    if (productId) setProductId("");
    setExpanded(null);
  }, [rangeKey]);

  const loading = current.loading || previous.loading;
  const truncated = Boolean(current.data?.truncated || previous.data?.truncated);
  const ranking = useMemo(
    () =>
      buildCustomerRanking(
        current.data?.rows ?? [],
        previous.data?.rows ?? [],
        { current: range, previous: previousRange },
        metric,
        { productId: productId || null, type }
      ),
    [current.data, previous.data, range, previousRange, metric, productId, type]
  );
  const infoMap = info.data ?? new Map<string, RankingCustomerInfo>();
  const visibleRows = useMemo(
    () => filterRankingRows(ranking.rows, search),
    [ranking.rows, search]
  );
  const resetKey = `${rangeKey}|${metric}|${productId}|${type}|${search}`;
  const rowsPage = useShowMore(resetKey, PAGE);
  const lostPage = useShowMore(resetKey, 10);
  const leaderShare = ranking.rows[0]?.share ?? 0;

  const productName = ranking.products.find((product) => product.id === productId)?.name;
  const filtersLabel = [
    productId ? `Produto: ${productName ?? "selecionado"}` : "",
    type !== "all" ? (RANKING_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? "") : ""
  ]
    .filter(Boolean)
    .join(" · ");

  const totals = ranking.totals;
  const before = ranking.previousTotals;
  const averagePerCustomer =
    totals.customers > 0 ? Math.round(totals.totalCents / totals.customers) : 0;
  const averageBefore = before.customers > 0 ? Math.round(before.totalCents / before.customers) : 0;

  async function exportRanking(kind: "pdf" | "excel") {
    setExporting(kind);
    const input: RankingExportInput = {
      ranking,
      range,
      previousRange,
      metric,
      filtersLabel,
      info: infoMap
    };
    try {
      if (kind === "pdf") {
        await printReportHtml(rankingReportHtml(input), `${rankingFileBase(range)}.pdf`);
      } else {
        downloadSpreadsheet({
          filename: `${rankingFileBase(range)}.xls`,
          html: rankingSpreadsheetHtml(input)
        });
      }
    } catch (caught) {
      toast.push(errorMessage(caught, "Falha ao exportar o ranking."), "error");
    } finally {
      setExporting(null);
    }
  }

  const loadError = current.error ?? previous.error;

  return (
    <section className="ranking">
      <PageHeader
        kicker="Análise"
        title="Ranking de clientes"
        help={HELP}
        description={`${formatDayLabel(range.start)} a ${formatDayLabel(range.end)} · comparado com ${formatDayLabel(
          previousRange.start
        )} a ${formatDayLabel(previousRange.end)} (${previousRange.label.toLowerCase()})`}
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={exporting !== null || loading || ranking.rows.length === 0}
              onClick={() => void exportRanking("pdf")}
            >
              <FileText size={16} strokeWidth={2} />
              {exporting === "pdf" ? "Gerando PDF..." : "Exportar PDF"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={exporting !== null || loading || ranking.rows.length === 0}
              onClick={() => void exportRanking("excel")}
            >
              <Table2 size={16} strokeWidth={2} />
              {exporting === "excel" ? "Gerando Excel..." : "Exportar Excel"}
            </button>
          </>
        }
      />

      <div className="ranking-period">
        <Tabs
          label="Período"
          variant="pill"
          active={period}
          onChange={setPeriod}
          tabs={RANKING_PERIOD_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        />
        {period === "custom" && (
          <div className="ranking-dates">
            <label>
              De
              <FilterInput
                type="date"
                className="input"
                value={customStart}
                max={customEnd || undefined}
                onValue={setCustomStart}
                keepLastValid
              />
            </label>
            <label>
              Até
              <FilterInput
                type="date"
                className="input"
                value={customEnd}
                min={customStart || undefined}
                onValue={setCustomEnd}
                keepLastValid
              />
            </label>
          </div>
        )}
      </div>

      <div className="ranking-filters">
        <div className="ranking-field">
          <span>
            Posição por
            <HelpTip
              text="Faturamento soma produto + frete (o que o cliente paga). Peso soma as toneladas líquidas. Cargas conta as pesagens fechadas."
              label="Sobre a ordem do ranking"
            />
          </span>
          <Tabs
            label="Ordenar o ranking por"
            variant="pill"
            active={metric}
            onChange={(next) => setMetric(next)}
            tabs={RANKING_METRIC_OPTIONS}
          />
        </div>
        <div className="ranking-field">
          Produto
          <Picker
            value={productId}
            options={ranking.products.map((product) => ({
              value: product.id,
              label: product.name
            }))}
            onChange={setProductId}
            placeholder="Todos"
            allowEmpty
            emptyLabel="Todos"
          />
        </div>
        <label className="ranking-field">
          Tipo de venda
          <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
            {RANKING_TYPE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ranking-field ranking-search">
          Buscar cliente
          <span className="ranking-search-box">
            <Search size={16} aria-hidden="true" />
            <FilterInput
              type="search"
              className="input"
              placeholder="Nome do cliente"
              value={search}
              onValue={setSearch}
            />
          </span>
        </label>
      </div>

      {loadError && (
        <ErrorState
          message={loadError}
          onRetry={() => {
            void current.reload();
            void previous.reload();
          }}
        />
      )}
      {truncated && (
        <Alert kind="warn">
          Período com mais de {RANKING_MAX_ROWS.toLocaleString("pt-BR")} vendas — o ranking ficou
          incompleto. Escolha um período menor para ver tudo.
        </Alert>
      )}

      <div className="ranking-kpis">
        <Kpi
          label="Clientes que compraram"
          value={loading ? "-" : totals.customers.toLocaleString("pt-BR")}
          change={loading ? undefined : relativeChange(totals.customers, before.customers)}
          hint={
            loading
              ? ""
              : `${plural(ranking.newCustomers, "novo", "novos")} · ${plural(
                  ranking.lost.length,
                  "parou",
                  "pararam"
                )}`
          }
        />
        <Kpi
          label="Faturamento"
          value={loading ? "-" : formatBRL(totals.totalCents)}
          change={loading ? undefined : relativeChange(totals.totalCents, before.totalCents)}
          hint={loading ? "" : `Antes: ${formatBRL(before.totalCents)}`}
        />
        <Kpi
          label="Peso vendido"
          value={loading ? "-" : formatTonsShort(totals.weightKg)}
          change={loading ? undefined : relativeChange(totals.weightKg, before.weightKg)}
          hint={loading ? "" : `Antes: ${formatTonsShort(before.weightKg)}`}
        />
        <Kpi
          label="Cargas"
          value={loading ? "-" : totals.loads.toLocaleString("pt-BR")}
          change={loading ? undefined : relativeChange(totals.loads, before.loads)}
          hint={loading ? "" : `Antes: ${before.loads.toLocaleString("pt-BR")}`}
        />
        <Kpi
          label="Média por cliente"
          value={loading ? "-" : formatBRL(averagePerCustomer)}
          change={loading ? undefined : relativeChange(averagePerCustomer, averageBefore)}
          hint={loading ? "" : `Antes: ${formatBRL(averageBefore)}`}
        />
        <Kpi
          label="Concentração"
          value={loading ? "-" : formatShare(ranking.top10Share)}
          hint={loading ? "" : `${METRIC_HINT[metric]} vem dos 10 maiores`}
          note={
            loading
              ? ""
              : `Curva ABC: A ${ranking.abcCounts.A} · B ${ranking.abcCounts.B} · C ${ranking.abcCounts.C}`
          }
        />
      </div>

      {loading && ranking.rows.length === 0 ? (
        <div className="ranking-podium" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={132} radius={14} />
          ))}
        </div>
      ) : ranking.rows.length > 0 ? (
        <ol className="ranking-podium" aria-label="Os três primeiros">
          {ranking.rows.slice(0, 3).map((row) => (
            <PodiumCard
              key={row.key}
              row={row}
              metric={metric}
              place={customerInfoLine(row.customerId ? infoMap.get(row.customerId) : undefined)}
            />
          ))}
        </ol>
      ) : null}

      <article className="ranking-card">
        <header className="ranking-card-head">
          <h2>Todos os clientes</h2>
          <span>
            {loading
              ? "Carregando..."
              : search
                ? `${visibleRows.length.toLocaleString("pt-BR")} de ${ranking.rows.length.toLocaleString("pt-BR")} clientes`
                : `${ranking.rows.length.toLocaleString("pt-BR")} clientes · ${range.label}`}
          </span>
        </header>
        {loading && ranking.rows.length === 0 ? (
          <SkeletonRows rows={8} columns={7} />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            title={
              search
                ? "Nenhum cliente com esse nome no ranking."
                : "Nenhuma venda concluída no período com os filtros escolhidos."
            }
          />
        ) : (
          <>
            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th className="ranking-col-pos">#</th>
                    <th className="is-text">Cliente</th>
                    <th className="hide-phone">Classe</th>
                    <th className="hide-phone">Cargas</th>
                    <th className="hide-phone">Peso</th>
                    <th>Faturamento</th>
                    <th className="ranking-col-share hide-phone">Participação</th>
                    <th className="hide-phone">Preço médio</th>
                    <th className="hide-phone">Última compra</th>
                    <th className="hide-phone">Vs. anterior</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, rowsPage.limit).map((row) => {
                    const open = expanded === row.key;
                    const details = customerInfoLine(
                      row.customerId ? infoMap.get(row.customerId) : undefined
                    );
                    return (
                      <Fragment key={row.key}>
                        <tr
                          className={`ranking-row${open ? " open" : ""}`}
                          onClick={() => setExpanded(open ? null : row.key)}
                        >
                          <td className="ranking-col-pos">
                            <span className={`ranking-pos pos-${Math.min(row.position, 4)}`}>
                              {row.position}
                            </span>
                            <Movement movement={row.movement} />
                          </td>
                          <td className="is-text">
                            <button
                              type="button"
                              className="ranking-name"
                              aria-expanded={open}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpanded(open ? null : row.key);
                              }}
                            >
                              {open ? (
                                <ChevronDown size={16} aria-hidden="true" />
                              ) : (
                                <ChevronRight size={16} aria-hidden="true" />
                              )}
                              <strong>{row.name}</strong>
                            </button>
                            <span className="ranking-sub">
                              {[details, row.mainProduct ? `Mais leva: ${row.mainProduct}` : ""]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {/* No celular as colunas de numero somem; o essencial vem aqui. */}
                            <span className="ranking-sub show-phone">
                              Classe {row.abc} · {plural(row.loads, "carga", "cargas")} ·{" "}
                              {formatTonsShort(row.weightKg)} · {formatShare(row.share)}
                            </span>
                          </td>
                          <td className="hide-phone">
                            <Pill tone={ABC_TONE[row.abc]} title={ABC_HINT[row.abc]}>
                              {row.abc}
                            </Pill>
                          </td>
                          <td className="hide-phone">{row.loads.toLocaleString("pt-BR")}</td>
                          <td className="hide-phone">{formatTonsShort(row.weightKg)}</td>
                          <td>
                            <strong>{formatBRL(row.totalCents)}</strong>
                            <span className="show-phone">
                              <Change change={row.change} isNew={row.previous === null} />
                            </span>
                          </td>
                          <td className="ranking-col-share hide-phone">
                            <span className="ranking-share">
                              <span
                                className="ranking-share-bar"
                                style={{
                                  width: `${leaderShare > 0 ? Math.max(2, (row.share / leaderShare) * 100) : 0}%`
                                }}
                              />
                            </span>
                            <span className="ranking-share-text">{formatShare(row.share)}</span>
                          </td>
                          <td className="hide-phone">
                            {row.avgPriceCentsPerTon > 0
                              ? `${formatBRL(row.avgPriceCentsPerTon)}/t`
                              : "—"}
                          </td>
                          <td className="hide-phone">{formatShortDate(row.lastDay)}</td>
                          <td className="hide-phone">
                            <Change change={row.change} isNew={row.previous === null} />
                          </td>
                        </tr>
                        {open && (
                          <tr className="ranking-detail">
                            <td colSpan={10}>
                              <CustomerDetail
                                row={row}
                                metric={metric}
                                reportLink={
                                  row.customerId
                                    ? customerReportLink(row.customerId, range.start, range.end)
                                    : null
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                {!search && (
                  <tfoot>
                    <tr>
                      <td />
                      <td className="is-text">
                        <strong>Total · {totals.customers.toLocaleString("pt-BR")} clientes</strong>
                      </td>
                      <td className="hide-phone" />
                      <td className="hide-phone">
                        <strong>{totals.loads.toLocaleString("pt-BR")}</strong>
                      </td>
                      <td className="hide-phone">
                        <strong>{formatTonsShort(totals.weightKg)}</strong>
                      </td>
                      <td>
                        <strong>{formatBRL(totals.totalCents)}</strong>
                      </td>
                      <td className="ranking-col-share hide-phone">
                        <strong>100%</strong>
                      </td>
                      <td className="hide-phone" />
                      <td className="hide-phone" />
                      <td className="hide-phone">
                        <Change
                          change={relativeChange(
                            metricValue(totals, metric),
                            metricValue(before, metric)
                          )}
                          isNew={false}
                        />
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <LoadMore
              shown={Math.min(rowsPage.limit, visibleRows.length)}
              total={visibleRows.length}
              onMore={rowsPage.more}
              step={PAGE}
            />
          </>
        )}
      </article>

      <article className="ranking-card">
        <header className="ranking-card-head">
          <h2>
            <UserX size={18} aria-hidden="true" />
            Pararam de comprar
          </h2>
          <span>
            Compraram de {formatShortDate(previousRange.start)} a{" "}
            {formatShortDate(previousRange.end)} e não compraram agora
          </span>
        </header>
        {loading && ranking.lost.length === 0 ? (
          <SkeletonRows rows={3} columns={5} />
        ) : ranking.lost.length === 0 ? (
          <EmptyState
            icon={null}
            title="Nenhum cliente parou de comprar."
            hint="Todo mundo que comprou no período anterior voltou a comprar neste."
          />
        ) : (
          <>
            <div className="ranking-table-wrap">
              <table className="ranking-table ranking-lost">
                <thead>
                  <tr>
                    <th>Posição antes</th>
                    <th className="is-text">Cliente</th>
                    <th className="hide-phone">Cargas</th>
                    <th className="hide-phone">Peso</th>
                    <th>Faturamento</th>
                    <th className="hide-phone">Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.lost.slice(0, lostPage.limit).map((lost) => (
                    <tr key={lost.key}>
                      <td>{lost.previousPosition}º</td>
                      <td className="is-text">
                        {lost.customerId ? (
                          <Link
                            to={customerReportLink(
                              lost.customerId,
                              previousRange.start,
                              previousRange.end
                            )}
                            title="Abrir o relatório do cliente no período anterior"
                          >
                            {lost.name}
                          </Link>
                        ) : (
                          lost.name
                        )}
                        <span className="ranking-sub">
                          {customerInfoLine(
                            lost.customerId ? infoMap.get(lost.customerId) : undefined
                          )}
                        </span>
                        <span className="ranking-sub show-phone">
                          {plural(lost.loads, "carga", "cargas")} · última em{" "}
                          {formatDayLabel(lost.lastDay)}
                        </span>
                      </td>
                      <td className="hide-phone">{lost.loads.toLocaleString("pt-BR")}</td>
                      <td className="hide-phone">{formatTonsShort(lost.weightKg)}</td>
                      <td>{formatBRL(lost.totalCents)}</td>
                      <td className="hide-phone">{formatDayLabel(lost.lastDay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LoadMore
              shown={Math.min(lostPage.limit, ranking.lost.length)}
              total={ranking.lost.length}
              onMore={lostPage.more}
              step={10}
            />
          </>
        )}
      </article>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  note,
  change
}: {
  label: string;
  value: string;
  hint: string;
  /** Segunda linha de explicacao, embaixo da dica. */
  note?: string;
  /** `undefined` = sem comparacao (carregando ou indicador que nao compara). */
  change?: number | null;
}) {
  return (
    <article className="ranking-kpi">
      <p className="ranking-kpi-label">{label}</p>
      <p className="ranking-kpi-value">{value}</p>
      {change !== undefined && <Change change={change} isNew={false} suffix="vs. anterior" />}
      {hint && <p className="ranking-kpi-hint">{hint}</p>}
      {note && <p className="ranking-kpi-hint">{note}</p>}
    </article>
  );
}

/** Variacao com seta: verde subindo, vermelho caindo, cinza parado ou sem base. */
function Change({
  change,
  isNew,
  suffix
}: {
  change: number | null;
  isNew: boolean;
  suffix?: string;
}) {
  if (isNew) {
    return <span className="ranking-change new">Novo</span>;
  }
  if (change === null) {
    return <span className="ranking-change flat">Sem base</span>;
  }
  const flat = Math.abs(change) < 0.0005;
  const tone = flat ? "flat" : change > 0 ? "up" : "down";
  const Icon = flat ? Minus : change > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`ranking-change ${tone}`}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      {formatChange(change)}
      {suffix && <span className="ranking-change-suffix">{suffix}</span>}
    </span>
  );
}

/** Quantas posicoes o cliente ganhou ou perdeu desde o periodo anterior. */
function Movement({ movement }: { movement: number | null }) {
  const label = movementLabel(movement);
  if (movement === null) {
    return (
      <span className="ranking-move new" title="Não comprou no período anterior">
        novo
      </span>
    );
  }
  if (movement === 0) {
    return (
      <span className="ranking-move flat" title={label}>
        <Minus size={11} aria-hidden="true" />
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span className={`ranking-move ${up ? "up" : "down"}`} title={label}>
      {up ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
      {Math.abs(movement)}
    </span>
  );
}

function PodiumCard({
  row,
  metric,
  place
}: {
  row: CustomerRankingRow;
  metric: RankingMetric;
  place: string;
}) {
  const Icon = row.position === 1 ? Trophy : Medal;
  return (
    <li className={`ranking-podium-card place-${row.position}`}>
      <div className="ranking-podium-top">
        <span className="ranking-podium-medal" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span className="ranking-podium-place">{row.position}º lugar</span>
        <Movement movement={row.movement} />
      </div>
      <strong className="ranking-podium-name" title={row.name}>
        {row.name}
      </strong>
      {place && <span className="ranking-sub">{place}</span>}
      <span className="ranking-podium-value">{formatMetric(metricValue(row, metric), metric)}</span>
      <span className="ranking-podium-meta">
        {formatShare(row.share)} {METRIC_HINT[metric]} · {row.loads.toLocaleString("pt-BR")}{" "}
        {row.loads === 1 ? "carga" : "cargas"} · {formatTonsShort(row.weightKg)}
      </span>
    </li>
  );
}

function CustomerDetail({
  row,
  metric,
  reportLink
}: {
  row: CustomerRankingRow;
  metric: RankingMetric;
  reportLink: string | null;
}) {
  return (
    <div className="ranking-detail-body">
      <dl className="ranking-facts">
        <div>
          <dt>Valor do produto</dt>
          <dd>{formatBRL(row.productCents)}</dd>
        </div>
        <div>
          <dt>Frete</dt>
          <dd>{formatBRL(row.freightCents)}</dd>
        </div>
        <div>
          <dt>Ticket por carga</dt>
          <dd>{formatBRL(row.ticketCents)}</dd>
        </div>
        <div>
          <dt>Dias com compra</dt>
          <dd>{row.activeDays.toLocaleString("pt-BR")}</dd>
        </div>
        <div>
          <dt>Primeira / última compra</dt>
          <dd>
            {formatDayLabel(row.firstDay)} · {formatDayLabel(row.lastDay)}
          </dd>
        </div>
        <div>
          <dt>Período anterior</dt>
          <dd>
            {row.previous
              ? `${row.previous.position}º · ${formatMetric(metricValue(row.previous, metric), metric)}`
              : "Não comprou"}
          </dd>
        </div>
        <div>
          <dt>Acumulado até ele</dt>
          <dd>{formatShare(row.cumulativeShare)}</dd>
        </div>
      </dl>
      <table className="ranking-products">
        <thead>
          <tr>
            <th className="is-text">Material</th>
            <th>Cargas</th>
            <th>Peso</th>
            <th>Faturamento</th>
            <th>% do peso</th>
          </tr>
        </thead>
        <tbody>
          {row.products.map((product) => (
            <tr key={product.key}>
              <td className="is-text">{product.name}</td>
              <td>{product.loads.toLocaleString("pt-BR")}</td>
              <td>{formatTonsShort(product.weightKg)}</td>
              <td>{formatBRL(product.totalCents)}</td>
              <td>{formatShare(row.weightKg > 0 ? product.weightKg / row.weightKg : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reportLink && (
        <Link className="btn small" to={reportLink}>
          Abrir relatório do cliente
        </Link>
      )}
    </div>
  );
}
