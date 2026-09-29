import "./billing-conference.css";

import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { Picker } from "../components/Picker";
import { Alert, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from "../components/ui";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  BILLING_PERIOD_OPTIONS,
  BILLING_SITUATIONS,
  BILLING_SITUATION_LABEL,
  BILLING_SITUATION_TONE,
  buildBillingReport,
  buildBillingReportFiles,
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
  type BillingExportFormat,
  type BillingPeriod,
  type BillingRow,
  type BillingSituation
} from "../lib/billing-conference";
import { formatDateTime, formatDocument, todayIso } from "../lib/format";
import { deliverReports, spreadsheetFileName } from "../lib/report-output";
import { useAsync } from "../lib/use-async";

const HELP =
  "Lista pesagem a pesagem do período: cliente, data, produto, peso, frete e total de cada carregamento fechado na balança, com a situação dele no OMIE. Use o filtro de situação para isolar o que ainda não foi faturado e conferir contra o relatório do OMIE. O PDF e a planilha saem com as mesmas linhas que estão na tela.";

/**
 * Conferencia de faturamento — a tela `WeighingBillingReportView` do desktop, lendo a nuvem.
 * Periodo pela data de FECHAMENTO da pesagem. Os arquivos sao os do desktop, gerados pelo
 * mesmo renderizador (`lib/desktop/weighing-billing-report-render.ts`): o "Excel" baixa a
 * planilha `.xls` com o nome que o desktop grava, e o "PDF" abre a impressao do navegador com
 * o documento A4 paisagem (la se escolhe "Salvar como PDF").
 */
export function BillingConference() {
  const user = useUser();
  const [customerId, setCustomerId] = useState("");
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [customStart, setCustomStart] = useState(() => todayIso());
  const [customEnd, setCustomEnd] = useState(() => todayIso());
  const [situations, setSituations] = useState<BillingSituation[]>([]);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  // O que a geracao do arquivo respondeu: os nomes gerados (info) ou o que faltou/falhou (erro).
  const [exportMessage, setExportMessage] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  const [formats, setFormats] = useState<{ pdf: boolean; excel: boolean }>({
    pdf: false,
    excel: true
  });

  const range = useMemo(
    () => resolveRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );
  const selectedFormats = useMemo(
    () => (["pdf", "excel"] as const).filter((format) => formats[format]) as BillingExportFormat[],
    [formats]
  );

  const customers = useAsync(() => loadCustomerOptions(user.companyId), [user.companyId], {
    key: `conferencia-faturamento:clientes:${user.companyId}`
  });
  const customerOptions = useMemo(
    () =>
      (customers.data ?? []).map((customer) => ({
        value: customer.id,
        label: customer.name,
        hint: customer.document ? formatDocument(customer.document) : undefined
      })),
    [customers.data]
  );

  // Situacao e busca filtram na tela: a leitura e so empresa + unidade + periodo + cliente.
  const { data, loading, error, reload, refresh } = useAsync(
    () => loadBillingRows(user.companyId, user.unitId, range, customerId || null),
    [user.companyId, user.unitId, range.start, range.end, customerId],
    {
      key: `conferencia-faturamento:pesagens:${user.companyId}:${user.unitId}:${range.start}:${range.end}:${customerId}`
    }
  );
  // Pesagem fechada, editada ou cancelada na balanca entra na tela na hora.
  useOnCadastroChange(refresh, CADASTRO_TABLES.operations);
  useOnCadastroChange(customers.refresh, CADASTRO_TABLES.customers);

  // O mesmo relatorio alimenta a tela e o arquivo: o PDF/planilha sai com as MESMAS linhas
  // que estao na tela, e o envelope (periodo, cliente, situacoes, busca) diz o que ele mostra.
  const report = useMemo(
    () =>
      data
        ? buildBillingReport(data, {
            range,
            customerId: customerId || null,
            situations,
            search
          })
        : null,
    [data, range, customerId, situations, search]
  );

  function toggleSituation(situation: BillingSituation) {
    setSituations((current) =>
      current.includes(situation)
        ? current.filter((item) => item !== situation)
        : [...current, situation]
    );
  }

  async function handleExport(): Promise<void> {
    if (!report) return;
    if (selectedFormats.length === 0) {
      setExportMessage({ kind: "error", text: "Selecione ao menos um formato: PDF ou Excel." });
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      const files = buildBillingReportFiles(report, selectedFormats);
      const names = [
        ...files.pdf.map((file) => file.filename),
        ...files.xls.map((file) => spreadsheetFileName(file.filename))
      ];
      await deliverReports(files);
      setExportMessage({
        kind: "info",
        text:
          names.length === 1
            ? `Arquivo gerado: ${names[0]}`
            : `${names.length} arquivos gerados:\n${names.join("\n")}`
      });
    } catch (err) {
      setExportMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Falha ao gerar o relatório."
      });
    } finally {
      setExporting(false);
    }
  }

  const totals = report?.totals ?? null;
  const unbilled = report?.unbilled ?? null;
  const billedOperations = totals && unbilled ? totals.operations - unbilled.operations : null;
  const combinedError = error ?? customers.error;

  return (
    <section className="billing-conference">
      <PageHeader
        kicker="Análise"
        title="Conferência de faturamento"
        help={HELP}
        actions={
          <button
            type="button"
            className="btn primary"
            title="Gera os arquivos escolhidos com as pesagens filtradas: a planilha Excel baixa na hora e o PDF abre a impressão do navegador (escolha Salvar como PDF)."
            disabled={exporting || loading || !report}
            onClick={() => void handleExport()}
          >
            <Download size={16} aria-hidden="true" />
            {exporting
              ? "Gerando..."
              : selectedFormats.length > 1
                ? `Gerar ${selectedFormats.length} arquivos`
                : "Gerar relatório"}
          </button>
        }
      />

      <div className="billing-conference-card billing-conference-filters">
        <div className="billing-conference-filter-grid">
          <div className="billing-conference-filter-block">
            <span className="billing-conference-filter-label">Período</span>
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
                  Até
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
              placeholder="Cliente, produto, placa ou número da operação"
            />
          </div>

          <div className="billing-conference-filter-block">
            <span className="billing-conference-filter-label">Situação no OMIE</span>
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

      {combinedError ? (
        <ErrorState
          message={combinedError}
          onRetry={() => void (error ? reload() : customers.reload())}
        />
      ) : null}
      {exportMessage ? (
        <Alert kind={exportMessage.kind}>
          <span className="billing-conference-pre-line">{exportMessage.text}</span>
        </Alert>
      ) : null}

      {loading && !report ? (
        <div className="billing-conference-card">
          <SkeletonRows rows={6} columns={6} />
        </div>
      ) : null}

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
              hint={`${formatCount(unbilled.operations)} ${unbilled.operations === 1 ? "pesagem" : "pesagens"} - ${formatTons(unbilled.netWeightKg)}`}
              tone={unbilled.operations > 0 ? "danger" : "success"}
            />
          </div>

          <div className="billing-conference-card">
            <h3 className="billing-conference-card-title">Situação do faturamento</h3>
            {report.bySituation.length === 0 ? (
              <EmptyState title="Sem pesagens no período." />
            ) : (
              <div className="billing-conference-scroll">
                <table className="billing-conference-table">
                  <thead>
                    <tr>
                      <th className="left">Situação</th>
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
              O KyberRock envia ao OMIE o pedido de venda (ou a ordem de serviço, na venda interna);
              a nota fiscal é emitida no próprio OMIE, na etapa &quot;Faturar&quot;. Uma pesagem em
              &quot;No OMIE, falta faturar&quot; já saiu daqui certa — o que falta é a emissão lá.
            </p>
          </div>

          <div className="billing-conference-card">
            <h3 className="billing-conference-card-title">
              Pesagem a pesagem ({formatCount(report.rows.length)})
            </h3>
            {report.rows.length === 0 ? (
              <EmptyState title="Nenhuma pesagem com os filtros escolhidos." />
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
    <Pill tone={BILLING_SITUATION_TONE[situation]} title={title}>
      {label}
    </Pill>
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
          <th>Preço unit.</th>
          <th>Produto</th>
          <th>Frete</th>
          <th>Total</th>
          <th className="left">Tipo</th>
          <th className="left">Situação</th>
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
              title={row.closedAt ? `Saída: ${formatDateTime(row.closedAt)}` : ""}
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
