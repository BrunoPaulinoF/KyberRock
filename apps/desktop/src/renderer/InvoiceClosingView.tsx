import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { CustomerReportOption } from "../services/customer-report";
import {
  INVOICE_CLOSING_CYCLES,
  INVOICE_CLOSING_CYCLE_LABEL,
  formatCouponNumber
} from "../services/invoice-closing-cycle";
import type { InvoiceClosingCycle } from "../services/invoice-closing-cycle";
import type { InvoiceClosingInvoice, InvoiceClosingReport } from "../services/invoice-closing";
import { IconActionButton } from "./IconActionButton";
import { HelpTooltip } from "./Tooltip";
import {
  INSIGHTS_PERIOD_OPTIONS,
  formatDayLabel,
  resolveInsightsRange,
  toIsoDate
} from "./insights-period";
import type { InsightsPeriod } from "./insights-period";

/**
 * Fechamento de faturas: a fatura de TODOS os clientes de um ciclo, de uma vez.
 *
 * A tela responde a pergunta com que a atendente comeca o mes — "quem fecha quinzenal, e
 * quanto cada um deve nesta quinzena?" —, que antes so tinha resposta abrindo cliente por
 * cliente. Por isso o filtro principal e o CICLO, e nao o cliente: escolher "Quinzenal"
 * traz a lista inteira, com a data de fechamento e o vencimento de cada fatura.
 *
 * Cada fatura abre carga a carga com nota, vale, placa e transportador — as quatro colunas
 * que a cobranca precisa —, e o mesmo periodo ainda sai resumido por transportador e
 * placa, que e como o acerto do frete e feito. A planilha e o PDF saem com exatamente as
 * faturas que estao na tela.
 *
 * O filtro de PLACA e o unico que troca o formato da lista: enquanto esta vazio, o
 * fechamento e um por cliente; marcando placas, o mesmo cliente passa a render uma fatura
 * por caminhao. E a pergunta de quem paga o frete por placa — "quanto este caminhao levou
 * deste cliente na quinzena?" — sem tirar do fechamento a conta que vai para o cliente.
 */

const ALL_CUSTOMERS = "";

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

export function InvoiceClosingView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [customers, setCustomers] = useState<CustomerReportOption[]>([]);
  const [customerId, setCustomerId] = useState(ALL_CUSTOMERS);
  const [period, setPeriod] = useState<InsightsPeriod>("month");
  const [customStart, setCustomStart] = useState(() => toIsoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => toIsoDate(new Date()));
  const [cycles, setCycles] = useState<InvoiceClosingCycle[]>([]);
  const [plates, setPlates] = useState<string[]>([]);
  const [plateSearch, setPlateSearch] = useState("");
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<InvoiceClosingReport | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
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

  // Os filtros que vao para a consulta E para o arquivo: o fechamento entregue ao cliente
  // precisa trazer exatamente as faturas que estavam na tela.
  const options = useMemo(
    () => ({
      cycles,
      customerId: customerId || null,
      plates,
      search: search.trim() || null,
      periodLabel: range.label
    }),
    [cycles, customerId, plates, search, range.label]
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
      setReport(await desktopApi.getInvoiceClosing(range.start, range.end, options));
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Falha ao carregar o fechamento.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi, range.start, range.end, options]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function toggleCycle(cycle: InvoiceClosingCycle): void {
    setCycles((current) =>
      current.includes(cycle) ? current.filter((item) => item !== cycle) : [...current, cycle]
    );
  }

  function togglePlate(plate: string): void {
    setPlates((current) =>
      current.includes(plate)
        ? current.filter((item) => item !== plate)
        : [...current, plate].sort((a, b) => a.localeCompare(b, "pt-BR"))
    );
  }

  async function handleExport(): Promise<void> {
    if (!desktopApi) return;
    if (selectedFormats.length === 0) {
      setExportMessage("Selecione ao menos um formato: Excel ou PDF.");
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      const result = await desktopApi.exportInvoiceClosing(
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
      setExportMessage(err instanceof Error ? err.message : "Falha ao gerar o fechamento.");
    } finally {
      setExporting(false);
    }
  }

  const totals = report?.totals ?? null;
  const splitByPlate = plates.length > 0;

  // As placas do periodo mais as ja marcadas: uma placa escolhida antes de trocar o periodo
  // continua visivel (e desmarcavel) mesmo quando ela nao rodou no periodo novo.
  const plateOptions = useMemo(() => {
    const all = new Set([...(report?.availablePlates ?? []), ...plates]);
    return [...all].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [report?.availablePlates, plates]);

  const visiblePlates = useMemo(() => {
    const term = plateSearch.trim().toUpperCase();
    return term ? plateOptions.filter((plate) => plate.includes(term)) : plateOptions;
  }, [plateOptions, plateSearch]);

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Fechamento de faturas</h2>
          <HelpTooltip
            content="Puxa de uma vez a fatura de todos os clientes de um ciclo: escolha Quinzenal ou Mensal e o periodo. Cada fatura sai com a data de fechamento, o vencimento e a lista carga a carga com nota fiscal, vale, placa e transportador. O ciclo, o dia do fechamento e o prazo do boleto vem do cadastro do cliente. Marcando placas no filtro de Placa, o fechamento sai separado por placa — uma fatura por caminhao dentro de cada cliente; com o filtro vazio, sai a fatura inteira do cliente. O Excel e o PDF saem com as mesmas faturas que estao na tela."
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
                : "Gerar fechamento"
          }
          tip="Gera os arquivos escolhidos com as faturas filtradas. Com mais de um arquivo, o aplicativo pede a pasta de destino uma unica vez."
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
            <span style={styles.filterLabel}>Ciclo de fechamento</span>
            <div style={styles.chipRow}>
              <button
                type="button"
                onClick={() => setCycles([])}
                style={cycles.length === 0 ? styles.chipActive : styles.chip}
              >
                Todos
              </button>
              {INVOICE_CLOSING_CYCLES.map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => toggleCycle(cycle)}
                  style={cycles.includes(cycle) ? styles.chipActive : styles.chip}
                >
                  {INVOICE_CLOSING_CYCLE_LABEL[cycle]}
                </button>
              ))}
            </div>
            <p style={styles.hint}>
              Definido em Cadastros &gt; Clientes, em &quot;Periodicidade do fechamento&quot;.
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
              placeholder="Cliente, placa, transportador, nota ou vale"
              style={styles.input}
            />
          </div>

          <div style={styles.filterBlock}>
            <div style={styles.filterLabelRow}>
              <span style={styles.filterLabel}>Placa</span>
              {splitByPlate ? (
                <button type="button" onClick={() => setPlates([])} style={styles.clearButton}>
                  Limpar ({formatCount(plates.length)})
                </button>
              ) : null}
            </div>
            <input
              value={plateSearch}
              onChange={(event) => setPlateSearch(event.target.value)}
              placeholder="Filtrar placas..."
              aria-label="Filtrar a lista de placas"
              style={styles.input}
            />
            {plates.length > 0 ? (
              <div style={styles.chipRow}>
                {plates.map((plate) => (
                  <button
                    key={plate}
                    type="button"
                    onClick={() => togglePlate(plate)}
                    title={`Tirar ${plate} do filtro`}
                    style={styles.chipActive}
                  >
                    {plate} ×
                  </button>
                ))}
              </div>
            ) : null}
            <div style={styles.plateList}>
              {visiblePlates.length === 0 ? (
                <p style={styles.hint}>
                  {plateOptions.length === 0
                    ? "Nenhuma placa rodou no periodo."
                    : "Nenhuma placa com esse texto."}
                </p>
              ) : (
                visiblePlates.map((plate) => (
                  <label key={plate} style={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={plates.includes(plate)}
                      onChange={() => togglePlate(plate)}
                    />
                    {plate}
                  </label>
                ))
              )}
            </div>
            <p style={styles.hint}>
              {splitByPlate
                ? "Uma fatura por placa: o mesmo cliente aparece uma vez para cada caminhao escolhido."
                : "Vazio: uma fatura por cliente, com todas as placas juntas."}
            </p>
          </div>

          <div style={styles.filterBlock}>
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
            <p style={styles.footNote}>
              A nota fiscal e o boleto sao emitidos no OMIE, a partir do pedido que o KyberRock ja
              enviou.
            </p>
          </div>
        </div>
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      {exportMessage ? <p style={styles.info}>{exportMessage}</p> : null}
      {loading && !report ? <p style={styles.hint}>Carregando...</p> : null}

      {report && totals ? (
        <>
          <div style={styles.kpiGrid}>
            <Kpi label="Faturas" value={formatCount(report.invoices.length)} />
            <Kpi label="Clientes" value={formatCount(report.customers)} />
            <Kpi label="Cargas" value={formatCount(totals.operations)} />
            <Kpi label="Tonelagem" value={formatTons(totals.netWeightKg)} />
            <Kpi label="Total a faturar" value={formatBRL(totals.totalCents)} />
            <Kpi
              label="Sem nota emitida"
              value={formatBRL(report.withoutInvoice.totalCents)}
              hint={`${formatCount(report.withoutInvoice.operations)} carga(s) esperando a emissao no OMIE`}
              tone={report.withoutInvoice.operations > 0 ? "danger" : "success"}
            />
          </div>

          {report.pendingSetup.length > 0 ? (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>
                Clientes fora do fechamento ({formatCount(report.pendingSetup.length)})
              </h3>
              <p style={styles.hint}>
                Tiveram carga no periodo mas nao entraram em fatura nenhuma: falta habilitar o
                credito do cliente e escolher a periodicidade do fechamento no cadastro deles.
              </p>
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, textAlign: "left" }}>Cliente</th>
                      <th style={styles.th}>Cargas</th>
                      <th style={styles.th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pendingSetup.map((row) => (
                      <tr key={row.customerId}>
                        <td style={{ ...styles.td, textAlign: "left" }}>{row.customerName}</td>
                        <td style={styles.td}>{formatCount(row.operations)}</td>
                        <td style={styles.td}>{formatBRL(row.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>
              {splitByPlate ? "Faturas por placa" : "Faturas"} (
              {formatCount(report.invoices.length)})
            </h3>
            {report.invoices.length === 0 ? (
              <p style={styles.hint}>
                {splitByPlate
                  ? "Nenhuma carga das placas escolhidas nos ciclos e no periodo."
                  : "Nenhum cliente com fechamento no periodo e nos ciclos escolhidos."}
              </p>
            ) : (
              <div style={styles.tableScrollTall}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, textAlign: "left" }}>Cliente</th>
                      {splitByPlate ? (
                        <th style={{ ...styles.th, textAlign: "left" }}>Placa</th>
                      ) : null}
                      <th style={{ ...styles.th, textAlign: "left" }}>Ciclo</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Fechamento</th>
                      <th style={{ ...styles.th, textAlign: "left" }}>Vencimento</th>
                      <th style={styles.th}>Cargas</th>
                      <th style={styles.th}>Peso</th>
                      <th style={styles.th}>Total</th>
                      <th style={styles.th}>Sem nota</th>
                      <th style={styles.th} />
                    </tr>
                  </thead>
                  <tbody>
                    {report.invoices.map((invoice) => (
                      <InvoiceRows
                        key={invoiceKey(invoice)}
                        invoice={invoice}
                        showPlate={splitByPlate}
                        expanded={expanded === invoiceKey(invoice)}
                        onToggle={() =>
                          setExpanded((current) =>
                            current === invoiceKey(invoice) ? null : invoiceKey(invoice)
                          )
                        }
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td
                        style={{ ...styles.tdTotal, textAlign: "left" }}
                        colSpan={splitByPlate ? 5 : 4}
                      >
                        TOTAL
                      </td>
                      <td style={styles.tdTotal}>{formatCount(totals.operations)}</td>
                      <td style={styles.tdTotal}>{formatKg(totals.netWeightKg)}</td>
                      <td style={styles.tdTotal}>{formatBRL(totals.totalCents)}</td>
                      <td style={styles.tdTotal}>
                        {report.withoutInvoice.operations === 0
                          ? "-"
                          : formatCount(report.withoutInvoice.operations)}
                      </td>
                      <td style={styles.tdTotal} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Transportadores e placas</h3>
            <p style={styles.hint}>
              As mesmas viagens do fechamento, agrupadas por quem levou — para o acerto do frete
              sair da mesma lista que foi cobrada do cliente.
            </p>
            {report.byCarrier.length === 0 ? (
              <p style={styles.hint}>Sem viagens no periodo.</p>
            ) : (
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, textAlign: "left" }}>Transportador / placa</th>
                      <th style={styles.th}>Viagens</th>
                      <th style={styles.th}>Peso</th>
                      <th style={styles.th}>Frete</th>
                      <th style={styles.th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byCarrier.map((carrier) => (
                      <Fragment key={carrier.carrierName}>
                        <tr>
                          <td style={{ ...styles.td, textAlign: "left", fontWeight: 700 }}>
                            {carrier.carrierName}
                          </td>
                          <td style={styles.td}>{formatCount(carrier.trips)}</td>
                          <td style={styles.td}>{formatKg(carrier.netWeightKg)}</td>
                          <td style={styles.td}>{formatBRL(carrier.freightCents)}</td>
                          <td style={styles.td}>{formatBRL(carrier.totalCents)}</td>
                        </tr>
                        {carrier.plates.map((plate) => (
                          <tr key={`${carrier.carrierName}|${plate.plate}`}>
                            <td
                              style={{
                                ...styles.td,
                                textAlign: "left",
                                paddingLeft: "26px",
                                color: "var(--kr-muted)"
                              }}
                            >
                              {plate.plate}
                            </td>
                            <td style={styles.td}>{formatCount(plate.trips)}</td>
                            <td style={styles.td}>{formatKg(plate.netWeightKg)}</td>
                            <td style={styles.td}>{formatBRL(plate.freightCents)}</td>
                            <td style={styles.td}>{formatBRL(plate.totalCents)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * A linha da fatura e, quando aberta, as cargas dela.
 *
 * Fica fechada por padrao porque a pergunta do fechamento e "quanto cada cliente deve";
 * a lista carga a carga so interessa quando um valor nao bate — e ai ela abre no lugar,
 * sem trocar de tela.
 */
function InvoiceRows({
  invoice,
  showPlate,
  expanded,
  onToggle
}: {
  invoice: InvoiceClosingInvoice;
  showPlate: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td
          style={{ ...styles.td, textAlign: "left", fontWeight: 700 }}
          title={invoice.customerName}
        >
          {invoice.customerName}
        </td>
        {showPlate ? (
          <td style={{ ...styles.td, textAlign: "left", fontWeight: 700 }}>
            {invoice.plate ?? "-"}
          </td>
        ) : null}
        <td style={{ ...styles.td, textAlign: "left" }}>{invoice.cycleLabel}</td>
        <td style={{ ...styles.td, textAlign: "left" }}>{formatDayLabel(invoice.closingDate)}</td>
        <td style={{ ...styles.td, textAlign: "left" }}>{formatDayLabel(invoice.dueDate)}</td>
        <td style={styles.td}>{formatCount(invoice.totals.operations)}</td>
        <td style={styles.td}>{formatKg(invoice.totals.netWeightKg)}</td>
        <td style={{ ...styles.td, fontWeight: 700 }}>{formatBRL(invoice.totals.totalCents)}</td>
        <td
          style={{
            ...styles.td,
            color: invoice.operationsWithoutInvoice > 0 ? "var(--kr-danger)" : undefined
          }}
        >
          {invoice.operationsWithoutInvoice === 0
            ? "-"
            : formatCount(invoice.operationsWithoutInvoice)}
        </td>
        <td style={styles.td}>
          <button type="button" onClick={onToggle} style={styles.linkButton}>
            {expanded ? "Fechar" : "Ver cargas"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td style={{ ...styles.td, padding: 0 }} colSpan={showPlate ? 10 : 9}>
            <div style={styles.detailBox}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, textAlign: "left" }}>Data</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Vale</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Nota fiscal</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Pedido OMIE</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Placa</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Transportador</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Motorista</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Produto</th>
                    <th style={styles.th}>Peso</th>
                    <th style={styles.th}>Frete</th>
                    <th style={styles.th}>Total</th>
                    <th style={{ ...styles.th, textAlign: "left" }}>Situacao</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.operationId}>
                      <td style={{ ...styles.td, textAlign: "left" }}>
                        {formatDayLabel(line.date)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "left" }}>
                        {formatCouponNumber(line.couponNumber)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "left" }}>
                        {line.invoiceNumber ?? "-"}
                      </td>
                      <td style={{ ...styles.td, textAlign: "left" }}>
                        {line.omieOrderNumber ?? "-"}
                      </td>
                      <td style={{ ...styles.td, textAlign: "left" }}>{line.plate}</td>
                      <td style={{ ...styles.td, textAlign: "left" }} title={line.carrierName}>
                        {line.carrierName}
                      </td>
                      <td style={{ ...styles.td, textAlign: "left" }}>{line.driverName}</td>
                      <td
                        style={{ ...styles.td, textAlign: "left" }}
                        title={line.productDescription}
                      >
                        {line.productDescription}
                      </td>
                      <td style={styles.td}>{formatKg(line.netWeightKg)}</td>
                      <td style={styles.td}>{formatBRL(line.freightTotalCents)}</td>
                      <td style={{ ...styles.td, fontWeight: 700 }}>
                        {formatBRL(line.totalCents)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "left" }}>{line.situationLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * A chave da fatura na tela. Inclui a PLACA porque, com o filtro de placas em uso, o mesmo
 * cliente tem varias faturas no mesmo fechamento — sem ela, abrir uma abriria todas.
 */
function invoiceKey(invoice: InvoiceClosingInvoice): string {
  return `${invoice.customerId}|${invoice.closingDate}|${invoice.plate ?? ""}`;
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
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "14px"
  },
  filterBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: 0
  },
  filterLabelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px"
  },
  clearButton: {
    border: "none",
    background: "none",
    color: "var(--kr-primary-strong)",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    padding: 0
  },
  plateList: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    maxHeight: "132px",
    overflowY: "auto",
    border: "1px solid var(--kr-card-border)",
    borderRadius: "10px",
    padding: "6px 8px",
    background: "var(--kr-surface)"
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
    maxHeight: "340px",
    overflowY: "auto"
  },
  tableScrollTall: {
    overflowX: "auto",
    maxHeight: "calc(100vh - 460px)",
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
  detailBox: {
    background: "var(--kr-surface)",
    borderLeft: "3px solid var(--kr-primary-strong)",
    padding: "8px 10px",
    overflowX: "auto"
  },
  linkButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "8px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap"
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
