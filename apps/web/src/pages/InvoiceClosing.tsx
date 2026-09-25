import "./invoice-closing.css";

import { Download, Lightbulb, Send } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { Picker, type PickerOption } from "../components/Picker";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDateTime, formatDocument, periodToIso } from "../lib/format";
import {
  DUPLICATE_WEIGHING_WINDOW_DAYS,
  INVOICE_CLOSING_CYCLES,
  INVOICE_CLOSING_CYCLE_LABEL,
  INVOICE_CLOSING_PERIOD_KINDS,
  INVOICE_CLOSING_PERIOD_KIND_LABEL,
  addDays,
  buildInvoiceClosingFiles,
  buildInvoiceClosingReport,
  customerIdentityKey,
  defaultInvoiceClosingPeriod,
  formatBRL,
  formatCount,
  formatCouponNumber,
  formatDayLabel,
  formatKg,
  formatTonsShort,
  invoiceNumberLabel,
  isBillable,
  isLiveRequest,
  lineSituation,
  loadBillingRequests,
  loadDuplicateRows,
  omieReference,
  resolveInvoiceClosingPeriod,
  unitPriceLabel,
  type InvoiceClosingBasis,
  type InvoiceClosingCycle,
  type InvoiceClosingInvoice,
  type InvoiceClosingLine,
  type InvoiceClosingPeriodSelection,
  type InvoiceClosingReport,
  type InvoiceClosingTotals
} from "../lib/invoice-closing";
import { matchesSearch } from "../lib/operation";
import { q, type BillingRequest } from "../lib/queries";
import { deliverReports } from "../lib/report-output";
import { useAsync } from "../lib/use-async";

const HELP =
  "Puxa de uma vez a fatura de todos os clientes de um periodo. Escolha o periodo (quinzena, mes, semana ou datas livres) e a tela monta uma fatura por cliente com tudo o que ele carregou nele — inclusive as vendas EM CARTEIRA e as de cliente sem credito no cadastro. Em 'Base do fechamento' voce troca para 'Cadastro do cliente' se preferir a periodicidade cadastrada em cada um; ai o cliente sem credito fica fora das faturas e aparece na lista 'Clientes fora do fechamento'. O botao 'Fazer fechamento' pede o faturamento no OMIE, de uma vez, das cargas do periodo que ainda nao tem nota — quem fatura e a balanca da unidade, que recebe o pedido e emite a nota de cada cliente; carga ja faturada nunca e reenviada. Marcando placas no filtro de Placa, o fechamento sai separado por placa — uma fatura por caminhao dentro de cada cliente. No fim da tela, a lista pesagem a pesagem traz TODAS as cargas do periodo numa tabela so, com a operacao inteira em cada linha. O Excel e o PDF saem com as mesmas faturas que estao na tela.";

/** A busca espera a palavra antes de virar filtro (o `useDebouncedValue` do desktop). */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface RunResult {
  requested: number;
  requestIds: string[];
  skipped: Array<{ operationId: string; reason: string }>;
}

/**
 * Fechamento de faturas: a fatura de TODOS os clientes de um periodo, de uma vez — a mesma
 * tela do desktop (`InvoiceClosingView`). O "Fazer fechamento" daqui nao fatura: ele pede, e a
 * balanca da unidade executa (docs/web-api.md 4.8); o andamento volta em `billing_requests`.
 */
export function InvoiceClosing() {
  const user = useUser();
  const [customerId, setCustomerId] = useState("");
  // Comeca na quinzena corrente: e o fechamento que a atendente abre a tela para fazer.
  const [period, setPeriod] = useState<InvoiceClosingPeriodSelection>(() =>
    defaultInvoiceClosingPeriod(new Date())
  );
  const [basis, setBasis] = useState<InvoiceClosingBasis>("period");
  const [cycles, setCycles] = useState<InvoiceClosingCycle[]>([]);
  const [plates, setPlates] = useState<string[]>([]);
  const [plateSearch, setPlateSearch] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmingRun, setConfirmingRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [formats, setFormats] = useState<{ pdf: boolean; excel: boolean }>({
    pdf: false,
    excel: true
  });

  const range = useMemo(() => resolveInvoiceClosingPeriod(period, new Date()), [period]);
  const iso = useMemo(() => periodToIso(range.start, range.end), [range.start, range.end]);
  // A janela das repetidas e maior que o periodo: a carga refeita costuma sair dias depois.
  const duplicateIso = useMemo(
    () =>
      periodToIso(
        addDays(range.start, -DUPLICATE_WEIGHING_WINDOW_DAYS),
        addDays(range.end, DUPLICATE_WEIGHING_WINDOW_DAYS)
      ),
    [range.start, range.end]
  );
  const debouncedSearch = useDebounced(search);

  const customers = useAsync(() => q.customers(user.companyId), [user.companyId]);
  const products = useAsync(() => q.products(user.companyId), [user.companyId]);
  const vehicles = useAsync(() => q.vehicles(user.companyId), [user.companyId]);
  const carriers = useAsync(() => q.carriers(user.companyId), [user.companyId]);
  const ops = useAsync(
    () => q.closedOperations(user.companyId, iso.startIso, iso.endIso),
    [user.companyId, iso.startIso, iso.endIso]
  );
  const duplicateRows = useAsync(
    () => loadDuplicateRows(user.companyId, duplicateIso.startIso, duplicateIso.endIso),
    [user.companyId, duplicateIso.startIso, duplicateIso.endIso]
  );
  const invoiceIds = useMemo(
    () =>
      (ops.data ?? [])
        .filter((op) => op.operation_type === "invoice" && op.status !== "cancelled")
        .map((op) => op.id),
    [ops.data]
  );
  const requests = useAsync(
    () => loadBillingRequests(user.companyId, invoiceIds),
    [user.companyId, invoiceIds.join(",")]
  );

  const report = useMemo<InvoiceClosingReport | null>(() => {
    if (!ops.data) return null;
    return buildInvoiceClosingReport(
      {
        operations: ops.data,
        customers: customers.data ?? [],
        products: products.data ?? [],
        vehicles: vehicles.data ?? [],
        carriers: carriers.data ?? [],
        duplicateRows: duplicateRows.data ?? [],
        billingRequests: requests.data ?? []
      },
      {
        startDate: range.start,
        endDate: range.end,
        basis,
        periodCycle: range.cycle,
        cycles,
        customerId: customerId || null,
        plates,
        search: debouncedSearch,
        periodLabel: range.label
      }
    );
  }, [
    ops.data,
    customers.data,
    products.data,
    vehicles.data,
    carriers.data,
    duplicateRows.data,
    requests.data,
    range,
    basis,
    cycles,
    customerId,
    plates,
    debouncedSearch
  ]);

  // Enquanto houver pedido na fila da balanca, a tela se atualiza sozinha a cada 10 s.
  const hasLive = (report?.rows ?? []).some((line) => isLiveRequest(line.request));
  useEffect(() => {
    if (!hasLive) return;
    const timer = window.setInterval(() => {
      void requests.reload();
      void ops.reload();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasLive]);

  const loading = ops.loading || customers.loading;
  const error =
    ops.error ??
    customers.error ??
    requests.error ??
    duplicateRows.error ??
    products.error ??
    vehicles.error ??
    carriers.error;

  const customerOptions = useMemo<PickerOption[]>(() => {
    // Um cliente por cadastro REAL: o do OMIE e o da balanca com o mesmo CNPJ sao um so.
    const seen = new Set<string>();
    const options: PickerOption[] = [];
    for (const customer of customers.data ?? []) {
      const key = customerIdentityKey(customer);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        value: customer.id,
        label: customer.trade_name || customer.legal_name,
        hint: customer.document ? formatDocument(customer.document) : undefined
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [customers.data]);

  const billable = useMemo(() => (report?.rows ?? []).filter(isBillable), [report]);
  const selectedFormats = (["pdf", "excel"] as const).filter((format) => formats[format]);
  const totals = report?.totals ?? null;
  const splitByPlate = plates.length > 0;
  const outsideClosing = report?.rows.filter((line) => line.closingDate === null).length ?? 0;

  // As placas do periodo mais as ja marcadas: a escolhida antes de trocar o periodo continua
  // visivel (e desmarcavel).
  const plateOptions = useMemo(() => {
    const all = new Set([...(report?.availablePlates ?? []), ...plates]);
    return [...all].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [report?.availablePlates, plates]);
  const visiblePlates = useMemo(() => {
    const term = plateSearch.trim();
    if (!term) return plateOptions;
    const needle = term.toUpperCase().replace(/[\s-]/g, "");
    return plateOptions
      .filter((plate) => matchesSearch(plate, term))
      .sort(
        (a, b) =>
          Number(!a.replace(/[\s-]/g, "").startsWith(needle)) -
          Number(!b.replace(/[\s-]/g, "").startsWith(needle))
      );
  }, [plateOptions, plateSearch]);

  function setPeriodField<K extends keyof InvoiceClosingPeriodSelection>(
    field: K,
    value: InvoiceClosingPeriodSelection[K]
  ): void {
    setPeriod((current) => ({ ...current, [field]: value }));
  }

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

  function openRunConfirmation(): void {
    setRunError(null);
    setRunResult(null);
    if (!navigator.onLine) {
      setRunError("O fechamento precisa de internet conectada. Conecte e tente de novo.");
      return;
    }
    setConfirmingRun(true);
  }

  async function handleRunClosing(): Promise<void> {
    setConfirmingRun(false);
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const result = await callWebApi("request_invoice_closing", {
        operationIds: billable.map((line) => line.operationId)
      });
      setRunResult({
        requested: Number(result.requested ?? 0),
        requestIds: (result.requestIds as string[] | undefined) ?? [],
        skipped: (result.skipped as RunResult["skipped"] | undefined) ?? []
      });
      await requests.reload();
    } catch (caught) {
      setRunError(errorMessage(caught, "Falha ao pedir o fechamento."));
    } finally {
      setRunning(false);
    }
  }

  /**
   * O "Gerar arquivo" do desktop: os mesmos documentos, com os mesmos filtros da tela. O Excel
   * baixa a planilha `.xls` do desktop; o PDF abre a impressao do navegador com o documento A4
   * do desktop (la se escolhe "Salvar como PDF").
   */
  async function handleExport(): Promise<void> {
    if (!report) return;
    if (selectedFormats.length === 0) {
      setExportMessage("Selecione ao menos um formato: Excel ou PDF.");
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      const files = buildInvoiceClosingFiles(report, selectedFormats);
      await deliverReports(files);
      const names = [...files.pdf, ...files.xls].map((file) => file.filename);
      setExportMessage(
        names.length === 1
          ? `Arquivo gerado: ${names[0]}`
          : `${names.length} arquivos gerados:\n${names.join("\n")}`
      );
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao gerar o fechamento.");
    } finally {
      setExporting(false);
    }
  }

  const customerLabel = customerId
    ? (customerOptions.find((option) => option.value === customerId)?.label ?? "cliente")
    : "todos os clientes";

  return (
    <section className="closing">
      <header className="closing-header">
        <div className="closing-title-row">
          <h2 className="closing-title">Fechamento de faturas</h2>
          <span className="closing-help" role="img" aria-label="Dica" title={HELP}>
            <Lightbulb size={14} />
          </span>
        </div>
        <div className="closing-actions">
          <button
            type="button"
            className="icon-action"
            aria-label={
              exporting
                ? "Gerando..."
                : selectedFormats.length > 1
                  ? `Gerar ${selectedFormats.length} arquivos`
                  : "Gerar arquivo"
            }
            title="Gera os arquivos escolhidos com as faturas filtradas. O Excel e baixado como planilha e o PDF abre na impressao do navegador, onde se escolhe Salvar como PDF."
            disabled={exporting || loading || running || !report}
            onClick={() => void handleExport()}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className="icon-action primary"
            aria-label={running ? "Enviando..." : "Fazer fechamento"}
            title="Pede o faturamento no OMIE de todas as pesagens do periodo que estao na tela; a balanca da unidade emite a nota de cada cliente. Pesagem que ja tem nota nao e reenviada. O site pede confirmacao antes."
            disabled={running || loading || (report?.rows.length ?? 0) === 0}
            onClick={openRunConfirmation}
          >
            <Send size={16} />
          </button>
        </div>
      </header>

      <div className="closing-card closing-filters">
        <div className="closing-filter-grid">
          <div className="closing-filter-block">
            <span className="closing-filter-label">Periodo do fechamento</span>
            <div className="closing-chip-row">
              {INVOICE_CLOSING_PERIOD_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`closing-chip${period.kind === kind ? " active" : ""}`}
                  onClick={() => setPeriodField("kind", kind)}
                >
                  {INVOICE_CLOSING_PERIOD_KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            {period.kind === "biweekly" || period.kind === "monthly" ? (
              <label className="closing-date-field">
                Mes
                <input
                  type="month"
                  className="closing-input"
                  value={period.month}
                  onChange={(event) => setPeriodField("month", event.target.value)}
                />
              </label>
            ) : null}
            {period.kind === "biweekly" ? (
              <div className="closing-chip-row">
                <button
                  type="button"
                  className={`closing-chip${period.half === 1 ? " active" : ""}`}
                  onClick={() => setPeriodField("half", 1)}
                >
                  1a quinzena (01 a 15)
                </button>
                <button
                  type="button"
                  className={`closing-chip${period.half === 2 ? " active" : ""}`}
                  onClick={() => setPeriodField("half", 2)}
                >
                  2a quinzena (16 ao fim)
                </button>
              </div>
            ) : null}
            {period.kind === "weekly" ? (
              <label className="closing-date-field">
                Qualquer dia da semana
                <input
                  type="date"
                  className="closing-input"
                  value={period.weekDay}
                  onChange={(event) => setPeriodField("weekDay", event.target.value)}
                />
              </label>
            ) : null}
            {period.kind === "custom" ? (
              <div className="closing-custom-dates">
                <label className="closing-date-field">
                  De
                  <input
                    type="date"
                    className="closing-input"
                    value={period.customStart}
                    onChange={(event) => setPeriodField("customStart", event.target.value)}
                  />
                </label>
                <label className="closing-date-field">
                  Ate
                  <input
                    type="date"
                    className="closing-input"
                    value={period.customEnd}
                    onChange={(event) => setPeriodField("customEnd", event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <p className="closing-hint">
              {range.label} — {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
            </p>
          </div>

          <div className="closing-filter-block">
            <span className="closing-filter-label">Base do fechamento</span>
            <div className="closing-chip-row">
              <button
                type="button"
                className={`closing-chip${basis === "period" ? " active" : ""}`}
                onClick={() => setBasis("period")}
              >
                Periodo escolhido
              </button>
              <button
                type="button"
                className={`closing-chip${basis === "customer" ? " active" : ""}`}
                onClick={() => setBasis("customer")}
              >
                Cadastro do cliente
              </button>
            </div>
            {basis === "period" ? (
              <p className="closing-hint">
                TODA carga do periodo entra na fatura do cliente dela — inclusive as em carteira e
                as de cliente sem credito no cadastro. A fatura fecha no ultimo dia do periodo.
              </p>
            ) : (
              <>
                <span className="closing-filter-label">Ciclo de fechamento</span>
                <div className="closing-chip-row">
                  <button
                    type="button"
                    className={`closing-chip${cycles.length === 0 ? " active" : ""}`}
                    onClick={() => setCycles([])}
                  >
                    Todos
                  </button>
                  {INVOICE_CLOSING_CYCLES.map((cycle) => (
                    <button
                      key={cycle}
                      type="button"
                      className={`closing-chip${cycles.includes(cycle) ? " active" : ""}`}
                      onClick={() => toggleCycle(cycle)}
                    >
                      {INVOICE_CLOSING_CYCLE_LABEL[cycle]}
                    </button>
                  ))}
                </div>
                <p className="closing-hint">
                  A data de fechamento vem de Cadastros &gt; Clientes, em &quot;Periodicidade do
                  fechamento&quot;. Cliente sem credito habilitado fica FORA das faturas.
                </p>
              </>
            )}
          </div>

          <div className="closing-filter-block">
            <span className="closing-filter-label">Cliente</span>
            <Picker
              value={customerId}
              options={customerOptions}
              onChange={setCustomerId}
              placeholder="Todos os clientes"
              allowEmpty
              emptyLabel="Todos os clientes"
            />
            <span className="closing-filter-label">Buscar</span>
            <input
              className="closing-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cliente, placa, transportador, nota ou vale"
            />
          </div>

          <div className="closing-filter-block">
            <div className="closing-filter-label-row">
              <span className="closing-filter-label">Placa</span>
              {splitByPlate ? (
                <button type="button" className="closing-clear" onClick={() => setPlates([])}>
                  Limpar ({formatCount(plates.length)})
                </button>
              ) : null}
            </div>
            <input
              className="closing-input"
              value={plateSearch}
              onChange={(event) => setPlateSearch(event.target.value)}
              placeholder="Filtrar placas..."
              aria-label="Filtrar a lista de placas"
            />
            {plates.length > 0 ? (
              <div className="closing-chip-row">
                {plates.map((plate) => (
                  <button
                    key={plate}
                    type="button"
                    className="closing-chip active"
                    title={`Tirar ${plate} do filtro`}
                    onClick={() => togglePlate(plate)}
                  >
                    {plate} ×
                  </button>
                ))}
              </div>
            ) : null}
            <div className="closing-plate-list">
              {visiblePlates.length === 0 ? (
                <p className="closing-hint">
                  {plateOptions.length === 0
                    ? "Nenhuma placa rodou no periodo."
                    : "Nenhuma placa com esse texto."}
                </p>
              ) : (
                visiblePlates.map((plate) => (
                  <label key={plate} className="closing-checkbox">
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
            <p className="closing-hint">
              {splitByPlate
                ? "Uma fatura por placa: o mesmo cliente aparece uma vez para cada caminhao escolhido."
                : "Vazio: uma fatura por cliente, com todas as placas juntas."}
            </p>
          </div>

          <div className="closing-filter-block">
            <span className="closing-filter-label">Formato do arquivo</span>
            <div className="closing-chip-row">
              <label className="closing-checkbox">
                <input
                  type="checkbox"
                  checked={formats.excel}
                  onChange={(event) => setFormats({ ...formats, excel: event.target.checked })}
                />
                Excel
              </label>
              <label className="closing-checkbox">
                <input
                  type="checkbox"
                  checked={formats.pdf}
                  onChange={(event) => setFormats({ ...formats, pdf: event.target.checked })}
                />
                PDF
              </label>
            </div>
            <p className="closing-foot-note">
              A nota fiscal e o boleto sao emitidos no OMIE, a partir do pedido que o KyberRock ja
              enviou.
            </p>
          </div>
        </div>
      </div>

      {error ? <p className="closing-error">{error}</p> : null}
      {exportMessage ? <p className="closing-info">{exportMessage}</p> : null}
      {runError ? <p className="closing-error">{runError}</p> : null}

      {confirmingRun ? (
        <RunConfirmation
          billable={billable.length}
          total={report?.rows.length ?? 0}
          periodLabel={range.label}
          customerLabel={customerLabel}
          onCancel={() => setConfirmingRun(false)}
          onConfirm={() => void handleRunClosing()}
        />
      ) : null}

      {running ? <p className="closing-info">Enviando o fechamento para a balanca...</p> : null}

      {runResult ? (
        <RunResultCard
          result={runResult}
          requests={requests.data ?? []}
          lines={report?.rows ?? []}
          onClose={() => setRunResult(null)}
        />
      ) : null}

      {loading && !report ? <p className="closing-hint">Carregando...</p> : null}

      {report && totals ? (
        <>
          <div className="closing-kpi-grid">
            <Kpi label="Faturas" value={formatCount(report.invoices.length)} />
            <Kpi label="Clientes" value={formatCount(report.customers)} />
            <Kpi label="Cargas" value={formatCount(totals.operations)} />
            <Kpi label="Tonelagem" value={formatTonsShort(totals.netWeightKg)} />
            <Kpi label="Total a faturar" value={formatBRL(totals.totalCents)} />
            <Kpi
              label="Sem nota emitida"
              value={formatBRL(report.withoutInvoice.totalCents)}
              hint={`${formatCount(report.withoutInvoice.operations)} carga(s) esperando a emissao no OMIE`}
              tone={report.withoutInvoice.operations > 0 ? "danger" : "success"}
            />
          </div>

          {report.duplicates.length > 0 ? <DuplicatesCard report={report} /> : null}

          {report.pendingSetup.length > 0 ? (
            <div className="closing-card">
              <h3 className="closing-card-title">
                Clientes fora do fechamento ({formatCount(report.pendingSetup.length)})
              </h3>
              <p className="closing-hint">
                Tiveram carga no periodo mas nao entraram em fatura nenhuma: falta habilitar o
                credito do cliente e escolher a periodicidade do fechamento no cadastro deles.
              </p>
              <div className="closing-scroll">
                <table className="closing-table">
                  <thead>
                    <tr>
                      <th className="left">Cliente</th>
                      <th>Cargas</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pendingSetup.map((row) => (
                      <tr key={row.key}>
                        <td className="left">{row.customerName}</td>
                        <td>{formatCount(row.operations)}</td>
                        <td>{formatBRL(row.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="closing-card">
            <h3 className="closing-card-title">
              {splitByPlate ? "Faturas por placa" : "Faturas"} (
              {formatCount(report.invoices.length)})
            </h3>
            {report.invoices.length === 0 ? (
              <p className="closing-hint">
                {splitByPlate
                  ? "Nenhuma carga das placas escolhidas nos ciclos e no periodo."
                  : "Nenhum cliente com fechamento no periodo e nos ciclos escolhidos."}
              </p>
            ) : (
              <div className="closing-scroll tall">
                <table className="closing-table">
                  <thead>
                    <tr>
                      <th className="left">Cliente</th>
                      {splitByPlate ? <th className="left">Placa</th> : null}
                      <th className="left">Ciclo</th>
                      <th className="left">Fechamento</th>
                      <th className="left">Vencimento</th>
                      <th>Cargas</th>
                      <th>Peso</th>
                      <th>Total</th>
                      <th>Sem nota</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {report.invoices.map((invoice) => (
                      <InvoiceRows
                        key={invoice.key}
                        invoice={invoice}
                        showPlate={splitByPlate}
                        expanded={expanded === invoice.key}
                        onToggle={() =>
                          setExpanded((current) => (current === invoice.key ? null : invoice.key))
                        }
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="total left" colSpan={splitByPlate ? 5 : 4}>
                        TOTAL
                      </td>
                      <td className="total">{formatCount(totals.operations)}</td>
                      <td className="total">{formatKg(totals.netWeightKg)}</td>
                      <td className="total">{formatBRL(totals.totalCents)}</td>
                      <td className="total">
                        {report.withoutInvoice.operations === 0
                          ? "-"
                          : formatCount(report.withoutInvoice.operations)}
                      </td>
                      <td className="total" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="closing-card">
            <h3 className="closing-card-title">Transportadores e placas</h3>
            <p className="closing-hint">
              As mesmas viagens do fechamento, agrupadas por quem levou — para o acerto do frete
              sair da mesma lista que foi cobrada do cliente.
            </p>
            {report.byCarrier.length === 0 ? (
              <p className="closing-hint">Sem viagens no periodo.</p>
            ) : (
              <div className="closing-scroll">
                <table className="closing-table">
                  <thead>
                    <tr>
                      <th className="left">Transportador / placa</th>
                      <th>Viagens</th>
                      <th>Peso</th>
                      <th>Frete</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byCarrier.map((carrier) => (
                      <Fragment key={carrier.carrierName}>
                        <tr>
                          <td className="left strong">{carrier.carrierName}</td>
                          <td>{formatCount(carrier.trips)}</td>
                          <td>{formatKg(carrier.netWeightKg)}</td>
                          <td>{formatBRL(carrier.freightCents)}</td>
                          <td>{formatBRL(carrier.totalCents)}</td>
                        </tr>
                        {carrier.plates.map((plate) => (
                          <tr key={`${carrier.carrierName}|${plate.plate}`}>
                            <td className="left closing-sub-row">{plate.plate}</td>
                            <td>{formatCount(plate.trips)}</td>
                            <td>{formatKg(plate.netWeightKg)}</td>
                            <td>{formatBRL(plate.freightCents)}</td>
                            <td>{formatBRL(plate.totalCents)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="closing-card">
            <h3 className="closing-card-title">
              Pesagem a pesagem ({formatCount(report.rows.length)})
            </h3>
            <p className="closing-hint">
              TODAS as cargas do periodo, na ordem em que foram feitas — inclusive as dos clientes
              que ficaram fora do fechamento. Cada linha traz a operacao inteira: vale, cliente,
              produto, quem levou, valores, situacao no OMIE e em qual fatura ela caiu.
            </p>
            {outsideClosing > 0 ? (
              <p className="closing-hint">
                <strong className="closing-warning-text">
                  {formatCount(outsideClosing)} carga(s) fora do fechamento
                </strong>{" "}
                — aparecem na lista com &quot;Fora do fechamento&quot; no lugar da data, e nao
                entram no total a faturar. Sao dos clientes listados acima, que ainda nao tem
                credito e periodicidade no cadastro.
              </p>
            ) : null}
            {report.rows.length === 0 ? (
              <p className="closing-hint">Nenhuma pesagem no periodo e nos filtros escolhidos.</p>
            ) : (
              <div className="closing-scroll tall">
                <WeighingLinesTable
                  lines={report.rows}
                  totals={report.rowTotals}
                  totalLabel="TOTAL DO PERIODO"
                />
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
  return (
    <div className="closing-kpi">
      <p className="closing-kpi-label">{label}</p>
      <p className={`closing-kpi-value${tone ? ` ${tone}` : ""}`}>{value}</p>
      {hint ? <p className="closing-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * A confirmacao do "Fazer fechamento": o pedido vira NOTA FISCAL na balanca, entao o texto diz
 * quantas saem, de qual periodo e de quem, e o botao de confirmar e o unico caminho.
 */
function RunConfirmation({
  billable,
  total,
  periodLabel,
  customerLabel,
  onCancel,
  onConfirm
}: {
  billable: number;
  total: number;
  periodLabel: string;
  customerLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const nothingToBill = billable === 0;
  return (
    <div className="closing-confirm">
      <h3 className="closing-card-title">Confirmar o fechamento no OMIE</h3>
      {nothingToBill ? (
        <p className="closing-hint">
          Nenhuma das {formatCount(total)} carga(s) deste periodo precisa ser faturada: elas ja tem
          nota emitida, ja estao na fila da balanca, sao repetidas, ou sao vendas internas (que
          geram ordem de servico, e nao nota fiscal).
        </p>
      ) : (
        <p className="closing-hint">
          Vao ser faturadas <strong>{formatCount(billable)}</strong> de {formatCount(total)}{" "}
          carga(s) de <strong>{customerLabel}</strong> em <strong>{periodLabel}</strong>. O pedido
          vai para a balanca da unidade, que fatura cada uma no OMIE — o OMIE emite a nota fiscal
          para o cliente daquela carga.
          {"\n"}As cargas que ja tem nota NAO sao reenviadas, e as notas NAO sao impressas aqui —
          elas ficam no OMIE. Emitir nota nao se desfaz pelo site: cancelar depois e feito no OMIE,
          com prazo e justificativa.
        </p>
      )}
      <div className="closing-chip-row closing-confirm-actions">
        <button type="button" className="closing-link-button" onClick={onCancel}>
          Cancelar
        </button>
        {nothingToBill ? null : (
          <button type="button" className="closing-danger-button" onClick={onConfirm}>
            Faturar {formatCount(billable)} carga(s) no OMIE
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Pesagens repetidas: a MESMA carga registrada duas vezes. Elas ja estao fora das faturas; o
 * cancelamento de vez e feito na balanca ou em Operacoes > Concluidas.
 */
function DuplicatesCard({ report }: { report: InvoiceClosingReport }) {
  const billedTwice = report.duplicates.filter((group) => group.billedMoreThanOnce);
  return (
    <div className="closing-card">
      <h3 className="closing-card-title closing-warning-text">
        Pesagens repetidas ({formatCount(report.duplicates.length)})
      </h3>
      <p className="closing-hint">
        A mesma carga (mesmo cliente, mesma placa, mesmo produto e os dois pesos iguais) registrada
        mais de uma vez — o relancamento feito para corrigir preco ou tipo de venda, com a errada
        esquecida no lugar. Elas <strong>ja estao fora das faturas</strong> (
        {formatBRL(report.duplicateTotals.totalCents)} em{" "}
        {formatCount(report.duplicateTotals.operations)} carga(s)): cobrar as duas seria cobrar a
        mesma carga duas vezes, e e essa soma a mais que faz o total daqui nao bater com o do OMIE.
      </p>
      {billedTwice.length > 0 ? (
        <p className="closing-error">
          {formatCount(billedTwice.length)} carga(s) tem DUAS notas fiscais emitidas no OMIE. Essas
          continuam nas faturas — a nota existe e o cliente vai receber a cobranca dela —, e o
          cancelamento da nota so pode ser feito no OMIE.
        </p>
      ) : null}
      <div className="closing-scroll">
        <table className="closing-table">
          <thead>
            <tr>
              <th className="left">Cliente</th>
              <th className="left">Placa</th>
              <th className="left">Produto</th>
              <th>Entrada / Saida</th>
              <th>Vale que vale</th>
              <th>Vale(s) repetido(s)</th>
              <th>Fora da fatura</th>
            </tr>
          </thead>
          <tbody>
            {report.duplicates.map((group) => (
              <tr key={group.key}>
                <td className="left">{group.customerName}</td>
                <td className="left">{group.plate}</td>
                <td className="left">{group.productDescription}</td>
                <td>
                  {formatKg(group.entryWeightKg)} / {formatKg(group.exitWeightKg)}
                </td>
                <td>
                  {group.kept
                    .map(
                      (kept) =>
                        `${formatCouponNumber(kept.couponNumber)}${kept.invoiceNumber ? ` (nota ${kept.invoiceNumber})` : ""}`
                    )
                    .join(", ")}
                </td>
                <td>
                  {group.repeats
                    .map(
                      (repeat) =>
                        `${formatCouponNumber(repeat.couponNumber)} — ${formatDayLabel(repeat.date)}${repeat.invoiceNumber ? ` (nota ${repeat.invoiceNumber})` : ""}`
                    )
                    .join(", ")}
                </td>
                <td>{formatBRL(group.removedTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="closing-foot-note">
        Para cancelar a repetida de vez, use Operacoes &gt; Concluidas (Venda cancelada) ou o botao
        &quot;Cancelar pesagens repetidas&quot; do Fechamento de faturas na balanca.
      </p>
    </div>
  );
}

/**
 * O que o pedido de fechamento virou, pesagem a pesagem. A balanca fatura no tique dela, entao
 * o cartao acompanha os pedidos ate cada um terminar — e lista so o que NAO entrou, com o motivo.
 */
function RunResultCard({
  result,
  requests,
  lines,
  onClose
}: {
  result: RunResult;
  requests: readonly BillingRequest[];
  lines: readonly InvoiceClosingLine[];
  onClose: () => void;
}) {
  const ids = new Set(result.requestIds);
  const mine = requests.filter((request) => ids.has(request.id));
  const lineById = new Map(lines.map((line) => [line.operationId, line]));
  const done = mine.filter((request) => request.status === "done");
  const waiting = mine.filter(
    (request) => request.status === "pending" || request.status === "processing"
  ).length;
  const failed = mine.filter((request) => request.status === "failed");
  const billedCents = done.reduce(
    (sum, request) => sum + (lineById.get(request.operation_id)?.totalCents ?? 0),
    0
  );
  const problems = [
    ...failed.map((request) => ({
      operationId: request.operation_id,
      message: request.result_message ?? "A balanca nao conseguiu faturar."
    })),
    ...result.skipped.map((item) => ({ operationId: item.operationId, message: item.reason }))
  ];

  return (
    <div className="closing-card">
      <div className="closing-filter-label-row">
        <h3 className="closing-card-title">Resultado do fechamento</h3>
        <button type="button" className="closing-clear" onClick={onClose}>
          Fechar
        </button>
      </div>
      <p className={problems.length > 0 ? "closing-error" : "closing-info"}>
        {formatCount(result.requested)} pedido(s) de faturamento enviado(s) para a balanca.
        {done.length > 0
          ? ` ${formatCount(done.length)} carga(s) faturada(s) no OMIE — ${formatBRL(billedCents)}.`
          : ""}
        {waiting > 0
          ? ` ${formatCount(waiting)} aguardando a balanca (a tela se atualiza sozinha).`
          : ""}
        {problems.length > 0
          ? ` ${formatCount(problems.length)} carga(s) NAO foram faturadas — veja abaixo.`
          : ""}
      </p>
      {problems.length > 0 ? (
        <div className="closing-scroll">
          <table className="closing-table">
            <thead>
              <tr>
                <th className="left">Vale</th>
                <th className="left">Cliente</th>
                <th>Valor</th>
                <th className="left">Por que nao faturou</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((item) => {
                const line = lineById.get(item.operationId);
                return (
                  <tr key={item.operationId}>
                    <td className="left">{formatCouponNumber(line?.couponNumber ?? null)}</td>
                    <td className="left" title={line?.customerName}>
                      {line?.customerName ?? "-"}
                    </td>
                    <td>{formatBRL(line?.totalCents ?? 0)}</td>
                    <td className="left wrap" title={item.message}>
                      {item.message}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** A linha da fatura e, quando aberta, as cargas dela. */
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
        <td className="left strong" title={invoice.customerName}>
          {invoice.customerName}
        </td>
        {showPlate ? <td className="left strong">{invoice.plate ?? "-"}</td> : null}
        <td className="left">{invoice.cycleLabel}</td>
        <td className="left">{formatDayLabel(invoice.closingDate)}</td>
        <td className="left">{formatDayLabel(invoice.dueDate)}</td>
        <td>{formatCount(invoice.totals.operations)}</td>
        <td>{formatKg(invoice.totals.netWeightKg)}</td>
        <td className="strong">{formatBRL(invoice.totals.totalCents)}</td>
        <td className={invoice.operationsWithoutInvoice > 0 ? "danger" : undefined}>
          {invoice.operationsWithoutInvoice === 0
            ? "-"
            : formatCount(invoice.operationsWithoutInvoice)}
        </td>
        <td>
          <button type="button" className="closing-link-button" onClick={onToggle}>
            {expanded ? "Fechar" : "Ver cargas"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td className="closing-detail-cell" colSpan={showPlate ? 10 : 9}>
            <div className="closing-detail">
              <table className="closing-table">
                <thead>
                  <tr>
                    <th className="left">Data</th>
                    <th className="left">Vale</th>
                    <th className="left">Nota fiscal</th>
                    <th className="left">Pedido OMIE</th>
                    <th className="left">Placa</th>
                    <th className="left">Transportador</th>
                    <th className="left">Motorista</th>
                    <th className="left">Produto</th>
                    <th>Peso</th>
                    <th>Frete</th>
                    <th>Total</th>
                    <th className="left">Situacao</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.operationId}>
                      <td className="left">{formatDayLabel(line.date)}</td>
                      <td className="left">{formatCouponNumber(line.couponNumber)}</td>
                      <td className="left">
                        <InvoiceNumberCell line={line} />
                      </td>
                      <td className="left">{omieReference(line)}</td>
                      <td className="left">{line.plate}</td>
                      <td className="left" title={line.carrierName}>
                        {line.carrierName}
                      </td>
                      <td className="left">{line.driverName}</td>
                      <td className="left" title={line.productDescription}>
                        {line.productDescription}
                      </td>
                      <td>{formatKg(line.netWeightKg)}</td>
                      <td>{formatBRL(line.freightTotalCents)}</td>
                      <td className="strong">{formatBRL(line.totalCents)}</td>
                      <td className="left">{lineSituation(line).label}</td>
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

/** A celula "Nota fiscal": vermelho so na venda com nota que ainda esta sem numero. */
function InvoiceNumberCell({ line }: { line: InvoiceClosingLine }) {
  const label = invoiceNumberLabel(line.invoiceNumber, line.operationType);
  return (
    <span className={`closing-invoice-number ${label.state}`} title={label.title ?? undefined}>
      {label.text}
    </span>
  );
}

/** A tabela "pesagem a pesagem" — a mesma `WeighingLinesTable` do desktop, com as colunas do fechamento. */
function WeighingLinesTable({
  lines,
  totals,
  totalLabel
}: {
  lines: readonly InvoiceClosingLine[];
  totals: InvoiceClosingTotals;
  totalLabel: string;
}) {
  return (
    <table className="closing-table">
      <thead>
        <tr>
          <th className="left">Op.</th>
          <th className="left">Vale</th>
          <th className="left">Data</th>
          <th className="left">Cliente</th>
          <th className="left">CNPJ/CPF</th>
          <th className="left">Produto</th>
          <th className="left">Placa</th>
          <th className="left">Transportador</th>
          <th className="left">Motorista</th>
          <th>Peso</th>
          <th>Preco unit.</th>
          <th>Produto</th>
          <th>Frete</th>
          <th>Total</th>
          <th className="left">Tipo</th>
          <th className="left">Situacao</th>
          <th className="left">Nota fiscal</th>
          <th className="left">Pedido/OS OMIE</th>
          <th className="left">Fechamento</th>
          <th className="left">Vencimento</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const situation = lineSituation(line);
          const productLabel = line.productCode
            ? `${line.productCode} - ${line.productDescription}`
            : line.productDescription;
          return (
            <tr key={line.operationId}>
              <td className="left">{line.couponNumber === null ? "-" : line.couponNumber}</td>
              <td className="left">{formatCouponNumber(line.couponNumber)}</td>
              <td
                className="left"
                title={line.closedAt ? `Saida: ${formatDateTime(line.closedAt)}` : ""}
              >
                {formatDayLabel(line.date)}
              </td>
              <td className="left" title={line.customerName}>
                {line.customerName}
              </td>
              <td className="left">{line.customerDocument ?? "-"}</td>
              <td className="left" title={line.productDescription}>
                {productLabel}
              </td>
              <td className="left">{line.plate}</td>
              <td className="left" title={line.carrierName}>
                {line.carrierName}
              </td>
              <td className="left">{line.driverName}</td>
              <td>{formatKg(line.netWeightKg)}</td>
              <td>{unitPriceLabel(line)}</td>
              <td>{formatBRL(line.productTotalCents)}</td>
              <td>{formatBRL(line.freightTotalCents)}</td>
              <td className="strong">{formatBRL(line.totalCents)}</td>
              <td className="left">{line.operationTypeLabel}</td>
              <td className="left">
                <span
                  className={`closing-situation ${situation.tone}`}
                  title={situation.title ?? undefined}
                >
                  {situation.label}
                </span>
              </td>
              <td className="left">
                <InvoiceNumberCell line={line} />
              </td>
              <td className="left">{omieReference(line)}</td>
              {line.closingDate === null ? (
                <td
                  className="left warning"
                  colSpan={2}
                  title={
                    line.isDuplicate
                      ? "Esta carga ja esta no fechamento em outro vale: a mesma pesagem foi registrada duas vezes. Cobrar as duas seria cobrar a carga duas vezes."
                      : "Esta carga nao entrou em fatura nenhuma: o cliente nao tem credito e periodicidade do fechamento no cadastro."
                  }
                >
                  {line.isDuplicate
                    ? `Repetida do vale ${formatCouponNumber(line.duplicateOfCouponNumber)}`
                    : "Fora do fechamento"}
                </td>
              ) : (
                <>
                  <td className="left">{formatDayLabel(line.closingDate)}</td>
                  <td className="left">{line.dueDate ? formatDayLabel(line.dueDate) : "-"}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td className="total left" colSpan={9}>
            {totalLabel}
          </td>
          <td className="total">{formatKg(totals.netWeightKg)}</td>
          <td className="total" />
          <td className="total">{formatBRL(totals.productCents)}</td>
          <td className="total">{formatBRL(totals.freightCents)}</td>
          <td className="total">{formatBRL(totals.totalCents)}</td>
          <td className="total" colSpan={6} />
        </tr>
      </tfoot>
    </table>
  );
}
