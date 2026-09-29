import "./customer-report.css";

import { Download } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Picker, type PickerOption } from "../components/Picker";
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from "../components/ui";
import { errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  PERIOD_OPTIONS,
  buildCustomerOptions,
  buildCustomerReport,
  buildCustomerReportFiles,
  buildCustomersOverview,
  buildCustomersOverviewFiles,
  customerReportTables,
  formatBRL,
  formatDayLabel,
  formatKg,
  formatNumber,
  formatReportTons,
  loadReportLookups,
  loadReportOperations,
  maxDueDays,
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
import { deliverReports, spreadsheetFileName } from "../lib/report-output";
import { useAsync } from "../lib/use-async";

/**
 * Valor de `customerId` que pede o resumo comparativo do periodo inteiro em vez do relatorio
 * de um cliente. Nao colide com id nenhum: os ids sao UUID.
 */
const ALL_CUSTOMERS = "__all__";

/**
 * O nome do periodo na tela. O `range.label` fica como o do desktop porque sai no cabecalho do
 * PDF e da planilha, e o arquivo do site tem de ser o mesmo documento da balanca.
 */
const PERIOD_SCREEN_LABEL: Record<PeriodPreset, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Mês atual",
  lastMonth: "Mês anterior",
  year: "Ano atual",
  next30d: "Próximos 30 dias",
  next90d: "Próximos 90 dias",
  custom: "Período personalizado"
};

const HELP =
  "Gera o relatório de um cliente no período escolhido, com transporte, compras, pagamentos, quanto ele carregou de cada material e em que dias, tonelagem, as viagens de cada placa/motorista em sequência e as parcelas a vencer. Use datas futuras para ver os dias em que o cliente ainda tem parcelas a pagar. Escolha os modelos (simplificado e/ou completo) e os formatos (PDF e/ou Excel). Em 'Todos os clientes', sai a lista comparativa do período: um cliente por linha, do que mais faturou para o que menos faturou, e os materiais que cada um carregou.";

/**
 * Relatorio por cliente: o usuario escolhe o cliente, o periodo (atalhos ou datas
 * personalizadas), quais modelos quer (simplificado e/ou completo) e em quais formatos
 * (PDF e/ou Excel). A tela mostra a previa dos mesmos dados que vao para o arquivo. Em
 * "Todos os clientes" sai a lista comparativa do periodo.
 *
 * Le a nuvem (pesagens da unidade do usuario, como a balanca le as dela). Os arquivos sao os
 * do desktop, montados pelo mesmo `customer-report-render` (copia guardada por teste): o PDF
 * abre a impressao do documento ("Salvar como PDF") e o Excel baixa a planilha `.xls`, com os
 * nomes de arquivo do desktop.
 *
 * Fica de fora o "Conferir notas no OMIE" do desktop: ele pergunta ao OMIE, pela balanca, o
 * numero da nota das cargas — o site nao tem esse caminho ate o OMIE.
 */
export function CustomerReport() {
  const user = useUser();
  const [customerId, setCustomerId] = useState("");
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [customStart, setCustomStart] = useState(() => todayIso());
  const [customEnd, setCustomEnd] = useState(() => todayIso());
  const [exporting, setExporting] = useState(false);
  // O que a geracao do arquivo respondeu: os nomes gerados (info) ou o que faltou/falhou (erro).
  const [exportMessage, setExportMessage] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
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

  const lookups = useAsync(() => loadReportLookups(user.companyId), [user.companyId], {
    key: `relatorio-cliente:cadastros:${user.companyId}`
  });
  const customers = useMemo(
    () => buildCustomerOptions(lookups.data?.customers ?? []),
    [lookups.data]
  );
  const pickerOptions = useMemo<PickerOption[]>(
    () => [
      { value: ALL_CUSTOMERS, label: "Todos os clientes (resumo do período)" },
      ...customers.map((customer) => ({
        value: customer.id,
        label: customer.name,
        hint: customer.document ? formatDocument(customer.document) : undefined
      }))
    ],
    [customers]
  );

  const result = useAsync(
    async (): Promise<
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
        periodLabel: range.label,
        referenceDate
      };
      return allCustomers
        ? { kind: "overview", overview: buildCustomersOverview(input) }
        : { kind: "report", report: buildCustomerReport({ ...input, customerId }) };
    },
    [lookups.data, customerId, range.start, range.end, range.label, user.companyId, user.unitId],
    {
      // Sem cadastro carregado ou sem cliente a leitura e `null`: nao vai para a memoria.
      key:
        lookups.data && customerId
          ? `relatorio-cliente:${user.companyId}:${user.unitId}:${customerId}:${range.start}:${range.end}:${range.label}`
          : null
    }
  );
  // Pesagem fechada, editada ou cancelada na balanca entra no relatorio na hora.
  useOnCadastroChange(result.refresh, CADASTRO_TABLES.operations);

  const report = result.data?.kind === "report" ? result.data.report : null;
  const overview = result.data?.kind === "overview" ? result.data.overview : null;
  const loading = lookups.loading || (Boolean(customerId) && result.loading);
  const error = lookups.error ?? (customerId ? result.error : null);

  const fileCount = allCustomers
    ? selectedFormats.length
    : selectedVariants.length * selectedFormats.length;

  async function handleExport(): Promise<void> {
    if (!customerId) return;
    // O resumo de todos os clientes e uma lista unica: nao ha modelo simplificado/completo
    // a escolher, so o formato do arquivo.
    if (!allCustomers && selectedVariants.length === 0) {
      setExportMessage({
        kind: "error",
        text: "Selecione ao menos um modelo: simplificado ou completo."
      });
      return;
    }
    if (selectedFormats.length === 0) {
      setExportMessage({ kind: "error", text: "Selecione ao menos um formato: PDF ou Excel." });
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      // Os mesmos documentos do desktop: modelo por modelo, PDF e Excel, com o nome de
      // arquivo de la. As planilhas baixam na hora; cada PDF abre a impressao, um depois do
      // outro.
      const files = overview
        ? buildCustomersOverviewFiles(overview, selectedFormats)
        : report
          ? buildCustomerReportFiles(report, selectedVariants, selectedFormats)
          : null;
      if (!files) return;
      const names = [
        ...files.pdf.map((file) => file.filename),
        ...files.xls.map((file) => spreadsheetFileName(file.filename))
      ];
      setExportMessage({
        kind: "info",
        text: [
          names.length === 1
            ? `Arquivo gerado: ${names[0]}`
            : `${names.length} arquivos gerados:\n${names.join("\n")}`,
          files.pdf.length > 0 ? 'PDF: na janela de impressão, escolha "Salvar como PDF".' : null
        ]
          .filter(Boolean)
          .join("\n")
      });
      await deliverReports(files);
    } catch (caught) {
      setExportMessage({
        kind: "error",
        text: errorMessage(caught, "Falha ao gerar o relatório.")
      });
    } finally {
      setExporting(false);
    }
  }

  // Na previa, o completo aparece quando marcado; os arquivos saem um por modelo escolhido.
  const showComplete = variants.complete;
  const totals = report?.totals ?? null;
  const dues = report?.installmentTotals ?? null;

  return (
    <section className="cr-page">
      <PageHeader
        kicker="Análise"
        title="Relatório por cliente"
        help={HELP}
        actions={
          <button
            type="button"
            className="btn primary"
            title="Gera os arquivos escolhidos: o Excel é baixado como planilha (.xlsx) e cada PDF abre a janela de impressão, um depois do outro."
            disabled={exporting || !customerId || loading || !result.data}
            onClick={() => void handleExport()}
          >
            <Download size={16} strokeWidth={2} aria-hidden="true" />
            {exporting
              ? "Gerando..."
              : fileCount > 1
                ? `Gerar ${fileCount} arquivos`
                : "Gerar relatório"}
          </button>
        }
      />

      <div className="cr-card">
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
                Uma linha por cliente com movimento no período, do que mais faturou para o que menos
                faturou, mais o que cada um carregou de cada material.
              </p>
            ) : null}
          </div>

          <div className="cr-filter-block">
            <span className="cr-filter-label">Período</span>
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
                  Até
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
              Datas futuras são aceitas: os carregamentos ficam vazios e o relatório mostra as
              parcelas que o cliente ainda tem a pagar naqueles dias.
            </p>
          </div>

          {/* O resumo de todos os clientes tem um formato so: a lista comparativa. */}
          {allCustomers ? null : (
            <div className="cr-filter-block">
              <span className="cr-filter-label">Modelo do relatório</span>
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
                    viagens por placa e motorista (com a transportadora) e compras por mês.
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
                    Tudo do simplificado + transporte, pagamentos, compras por dia, operação a
                    operação e canceladas.
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
                  ? "1 arquivo será gerado."
                  : `${fileCount} arquivos serão gerados.`}
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <ErrorState
          message={error}
          onRetry={() => void (lookups.error ? lookups.reload() : result.reload())}
        />
      ) : null}
      {exportMessage ? (
        <Alert kind={exportMessage.kind}>
          <span className="cr-pre-line">{exportMessage.text}</span>
        </Alert>
      ) : null}

      {!customerId ? (
        <EmptyState
          title={'Selecione um cliente — ou "Todos os clientes" — para ver a prévia do relatório.'}
        />
      ) : loading ? (
        <div className="cr-card">
          <SkeletonRows rows={6} columns={4} />
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
              <IdentityItem label="Razão social" value={report.customer.legalName || "-"} />
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
                label="Condição padrão"
                value={report.customer.defaultPaymentTermName ?? "-"}
              />
              <IdentityItem
                label="Transportadora padrão"
                value={report.customer.defaultCarrierName ?? "-"}
              />
              <IdentityItem
                label="Títulos em aberto"
                value={formatBRL(report.customer.openReceivablesCents)}
              />
            </div>
          </div>

          <div className="cr-kpi-grid">
            <Kpi
              label="Carregamentos"
              value={formatNumber(totals.operations)}
              hint={PERIOD_SCREEN_LABEL[period]}
            />
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
              label="Preço médio"
              value={`${formatBRL(totals.avgPriceCentsPerTon)}/t`}
              hint={`Ticket médio ${formatBRL(totals.avgTicketCents)}`}
            />
            <Kpi
              label="A vencer no período"
              value={formatBRL(dues.upcomingCents)}
              hint={`${formatNumber(dues.upcomingInstallments)} ${dues.upcomingInstallments === 1 ? "parcela" : "parcelas"}`}
            />
            <Kpi
              label="Próximo vencimento"
              value={dues.nextDueDate ? formatDayLabel(dues.nextDueDate) : "-"}
              hint={dues.nextDueDate ? formatBRL(dues.nextDueCents) : "Sem parcelas no período"}
            />
            <Kpi
              label="Vencidas no período"
              value={formatBRL(dues.overdueCents)}
              hint={`${formatNumber(dues.overdueInstallments)} ${dues.overdueInstallments === 1 ? "parcela" : "parcelas"}`}
            />
            <Kpi
              label="Parcelas no período"
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
        <EmptyState title={table.emptyMessage ?? "Sem dados no período."} />
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
