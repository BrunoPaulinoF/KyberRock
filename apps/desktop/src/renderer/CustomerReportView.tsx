import { useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type {
  CustomerReport,
  CustomerReportOption,
  CustomerReportVariant,
  CustomersOverview
} from "../services/customer-report";
import {
  INSTALLMENT_NOTE,
  INSTALLMENT_SITUATION_LABEL,
  formatDatesSummary
} from "../services/customer-report-render";
import { IconActionButton } from "./IconActionButton";
import { HelpTooltip } from "./Tooltip";

/**
 * Relatorio por cliente: o usuario escolhe o cliente, o periodo (atalhos ou datas
 * personalizadas), quais modelos quer (simplificado e/ou completo) e em quais formatos
 * (PDF e/ou Excel). A tela mostra a previa dos mesmos dados que vao para o arquivo:
 * transporte, compras, pagamentos, produtos (com os dias em que cada material foi
 * carregado), tonelagem e placas.
 *
 * Escolhendo "Todos os clientes" a tela troca de documento: em vez do relatorio de um
 * cliente, sai a lista comparativa do periodo — um cliente por linha, do que mais faturou
 * para o que menos faturou (ver `CustomersOverviewPreview`).
 */
type PeriodPreset =
  | "today"
  | "7d"
  | "30d"
  | "month"
  | "lastMonth"
  | "year"
  | "next30d"
  | "next90d"
  | "custom";

interface DateRange {
  start: string;
  end: string;
  label: string;
}

const PERIOD_OPTIONS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Mes atual" },
  { id: "lastMonth", label: "Mes anterior" },
  { id: "year", label: "Ano atual" },
  { id: "next30d", label: "Proximos 30 dias" },
  { id: "next90d", label: "Proximos 90 dias" },
  { id: "custom", label: "Personalizado" }
];

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveRange(
  preset: PeriodPreset,
  customStart: string,
  customEnd: string,
  now: Date
): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "custom") {
    // Datas invertidas viram um periodo valido em vez de um relatorio vazio.
    const start = customStart || toIsoDate(today);
    const end = customEnd || toIsoDate(today);
    return start <= end
      ? { start, end, label: "Periodo personalizado" }
      : { start: end, end: start, label: "Periodo personalizado" };
  }
  if (preset === "today") {
    return { start: toIsoDate(today), end: toIsoDate(today), label: "Hoje" };
  }
  if (preset === "7d") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ultimos 7 dias" };
  }
  if (preset === "30d") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ultimos 30 dias" };
  }
  if (preset === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Mes atual" };
  }
  if (preset === "year") {
    const start = new Date(today.getFullYear(), 0, 1);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ano atual" };
  }
  // Periodos futuros: nao ha carregamento a mostrar, e o objetivo e ver os dias em que
  // o cliente ainda tem parcelas a pagar.
  if (preset === "next30d" || preset === "next90d") {
    const days = preset === "next30d" ? 29 : 89;
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    return {
      start: toIsoDate(today),
      end: toIsoDate(end),
      label: preset === "next30d" ? "Proximos 30 dias" : "Proximos 90 dias"
    };
  }
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return {
    start: toIsoDate(lastMonthStart),
    end: toIsoDate(lastMonthEnd),
    label: "Mes anterior"
  };
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

// Peso em quilos, so o numero: a coluna ja diz "Peso" e repetir "kg" em cada linha
// so atrapalhava a leitura das tabelas.
function formatKg(kg: number): string {
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
}

function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function formatMonthLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 2) return iso;
  const [year, month] = parts;
  return `${month}/${year}`;
}

/**
 * Valor de `customerId` que pede o resumo comparativo do periodo inteiro em vez do
 * relatorio de um cliente. Nao colide com id nenhum: os ids sao UUID.
 */
const ALL_CUSTOMERS = "__all__";

export function CustomerReportView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [customers, setCustomers] = useState<CustomerReportOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [overview, setOverview] = useState<CustomersOverview | null>(null);
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [customStart, setCustomStart] = useState(() => toIsoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => toIsoDate(new Date()));
  const [report, setReport] = useState<CustomerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingNotes, setCheckingNotes] = useState(false);
  const [exporting, setExporting] = useState(false);
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
    () => resolveRange(period, customStart, customEnd, new Date()),
    [period, customStart, customEnd]
  );

  const allCustomers = customerId === ALL_CUSTOMERS;

  const selectedVariants = useMemo(
    () => (Object.keys(variants) as CustomerReportVariant[]).filter((variant) => variants[variant]),
    [variants]
  );
  const selectedFormats = useMemo(
    () => (["pdf", "excel"] as const).filter((format) => formats[format]) as Array<"pdf" | "excel">,
    [formats]
  );

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(term) ||
        (customer.document ?? "").toLowerCase().includes(term)
    );
  }, [customers, customerSearch]);

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .listCustomerReportCustomers()
      .then((rows) => {
        if (cancelled) return;
        setCustomers(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar clientes.");
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  // O cliente selecionado precisa continuar visivel na lista mesmo com a busca ativa;
  // se o filtro o esconder, a selecao e limpa para nao gerar relatorio de quem sumiu.
  // "Todos os clientes" nao e um cliente da lista e nunca e limpo pela busca.
  useEffect(() => {
    if (!customerId || customerId === ALL_CUSTOMERS) return;
    if (filteredCustomers.some((customer) => customer.id === customerId)) return;
    setCustomerId("");
  }, [filteredCustomers, customerId]);

  const loadReport = useCallback(async () => {
    if (!desktopApi || !customerId) {
      setReport(null);
      setOverview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (customerId === ALL_CUSTOMERS) {
        setReport(null);
        setOverview(await desktopApi.getCustomersOverview(range.start, range.end, range.label));
      } else {
        setOverview(null);
        setReport(
          await desktopApi.getCustomerReport(customerId, range.start, range.end, range.label)
        );
      }
    } catch (err) {
      setReport(null);
      setOverview(null);
      setError(err instanceof Error ? err.message : "Falha ao carregar o relatorio do cliente.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi, customerId, range.start, range.end, range.label]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  /**
   * Puxa do OMIE o numero da nota das cargas do cliente no periodo.
   *
   * So LE — nao fatura nada. Existe porque a conferencia automatica roda por rodizio, e
   * quem vai mandar o relatorio ao cliente AGORA nao pode esperar a vez dela: sem isto a
   * coluna "Nota fiscal" sai com "-" numa carga cuja nota ja existe no OMIE.
   */
  async function handleCheckNotes(): Promise<void> {
    if (!desktopApi || !customerId || allCustomers) return;
    setExportMessage(null);
    if (!navigator.onLine) {
      setExportMessage("Conferir as notas exige internet conectada para falar com o OMIE.");
      return;
    }
    setCheckingNotes(true);
    try {
      const result = await desktopApi.reconcileCustomerReportNotes(
        customerId,
        range.start,
        range.end
      );
      await loadReport();
      setExportMessage(
        result.checked === 0
          ? "Todas as cargas do periodo ja estavam com a nota conferida."
          : result.billed > 0
            ? `${result.billed} carga(s) passaram a constar faturadas. ${result.checked} conferida(s) no OMIE.`
            : `${result.checked} carga(s) conferida(s) no OMIE.`
      );
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao conferir as notas no OMIE.");
    } finally {
      setCheckingNotes(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!desktopApi || !customerId) return;
    // O resumo de todos os clientes e uma lista unica: nao ha modelo simplificado/completo
    // a escolher, so o formato do arquivo.
    if (!allCustomers && selectedVariants.length === 0) {
      setExportMessage("Selecione ao menos um modelo: simplificado ou completo.");
      return;
    }
    if (selectedFormats.length === 0) {
      setExportMessage("Selecione ao menos um formato: PDF ou Excel.");
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      const result = allCustomers
        ? await desktopApi.exportCustomersOverview(
            range.start,
            range.end,
            selectedFormats,
            range.label
          )
        : await desktopApi.exportCustomerReport(
            customerId,
            range.start,
            range.end,
            selectedVariants,
            selectedFormats,
            range.label
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

  const showComplete = variants.complete;
  const totals = report?.totals ?? null;
  const dues = report?.installmentTotals ?? null;
  const fileCount = allCustomers
    ? selectedFormats.length
    : selectedVariants.length * selectedFormats.length;

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Relatorio por cliente</h2>
          <HelpTooltip
            content="Gera o relatorio de um cliente no periodo escolhido, com transporte, compras, pagamentos, quanto ele carregou de cada material e em que dias, tonelagem, as viagens de cada placa/motorista em sequencia e as parcelas a vencer. Use datas futuras para ver os dias em que o cliente ainda tem parcelas a pagar. Escolha os modelos (simplificado e/ou completo) e os formatos (PDF e/ou Excel). Em 'Todos os clientes', sai a lista comparativa do periodo: um cliente por linha, do que mais faturou para o que menos faturou, e os materiais que cada um carregou."
            placement="right"
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <IconActionButton
            icon="retry"
            label={checkingNotes ? "Conferindo..." : "Conferir notas no OMIE"}
            tip="Pergunta ao OMIE o numero da nota das cargas do cliente no periodo e grava cada um na pesagem, para o relatorio sair com a NF-e/NFS-e preenchida. So consulta: nao fatura e nao emite nada."
            tone="neutral"
            placement="bottom"
            disabled={checkingNotes || exporting || loading || !customerId || allCustomers}
            onClick={() => void handleCheckNotes()}
          />
          <IconActionButton
            icon="download"
            label={
              exporting
                ? "Gerando..."
                : fileCount > 1
                  ? `Gerar ${fileCount} arquivos`
                  : "Gerar relatorio"
            }
            tip="Gera os arquivos escolhidos. Com mais de um arquivo, o aplicativo pede a pasta de destino uma unica vez."
            tone="primary"
            placement="bottom"
            disabled={exporting || !customerId || loading}
            onClick={() => void handleExport()}
          />
        </div>
      </header>

      <div style={styles.card}>
        <div style={styles.filterGrid}>
          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Cliente</span>
            <input
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Buscar por nome ou CNPJ/CPF"
              style={styles.input}
            />
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              style={styles.input}
            >
              <option value="">Selecione um cliente</option>
              <option value={ALL_CUSTOMERS}>Todos os clientes (resumo do periodo)</option>
              {filteredCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.document ? `${customer.name} - ${customer.document}` : customer.name}
                </option>
              ))}
            </select>
            {allCustomers ? (
              <p style={styles.hint}>
                Uma linha por cliente com movimento no periodo, do que mais faturou para o que menos
                faturou, mais o que cada um carregou de cada material.
              </p>
            ) : null}
          </div>

          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Periodo</span>
            <div style={styles.chipRow}>
              {PERIOD_OPTIONS.map((option) => (
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
            <p style={styles.hint}>
              Datas futuras sao aceitas: os carregamentos ficam vazios e o relatorio mostra as
              parcelas que o cliente ainda tem a pagar naqueles dias.
            </p>
          </div>

          {/* O resumo de todos os clientes tem um formato so: a lista comparativa. */}
          <div style={{ ...styles.filterBlock, display: allCustomers ? "none" : undefined }}>
            <span style={styles.filterLabel}>Modelo do relatorio</span>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={variants.simplified}
                onChange={(event) =>
                  setVariants((current) => ({ ...current, simplified: event.target.checked }))
                }
              />
              <span>
                Simplificado
                <span style={styles.checkboxHint}>
                  Dados principais: cadastro, KPIs, vencimentos, produtos, materiais por dia, placas
                  com as viagens de cada motorista e compras por mes.
                </span>
              </span>
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={variants.complete}
                onChange={(event) =>
                  setVariants((current) => ({ ...current, complete: event.target.checked }))
                }
              />
              <span>
                Completo
                <span style={styles.checkboxHint}>
                  Tudo do simplificado + transporte, pagamentos, compras por dia, operacao a
                  operacao e canceladas.
                </span>
              </span>
            </label>
          </div>

          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Formato do arquivo</span>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={formats.pdf}
                onChange={(event) =>
                  setFormats((current) => ({ ...current, pdf: event.target.checked }))
                }
              />
              <span>PDF</span>
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={formats.excel}
                onChange={(event) =>
                  setFormats((current) => ({ ...current, excel: event.target.checked }))
                }
              />
              <span>Excel</span>
            </label>
            <p style={styles.hint}>
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

      {error ? <p style={styles.error}>{error}</p> : null}
      {exportMessage ? <p style={styles.info}>{exportMessage}</p> : null}

      {!customerId ? (
        <div style={styles.card}>
          <p style={styles.hint}>
            Selecione um cliente — ou &quot;Todos os clientes&quot; — para ver a previa do
            relatorio.
          </p>
        </div>
      ) : loading ? (
        <div style={styles.card}>
          <p style={styles.hint}>Carregando relatorio...</p>
        </div>
      ) : overview ? (
        <CustomersOverviewPreview overview={overview} />
      ) : report && totals && dues ? (
        <>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>
              {report.customer.tradeName || report.customer.legalName}
            </h3>
            <div style={styles.identityGrid}>
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

          <div style={styles.kpiGrid}>
            <Kpi label="Carregamentos" value={formatNumber(totals.operations)} hint={range.label} />
            <Kpi
              label="Tonelagem"
              value={formatTons(totals.netWeightKg)}
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

          <DataCard
            title="Vencimentos no periodo"
            empty={report.installmentsByMonth.length === 0}
            footNote={INSTALLMENT_NOTE}
            emptyMessage="Nenhuma parcela vence neste periodo. Escolha datas futuras para ver os proximos vencimentos."
          >
            <Table
              headers={["Mes", "Parcelas", "Valor"]}
              rows={report.installmentsByMonth.map((row) => [
                formatMonthLabel(row.period),
                formatNumber(row.installments),
                formatBRL(row.amountCents)
              ])}
            />
          </DataCard>

          <DataCard
            title="Parcelas a pagar"
            empty={report.installments.length === 0}
            emptyMessage="Nenhuma parcela vence neste periodo."
          >
            <Table
              headers={[
                "Vencimento",
                "Situacao",
                "Parcela",
                "Valor",
                "Data da compra",
                "Produto",
                "Placa",
                "Condicao",
                "Forma"
              ]}
              rows={report.installments.map((installment) => [
                formatDayLabel(installment.dueDate),
                INSTALLMENT_SITUATION_LABEL[installment.situation],
                `${installment.number}/${installment.installmentCount}`,
                formatBRL(installment.amountCents),
                formatDayLabel(installment.operationDate),
                installment.productDescription,
                installment.plate,
                installment.paymentTermName ?? "-",
                installment.paymentMethodName ?? "-"
              ])}
            />
          </DataCard>

          <DataCard title="Produtos comprados" empty={report.byProduct.length === 0}>
            <Table
              headers={[
                "Produto",
                "Codigo",
                "Carregamentos",
                "Datas",
                "Peso",
                "Valor produto",
                "Preco medio",
                "Total"
              ]}
              rows={report.byProduct.map((row) => [
                row.productDescription,
                row.productCode ?? "-",
                formatNumber(row.operations),
                formatDatesSummary(row.dates),
                formatKg(row.netWeightKg),
                formatBRL(row.productCents),
                `${formatBRL(row.avgPriceCentsPerTon)}/t`,
                formatBRL(row.totalCents)
              ])}
            />
          </DataCard>

          {/* O detalhe da tabela acima: o que o cliente levou de cada material em cada dia. */}
          <DataCard
            title="Materiais por dia"
            empty={report.byProductDay.length === 0}
            emptyMessage="Nenhum carregamento neste periodo."
          >
            <Table
              headers={[
                "Produto",
                "Dia",
                "Carregamentos",
                "Peso",
                "Valor produto",
                "Preco medio",
                "Total"
              ]}
              rows={report.byProductDay.map((row) => [
                row.productDescription,
                formatDayLabel(row.date),
                formatNumber(row.operations),
                formatKg(row.netWeightKg),
                formatBRL(row.productCents),
                `${formatBRL(row.avgPriceCentsPerTon)}/t`,
                formatBRL(row.totalCents)
              ])}
            />
          </DataCard>

          <DataCard title="Placas" empty={report.byPlate.length === 0}>
            <Table
              headers={[
                "Placa",
                "Motorista",
                "Transportadora",
                "Viagens",
                "Peso",
                "Tempo medio",
                "Total"
              ]}
              rows={report.byPlate.map((row) => [
                row.plate,
                row.driverName ?? "-",
                row.carrierName ?? "-",
                formatNumber(row.operations),
                formatKg(row.netWeightKg),
                formatMinutes(row.avgMinutes),
                formatBRL(row.totalCents)
              ])}
            />
          </DataCard>

          {/* O detalhe da tabela acima: as viagens de cada motorista, em sequencia. */}
          <DataCard
            title="Viagens por placa e motorista"
            empty={report.tripsByPlate.length === 0}
            emptyMessage="Nenhuma viagem neste periodo."
          >
            <Table
              headers={[
                "Placa",
                "Motorista",
                "Data",
                "Produto",
                "Peso",
                "Preco/t",
                "Produto (R$)",
                "Frete (R$)",
                "Total",
                "Tempo"
              ]}
              rows={report.tripsByPlate.map((operation) => [
                operation.plate,
                operation.driverName,
                formatDayLabel(operation.date),
                operation.productDescription,
                formatKg(operation.netWeightKg),
                operation.unitPriceCents === null ? "-" : formatBRL(operation.unitPriceCents),
                formatBRL(operation.productTotalCents),
                formatBRL(operation.freightTotalCents),
                formatBRL(operation.totalCents),
                operation.minutesInside === null ? "-" : formatMinutes(operation.minutesInside)
              ])}
            />
          </DataCard>

          <DataCard title="Compras por mes" empty={report.byMonth.length === 0}>
            <Table
              headers={["Mes", "Carregamentos", "Peso", "Produto", "Frete", "Total"]}
              rows={report.byMonth.map((row) => [
                formatMonthLabel(row.period),
                formatNumber(row.operations),
                formatKg(row.netWeightKg),
                formatBRL(row.productCents),
                formatBRL(row.freightCents),
                formatBRL(row.totalCents)
              ])}
            />
          </DataCard>

          {showComplete ? (
            <>
              <DataCard title="Transporte por transportadora" empty={report.byCarrier.length === 0}>
                <Table
                  headers={["Transportadora", "CNPJ / CPF", "Viagens", "Peso", "Frete", "Placas"]}
                  rows={report.byCarrier.map((row) => [
                    row.carrierName,
                    row.carrierDocument ?? "-",
                    formatNumber(row.operations),
                    formatKg(row.netWeightKg),
                    formatBRL(row.freightCents),
                    row.plates.join(", ") || "-"
                  ])}
                />
              </DataCard>

              <DataCard title="Tipos de frete" empty={report.byFreightModality.length === 0}>
                <Table
                  headers={["Tipo de frete", "Carregamentos", "Peso", "Total"]}
                  rows={report.byFreightModality.map((row) => [
                    row.name,
                    formatNumber(row.operations),
                    formatKg(row.netWeightKg),
                    formatBRL(row.totalCents)
                  ])}
                />
              </DataCard>

              <DataCard title="Pagamentos por forma" empty={report.byPaymentMethod.length === 0}>
                <Table
                  headers={["Forma de pagamento", "Carregamentos", "Peso", "Total"]}
                  rows={report.byPaymentMethod.map((row) => [
                    row.name,
                    formatNumber(row.operations),
                    formatKg(row.netWeightKg),
                    formatBRL(row.totalCents)
                  ])}
                />
              </DataCard>

              <DataCard title="Pagamentos por condicao" empty={report.byPaymentTerm.length === 0}>
                <Table
                  headers={["Condicao de pagamento", "Carregamentos", "Peso", "Total"]}
                  rows={report.byPaymentTerm.map((row) => [
                    row.name,
                    formatNumber(row.operations),
                    formatKg(row.netWeightKg),
                    formatBRL(row.totalCents)
                  ])}
                />
              </DataCard>

              <DataCard title="Operacoes (detalhado)" empty={report.operations.length === 0}>
                <Table
                  headers={[
                    "Data",
                    "Produto",
                    "Placa",
                    "Motorista",
                    "Transportadora",
                    "Frete",
                    "Liquido",
                    "Tempo",
                    "Preco/t",
                    "Produto",
                    "Frete (R$)",
                    "Total",
                    "Forma",
                    "Condicao",
                    "Nota fiscal",
                    "Pedido OMIE",
                    "Status"
                  ]}
                  rows={report.operations.map((operation) => [
                    formatDayLabel(operation.date),
                    operation.productDescription,
                    operation.plate,
                    operation.driverName,
                    operation.carrierName ?? "-",
                    [operation.freightModalityLabel, operation.freightDestination]
                      .filter(Boolean)
                      .join(" - "),
                    formatKg(operation.netWeightKg),
                    operation.minutesInside === null ? "-" : formatMinutes(operation.minutesInside),
                    operation.unitPriceCents === null ? "-" : formatBRL(operation.unitPriceCents),
                    formatBRL(operation.productTotalCents),
                    formatBRL(operation.freightTotalCents),
                    formatBRL(operation.totalCents),
                    operation.paymentMethodName ?? "-",
                    operation.paymentTermName ?? "-",
                    operation.omieInvoiceNumber ?? "-",
                    operation.omieSalesOrderId === null ? "-" : String(operation.omieSalesOrderId),
                    operation.statusLabel
                  ])}
                />
              </DataCard>

              <DataCard
                title="Operacoes canceladas"
                empty={report.cancelledOperations.length === 0}
              >
                <Table
                  headers={["Data", "Produto", "Placa", "Motorista", "Liquido", "Motivo"]}
                  rows={report.cancelledOperations.map((operation) => [
                    formatDayLabel(operation.date),
                    operation.productDescription,
                    operation.plate,
                    operation.driverName,
                    formatKg(operation.netWeightKg),
                    operation.cancelReason ?? "-"
                  ])}
                />
              </DataCard>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * Previa do resumo de todos os clientes: KPIs do periodo e a lista comparativa, um cliente
 * por linha do que mais faturou para o que menos faturou — a mesma ordem e as mesmas
 * colunas do PDF/planilha, para a tela e o arquivo contarem a mesma historia.
 */
function CustomersOverviewPreview({ overview }: { overview: CustomersOverview }) {
  const { totals, installmentTotals } = overview;
  return (
    <>
      <div style={styles.kpiGrid}>
        <Kpi
          label="Clientes"
          value={formatNumber(overview.customers.length)}
          hint="Com movimento"
        />
        <Kpi label="Carregamentos" value={formatNumber(totals.operations)} />
        <Kpi
          label="Tonelagem"
          value={formatTons(totals.netWeightKg)}
          hint={`${formatKg(totals.netWeightKg)} kg`}
        />
        <Kpi label="Total comprado" value={formatBRL(totals.totalCents)} />
        <Kpi
          label="A vencer"
          value={formatBRL(installmentTotals.upcomingCents)}
          hint={`Vencidas: ${formatBRL(installmentTotals.overdueCents)}`}
        />
      </div>

      <DataCard
        title="Clientes no periodo"
        empty={overview.customers.length === 0}
        emptyMessage="Nenhum cliente com movimento no periodo."
        footNote={INSTALLMENT_NOTE}
      >
        <Table
          headers={[
            "Cliente",
            "Carregamentos",
            "Tonelagem",
            "Preco medio/t",
            "Total comprado",
            "A vencer",
            "Vencidas"
          ]}
          rows={[
            ...overview.customers.map((row) => [
              row.customer.document
                ? `${row.customer.name} - ${row.customer.document}`
                : row.customer.name,
              formatNumber(row.totals.operations),
              formatTons(row.totals.netWeightKg),
              formatBRL(row.totals.avgPriceCentsPerTon),
              formatBRL(row.totals.totalCents),
              formatBRL(row.installmentTotals.upcomingCents),
              formatBRL(row.installmentTotals.overdueCents)
            ]),
            [
              "TOTAL",
              formatNumber(totals.operations),
              formatTons(totals.netWeightKg),
              formatBRL(totals.avgPriceCentsPerTon),
              formatBRL(totals.totalCents),
              formatBRL(installmentTotals.upcomingCents),
              formatBRL(installmentTotals.overdueCents)
            ]
          ]}
        />
      </DataCard>

      {/* O que cada cliente carregou de cada material, quanto e em que dias. */}
      <DataCard
        title="Materiais por cliente"
        empty={overview.customers.every((row) => row.byProduct.length === 0)}
        emptyMessage="Nenhum carregamento no periodo."
      >
        <Table
          headers={[
            "Cliente",
            "Produto",
            "Codigo",
            "Carregamentos",
            "Datas",
            "Peso",
            "Preco medio/t",
            "Total"
          ]}
          rows={overview.customers.flatMap((row) =>
            row.byProduct.map((product) => [
              row.customer.name,
              product.productDescription,
              product.productCode ?? "-",
              formatNumber(product.operations),
              formatDatesSummary(product.dates),
              formatKg(product.netWeightKg),
              formatBRL(product.avgPriceCentsPerTon),
              formatBRL(product.totalCents)
            ])
          )}
        />
      </DataCard>
    </>
  );
}

function IdentityItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={styles.identityLabel}>{label}</p>
      <p style={styles.identityValue}>{value}</p>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={styles.card}>
      <p style={styles.identityLabel}>{label}</p>
      <p style={styles.kpiValue}>{value}</p>
      {hint ? <p style={styles.hint}>{hint}</p> : null}
    </div>
  );
}

function DataCard({
  title,
  empty,
  children,
  footNote,
  emptyMessage
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
  footNote?: string;
  emptyMessage?: string;
}) {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{title}</h3>
      {empty ? <p style={styles.hint}>{emptyMessage ?? "Sem dados no periodo."}</p> : children}
      {footNote ? <p style={styles.footNote}>{footNote}</p> : null}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={header} style={{ ...styles.th, textAlign: index === 0 ? "left" : "right" }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, index) => (
                <td key={index} style={{ ...styles.td, textAlign: index === 0 ? "left" : "right" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
    gap: "6px"
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
    alignItems: "flex-start",
    gap: "8px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--kr-text-strong)",
    cursor: "pointer"
  },
  checkboxHint: {
    display: "block",
    fontSize: "11px",
    fontWeight: 400,
    color: "var(--kr-muted)",
    marginTop: "2px"
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
  identityGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px"
  },
  identityLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--kr-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0
  },
  identityValue: {
    fontSize: "13px",
    color: "var(--kr-text-strong)",
    margin: "2px 0 0 0",
    wordBreak: "break-word"
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "10px"
  },
  kpiValue: {
    fontSize: "21px",
    fontWeight: 700,
    color: "var(--kr-text-strong)",
    margin: "4px 0 2px 0"
  },
  tableScroll: {
    overflowX: "auto",
    maxHeight: "420px",
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
    zIndex: 1
  },
  td: {
    padding: "6px 10px",
    borderBottom: "1px solid var(--kr-card-border)",
    color: "var(--kr-text-strong)",
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
