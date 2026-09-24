import "./customer-report.css";

import { CircleHelp, Download } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Picker, type PickerOption } from "../components/Picker";
import { errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import {
  PERIOD_OPTIONS,
  buildCustomerOptions,
  buildCustomerReport,
  buildCustomersOverview,
  customerReportCsv,
  customerReportFileBaseName,
  customerReportTables,
  formatBRL,
  formatDayLabel,
  formatKg,
  formatNumber,
  formatReportTons,
  loadReportLookups,
  loadReportOperations,
  maxDueDays,
  overviewCsv,
  overviewTables,
  resolveCustomerIdGroup,
  resolveRange,
  type CustomerReport as CustomerReportData,
  type CustomerReportVariant,
  type CustomersOverview,
  type PeriodPreset,
  type ReportTable
} from "../lib/customer-report";
import { formatDocument, todayIso } from "../lib/format";
import { useAsync } from "../lib/use-async";

/**
 * Valor de `customerId` que pede o resumo comparativo do periodo inteiro em vez do relatorio
 * de um cliente. Nao colide com id nenhum: os ids sao UUID.
 */
const ALL_CUSTOMERS = "__all__";

const HELP =
  "Gera o relatorio de um cliente no periodo escolhido, com transporte, compras, pagamentos, quanto ele carregou de cada material e em que dias, tonelagem, as viagens de cada placa/motorista em sequencia e as parcelas a vencer. Use datas futuras para ver os dias em que o cliente ainda tem parcelas a pagar. Escolha os modelos (simplificado e/ou completo) e os formatos (PDF e/ou Excel). Em 'Todos os clientes', sai a lista comparativa do periodo: um cliente por linha, do que mais faturou para o que menos faturou, e os materiais que cada um carregou.";

function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([String.fromCharCode(0xfeff) + content], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Relatorio por cliente: o usuario escolhe o cliente, o periodo (atalhos ou datas
 * personalizadas), quais modelos quer (simplificado e/ou completo) e em quais formatos
 * (PDF e/ou Excel). A tela mostra a previa dos mesmos dados que vao para o arquivo. Em
 * "Todos os clientes" sai a lista comparativa do periodo.
 *
 * Le a nuvem (pesagens da unidade do usuario, como a balanca le as dela). O PDF e a
 * impressao da propria previa ("Salvar como PDF"); o Excel e uma planilha CSV.
 */
export function CustomerReport() {
  const user = useUser();
  const [customerId, setCustomerId] = useState("");
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [customStart, setCustomStart] = useState(() => todayIso());
  const [customEnd, setCustomEnd] = useState(() => todayIso());
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [variants, setVariants] = useState<Record<CustomerReportVariant, boolean>>({
    simplified: true,
    complete: false
  });
  const [formats, setFormats] = useState<{ pdf: boolean; excel: boolean }>({
    pdf: true,
    excel: false
  });

  const range = useMemo(
    () => resolveRange(period, customStart, customEnd, todayIso()),
    [period, customStart, customEnd]
  );
  const allCustomers = customerId === ALL_CUSTOMERS;

  const selectedVariants = (Object.keys(variants) as CustomerReportVariant[]).filter(
    (variant) => variants[variant]
  );
  const selectedFormats = (["pdf", "excel"] as const).filter((format) => formats[format]);

  const lookups = useAsync(() => loadReportLookups(user.companyId), [user.companyId]);
  const customers = useMemo(
    () => buildCustomerOptions(lookups.data?.customers ?? []),
    [lookups.data]
  );
  const pickerOptions = useMemo<PickerOption[]>(
    () => [
      { value: ALL_CUSTOMERS, label: "Todos os clientes (resumo do periodo)" },
      ...customers.map((customer) => ({
        value: customer.id,
        label: customer.name,
        hint: customer.document ? formatDocument(customer.document) : undefined
      }))
    ],
    [customers]
  );

  const result = useAsync(async (): Promise<
    | { kind: "report"; report: CustomerReportData }
    | { kind: "overview"; overview: CustomersOverview }
    | null
  > => {
    const data = lookups.data;
    if (!data || !customerId) return null;
    const referenceDate = todayIso();
    const rows = await loadReportOperations({
      companyId: user.companyId,
      unitId: user.unitId,
      // O cliente escolhido pode ter mais de um cadastro (o do OMIE e o da balanca, mesmo
      // CNPJ): o relatorio e do cliente REAL, e le as cargas de todos eles.
      customerIds: allCustomers ? null : resolveCustomerIdGroup(data.customers, customerId),
      startDay: range.start,
      endDay: range.end,
      lookbackDays: maxDueDays(data)
    });
    const input = {
      rows,
      lookups: data,
      startDate: range.start,
      endDate: range.end,
      referenceDate
    };
    return allCustomers
      ? { kind: "overview", overview: buildCustomersOverview(input) }
      : { kind: "report", report: buildCustomerReport({ ...input, customerId }) };
  }, [lookups.data, customerId, range.start, range.end, user.companyId, user.unitId]);

  const report = result.data?.kind === "report" ? result.data.report : null;
  const overview = result.data?.kind === "overview" ? result.data.overview : null;
  const loading = lookups.loading || (Boolean(customerId) && result.loading);
  const error = lookups.error ?? (customerId ? result.error : null);

  const fileCount = allCustomers
    ? selectedFormats.length
    : selectedVariants.length * selectedFormats.length;

  function handleExport(): void {
    if (!customerId) return;
    // O resumo de todos os clientes e uma lista unica: nao ha modelo a escolher.
    if (!allCustomers && selectedVariants.length === 0) {
      setExportMessage("Selecione ao menos um modelo: simplificado ou completo.");
      return;
    }
    if (selectedFormats.length === 0) {
      setExportMessage("Selecione ao menos um formato: PDF ou Excel.");
      return;
    }
    try {
      const files: string[] = [];
      if (formats.excel) {
        if (overview) {
          const name = `relatorio-clientes-${overview.startDate}-a-${overview.endDate}.csv`;
          downloadCsv(name, overviewCsv(overview, range.label));
          files.push(name);
        } else if (report) {
          for (const variant of selectedVariants) {
            const name = `${customerReportFileBaseName(report, variant)}.csv`;
            downloadCsv(name, customerReportCsv(report, variant, range.label));
            files.push(name);
          }
        }
      }
      const lines = [
        files.length === 1
          ? `Arquivo baixado: ${files[0]}`
          : files.length > 1
            ? `${files.length} arquivos baixados:\n${files.join("\n")}`
            : null,
        formats.pdf
          ? 'PDF: na janela de impressao, escolha "Salvar como PDF". Sai a previa desta tela.'
          : null
      ].filter(Boolean);
      setExportMessage(lines.join("\n"));
      if (formats.pdf) window.setTimeout(() => window.print(), 50);
    } catch (caught) {
      setExportMessage(errorMessage(caught, "Falha ao gerar o relatorio."));
    }
  }

  // No PDF sai o modelo mais completo escolhido; na tela, o completo aparece quando marcado.
  const showComplete = variants.complete;
  const totals = report?.totals ?? null;
  const dues = report?.installmentTotals ?? null;

  return (
    <section className="cr-page">
      <header className="cr-header">
        <div className="cr-title-row">
          <h2 className="cr-title">Relatorio por cliente</h2>
          <span className="cr-help" title={HELP} aria-label={HELP} role="img">
            <CircleHelp size={14} />
          </span>
        </div>
        <div className="cr-header-actions">
          <button
            type="button"
            className="icon-action primary"
            aria-label={fileCount > 1 ? `Gerar ${fileCount} arquivos` : "Gerar relatorio"}
            title="Gera os arquivos escolhidos: o Excel e baixado como planilha e o PDF sai pela impressao da previa."
            disabled={!customerId || loading || !result.data}
            onClick={handleExport}
          >
            <Download size={16} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="cr-card cr-filters">
        <div className="cr-filter-grid">
          <div className="cr-filter-block">
            <span className="cr-filter-label">Cliente</span>
            <Picker
              value={customerId}
              options={pickerOptions}
              onChange={setCustomerId}
              placeholder="Buscar cliente por nome ou CNPJ/CPF..."
            />
            {customers.length > 8 ? (
              <p className="cr-hint">
                {customers.length} clientes cadastrados. Escreva o nome, o nome fantasia ou o
                CNPJ/CPF.
              </p>
            ) : null}
            {allCustomers ? (
              <p className="cr-hint">
                Uma linha por cliente com movimento no periodo, do que mais faturou para o que menos
                faturou, mais o que cada um carregou de cada material.
              </p>
            ) : null}
          </div>

          <div className="cr-filter-block">
            <span className="cr-filter-label">Periodo</span>
            <div className="cr-chip-row">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`cr-chip${period === option.id ? " active" : ""}`}
                  onClick={() => setPeriod(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {period === "custom" ? (
              <div className="cr-custom-dates">
                <label className="cr-date-field">
                  De
                  <input
                    className="input"
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                  />
                </label>
                <label className="cr-date-field">
                  Ate
                  <input
                    className="input"
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <p className="cr-hint">
              {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
            </p>
            <p className="cr-hint">
              Datas futuras sao aceitas: os carregamentos ficam vazios e o relatorio mostra as
              parcelas que o cliente ainda tem a pagar naqueles dias.
            </p>
          </div>

          {/* O resumo de todos os clientes tem um formato so: a lista comparativa. */}
          {allCustomers ? null : (
            <div className="cr-filter-block">
              <span className="cr-filter-label">Modelo do relatorio</span>
              <label className="cr-checkbox">
                <input
                  type="checkbox"
                  checked={variants.simplified}
                  onChange={(event) =>
                    setVariants((current) => ({ ...current, simplified: event.target.checked }))
                  }
                />
                <span>
                  Simplificado
                  <span className="cr-checkbox-hint">
                    Dados principais: cadastro, KPIs, vencimentos, produtos, materiais por dia,
                    placas com as viagens de cada motorista e compras por mes.
                  </span>
                </span>
              </label>
              <label className="cr-checkbox">
                <input
                  type="checkbox"
                  checked={variants.complete}
                  onChange={(event) =>
                    setVariants((current) => ({ ...current, complete: event.target.checked }))
                  }
                />
                <span>
                  Completo
                  <span className="cr-checkbox-hint">
                    Tudo do simplificado + transporte, pagamentos, compras por dia, operacao a
                    operacao e canceladas.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="cr-filter-block">
            <span className="cr-filter-label">Formato do arquivo</span>
            <label className="cr-checkbox">
              <input
                type="checkbox"
                checked={formats.pdf}
                onChange={(event) =>
                  setFormats((current) => ({ ...current, pdf: event.target.checked }))
                }
              />
              <span>PDF</span>
            </label>
            <label className="cr-checkbox">
              <input
                type="checkbox"
                checked={formats.excel}
                onChange={(event) =>
                  setFormats((current) => ({ ...current, excel: event.target.checked }))
                }
              />
              <span>Excel</span>
            </label>
            <p className="cr-hint">
              {fileCount === 0
                ? allCustomers
                  ? "Selecione ao menos um formato."
                  : "Selecione ao menos um modelo e um formato."
                : fileCount === 1
                  ? "1 arquivo sera gerado."
                  : `${fileCount} arquivos serao gerados.`}
            </p>
          </div>
        </div>
      </div>

      {error ? <p className="cr-error">{error}</p> : null}
      {exportMessage ? <p className="cr-info cr-message">{exportMessage}</p> : null}

      {!customerId ? (
        <div className="cr-card">
          <p className="cr-hint">
            Selecione um cliente — ou &quot;Todos os clientes&quot; — para ver a previa do
            relatorio.
          </p>
        </div>
      ) : loading ? (
        <div className="cr-card">
          <p className="cr-hint">Carregando relatorio...</p>
        </div>
      ) : overview ? (
        <CustomersOverviewPreview overview={overview} />
      ) : report && totals && dues ? (
        <>
          <div className="cr-card">
            <h3 className="cr-card-title">
              {report.customer.tradeName || report.customer.legalName}
            </h3>
            <div className="cr-identity-grid">
              <IdentityItem label="Razao social" value={report.customer.legalName || "-"} />
              <IdentityItem label="CNPJ / CPF" value={report.customer.document ?? "-"} />
              <IdentityItem label="Telefone" value={report.customer.phone ?? "-"} />
              <IdentityItem label="E-mail" value={report.customer.email ?? "-"} />
              <IdentityItem
                label="Cidade / UF"
                value={
                  [report.customer.city, report.customer.state].filter(Boolean).join(" / ") || "-"
                }
              />
              <IdentityItem
                label="Condicao padrao"
                value={report.customer.defaultPaymentTermName ?? "-"}
              />
              <IdentityItem
                label="Transportadora padrao"
                value={report.customer.defaultCarrierName ?? "-"}
              />
              <IdentityItem
                label="Titulos em aberto"
                value={formatBRL(report.customer.openReceivablesCents)}
              />
            </div>
          </div>

          <div className="cr-kpi-grid">
            <Kpi label="Carregamentos" value={formatNumber(totals.operations)} hint={range.label} />
            <Kpi
              label="Tonelagem"
              value={formatReportTons(totals.netWeightKg)}
              hint={`${formatKg(totals.netWeightKg)} kg`}
            />
            <Kpi
              label="Total comprado"
              value={formatBRL(totals.totalCents)}
              hint={`Produto ${formatBRL(totals.productCents)} + frete ${formatBRL(totals.freightCents)}`}
            />
            <Kpi
              label="Preco medio"
              value={`${formatBRL(totals.avgPriceCentsPerTon)}/t`}
              hint={`Ticket medio ${formatBRL(totals.avgTicketCents)}`}
            />
            <Kpi
              label="A vencer no periodo"
              value={formatBRL(dues.upcomingCents)}
              hint={`${formatNumber(dues.upcomingInstallments)} parcela(s)`}
            />
            <Kpi
              label="Proximo vencimento"
              value={dues.nextDueDate ? formatDayLabel(dues.nextDueDate) : "-"}
              hint={dues.nextDueDate ? formatBRL(dues.nextDueCents) : "Sem parcelas no periodo"}
            />
            <Kpi
              label="Vencidas no periodo"
              value={formatBRL(dues.overdueCents)}
              hint={`${formatNumber(dues.overdueInstallments)} parcela(s)`}
            />
            <Kpi
              label="Parcelas no periodo"
              value={formatNumber(dues.installments)}
              hint={formatBRL(dues.amountCents)}
            />
          </div>

          {customerReportTables(report, showComplete ? "complete" : "simplified").map((table) => (
            <DataCard key={table.title} table={table} />
          ))}
        </>
      ) : null}
    </section>
  );
}

/**
 * Previa do resumo de todos os clientes: KPIs do periodo e a lista comparativa, um cliente
 * por linha do que mais faturou para o que menos faturou.
 */
function CustomersOverviewPreview({ overview }: { overview: CustomersOverview }) {
  const { totals, installmentTotals } = overview;
  return (
    <>
      <div className="cr-kpi-grid">
        <Kpi
          label="Clientes"
          value={formatNumber(overview.customers.length)}
          hint="Com movimento"
        />
        <Kpi label="Carregamentos" value={formatNumber(totals.operations)} />
        <Kpi
          label="Tonelagem"
          value={formatReportTons(totals.netWeightKg)}
          hint={`${formatKg(totals.netWeightKg)} kg`}
        />
        <Kpi label="Total comprado" value={formatBRL(totals.totalCents)} />
        <Kpi
          label="A vencer"
          value={formatBRL(installmentTotals.upcomingCents)}
          hint={`Vencidas: ${formatBRL(installmentTotals.overdueCents)}`}
        />
      </div>
      {overviewTables(overview).map((table) => (
        <DataCard key={table.title} table={table} />
      ))}
    </>
  );
}

function IdentityItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="cr-label">{label}</p>
      <p className="cr-identity-value">{value}</p>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="cr-card">
      <p className="cr-label">{label}</p>
      <p className="cr-kpi-value">{value}</p>
      {hint ? <p className="cr-hint">{hint}</p> : null}
    </div>
  );
}

function DataCard({ table }: { table: ReportTable }): ReactNode {
  return (
    <div className="cr-card cr-data-card">
      <h3 className="cr-card-title">{table.title}</h3>
      {table.rows.length === 0 ? (
        <p className="cr-hint">{table.emptyMessage ?? "Sem dados no periodo."}</p>
      ) : (
        <div className="cr-table-scroll">
          <table className="cr-table">
            <thead>
              <tr>
                {table.headers.map((header, index) => (
                  <th key={`${header}-${index}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((cells, rowIndex) => (
                <tr key={rowIndex}>
                  {cells.map((cell, index) => (
                    <td key={index}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.footNote ? <p className="cr-foot-note">{table.footNote}</p> : null}
    </div>
  );
}
