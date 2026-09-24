import "./billing-conference.css";

import { Download, Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";

import { Picker } from "../components/Picker";
import { useUser } from "../lib/auth";
import {
  BILLING_PERIOD_OPTIONS,
  BILLING_SITUATIONS,
  BILLING_SITUATION_LABEL,
  BILLING_SITUATION_TONE,
  billingConferenceCsv,
  buildBillingReport,
  formatBRL,
  formatCount,
  formatDayLabel,
  formatKg,
  formatTons,
  invoiceNumberLabel,
  loadBillingRows,
  loadCustomerOptions,
  omieReference,
  resolveRange,
  unitPriceLabel,
  type BillingPeriod,
  type BillingRow,
  type BillingSituation
} from "../lib/billing-conference";
import { formatDateTime, formatDocument, todayIso } from "../lib/format";
import { useAsync } from "../lib/use-async";

const HELP =
  "Lista pesagem a pesagem do periodo: cliente, data, produto, peso, frete e total de cada carregamento fechado na balanca, com a situacao dele no OMIE. Use o filtro de situacao para isolar o que ainda nao foi faturado e conferir contra o relatorio do OMIE. O PDF e a planilha saem com as mesmas linhas que estao na tela.";

/**
 * Conferencia de faturamento — a tela `WeighingBillingReportView` do desktop, lendo a nuvem.
 * Periodo pela data de FECHAMENTO da pesagem. No site o "Excel" baixa um CSV com as mesmas
 * linhas da tela e o "PDF" abre a impressao do navegador.
 */
export function BillingConference() {
  const user = useUser();
  const [customerId, setCustomerId] = useState("");
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [customStart, setCustomStart] = useState(() => todayIso());
  const [customEnd, setCustomEnd] = useState(() => todayIso());
  const [situations, setSituations] = useState<BillingSituation[]>([]);
  const [search, setSearch] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [formats, setFormats] = useState<{ pdf: boolean; excel: boolean }>({
    pdf: false,
    excel: true
  });

  const range = useMemo(
    () => resolveRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );
  const selectedFormats = (["pdf", "excel"] as const).filter((format) => formats[format]);

  const customers = useAsync(() => loadCustomerOptions(user.companyId), [user.companyId]);
  const customerOptions = useMemo(
    () =>
      (customers.data ?? []).map((customer) => ({
        value: customer.id,
        label: customer.name,
        hint: customer.document ? formatDocument(customer.document) : undefined
      })),
    [customers.data]
  );

  const { data, loading, error } = useAsync(
    () => loadBillingRows(user.companyId, user.unitId, range, customerId || null),
    [user.companyId, user.unitId, range.start, range.end, customerId]
  );

  const report = useMemo(
    () => (data ? buildBillingReport(data, situations, search) : null),
    [data, situations, search]
  );

  function toggleSituation(situation: BillingSituation) {
    setSituations((current) =>
      current.includes(situation)
        ? current.filter((item) => item !== situation)
        : [...current, situation]
    );
  }

  function handleExport() {
    if (!report) return;
    if (selectedFormats.length === 0) {
      setExportMessage("Selecione ao menos um formato: PDF ou Excel.");
      return;
    }
    setExportMessage(null);
    if (formats.excel) {
      const fileName = `conferencia-faturamento-${range.start}-a-${range.end}.csv`;
      const blob = new Blob([billingConferenceCsv(report, range)], {
        type: "text/csv;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportMessage(`Arquivo baixado: ${fileName}`);
    }
    if (formats.pdf) window.print();
  }

  const totals = report?.totals ?? null;
  const unbilled = report?.unbilled ?? null;
  const billedOperations = totals && unbilled ? totals.operations - unbilled.operations : null;
  const combinedError = error ?? customers.error;

  return (
    <section className="billing-conference">
      <header className="billing-conference-header">
        <div className="billing-conference-title-row">
          <h2 className="billing-conference-title">Conferencia de faturamento</h2>
          <span className="billing-conference-help" role="img" aria-label="Dica" title={HELP}>
            <Lightbulb size={14} />
          </span>
          <span className="billing-conference-print-only">
            {range.label}: {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
          </span>
        </div>
        <button
          type="button"
          className="icon-action primary billing-conference-no-print"
          aria-label={
            selectedFormats.length > 1
              ? `Gerar ${selectedFormats.length} arquivos`
              : "Gerar relatorio"
          }
          title="Gera os arquivos escolhidos com as pesagens filtradas: o Excel sai como planilha CSV e o PDF pela impressao do navegador."
          disabled={loading || !report}
          onClick={handleExport}
        >
          <Download size={16} />
        </button>
      </header>

      <div className="billing-conference-card billing-conference-filters">
        <div className="billing-conference-filter-grid">
          <div className="billing-conference-filter-block">
            <span className="billing-conference-filter-label">Periodo</span>
            <div className="billing-conference-chips">
              {BILLING_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`billing-conference-chip${period === option.id ? " active" : ""}`}
                  onClick={() => setPeriod(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {period === "custom" ? (
              <div className="billing-conference-dates">
                <label className="billing-conference-date">
                  De
                  <input
                    type="date"
                    className="billing-conference-input"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                  />
                </label>
                <label className="billing-conference-date">
                  Ate
                  <input
                    type="date"
                    className="billing-conference-input"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <p className="billing-conference-hint">
              {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
            </p>
          </div>

          <div className="billing-conference-filter-block">
            <span className="billing-conference-filter-label">Cliente</span>
            <Picker
              value={customerId}
              options={customerOptions}
              onChange={setCustomerId}
              placeholder="Todos os clientes"
              allowEmpty
              emptyLabel="Todos os clientes"
            />
            <span className="billing-conference-filter-label">Buscar</span>
            <input
              className="billing-conference-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cliente, produto, placa ou numero da operacao"
            />
          </div>

          <div className="billing-conference-filter-block">
            <span className="billing-conference-filter-label">Situacao no OMIE</span>
            <div className="billing-conference-chips">
              <button
                type="button"
                className={`billing-conference-chip${situations.length === 0 ? " active" : ""}`}
                onClick={() => setSituations([])}
              >
                Todas
              </button>
              {BILLING_SITUATIONS.map((situation) => (
                <button
                  key={situation}
                  type="button"
                  className={`billing-conference-chip${situations.includes(situation) ? " active" : ""}`}
                  onClick={() => toggleSituation(situation)}
                >
                  {BILLING_SITUATION_LABEL[situation]}
                </button>
              ))}
            </div>
            <span className="billing-conference-filter-label">Formato do arquivo</span>
            <div className="billing-conference-chips">
              <label className="billing-conference-check">
                <input
                  type="checkbox"
                  checked={formats.excel}
                  onChange={(event) => setFormats({ ...formats, excel: event.target.checked })}
                />
                Excel
              </label>
              <label className="billing-conference-check">
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

      {combinedError ? <p className="billing-conference-error">{combinedError}</p> : null}
      {exportMessage ? <p className="billing-conference-info">{exportMessage}</p> : null}

      {loading && !report ? <p className="billing-conference-hint">Carregando...</p> : null}

      {report && totals && unbilled ? (
        <>
          <div className="billing-conference-kpis">
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

          <div className="billing-conference-card">
            <h3 className="billing-conference-card-title">Situacao do faturamento</h3>
            {report.bySituation.length === 0 ? (
              <p className="billing-conference-hint">Sem pesagens no periodo.</p>
            ) : (
              <div className="billing-conference-scroll">
                <table className="billing-conference-table">
                  <thead>
                    <tr>
                      <th className="left">Situacao</th>
                      <th>Pesagens</th>
                      <th>Peso</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bySituation.map((row) => (
                      <tr key={row.situation}>
                        <td className="left">
                          <SituationPill situation={row.situation} label={row.label} />
                        </td>
                        <td>{formatCount(row.operations)}</td>
                        <td>{formatKg(row.netWeightKg)}</td>
                        <td>{formatBRL(row.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="billing-conference-foot-note">
              O KyberRock envia ao OMIE o pedido de venda (ou a ordem de servico, na venda interna);
              a nota fiscal e emitida no proprio OMIE, na etapa &quot;Faturar&quot;. Uma pesagem em
              &quot;No OMIE, falta faturar&quot; ja saiu daqui certa — o que falta e a emissao la.
            </p>
          </div>

          <div className="billing-conference-card">
            <h3 className="billing-conference-card-title">
              Pesagem a pesagem ({formatCount(report.rows.length)})
            </h3>
            {report.rows.length === 0 ? (
              <p className="billing-conference-hint">Nenhuma pesagem com os filtros escolhidos.</p>
            ) : (
              <div className="billing-conference-scroll tall">
                <WeighingLinesTable rows={report.rows} totals={totals} />
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
    <div className="billing-conference-card">
      <p className="billing-conference-kpi-label">{label}</p>
      <p className={`billing-conference-kpi-value${tone ? ` ${tone}` : ""}`}>{value}</p>
      {hint ? <p className="billing-conference-hint">{hint}</p> : null}
    </div>
  );
}

function SituationPill({
  situation,
  label,
  title
}: {
  situation: BillingSituation;
  label: string;
  title?: string;
}) {
  return (
    <span className={`billing-conference-pill ${BILLING_SITUATION_TONE[situation]}`} title={title}>
      {label}
    </span>
  );
}

function InvoiceNumberCell({ row }: { row: BillingRow }) {
  const label = invoiceNumberLabel(row.omieInvoiceNumber, row.operationType);
  return (
    <span className={`billing-conference-invoice ${label.state}`} title={label.title ?? undefined}>
      {label.text}
    </span>
  );
}

/** A tabela "pesagem a pesagem" (o `WeighingLinesTable` do desktop, colunas da Conferencia). */
function WeighingLinesTable({
  rows,
  totals
}: {
  rows: readonly BillingRow[];
  totals: { netWeightKg: number; productCents: number; freightCents: number; totalCents: number };
}) {
  return (
    <table className="billing-conference-table">
      <thead>
        <tr>
          <th className="left">Op.</th>
          <th className="left">Data</th>
          <th className="left">Cliente</th>
          <th className="left">Produto</th>
          <th className="left">Placa</th>
          <th>Peso</th>
          <th>Preco unit.</th>
          <th>Produto</th>
          <th>Frete</th>
          <th>Total</th>
          <th className="left">Tipo</th>
          <th className="left">Situacao</th>
          <th className="left">Nota fiscal</th>
          <th className="left">Pedido/OS OMIE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.operationId}>
            <td className="left">{row.operationCode === null ? "-" : row.operationCode}</td>
            <td
              className="left"
              title={row.closedAt ? `Saida: ${formatDateTime(row.closedAt)}` : ""}
            >
              {formatDayLabel(row.date)}
            </td>
            <td className="left" title={row.customerName}>
              {row.customerName}
            </td>
            <td className="left" title={row.productDescription}>
              {row.productDescription}
            </td>
            <td className="left">{row.plate}</td>
            <td>{formatKg(row.netWeightKg)}</td>
            <td>{unitPriceLabel(row)}</td>
            <td>{formatBRL(row.productTotalCents)}</td>
            <td>{formatBRL(row.freightTotalCents)}</td>
            <td className="strong">{formatBRL(row.totalCents)}</td>
            <td className="left">{row.operationTypeLabel}</td>
            <td className="left">
              <SituationPill
                situation={row.situation}
                label={row.situationLabel}
                title={row.situationDetail ?? undefined}
              />
            </td>
            <td className="left">
              <InvoiceNumberCell row={row} />
            </td>
            <td className="left">{omieReference(row)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="left" colSpan={5}>
            TOTAL
          </td>
          <td>{formatKg(totals.netWeightKg)}</td>
          {/* Preco unitario nao soma: sao precos diferentes por carga. */}
          <td />
          <td>{formatBRL(totals.productCents)}</td>
          <td>{formatBRL(totals.freightCents)}</td>
          <td>{formatBRL(totals.totalCents)}</td>
          <td colSpan={4} />
        </tr>
      </tfoot>
    </table>
  );
}
