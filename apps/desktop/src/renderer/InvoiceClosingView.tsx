import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { CustomerReportOption } from "../services/customer-report";
import {
  INVOICE_CLOSING_CYCLES,
  INVOICE_CLOSING_CYCLE_LABEL,
  formatCouponNumber
} from "../services/invoice-closing-cycle";
import type { InvoiceClosingCycle } from "../services/invoice-closing-cycle";
import type {
  InvoiceClosingBasis,
  InvoiceClosingInvoice,
  InvoiceClosingReport
} from "../services/invoice-closing";
import {
  INVOICE_CLOSING_PERIOD_KINDS,
  INVOICE_CLOSING_PERIOD_KIND_LABEL,
  defaultInvoiceClosingPeriod,
  formatDayLabel,
  resolveInvoiceClosingPeriod
} from "../services/invoice-closing-period";
import type { InvoiceClosingPeriodSelection } from "../services/invoice-closing-period";
import type {
  InvoiceClosingRunItem,
  InvoiceClosingRunProgress,
  InvoiceClosingRunResult
} from "../services/invoice-closing-run";
import { IconActionButton } from "./IconActionButton";
import { HelpTooltip } from "./Tooltip";
import { rankByText } from "@kyberrock/shared";

import { CustomerSearchSelect } from "./CustomerSearchSelect";
import { InvoiceNumberCell } from "./InvoiceNumberCell";
import { Kpi } from "./Kpi";
import { WeighingLinesTable } from "./WeighingLinesTable";
import type { WeighingLineCells } from "./WeighingLinesTable";
import {
  formatBRL,
  formatCount,
  formatKg,
  formatTons,
  omieReference,
  unitPriceLabel
} from "./weighing-line-format";
import { useDebouncedValue } from "./use-debounced-value";
import { useOmieInvoiceNumbers } from "./useOmieInvoiceNumbers";

/**
 * Fechamento de faturas: a fatura de TODOS os clientes de um periodo, de uma vez.
 *
 * A tela responde a pergunta com que a atendente comeca o mes — "quanto cada cliente deve
 * nesta quinzena?" —, que antes so tinha resposta abrindo cliente por cliente. Por isso o
 * filtro principal e o PERIODO: escolher a 2a quinzena de agosto traz a lista inteira, com
 * a data de fechamento e o vencimento de cada fatura.
 *
 * Toda carga do periodo entra na fatura do cliente dela — inclusive a venda EM CARTEIRA e a
 * do cliente sem credito habilitado. Antes o ciclo vinha do cadastro, e quem nao tinha
 * periodicidade nao pertencia a fechamento nenhum: a quinzena inteira do cliente em
 * carteira ficava sem ser cobrada. Essa base continua disponivel em "Cadastro do cliente",
 * para quem organiza a cobranca por cliente e nao por quinzena.
 *
 * O botao "Fazer fechamento" e o outro lado: depois de conferir a lista, ele fatura no OMIE
 * de uma vez as cargas do periodo que ainda nao tem nota — o que antes era faturar uma por
 * uma na coluna "Faturar" do OMIE, e por isso escapava carga. Ele EMITE nota fiscal, entao
 * pede confirmacao com a contagem do que vai sair, nunca refatura o que ja tem nota e
 * devolve, linha a linha, o que nao passou e por que.
 *
 * Cada fatura abre carga a carga com nota, vale, placa e transportador — as quatro colunas
 * que a cobranca precisa —, e o mesmo periodo ainda sai resumido por transportador e
 * placa, que e como o acerto do frete e feito. A planilha e o PDF saem com exatamente as
 * faturas que estao na tela.
 *
 * No fim da tela vem a lista "pesagem a pesagem": TODAS as cargas do periodo, numa tabela
 * unica e na ordem em que foram feitas, com a operacao INTEIRA em cada linha. O escopo dela
 * e o PERIODO, e nao as faturas, de proposito: numa pedreira onde a maior parte dos clientes
 * ainda nao tem periodicidade no cadastro, uma lista so das faturas viria quase vazia e
 * esconderia justamente as cargas que ninguem esta cobrando. As faturas respondem "quanto
 * cada cliente deve"; esta lista responde a pergunta de conferencia — "cade a carga tal?" —,
 * que com a tela dividida em blocos por cliente obrigaria a abrir fatura por fatura ate
 * achar. E a mesma estrutura da Conferencia de faturamento, de proposito: quem confere passa
 * de uma tela para a outra sem reaprender a ler a tabela.
 *
 * O filtro de PLACA e o unico que troca o formato da lista: enquanto esta vazio, o
 * fechamento e um por cliente; marcando placas, o mesmo cliente passa a render uma fatura
 * por caminhao. E a pergunta de quem paga o frete por placa — "quanto este caminhao levou
 * deste cliente na quinzena?" — sem tirar do fechamento a conta que vai para o cliente.
 */

const ALL_CUSTOMERS = "";

export function InvoiceClosingView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [customers, setCustomers] = useState<CustomerReportOption[]>([]);
  const [customerId, setCustomerId] = useState(ALL_CUSTOMERS);
  // Comeca na quinzena corrente: e o fechamento que a atendente abre a tela para fazer.
  const [period, setPeriod] = useState<InvoiceClosingPeriodSelection>(() =>
    defaultInvoiceClosingPeriod(new Date())
  );
  const [basis, setBasis] = useState<InvoiceClosingBasis>("period");
  const [cycles, setCycles] = useState<InvoiceClosingCycle[]>([]);
  const [confirmingRun, setConfirmingRun] = useState(false);
  const [runPreview, setRunPreview] = useState<{ billable: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<InvoiceClosingRunProgress | null>(null);
  const [runResult, setRunResult] = useState<InvoiceClosingRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [cancellingDuplicates, setCancellingDuplicates] = useState(false);
  const [confirmingDuplicates, setConfirmingDuplicates] = useState(false);
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

  const range = useMemo(() => resolveInvoiceClosingPeriod(period, new Date()), [period]);

  const selectedFormats = useMemo(
    () => (["pdf", "excel"] as const).filter((format) => formats[format]) as Array<"pdf" | "excel">,
    [formats]
  );

  // A busca espera a palavra antes de virar consulta: cada leitura aqui e o fechamento
  // INTEIRO do periodo, e disparar uma por tecla travava a tela em quinzena movimentada.
  const debouncedSearch = useDebouncedValue(search);

  // Os filtros que vao para a consulta E para o arquivo: o fechamento entregue ao cliente
  // precisa trazer exatamente as faturas que estavam na tela.
  const options = useMemo(
    () => ({
      basis,
      periodCycle: range.cycle,
      cycles,
      customerId: customerId || null,
      plates,
      search: debouncedSearch.trim() || null,
      periodLabel: range.label
    }),
    [basis, range.cycle, cycles, customerId, plates, debouncedSearch, range.label]
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

  // A coluna "Nota fiscal" se preenche sozinha: as cargas do periodo que ainda estao sem
  // numero sao perguntadas ao OMIE assim que a lista aparece, e a tela recarrega quando
  // alguma volta com nota. Sem botao — quem fecha a quinzena nao tem por que saber que
  // existe uma conferencia.
  useOmieInvoiceNumbers(desktopApi, report?.rows, loadReport);

  /**
   * As linhas do jeito que a tabela compartilhada as le.
   *
   * O que e so desta tela fica aqui: a coluna "Op." mostra o numero do cupom cru e a "Vale"
   * o mesmo numero formatado; o produto sai com o codigo na frente quando ha; e as colunas
   * de fechamento viram um aviso unico quando a carga nao caiu em fatura nenhuma.
   *
   * As duas razoes para essa coluna vazia sao separadas de proposito. Sem isso a carga
   * repetida vinha explicada como "falta cadastro do cliente", e a atendente ia mexer no
   * cadastro certo por um problema que nao era dele.
   */
  const tableLines = useMemo<WeighingLineCells[]>(
    () =>
      (report?.rows ?? []).map((line) => ({
        key: line.operationId,
        operationLabel: line.couponNumber === null ? "-" : String(line.couponNumber),
        couponLabel: formatCouponNumber(line.couponNumber),
        dateLabel: formatDayLabel(line.date),
        closedAt: line.closedAt,
        customerName: line.customerName,
        customerDocument: line.customerDocument,
        productLabel: line.productCode
          ? `${line.productCode} - ${line.productDescription}`
          : line.productDescription,
        productTitle: line.productDescription,
        plate: line.plate,
        carrierName: line.carrierName,
        driverName: line.driverName,
        netWeightKg: line.netWeightKg,
        unitPriceLabel: unitPriceLabel(line),
        productTotalCents: line.productTotalCents,
        freightTotalCents: line.freightTotalCents,
        totalCents: line.totalCents,
        operationTypeLabel: line.operationTypeLabel,
        situation: line.situation,
        situationLabel: line.situationLabel,
        situationDetail: line.situationDetail,
        invoiceNumber: line.invoiceNumber,
        operationType: line.operationType,
        omieReference: omieReference(line),
        closing:
          line.closingDate === null
            ? {
                kind: "warning" as const,
                text: line.isDuplicate
                  ? `Repetida do vale ${formatCouponNumber(line.duplicateOfCouponNumber)}`
                  : "Fora do fechamento",
                title: line.isDuplicate
                  ? "Esta carga ja esta no fechamento em outro vale: a mesma pesagem foi " +
                    "registrada duas vezes. Cobrar as duas seria cobrar a carga duas vezes."
                  : "Esta carga nao entrou em fatura nenhuma: o cliente nao tem credito e " +
                    "periodicidade do fechamento no cadastro."
              }
            : {
                kind: "dates" as const,
                closingLabel: formatDayLabel(line.closingDate),
                dueLabel: line.dueDate ? formatDayLabel(line.dueDate) : "-"
              }
      })),
    [report]
  );

  // Andamento do fechamento, para a tela nao ficar num spinner mudo enquanto vinte notas
  // sao emitidas uma a uma.
  useEffect(() => {
    if (!desktopApi) return;
    return desktopApi.onInvoiceClosingProgress((progress) => setRunProgress(progress));
  }, [desktopApi]);

  function setPeriodField<K extends keyof InvoiceClosingPeriodSelection>(
    field: K,
    value: InvoiceClosingPeriodSelection[K]
  ): void {
    setPeriod((current) => ({ ...current, [field]: value }));
  }

  /**
   * Abre a confirmacao do fechamento com a contagem REAL do que sera faturado.
   *
   * A contagem vem do processo principal, e nao da tela: as pesagens ja faturadas nao sao
   * reenviadas, entao "20 cargas na lista" quase nunca e "20 notas a emitir" — e confirmar
   * um numero que nao e o que vai acontecer e pior que nao mostrar numero nenhum.
   */
  async function openRunConfirmation(): Promise<void> {
    if (!desktopApi) return;
    setRunError(null);
    setRunResult(null);
    // Sem internet, cada pesagem falharia uma a uma contra o OMIE: melhor dizer antes de
    // abrir a confirmacao do que devolver uma lista de vinte erros iguais.
    if (!navigator.onLine) {
      setRunError(
        "O fechamento fala com o OMIE e precisa de internet conectada. Conecte e tente de novo."
      );
      return;
    }
    try {
      setRunPreview(await desktopApi.previewInvoiceClosingRun(range.start, range.end, options));
      setConfirmingRun(true);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Falha ao conferir o fechamento.");
    }
  }

  /**
   * Cancela as pesagens repetidas do periodo — a mesma carga registrada duas vezes.
   *
   * O fechamento ja para de cobrar a repetida sozinho; aqui ela sai de vez, com o motivo
   * gravado, e o cancelamento segue para a nuvem e para o OMIE (onde o pedido e excluido
   * enquanto nao virou nota). Quem escolhe quais sao as repetidas e o processo principal, a
   * partir do MESMO relatorio da tela: a tela manda o periodo e os filtros, nunca ids.
   */
  async function handleCancelDuplicates(): Promise<void> {
    if (!desktopApi) return;
    setConfirmingDuplicates(false);
    setCancellingDuplicates(true);
    setRunError(null);
    setExportMessage(null);
    try {
      const result = await desktopApi.cancelInvoiceClosingDuplicates(
        range.start,
        range.end,
        options
      );
      await loadReport();
      const skippedNote =
        result.skipped.length === 0
          ? ""
          : ` ${formatCount(result.skipped.length)} repetida(s) com nota emitida continuam na fatura: so o OMIE cancela nota (${result.skipped
              .map(
                (item) =>
                  `vale ${formatCouponNumber(item.couponNumber)} / nota ${item.invoiceNumber}`
              )
              .join("; ")}).`;
      setExportMessage(
        `${formatCount(result.cancelled)} pesagem(ns) repetida(s) cancelada(s).${skippedNote}`
      );
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Falha ao cancelar as pesagens repetidas.");
    } finally {
      setCancellingDuplicates(false);
    }
  }

  async function handleRunClosing(): Promise<void> {
    if (!desktopApi) return;
    setConfirmingRun(false);
    setRunning(true);
    setRunError(null);
    setRunProgress(null);
    setRunResult(null);
    try {
      const result = await desktopApi.runInvoiceClosing(range.start, range.end, options);
      setRunResult(result);
      // A situacao de cada pesagem mudou no OMIE: sem recarregar, a tela continuaria
      // mostrando "falta faturar" no que acabou de virar nota.
      await loadReport();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Falha ao enviar o fechamento ao OMIE.");
    } finally {
      setRunning(false);
      setRunProgress(null);
    }
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
  // Quantas cargas da lista nao entraram em fatura nenhuma. Sao as que a tela precisa
  // gritar: elas foram pesadas, sairam da pedreira e nao estao sendo cobradas de ninguem.
  const outsideClosing = report?.rows.filter((line) => line.closingDate === null).length ?? 0;

  // As placas do periodo mais as ja marcadas: uma placa escolhida antes de trocar o periodo
  // continua visivel (e desmarcavel) mesmo quando ela nao rodou no periodo novo.
  const plateOptions = useMemo(() => {
    const all = new Set([...(report?.availablePlates ?? []), ...plates]);
    return [...all].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [report?.availablePlates, plates]);

  // A placa e digitada do jeito que esta escrita no caminhao — "ABC-1D23", "abc 1d23" — e
  // guardada sem o traco. Comparar por trecho em maiuscula so achava quem digitasse igual ao
  // cadastro; a comparacao do `search-ranking` ignora o traco, o espaco e a caixa, e ainda
  // poe a placa mais parecida no topo.
  const visiblePlates = useMemo(
    () => rankByText(plateOptions, (plate) => plate, plateSearch),
    [plateOptions, plateSearch]
  );

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Fechamento de faturas</h2>
          <HelpTooltip
            content="Puxa de uma vez a fatura de todos os clientes de um periodo. Escolha o periodo (quinzena, mes, semana ou datas livres) e a tela monta uma fatura por cliente com tudo o que ele carregou nele — inclusive as vendas EM CARTEIRA e as de cliente sem credito no cadastro. Em 'Base do fechamento' voce troca para 'Cadastro do cliente' se preferir a periodicidade cadastrada em cada um; ai o cliente sem credito fica fora das faturas e aparece na lista 'Clientes fora do fechamento'. O botao 'Fazer fechamento' fatura no OMIE, de uma vez, as cargas do periodo que ainda nao tem nota — o OMIE emite a nota de cada cliente; carga ja faturada nunca e reenviada. Marcando placas no filtro de Placa, o fechamento sai separado por placa — uma fatura por caminhao dentro de cada cliente. No fim da tela, a lista pesagem a pesagem traz TODAS as cargas do periodo numa tabela so, com a operacao inteira em cada linha. O Excel e o PDF saem com as mesmas faturas que estao na tela."
            placement="right"
          />
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <IconActionButton
            icon="download"
            label={
              exporting
                ? "Gerando..."
                : selectedFormats.length > 1
                  ? `Gerar ${selectedFormats.length} arquivos`
                  : "Gerar arquivo"
            }
            tip="Gera os arquivos escolhidos com as faturas filtradas. Com mais de um arquivo, o aplicativo pede a pasta de destino uma unica vez."
            tone="neutral"
            placement="bottom"
            disabled={exporting || loading || running}
            onClick={() => void handleExport()}
          />
          <IconActionButton
            icon="send"
            label={running ? "Fechando..." : "Fazer fechamento"}
            tip="Fatura no OMIE todas as pesagens do periodo que estao na tela, emitindo a nota de cada cliente. Pesagem que ja tem nota nao e reenviada. O aplicativo pede confirmacao antes."
            tone="primary"
            placement="bottom"
            disabled={running || loading || (report?.rows.length ?? 0) === 0}
            onClick={() => void openRunConfirmation()}
          />
        </div>
      </header>

      <div style={styles.card}>
        <div style={styles.filterGrid}>
          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Periodo do fechamento</span>
            <div style={styles.chipRow}>
              {INVOICE_CLOSING_PERIOD_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setPeriodField("kind", kind)}
                  style={period.kind === kind ? styles.chipActive : styles.chip}
                >
                  {INVOICE_CLOSING_PERIOD_KIND_LABEL[kind]}
                </button>
              ))}
            </div>

            {period.kind === "biweekly" || period.kind === "monthly" ? (
              <label style={styles.dateField}>
                Mes
                <input
                  type="month"
                  value={period.month}
                  onChange={(event) => setPeriodField("month", event.target.value)}
                  style={styles.input}
                />
              </label>
            ) : null}

            {period.kind === "biweekly" ? (
              <div style={styles.chipRow}>
                <button
                  type="button"
                  onClick={() => setPeriodField("half", 1)}
                  style={period.half === 1 ? styles.chipActive : styles.chip}
                >
                  1a quinzena (01 a 15)
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodField("half", 2)}
                  style={period.half === 2 ? styles.chipActive : styles.chip}
                >
                  2a quinzena (16 ao fim)
                </button>
              </div>
            ) : null}

            {period.kind === "weekly" ? (
              <label style={styles.dateField}>
                Qualquer dia da semana
                <input
                  type="date"
                  value={period.weekDay}
                  onChange={(event) => setPeriodField("weekDay", event.target.value)}
                  style={styles.input}
                />
              </label>
            ) : null}

            {period.kind === "custom" ? (
              <div style={styles.customDates}>
                <label style={styles.dateField}>
                  De
                  <input
                    type="date"
                    value={period.customStart}
                    onChange={(event) => setPeriodField("customStart", event.target.value)}
                    style={styles.input}
                  />
                </label>
                <label style={styles.dateField}>
                  Ate
                  <input
                    type="date"
                    value={period.customEnd}
                    onChange={(event) => setPeriodField("customEnd", event.target.value)}
                    style={styles.input}
                  />
                </label>
              </div>
            ) : null}

            <p style={styles.hint}>
              {range.label} — {formatDayLabel(range.start)} a {formatDayLabel(range.end)}
            </p>
          </div>

          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Base do fechamento</span>
            <div style={styles.chipRow}>
              <button
                type="button"
                onClick={() => setBasis("period")}
                style={basis === "period" ? styles.chipActive : styles.chip}
              >
                Periodo escolhido
              </button>
              <button
                type="button"
                onClick={() => setBasis("customer")}
                style={basis === "customer" ? styles.chipActive : styles.chip}
              >
                Cadastro do cliente
              </button>
            </div>
            {basis === "period" ? (
              <p style={styles.hint}>
                TODA carga do periodo entra na fatura do cliente dela — inclusive as em carteira e
                as de cliente sem credito no cadastro. A fatura fecha no ultimo dia do periodo.
              </p>
            ) : (
              <>
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
                  A data de fechamento vem de Cadastros &gt; Clientes, em &quot;Periodicidade do
                  fechamento&quot;. Cliente sem credito habilitado fica FORA das faturas.
                </p>
              </>
            )}
          </div>

          <div style={styles.filterBlock}>
            <span style={styles.filterLabel}>Cliente</span>
            <CustomerSearchSelect
              customers={customers}
              value={customerId}
              onChange={setCustomerId}
              leadingOption={{ value: ALL_CUSTOMERS, label: "Todos os clientes" }}
              inputStyle={styles.input}
              hintStyle={styles.hint}
            />
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
      {runError ? <p style={styles.error}>{runError}</p> : null}

      {confirmingRun && runPreview ? (
        <RunConfirmation
          preview={runPreview}
          periodLabel={range.label}
          customerLabel={
            customerId
              ? (customers.find((customer) => customer.id === customerId)?.name ?? "cliente")
              : "todos os clientes"
          }
          onCancel={() => setConfirmingRun(false)}
          onConfirm={() => void handleRunClosing()}
        />
      ) : null}

      {running ? (
        <p style={styles.info}>
          {runProgress
            ? `Faturando ${runProgress.done} de ${runProgress.total} — ${runProgress.customerName}, vale ${formatCouponNumber(runProgress.couponNumber)}.`
            : "Enviando o fechamento ao OMIE..."}
        </p>
      ) : null}

      {runResult ? <RunResultCard result={runResult} onClose={() => setRunResult(null)} /> : null}

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

          {report.duplicates.length > 0 ? (
            <DuplicatesCard
              report={report}
              busy={cancellingDuplicates}
              confirming={confirmingDuplicates}
              onAsk={() => setConfirmingDuplicates(true)}
              onCancelAsk={() => setConfirmingDuplicates(false)}
              onConfirm={() => void handleCancelDuplicates()}
            />
          ) : null}

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

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Pesagem a pesagem ({formatCount(report.rows.length)})</h3>
            <p style={styles.hint}>
              TODAS as cargas do periodo, na ordem em que foram feitas — inclusive as dos clientes
              que ficaram fora do fechamento. Cada linha traz a operacao inteira: vale, cliente,
              produto, quem levou, valores, situacao no OMIE e em qual fatura ela caiu.
            </p>
            {outsideClosing > 0 ? (
              <p style={styles.hint}>
                <strong style={{ color: "var(--kr-warning)" }}>
                  {formatCount(outsideClosing)} carga(s) fora do fechamento
                </strong>{" "}
                — aparecem na lista com &quot;Fora do fechamento&quot; no lugar da data, e nao
                entram no total a faturar. Sao dos clientes listados acima, que ainda nao tem
                credito e periodicidade no cadastro.
              </p>
            ) : null}
            {report.rows.length === 0 ? (
              <p style={styles.hint}>Nenhuma pesagem no periodo e nos filtros escolhidos.</p>
            ) : (
              <div style={styles.tableScrollTall}>
                <WeighingLinesTable
                  lines={tableLines}
                  columns={{ coupon: true, document: true, carrier: true, closing: true }}
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

/**
 * A confirmacao do "Fazer fechamento".
 *
 * Existe porque o botao EMITE NOTA FISCAL: uma vez que o OMIE fatura, desfazer e cancelar
 * nota, com prazo e justificativa. O texto diz os tres numeros que decidem — quantas notas
 * saem, de qual periodo e de quem —, e o botao de confirmar e o unico caminho.
 */
function RunConfirmation({
  preview,
  periodLabel,
  customerLabel,
  onCancel,
  onConfirm
}: {
  preview: { billable: number; total: number };
  periodLabel: string;
  customerLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const nothingToBill = preview.billable === 0;
  return (
    <div style={styles.confirmCard}>
      <h3 style={styles.cardTitle}>Confirmar o fechamento no OMIE</h3>
      {nothingToBill ? (
        <p style={styles.hint}>
          Nenhuma das {formatCount(preview.total)} carga(s) deste periodo precisa ser faturada: elas
          ja tem nota emitida, ou sao vendas internas (que geram ordem de servico, e nao nota
          fiscal).
        </p>
      ) : (
        <p style={styles.hint}>
          Vao ser faturadas <strong>{formatCount(preview.billable)}</strong> de{" "}
          {formatCount(preview.total)} carga(s) de <strong>{customerLabel}</strong> em{" "}
          <strong>{periodLabel}</strong>. O OMIE emite a nota fiscal de cada uma, para o cliente
          daquela carga.
          {"\n"}As cargas que ja tem nota NAO sao reenviadas, e as notas NAO sao impressas aqui —
          elas ficam no OMIE. Emitir nota nao se desfaz pelo aplicativo: cancelar depois e feito no
          OMIE, com prazo e justificativa.
        </p>
      )}
      <div style={{ ...styles.chipRow, marginTop: "10px" }}>
        <button type="button" onClick={onCancel} style={styles.linkButton}>
          Cancelar
        </button>
        {nothingToBill ? null : (
          <button type="button" onClick={onConfirm} style={styles.dangerButton}>
            Faturar {formatCount(preview.billable)} carga(s) no OMIE
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Pesagens repetidas: a MESMA carga registrada duas vezes.
 *
 * Uma pesagem fechada nao pode ser editada. Quando o preco sai errado, ou a venda foi
 * lancada como interna em vez de com nota, a saida que a tela oferece e registrar a carga de
 * novo — e a errada fica para tras, concluida, somando no fechamento. No OMIE alguem exclui
 * o pedido errado, aqui a pesagem continua: e essa a diferenca de valor entre os dois
 * fechamentos que os clientes reclamam.
 *
 * O card e o unico lugar em que essa conta aparece por extenso. As repetidas JA ficaram de
 * fora das faturas (por isso o total das faturas e menor que o da lista pesagem a pesagem),
 * e o botao e o passo seguinte: cancelar de vez, com o motivo gravado, para a repetida sumir
 * tambem dos outros relatorios e da nuvem.
 */
function DuplicatesCard({
  report,
  busy,
  confirming,
  onAsk,
  onCancelAsk,
  onConfirm
}: {
  report: InvoiceClosingReport;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancelAsk: () => void;
  onConfirm: () => void;
}) {
  // So o que este botao consegue cancelar: a repetida que ainda nao tem nota. Com nota
  // emitida, quem cancela e o OMIE — e prometer o contrario seria pior que nao oferecer.
  const cancellable = report.duplicates.flatMap((group) =>
    group.repeats.filter((repeat) => !repeat.invoiceNumber)
  );
  const billedTwice = report.duplicates.filter((group) => group.billedMoreThanOnce);

  return (
    <div style={styles.card}>
      <h3 style={{ ...styles.cardTitle, color: "var(--kr-warning)" }}>
        Pesagens repetidas ({formatCount(report.duplicates.length)})
      </h3>
      <p style={styles.hint}>
        A mesma carga (mesmo cliente, mesma placa, mesmo produto e os dois pesos iguais) registrada
        mais de uma vez — o relancamento feito para corrigir preco ou tipo de venda, com a errada
        esquecida no lugar. Elas <strong>ja estao fora das faturas</strong> (
        {formatBRL(report.duplicateTotals.totalCents)} em {""}
        {formatCount(report.duplicateTotals.operations)} carga(s)): cobrar as duas seria cobrar a
        mesma carga duas vezes, e e essa soma a mais que faz o total daqui nao bater com o do OMIE.
      </p>
      {billedTwice.length > 0 ? (
        <p style={styles.error}>
          {formatCount(billedTwice.length)} carga(s) tem DUAS notas fiscais emitidas no OMIE. Essas
          continuam nas faturas — a nota existe e o cliente vai receber a cobranca dela —, e o
          cancelamento da nota so pode ser feito no OMIE.
        </p>
      ) : null}
      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, textAlign: "left" }}>Cliente</th>
              <th style={{ ...styles.th, textAlign: "left" }}>Placa</th>
              <th style={{ ...styles.th, textAlign: "left" }}>Produto</th>
              <th style={styles.th}>Entrada / Saida</th>
              <th style={styles.th}>Vale que vale</th>
              <th style={styles.th}>Vale(s) repetido(s)</th>
              <th style={styles.th}>Fora da fatura</th>
            </tr>
          </thead>
          <tbody>
            {report.duplicates.map((group) => (
              <tr key={group.key}>
                <td style={{ ...styles.td, textAlign: "left" }}>{group.customerName}</td>
                <td style={{ ...styles.td, textAlign: "left" }}>{group.plate}</td>
                <td style={{ ...styles.td, textAlign: "left" }}>{group.productDescription}</td>
                <td style={styles.td}>
                  {formatKg(group.entryWeightKg)} / {formatKg(group.exitWeightKg)}
                </td>
                <td style={styles.td}>
                  {group.kept
                    .map(
                      (kept) =>
                        `${formatCouponNumber(kept.couponNumber)}${kept.invoiceNumber ? ` (nota ${kept.invoiceNumber})` : ""}`
                    )
                    .join(", ")}
                </td>
                <td style={styles.td}>
                  {group.repeats
                    .map(
                      (repeat) =>
                        `${formatCouponNumber(repeat.couponNumber)} — ${formatDayLabel(repeat.date)}${repeat.invoiceNumber ? ` (nota ${repeat.invoiceNumber})` : ""}`
                    )
                    .join(", ")}
                </td>
                <td style={styles.td}>{formatBRL(group.removedTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cancellable.length === 0 ? (
        <p style={styles.footNote}>
          Nada a cancelar por aqui: as repetidas deste periodo ja tem nota emitida no OMIE.
        </p>
      ) : confirming ? (
        <div style={styles.confirmCard}>
          <p style={styles.hint}>
            Vao ser canceladas <strong>{formatCount(cancellable.length)}</strong> pesagem(ns)
            repetida(s). A carga que ficou valendo NAO e tocada. O cancelamento tambem exclui o
            pedido (ou a ordem de servico) delas no OMIE, e nao se desfaz pelo aplicativo.
          </p>
          <div style={{ ...styles.chipRow, marginTop: "10px" }}>
            <button type="button" onClick={onCancelAsk} style={styles.linkButton}>
              Voltar
            </button>
            <button type="button" onClick={onConfirm} style={styles.dangerButton}>
              Cancelar {formatCount(cancellable.length)} pesagem(ns) repetida(s)
            </button>
          </div>
        </div>
      ) : (
        <div style={{ ...styles.chipRow, marginTop: "10px" }}>
          <button type="button" onClick={onAsk} disabled={busy} style={styles.dangerButton}>
            {busy
              ? "Cancelando..."
              : `Cancelar ${formatCount(cancellable.length)} pesagem(ns) repetida(s)`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * O que a passada do fechamento fez, pesagem a pesagem.
 *
 * A contagem sozinha nao resolve: "18 de 20" deixa a atendente procurando as duas que
 * faltaram no OMIE. A lista traz so as que NAO entraram (com o motivo do OMIE) — as que
 * deram certo ja aparecem faturadas na tabela do periodo, logo abaixo.
 */
function RunResultCard({
  result,
  onClose
}: {
  result: InvoiceClosingRunResult;
  onClose: () => void;
}) {
  const pending = result.items.filter(
    (item) => item.status === "blocked" || item.status === "failed"
  );
  const tone = pending.length > 0 ? styles.error : styles.info;

  return (
    <div style={styles.card}>
      <div style={styles.filterLabelRow}>
        <h3 style={styles.cardTitle}>Resultado do fechamento</h3>
        <button type="button" onClick={onClose} style={styles.clearButton}>
          Fechar
        </button>
      </div>
      <p style={tone}>
        {formatCount(result.billed)} carga(s) faturada(s) no OMIE
        {result.billed > 0 ? ` — ${formatBRL(result.billedTotalCents)}` : ""}.
        {result.alreadyBilled > 0
          ? ` ${formatCount(result.alreadyBilled)} ja tinha(m) nota e nao foi(ram) reenviada(s).`
          : ""}
        {result.skipped > 0
          ? ` ${formatCount(result.skipped)} venda(s) interna(s) ficaram de fora (nao geram nota fiscal).`
          : ""}
        {pending.length > 0
          ? ` ${formatCount(pending.length)} carga(s) NAO foram faturadas — veja abaixo.`
          : ""}
      </p>
      {pending.length > 0 ? (
        <div style={styles.tableScroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, textAlign: "left" }}>Vale</th>
                <th style={{ ...styles.th, textAlign: "left" }}>Cliente</th>
                <th style={styles.th}>Valor</th>
                <th style={{ ...styles.th, textAlign: "left" }}>Por que nao faturou</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item: InvoiceClosingRunItem) => (
                <tr key={item.operationId}>
                  <td style={{ ...styles.td, textAlign: "left" }}>
                    {formatCouponNumber(item.couponNumber)}
                  </td>
                  <td style={{ ...styles.td, textAlign: "left" }} title={item.customerName}>
                    {item.customerName}
                  </td>
                  <td style={styles.td}>{formatBRL(item.totalCents)}</td>
                  <td
                    style={{ ...styles.td, textAlign: "left", whiteSpace: "normal" }}
                    title={item.message}
                  >
                    {item.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
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
                        <InvoiceNumberCell
                          invoiceNumber={line.invoiceNumber}
                          operationType={line.operationType}
                        />
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
  },
  confirmCard: {
    background: "var(--kr-card-bg)",
    border: "2px solid var(--kr-primary-strong)",
    borderRadius: "12px",
    padding: "12px",
    boxShadow: "var(--kr-shadow)"
  },
  dangerButton: {
    border: "none",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    borderRadius: "8px",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer"
  }
};
