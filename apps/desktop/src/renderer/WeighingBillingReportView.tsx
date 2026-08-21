import { useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { CustomerReportOption } from "../services/customer-report";
import {
  WEIGHING_BILLING_SITUATIONS,
  WEIGHING_BILLING_SITUATION_LABEL
} from "../services/weighing-billing-situation";
import type { WeighingBillingSituation } from "../services/weighing-billing-situation";
import type {
  WeighingBillingReport,
  WeighingBillingRow
} from "../services/weighing-billing-report";
import { IconActionButton } from "./IconActionButton";
import { SituationPill } from "./SituationPill";
import { HelpTooltip } from "./Tooltip";
import { formatDbDateTime } from "./format-datetime";
import {
  INSIGHTS_PERIOD_OPTIONS,
  formatDayLabel,
  resolveInsightsRange,
  toIsoDate
} from "./insights-period";
import type { InsightsPeriod } from "./insights-period";

/**
 * Conferencia de faturamento: a lista PESAGEM A PESAGEM do periodo — cliente, data,
 * produto, peso, frete e total — com a situacao de cada uma no OMIE ao lado.
 *
 * A tela existe para responder "o que a balanca fechou foi faturado certinho?". Por isso
 * ela nao resume nada: os cartoes no topo servem so para dizer QUANTO ainda nao foi
 * faturado, e o trabalho de verdade acontece na tabela, filtrando por situacao e
 * comparando linha a linha com o relatorio do OMIE. O PDF e a planilha saem com
 * exatamente as pesagens que estao na tela.
 */

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
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

function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

function unitPriceLabel(row: WeighingBillingRow): string {
  if (row.unitPriceCents === null) return "-";
  return `${formatBRL(row.unitPriceCents)}/${row.priceUnit === "kg" ? "kg" : "t"}`;
}

/**
 * Numero pelo qual a pesagem e procurada no OMIE. Quando o numero VISIVEL do documento ja
 * foi conferido la, ele vem junto entre parenteses: o codigo grande e o da integracao, e
 * digitar ele na busca do OMIE nao acha nada.
 */
function omieReference(row: WeighingBillingRow): string {
  const visible = row.omieOrderNumber ? ` (nº ${row.omieOrderNumber})` : "";
  if (row.omieSalesOrderId) return `Pedido ${row.omieSalesOrderId}${visible}`;
  if (row.omieServiceOrderId) return `OS ${row.omieServiceOrderId}${visible}`;
  return "-";
}

const ALL_CUSTOMERS = "";

export function WeighingBillingReportView({
  desktopApi
}: {
  desktopApi: KyberRockDesktopApi | null;
}) {
  const [customers, setCustomers] = useState<CustomerReportOption[]>([]);
  const [customerId, setCustomerId] = useState(ALL_CUSTOMERS);
  const [period, setPeriod] = useState<InsightsPeriod>("month");
  const [customStart, setCustomStart] = useState(() => toIsoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => toIsoDate(new Date()));
  const [situations, setSituations] = useState<WeighingBillingSituation[]>([]);
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<WeighingBillingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [formats, setFormats] = useState<{ pdf: boolean; excel: boolean }>({
    pdf: false,
    excel: true
  });

  const range = useMemo(
    () => resolveInsightsRange(period, customStart, customEnd, new Date()),
    [period, customStart, customEnd]
  );

  const selectedFormats = useMemo(
    () => (["pdf", "excel"] as const).filter((format) => formats[format]) as Array<"pdf" | "excel">,
    [formats]
  );

  // Os filtros que vao para a consulta e para o arquivo. `search` entra com debounce na
  // dependencia do efeito, mas o objeto e o mesmo dos dois lados de proposito: o PDF/planilha
  // precisa sair com as MESMAS linhas que estao na tela.
  const options = useMemo(
    () => ({
      customerId: customerId || null,
      situations,
      search: search.trim() || null,
      periodLabel: range.label
    }),
    [customerId, situations, search, range.label]
  );

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .listCustomerReportCustomers()
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar clientes.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  const loadReport = useCallback(async () => {
    if (!desktopApi) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await desktopApi.getWeighingBillingReport(range.start, range.end, options));
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Falha ao carregar a conferencia.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi, range.start, range.end, options]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function toggleSituation(situation: WeighingBillingSituation): void {
    setSituations((current) =>
      current.includes(situation)
        ? current.filter((item) => item !== situation)
        : [...current, situation]
    );
  }

  async function handleExport(): Promise<void> {
    if (!desktopApi) return;
    if (selectedFormats.length === 0) {
      setExportMessage("Selecione ao menos um formato: PDF ou Excel.");
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      const result = await desktopApi.exportWeighingBillingReport(
        range.start,
        range.end,
        selectedFormats,
        options
      );
      if (result) {
        setExportMessage(
          result.files.length === 1
            ? `Arquivo salvo em ${result.files[0]}`
            : `${result.files.length} arquivos salvos:\n${result.files.join("\n")}`
        );
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao gerar o relatorio.");
    } finally {
      setExporting(false);
    }
  }

  const totals = report?.totals ?? null;
  const unbilled = report?.unbilled ?? null;
  const billedOperations = totals && unbilled ? totals.operations - unbilled.operations : null;

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Conferencia de faturamento</h2>
          <HelpTooltip
            content="Lista pesagem a pesagem do periodo: cliente, data, produto, peso, frete e total de cada carregamento fechado na balanca, com a situacao dele no OMIE. Use o filtro de situacao para isolar o que ainda nao foi faturado e conferir contra o relatorio do OMIE. O PDF e a planilha saem com as mesmas linhas que estao na tela."
            placement="right"
          />
        </div>
        <IconActionButton
          icon="download"
          label={
            exporting
              ? "Gerando..."
              : selectedFormats.length > 1
                ? `Gerar ${selectedFormats.length} arquivos`
                : "Gerar relatorio"
          }
          tip="Gera os arquivos escolhidos com as pesagens filtradas. Com mais de um arquivo, o aplicativo pede a pasta de destino uma unica vez."
          tone="primary"
          placement="bottom"
          disabled={exporting || loading}
          onClick={() => void handleExport()}
        />
      </header>

      <div style={styles.card}>
        <div style={styles.filterGrid}>
          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Periodo</span>
            <div style={styles.chipRow}>
              {INSIGHTS_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPeriod(option.id)}
                  style={period === option.id ? styles.chipActive : styles.chip}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {period === "custom" ? (
              <div style={styles.customDates}>
                <label style={styles.dateField}>
                  De
                  <input
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    style={styles.input}
                  />
                </label>
                <label style={styles.dateField}>
                  Ate
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    style={styles.input}
                  />
                </label>
              </div>
            ) : null}
            <p style={styles.hint}>
              {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
            </p>
          </div>

          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Cliente</span>
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              style={styles.input}
            >
              <option value={ALL_CUSTOMERS}>Todos os clientes</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.document ? `${customer.name} - ${customer.document}` : customer.name}
                </option>
              ))}
            </select>
            <span style={styles.filterLabel}>Buscar</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cliente, produto, placa ou numero da operacao"
              style={styles.input}
            />
          </div>

          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Situacao no OMIE</span>
            <div style={styles.chipRow}>
              <button
                type="button"
                onClick={() => setSituations([])}
                style={situations.length === 0 ? styles.chipActive : styles.chip}
              >
                Todas
              </button>
              {WEIGHING_BILLING_SITUATIONS.map((situation) => (
                <button
                  key={situation}
                  type="button"
                  onClick={() => toggleSituation(situation)}
                  style={situations.includes(situation) ? styles.chipActive : styles.chip}
                >
                  {WEIGHING_BILLING_SITUATION_LABEL[situation]}
                </button>
              ))}
            </div>
            <span style={styles.filterLabel}>Formato do arquivo</span>
            <div style={styles.chipRow}>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={formats.excel}
                  onChange={(event) => setFormats({ ...formats, excel: event.target.checked })}
                />
                Excel
              </label>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={formats.pdf}
                  onChange={(event) => setFormats({ ...formats, pdf: event.target.checked })}
                />
                PDF
              </label>
            </div>
          </div>
        </div>
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      {exportMessage ? <p style={styles.info}>{exportMessage}</p> : null}

      {loading && !report ? <p style={styles.hint}>Carregando...</p> : null}

      {report && totals && unbilled ? (
        <>
          <div style={styles.kpiGrid}>
            <Kpi label="Pesagens" value={formatCount(totals.operations)} />
            <Kpi label="Tonelagem" value={formatTons(totals.netWeightKg)} />
            <Kpi label="Frete" value={formatBRL(totals.freightCents)} />
            <Kpi label="Total fechado" value={formatBRL(totals.totalCents)} />
            <Kpi
              label="Faturadas"
              value={formatCount(billedOperations ?? 0)}
              hint="Pesagens com nota emitida no OMIE."
            />
            <Kpi
              label="Sem faturar"
              value={formatBRL(unbilled.totalCents)}
              hint={`${formatCount(unbilled.operations)} pesagem(ns) - ${formatTons(unbilled.netWeightKg)}`}
              tone={unbilled.operations > 0 ? "danger" : "success"}
            />
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Situacao do faturamento</h3>
            {report.bySituation.length === 0 ? (
              <p style={styles.hint}>Sem pesagens no periodo.</p>
            ) : (
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, textAlign: "left" }}>Situacao</th>
                      <th style={styles.th}>Pesagens</th>
                      <th style={styles.th}>Peso</th>
                      <th style={styles.th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bySituation.map((row) => (
                      <tr key={row.situation}>
                        <td style={{ ...styles.td, textAlign: "left" }}>
                          <SituationPill situation={row.situation} label={row.label} />
                        </td>
                        <td style={styles.td}>{formatCount(row.operations)}</td>
                        <td style={styles.td}>{formatKg(row.netWeightKg)}</td>
                        <td style={styles.td}>{formatBRL(row.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={styles.footNote}>
              O KyberRock envia ao OMIE o pedido de venda (ou a ordem de servico, na venda interna);
              a nota fiscal e emitida no proprio OMIE, na etapa &quot;Faturar&quot;. Uma pesagem em
              &quot;No OMIE, falta faturar&quot; ja saiu daqui certa — o que falta e a emissao la.
            </p>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Pesagem a pesagem ({formatCount(report.rows.length)})</h3>
            {report.rows.length === 0 ? (
              <p style={styles.hint}>Nenhuma pesagem com os filtros escolhidos.</p>
            ) : (
              <div style={styles.tableScrollTall}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, textAlign: "left" }}>Op.</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Data</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Cliente</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Produto</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Placa</th>
                      <th style={styles.th}>Peso</th>
                      <th style={styles.th}>Preco unit.</th>
                      <th style={styles.th}>Produto</th>
                      <th style={styles.th}>Frete</th>
                      <th style={styles.th}>Total</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Tipo</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Situacao</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Nota fiscal</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Pedido/OS OMIE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.operationId}>
                        <td style={{ ...styles.td, textAlign: "left" }}>
                          {row.operationCode ?? "-"}
                        </td>
                        <td
                          style={{ ...styles.td, textAlign: "left" }}
                          title={row.closedAt ? `Saida: ${formatDbDateTime(row.closedAt)}` : ""}
                        >
                          {formatDayLabel(row.date)}
                        </td>
                        <td style={{ ...styles.td, textAlign: "left" }} title={row.customerName}>
                          {row.customerName}
                        </td>
                        <td
                          style={{ ...styles.td, textAlign: "left" }}
                          title={row.productDescription}
                        >
                          {row.productDescription}
                        </td>
                        <td style={{ ...styles.td, textAlign: "left" }}>{row.plate}</td>
                        <td style={styles.td}>{formatKg(row.netWeightKg)}</td>
                        <td style={styles.td}>{unitPriceLabel(row)}</td>
                        <td style={styles.td}>{formatBRL(row.productTotalCents)}</td>
                        <td style={styles.td}>{formatBRL(row.freightTotalCents)}</td>
                        <td style={{ ...styles.td, fontWeight: 700 }}>
                          {formatBRL(row.totalCents)}
                        </td>
                        <td style={{ ...styles.td, textAlign: "left" }}>
                          {row.operationTypeLabel}
                        </td>
                        <td style={{ ...styles.td, textAlign: "left" }}>
                          <SituationPill
                            situation={row.situation}
                            label={row.situationLabel}
                            title={row.situationDetail ?? undefined}
                          />
                        </td>
                        <td style={{ ...styles.td, textAlign: "left" }}>
                          {row.omieInvoiceNumber ?? "-"}
                        </td>
                        <td style={{ ...styles.td, textAlign: "left" }}>{omieReference(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ ...styles.tdTotal, textAlign: "left" }} colSpan={5}>
                        TOTAL
                      </td>
                      <td style={styles.tdTotal}>{formatKg(totals.netWeightKg)}</td>
                      <td style={styles.tdTotal} />
                      <td style={styles.tdTotal}>{formatBRL(totals.productCents)}</td>
                      <td style={styles.tdTotal}>{formatBRL(totals.freightCents)}</td>
                      <td style={styles.tdTotal}>{formatBRL(totals.totalCents)}</td>
                      {/* Tipo, Situacao, Nota fiscal e Pedido/OS: quatro colunas sem total. */}
                      <td style={styles.tdTotal} colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "success";
}) {
  const valueStyle =
    tone === "danger"
      ? { ...styles.kpiValue, color: "var(--kr-danger)" }
      : tone === "success"
        ? { ...styles.kpiValue, color: "var(--kr-success)" }
        : styles.kpiValue;
  return (
    <div style={styles.card}>
      <p style={styles.kpiLabel}>{label}</p>
      <p style={valueStyle}>{value}</p>
      {hint ? <p style={styles.hint}>{hint}</p> : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 0,
    display: "grid",
    gap: "10px",
    flexShrink: 0
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "10px"
  },
  title: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "18px"
  },
  card: {
    background: "var(--kr-card-bg)",
    border: "1px solid var(--kr-card-border)",
    borderRadius: "12px",
    padding: "12px",
    boxShadow: "var(--kr-shadow)",
    minWidth: 0
  },
  cardTitle: {
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: "0 0 8px 0"
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px"
  },
  filterBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: 0
  },
  filterLabel: {
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--kr-muted)"
  },
  input: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "8px 10px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)",
    width: "100%"
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center"
  },
  chip: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-muted)",
    borderRadius: "999px",
    padding: "5px 11px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer"
  },
  chipActive: {
    border: "1px solid var(--kr-primary-strong)",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    borderRadius: "999px",
    padding: "5px 11px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer"
  },
  customDates: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap"
  },
  dateField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--kr-muted)",
    flex: "1 1 120px"
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--kr-text-strong)",
    cursor: "pointer"
  },
  hint: {
    fontSize: "12px",
    color: "var(--kr-muted)",
    margin: 0,
    whiteSpace: "pre-line"
  },
  footNote: {
    fontSize: "11px",
    color: "var(--kr-muted)",
    fontStyle: "italic",
    margin: "8px 0 0 0"
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "10px"
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
    fontSize: "21px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: "4px 0 2px 0"
  },
  tableScroll: {
    overflowX: "auto",
    maxHeight: "320px",
    overflowY: "auto"
  },
  tableScrollTall: {
    overflowX: "auto",
    maxHeight: "calc(100vh - 420px)",
    overflowY: "auto"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "12px"
  },
  th: {
    padding: "7px 10px",
    borderBottom: "2px solid var(--kr-card-border)",
    color: "var(--kr-muted)",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    position: "sticky",
    top: 0,
    background: "var(--kr-card-bg)",
    whiteSpace: "nowrap",
    textAlign: "right",
    zIndex: 1
  },
  td: {
    padding: "6px 10px",
    borderBottom: "1px solid var(--kr-card-border)",
    color: "var(--kr-text-strong)",
    whiteSpace: "nowrap",
    textAlign: "right",
    maxWidth: "260px",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  tdTotal: {
    padding: "8px 10px",
    borderTop: "2px solid var(--kr-card-border)",
    color: "var(--kr-text-strong)",
    fontWeight: 800,
    whiteSpace: "nowrap",
    textAlign: "right",
    position: "sticky",
    bottom: 0,
    background: "var(--kr-card-bg)"
  },
  error: {
    color: "var(--kr-chart-4)",
    fontSize: "13px",
    background: "color-mix(in srgb, var(--kr-chart-4) 12%, transparent)",
    border: "1px solid color-mix(in srgb, var(--kr-chart-4) 35%, transparent)",
    borderRadius: "8px",
    padding: "8px 12px",
    margin: 0
  },
  info: {
    color: "var(--kr-info-text)",
    background: "var(--kr-info-bg)",
    border: "1px solid var(--kr-info-border)",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    margin: 0,
    whiteSpace: "pre-line"
  }
};
