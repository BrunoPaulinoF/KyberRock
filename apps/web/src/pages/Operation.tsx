import { Ban, Check, Clock, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  CountBadge,
  DeskPanel,
  EmptyState,
  IconAction,
  LoaderLight,
  Pill,
  PillTabs,
  PlateBadge
} from "../components/desk";
import { Picker, type PickerOption } from "../components/Picker";
import { Alert, Badge, Field, Modal, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import {
  formatDateTime,
  formatDocument,
  formatMoney,
  formatPlate,
  formatTons,
  periodToIso,
  todayIso
} from "../lib/format";
import {
  CLOSED_EDITABLE,
  OPEN_STATUS,
  REQUEST_KIND_LABELS,
  changedFields,
  countByProduct,
  estimateClose,
  fiscalStatus,
  formatElapsedSince,
  formatWeightNumber,
  isFinished,
  matchesSearch,
  parsePriceCents,
  parseWeight,
  printWarning,
  requestStatusText,
  type EditableFields,
  type OperationRequest,
  type RequestKind
} from "../lib/operation";
import { q, type Operation } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { useAsync } from "../lib/use-async";

/**
 * Pesagem pelo site, nas mesmas telas do desktop. O site PEDE (web-api `request_operation`) e a balanca executora da
 * unidade EXECUTA pelas mesmas funcoes dos botoes do desktop, imprimindo o cupom do fechamento
 * na impressora dela. Esta tela e a "Operacoes" do desktop (abertas, canceladas, concluidas),
 * com os mesmos botoes; cada clique vira um pedido, acompanhado ao vivo (enviando -> balanca
 * registrando -> pronto). A Nova entrada fica em `NewEntry.tsx`. Contrato em `docs/web-api.md`.
 */

// ---------------------------------------------------------------------------
// Dados compartilhados pelas telas de operacao
// ---------------------------------------------------------------------------

export interface Catalog {
  customers: PickerOption[];
  vehicles: PickerOption[];
  drivers: PickerOption[];
  products: PickerOption[];
  carriers: PickerOption[];
  paymentMethods: PickerOption[];
  paymentTerms: PickerOption[];
  customerDefaults: Map<
    string,
    {
      paymentMethodId: string;
      paymentTermId: string;
      carrierId: string;
      /** Cadastro pede nota? Decide com/sem nota ao escolher o cliente, como no desktop. */
      nfRequired: boolean | null;
      /** Tipo de frete padrao do cadastro (aba Transporte do cliente). */
      freightModality: string | null;
    }
  >;
}

export function useCatalog(companyId: string) {
  return useAsync(async (): Promise<Catalog> => {
    const [customers, vehicles, drivers, products, carriers, methods, terms] = await Promise.all([
      q.customers(companyId),
      q.vehicles(companyId),
      q.drivers(companyId),
      q.products(companyId),
      q.carriers(companyId),
      q.paymentMethods(companyId),
      q.paymentTerms(companyId)
    ]);
    const liveCustomers = customers.filter((row) => row.is_active);
    return {
      customers: liveCustomers.map((row) => ({
        value: row.id,
        label: row.trade_name || row.legal_name,
        hint: formatDocument(row.document) || undefined
      })),
      vehicles: vehicles
        .filter((row) => row.is_active)
        .map((row) => ({
          value: row.id,
          label: formatPlate(row.plate),
          hint: row.description ?? undefined
        })),
      drivers: drivers
        .filter((row) => row.is_active)
        .map((row) => ({ value: row.id, label: row.name, hint: row.document ?? undefined })),
      products: products.map((row) => ({
        value: row.id,
        label: row.description,
        hint: row.code ?? undefined
      })),
      carriers: carriers
        .filter((row) => row.is_active)
        .map((row) => ({
          value: row.id,
          label: row.name,
          hint: formatDocument(row.document) || undefined
        })),
      paymentMethods: methods
        .filter((row) => row.is_active)
        .map((row) => ({ value: row.id, label: row.name })),
      paymentTerms: terms.map((row) => ({ value: row.id, label: row.name })),
      customerDefaults: new Map(
        liveCustomers.map((row) => [
          row.id,
          {
            paymentMethodId: row.default_payment_method_id ?? "",
            paymentTermId: row.default_payment_term_id ?? "",
            carrierId: row.default_carrier_id ?? "",
            nfRequired: row.nf_required,
            freightModality: row.default_freight_modality
          }
        ])
      )
    };
  }, [companyId]);
}

export interface ExecutorStatus {
  executor: {
    deviceId: string;
    name: string;
    online: boolean;
    seenAt: string | null;
    /** Versao do KyberRock Desktop da executora (nula em instalacao antiga). */
    appVersion?: string | null;
    /** A executora e mais velha que a versao que recebe frete e condicao digitada. */
    needsUpdate?: boolean;
    minVersion?: string;
  } | null;
  requiresPricePassword: boolean;
}

/** A balanca que executa os pedidos: conectada ou nao. Pergunta de 20 em 20 s. */
export function useExecutorStatus(): ExecutorStatus | null {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await callWebApi("operation_status");
        if (!cancelled) setStatus(result as unknown as ExecutorStatus);
      } catch {
        // Falha de rede: mantem o ultimo estado e tenta no proximo tique.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return status;
}

/**
 * Pedidos das ultimas 12 h, ao vivo: o Realtime avisa cada mudanca de status e, enquanto houver
 * pedido esperando a balanca, um tique de 3 s cobre aviso perdido. `onFinished` roda quando um
 * pedido termina (e a tela recarrega o patio).
 */
function useRequestFeed(companyId: string, onFinished: () => void) {
  const [requests, setRequests] = useState<OperationRequest[]>([]);
  const finishedRef = useRef(new Set<string>());
  // A primeira leitura so aprende o que ja estava pronto: recarregar o patio por causa de
  // pedidos antigos seria trabalho a toa.
  const initializedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await q.operationRequests(companyId, since);
      let finishedNow = false;
      for (const row of rows) {
        if (isFinished(row) && !finishedRef.current.has(row.id)) {
          finishedRef.current.add(row.id);
          if (initializedRef.current) finishedNow = true;
        }
      }
      initializedRef.current = true;
      setRequests(rows);
      if (finishedNow) onFinishedRef.current();
    } catch {
      // A proxima rodada tenta de novo.
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`operation-requests:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_requests",
          filter: `company_id=eq.${companyId}`
        },
        () => void load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, load]);

  const waiting = requests.some((request) => !isFinished(request));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  return { requests, reload: load };
}

/** Manda o pedido para a web-api; avisos (balanca fora do ar) viram toast. */
export async function sendRequest(
  toast: ReturnType<typeof useToast>,
  kind: RequestKind,
  body: { operationId?: string; data?: Record<string, unknown>; pricePassword?: string }
): Promise<boolean> {
  try {
    const result = await callWebApi("request_operation", { kind, ...body });
    for (const warning of result.warnings) toast.push(warning, "error");
    toast.push(`${REQUEST_KIND_LABELS[kind]} enviada para a balanca.`);
    return true;
  } catch (caught) {
    toast.push(errorMessage(caught), "error");
    return false;
  }
}

function operationLabel(operation: Pick<Operation, "operation_code" | "plate">): string {
  const code =
    operation.operation_code !== null
      ? `Nº ${operation.operation_code.toLocaleString("pt-BR")}`
      : "";
  const plate = operation.plate ? formatPlate(operation.plate) : "sem placa";
  return code ? `${code} · ${plate}` : plate;
}

/** Ctrl+Enter confirma o formulario, como no desktop. */
export function submitOnCtrlEnter(event: ReactKeyboardEvent<HTMLFormElement>) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }
}

// ---------------------------------------------------------------------------
// Cabecalho comum: balanca conectada + pedidos ao vivo
// ---------------------------------------------------------------------------

export function ExecutorBadge({ status }: { status: ExecutorStatus | null }) {
  if (!status) return <Badge>Balanca: verificando...</Badge>;
  if (!status.executor) {
    return <Badge kind="warn">Nenhuma balanca executa os pedidos do site</Badge>;
  }
  return status.executor.online ? (
    <Badge kind="ok">Balanca: {status.executor.name} conectada</Badge>
  ) : (
    <Badge kind="err">Balanca: {status.executor.name} fora do ar</Badge>
  );
}

/**
 * Os pedidos do site das ultimas 2 h: o que ainda espera a balanca, o que ela fez e o cupom que
 * nao imprimiu. Fica acima da fila, como o aviso do carregador no desktop.
 */
function RequestFeed({ requests }: { requests: OperationRequest[] }) {
  const since = Date.now() - 2 * 60 * 60 * 1000;
  const recent = requests.filter((request) => Date.parse(request.requested_at) >= since);
  if (recent.length === 0) return null;
  return (
    <ul className="request-feed">
      {recent.slice(0, 5).map((request) => {
        const warning = printWarning(request);
        const result = request.result as { operationCode?: number; plate?: string } | null;
        return (
          <li key={request.id} className={`request-item ${request.status}`}>
            <span className="request-dot" aria-hidden="true" />
            <div className="request-body">
              <strong>
                {REQUEST_KIND_LABELS[request.kind]}
                {result?.operationCode
                  ? ` · Nº ${result.operationCode.toLocaleString("pt-BR")}`
                  : ""}
                {result?.plate ? ` · ${formatPlate(result.plate)}` : ""}
              </strong>
              <span className="cell-sub">
                {requestStatusText(request)}
                {request.result_message && isFinished(request)
                  ? ` — ${request.result_message}`
                  : ""}
              </span>
              {warning && <span className="request-warning">{warning}</span>}
            </div>
            <span className="cell-sub request-when">
              {request.requested_by_name ? `${request.requested_by_name} · ` : ""}
              {formatDateTime(request.requested_at)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Tela Operacoes (abertas, canceladas, concluidas) — a mesma do desktop
// ---------------------------------------------------------------------------

type OperationsTab = "abertas" | "canceladas" | "concluidas";
type CanceledPeriod = "day" | "week" | "month";

const OPERATIONS_TABS: Array<{ id: OperationsTab; label: string; icon: LucideIcon }> = [
  { id: "abertas", label: "Operacoes abertas", icon: Clock },
  { id: "canceladas", label: "Operacoes canceladas", icon: Ban },
  { id: "concluidas", label: "Operacoes concluidas", icon: Check }
];

function isOperationsTab(value: string | null): value is OperationsTab {
  return value === "abertas" || value === "canceladas" || value === "concluidas";
}

/** Inicio do periodo das canceladas (Hoje / Ultimos 7 dias / Este mes), como no desktop. */
function canceledSince(period: CanceledPeriod, now: Date = new Date()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(1);
  return start.toISOString();
}

/** Qual janela esta aberta, e para qual pesagem. */
type Dialog =
  | { kind: "close"; operation: Operation }
  | { kind: "edit"; operation: Operation; only?: SingleEditField }
  | { kind: "cancel"; operation: Operation };

export function Operations() {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("aba");
  const tab: OperationsTab = isOperationsTab(tabParam) ? tabParam : "abertas";
  const executor = useExecutorStatus();
  const catalog = useCatalog(user.companyId);
  const [now, setNow] = useState(() => Date.now());
  const [plateSearch, setPlateSearch] = useState("");
  const [canceledPeriod, setCanceledPeriod] = useState<CanceledPeriod>("day");
  const [closedDay, setClosedDay] = useState(todayIso());
  const [closedProduct, setClosedProduct] = useState("all");
  const [closedSearch, setClosedSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const open = useAsync(
    () => q.openOperations(user.companyId, user.unitId),
    [user.companyId, user.unitId]
  );
  const openIds = useMemo(() => (open.data ?? []).map((row) => row.id), [open.data]);
  const loading = useAsync(
    () => q.loadingRequests(user.companyId, openIds),
    [user.companyId, openIds.join(",")]
  );
  const canceledFrom = useMemo(() => canceledSince(canceledPeriod), [canceledPeriod]);
  const canceled = useAsync(
    () =>
      tab === "canceladas"
        ? q.cancelledOperations(user.companyId, user.unitId, canceledFrom)
        : Promise.resolve([] as Operation[]),
    [tab, user.companyId, user.unitId, canceledFrom]
  );
  const closedPeriod = useMemo(() => periodToIso(closedDay, closedDay), [closedDay]);
  const closed = useAsync(
    () =>
      tab === "concluidas"
        ? q.closedOperations(user.companyId, closedPeriod.startIso, closedPeriod.endIso)
        : Promise.resolve([] as Operation[]),
    [tab, user.companyId, closedPeriod.startIso, closedPeriod.endIso]
  );

  const reloadOpen = open.reload;
  const reloadLoading = loading.reload;
  const reloadClosed = closed.reload;
  const reloadCanceled = canceled.reload;
  const feed = useRequestFeed(user.companyId, () => {
    void reloadOpen();
    void reloadClosed();
    void reloadCanceled();
  });

  // Fila pelo relogio: o tempo de cada caminhao anda, e a entrada feita no proprio PC da
  // balanca (ou a carga concluida pelo carregador) aparece aqui sem ninguem clicar.
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const poll = window.setInterval(() => {
      void reloadOpen();
      void reloadLoading();
    }, 15_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
    };
  }, [reloadOpen, reloadLoading]);

  // F2 abre a Nova entrada, como no desktop.
  useEffect(() => {
    if (!user.canOperate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        navigate("/nova-entrada");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user.canOperate, navigate]);

  const pendingOps = useMemo(
    () =>
      new Set(
        feed.requests
          .filter((request) => !isFinished(request))
          .map((request) => request.operation_id)
      ),
    [feed.requests]
  );
  const loaderDone = useMemo(
    () => new Map((loading.data ?? []).map((row) => [row.operation_id, row.loader_completed_at])),
    [loading.data]
  );

  const openRows = open.data ?? [];
  const plateNeedle = plateSearch.replace(/[\s-]/g, "").toUpperCase();
  const visibleOpen = plateNeedle
    ? openRows.filter((row) => (row.plate ?? "").toUpperCase().includes(plateNeedle))
    : openRows;
  const productCounts = useMemo(() => countByProduct(openRows), [openRows]);

  const closedRows = useMemo(
    () =>
      (closed.data ?? [])
        .filter((row) => row.status !== "cancelled" && row.unit_id === user.unitId)
        .sort((a, b) => (b.closed_at ?? b.created_at).localeCompare(a.closed_at ?? a.created_at)),
    [closed.data, user.unitId]
  );
  const closedProducts = useMemo(
    () =>
      [...new Set(closedRows.map((row) => row.product_description ?? "").filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "pt-BR")
      ),
    [closedRows]
  );
  const visibleClosed = closedRows.filter(
    (row) =>
      (closedProduct === "all" || row.product_description === closedProduct) &&
      matchesSearch(
        `${row.customer_name ?? ""} ${row.product_description ?? ""} ${row.plate ?? ""}`,
        closedSearch
      )
  );
  const canceledRows = canceled.data ?? [];

  const countLabel =
    tab === "abertas"
      ? plateNeedle
        ? `${visibleOpen.length} de ${openRows.length} abertas`
        : `${openRows.length} abertas`
      : tab === "canceladas"
        ? `${canceledRows.length} canceladas`
        : `${visibleClosed.length} concluidas`;

  async function reprint(operation: Operation) {
    await sendRequest(toast, "reprint", { operationId: operation.id });
    void feed.reload();
  }

  function actionsFor(operation: Operation, children: ReactNode) {
    if (!user.canOperate) return <span className="row-actions" />;
    if (pendingOps.has(operation.id)) {
      return (
        <span className="row-actions">
          <Pill tone="warning">Aguardando a balanca</Pill>
        </span>
      );
    }
    return <span className="row-actions">{children}</span>;
  }

  const error = open.error ?? closed.error ?? canceled.error ?? catalog.error;

  return (
    <DeskPanel fill>
      <div className="desk-title-row">
        <div>
          <p className="desk-kicker">Fila operacional</p>
          <h1 className="desk-title">Operacoes</h1>
        </div>
        <span className="executor-line">
          <ExecutorBadge status={executor} />
          <CountBadge>{countLabel}</CountBadge>
        </span>
      </div>

      <div className="op-toolbar">
        <PillTabs
          tabs={OPERATIONS_TABS}
          active={tab}
          onChange={(next) => setParams(next === "abertas" ? {} : { aba: next }, { replace: true })}
        />
        {tab === "abertas" && (
          <div className="op-filters">
            <label className="op-filter">
              Buscar placa
              <input
                className="input"
                type="search"
                value={plateSearch}
                placeholder="Placa do caminhao"
                aria-label="Buscar operacao aberta pela placa"
                style={{ minWidth: 240 }}
                onChange={(event) => setPlateSearch(event.target.value)}
              />
            </label>
          </div>
        )}
        {tab === "canceladas" && (
          <div className="op-filters">
            <label className="op-filter">
              Periodo
              <select
                className="select"
                value={canceledPeriod}
                style={{ minWidth: 150 }}
                onChange={(event) => setCanceledPeriod(event.target.value as CanceledPeriod)}
              >
                <option value="day">Hoje</option>
                <option value="week">Ultimos 7 dias</option>
                <option value="month">Este mes</option>
              </select>
            </label>
          </div>
        )}
        {tab === "concluidas" && (
          <div className="op-filters">
            <label className="op-filter">
              Dia
              <input
                className="input"
                type="date"
                value={closedDay}
                onChange={(event) => setClosedDay(event.target.value || todayIso())}
              />
            </label>
            <label className="op-filter">
              Produto
              <select
                className="select"
                value={closedProduct}
                style={{ minWidth: 180 }}
                onChange={(event) => setClosedProduct(event.target.value)}
              >
                <option value="all">Todos</option>
                {closedProducts.map((product) => (
                  <option key={product} value={product}>
                    {product}
                  </option>
                ))}
              </select>
            </label>
            <label className="op-filter">
              Buscar
              <input
                className="input"
                type="search"
                value={closedSearch}
                placeholder="Cliente, placa ou produto"
                style={{ minWidth: 240 }}
                onChange={(event) => setClosedSearch(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      <RequestFeed requests={feed.requests} />

      {tab === "abertas" &&
        (openRows.length === 0 ? (
          <EmptyState
            title={open.loading ? "Carregando..." : "Nenhuma operacao aberta"}
            hint="As entradas registradas pela balanca aparecem aqui para fechamento."
          />
        ) : (
          <>
            <div
              className="product-counters"
              role="list"
              aria-label="Operacoes abertas por produto"
            >
              {productCounts.map((product) => (
                <span key={product.label} role="listitem" className="product-counter">
                  {product.label}
                  <strong>{product.count}</strong>
                </span>
              ))}
            </div>
            <div className="op-table">
              <div className="op-row open head">
                <span>Placa / Carregador</span>
                <span>Cliente / Produto</span>
                <span>Entrada / Preco</span>
                <span>Acoes</span>
              </div>
              {visibleOpen.length === 0 && (
                <EmptyState
                  title="Nenhuma operacao aberta com essa placa"
                  hint="Confira a placa digitada ou limpe a busca para ver a fila inteira."
                />
              )}
              {visibleOpen.map((row) => (
                <div
                  key={row.id}
                  className={`op-row open${pendingOps.has(row.id) ? " waiting" : ""}`}
                >
                  <span className="op-plate">
                    <PlateBadge plate={formatPlate(row.plate ?? "")} />
                    <LoaderLight completedAt={loaderDone.get(row.id)} />
                  </span>
                  <span className="op-cell">
                    <strong>{row.customer_name || "Cliente nao informado"}</strong>
                    <span>{row.product_description || "Produto nao informado"}</span>
                    <small>Motorista: {row.driver_name || "—"}</small>
                  </span>
                  <span className="op-cell">
                    <strong>{formatWeightNumber(row.entry_weight_kg)}</strong>
                    <span>{formatMoney(row.unit_price_cents)}/ton</span>
                    <small title={formatDateTime(row.created_at)}>
                      Entrou {formatElapsedSince(row.created_at, now)}
                    </small>
                  </span>
                  {actionsFor(
                    row,
                    <>
                      <IconAction
                        icon="file-text"
                        label="Ver / editar operacao"
                        onClick={() => setDialog({ kind: "edit", operation: row })}
                      />
                      <IconAction
                        icon="swap"
                        label="Alterar material"
                        onClick={() =>
                          setDialog({ kind: "edit", operation: row, only: "productId" })
                        }
                      />
                      <IconAction
                        icon="edit"
                        label="Alterar cliente"
                        onClick={() =>
                          setDialog({ kind: "edit", operation: row, only: "customerId" })
                        }
                      />
                      <IconAction
                        icon="truck"
                        label="Alterar transportadora"
                        onClick={() =>
                          setDialog({ kind: "edit", operation: row, only: "carrierId" })
                        }
                      />
                      <IconAction
                        icon="check"
                        label="Fechar operacao"
                        tone="primary"
                        onClick={() => setDialog({ kind: "close", operation: row })}
                      />
                      <IconAction
                        icon="ban"
                        label="Cancelar operacao"
                        tone="danger"
                        onClick={() => setDialog({ kind: "cancel", operation: row })}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        ))}

      {tab === "canceladas" &&
        (canceledRows.length === 0 ? (
          <EmptyState
            title={canceled.loading ? "Carregando..." : "Nenhuma operacao cancelada"}
            hint="Altere o periodo no filtro para consultar outros cancelamentos."
          />
        ) : (
          <div className="op-table">
            <div className="op-row canceled head">
              <span>Placa</span>
              <span>Cliente / Produto</span>
              <span>Cancelada em</span>
              <span>Motivo</span>
            </div>
            {canceledRows.map((row) => (
              <div key={row.id} className="op-row canceled">
                <PlateBadge plate={formatPlate(row.plate ?? "")} />
                <span className="op-cell">
                  <strong>{row.customer_name || "Cliente nao informado"}</strong>
                  <span>{row.product_description || "Produto nao informado"}</span>
                </span>
                <span>{formatDateTime(row.updated_at)}</span>
                <span>{row.cancel_reason || "Sem motivo registrado"}</span>
              </div>
            ))}
          </div>
        ))}

      {tab === "concluidas" &&
        (visibleClosed.length === 0 ? (
          <EmptyState
            title={closed.loading ? "Carregando..." : "Nenhuma operacao concluida"}
            hint="As operacoes fechadas no dia escolhido aparecem aqui."
          />
        ) : (
          <div className="op-table">
            <div className="op-row closed head">
              <span>Placa</span>
              <span>Cliente / Produto</span>
              <span>Peso liquido / Receita</span>
              <span>Concluida em</span>
              <span>Fiscal OMIE</span>
              <span>Acoes</span>
            </div>
            {visibleClosed.map((row) => {
              const fiscal = fiscalStatus(row);
              return (
                <div
                  key={row.id}
                  className={`op-row closed${pendingOps.has(row.id) ? " waiting" : ""}`}
                >
                  <PlateBadge plate={formatPlate(row.plate ?? "")} />
                  <span className="op-cell">
                    <strong>{row.customer_name || "Cliente nao informado"}</strong>
                    <span>{row.product_description || "Produto nao informado"}</span>
                    <small>Motorista: {row.driver_name || "—"}</small>
                  </span>
                  <span className="op-cell">
                    <strong>{formatWeightNumber(row.net_weight_kg)}</strong>
                    <span>{formatMoney(row.total_cents)}</span>
                  </span>
                  <span>{formatDateTime(row.closed_at ?? row.created_at)}</span>
                  <span className="op-cell">
                    <Pill tone={fiscal.tone}>{fiscal.label}</Pill>
                    <small>{fiscal.detail}</small>
                  </span>
                  {actionsFor(
                    row,
                    <>
                      <IconAction
                        icon="printer"
                        label="Reimprimir nota"
                        onClick={() => void reprint(row)}
                      />
                      <IconAction
                        icon="edit"
                        label="Editar cliente, produto ou transportadora"
                        onClick={() => setDialog({ kind: "edit", operation: row })}
                      />
                      <IconAction
                        icon="ban"
                        label="Venda cancelada"
                        tone="danger"
                        onClick={() => setDialog({ kind: "cancel", operation: row })}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}

      {dialog?.kind === "close" && (
        <ExitModal
          operation={dialog.operation}
          onClose={() => setDialog(null)}
          onSent={() => {
            setDialog(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
      {dialog?.kind === "edit" && catalog.data && (
        <EditModal
          operation={dialog.operation}
          catalog={catalog.data}
          only={dialog.only}
          requiresPricePassword={executor?.requiresPricePassword ?? false}
          onClose={() => setDialog(null)}
          onSent={() => {
            setDialog(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelModal
          operation={dialog.operation}
          onClose={() => setDialog(null)}
          onSent={() => {
            setDialog(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
    </DeskPanel>
  );
}

// ---------------------------------------------------------------------------
// Janelas
// ---------------------------------------------------------------------------

/** Os "Alterar material / cliente / transportadora" da fila abrem so aquele campo. */
export type SingleEditField = "customerId" | "productId" | "carrierId";

const SINGLE_EDIT_TITLES: Record<SingleEditField, string> = {
  customerId: "Alterar cliente",
  productId: "Alterar material",
  carrierId: "Alterar transportadora"
};

type ModalProps = {
  onClose: () => void;
  onSent: () => void;
  toast: ReturnType<typeof useToast>;
};

function ExitModal({ operation, onClose, onSent, toast }: ModalProps & { operation: Operation }) {
  const formId = "exit-form";
  const [weight, setWeight] = useState("");
  const [operationType, setOperationType] = useState(
    operation.operation_type === "internal" ? "internal" : "invoice"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exitKg = parseWeight(weight);
  const estimate = estimateClose(operation.entry_weight_kg, exitKg, operation.unit_price_cents);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (exitKg === null) {
      setError("Digite o peso de saida em kg.");
      return;
    }
    setBusy(true);
    const data: Record<string, unknown> = { exitWeightKg: exitKg };
    if (operationType !== operation.operation_type) data.operationType = operationType;
    const ok = await sendRequest(toast, "exit", { operationId: operation.id, data });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title={`Fechar saida — ${operationLabel(operation)}`}
      description={`${operation.customer_name ?? ""} · ${operation.product_description ?? ""}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Fechar e imprimir (Ctrl+Enter)"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid-2">
          <Field label="Peso de entrada">
            <input className="input" value={formatTons(operation.entry_weight_kg)} disabled />
          </Field>
          <Field label="Peso de saida (kg)" hint="Ex.: 40.120">
            <input
              className="input weight-input"
              inputMode="numeric"
              value={weight}
              autoFocus
              onChange={(event) => setWeight(event.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
        <Field label="Tipo">
          <select
            className="select"
            value={operationType}
            onChange={(event) => setOperationType(event.target.value)}
          >
            <option value="invoice">Com nota (venda)</option>
            <option value="internal">Sem nota (interna)</option>
          </select>
        </Field>
        {estimate && (
          <div className="kpis">
            <div className="kpi">
              <span>Liquido</span>
              <strong>{formatTons(estimate.netKg)}</strong>
            </div>
            <div className="kpi">
              <span>Produto (estimativa)</span>
              <strong>
                {estimate.productTotalCents === null
                  ? "—"
                  : formatMoney(estimate.productTotalCents)}
              </strong>
            </div>
          </div>
        )}
        <p className="cell-sub">
          Frete, credito e o valor final a balanca calcula no fechamento. O cupom sai na impressora
          dela.
        </p>
      </form>
    </Modal>
  );
}

function EditModal({
  operation,
  catalog,
  only,
  requiresPricePassword,
  onClose,
  onSent,
  toast
}: ModalProps & {
  operation: Operation;
  catalog: Catalog;
  only?: SingleEditField;
  requiresPricePassword: boolean;
}) {
  const formId = "edit-form";
  const open = operation.status === OPEN_STATUS;
  // A nuvem nao guarda o id da placa e do motorista da pesagem, so o texto: em branco aqui
  // significa "manter", e so vai no pedido se alguem escolher outro.
  const original: EditableFields = useMemo(
    () => ({
      customerId: operation.customer_id ?? "",
      productId: operation.product_id ?? "",
      vehicleId: "",
      driverId: "",
      carrierId: operation.carrier_id ?? "",
      paymentMethodId: operation.payment_method_id ?? "",
      paymentTermId: operation.payment_term_id ?? "",
      operationType: operation.operation_type,
      unitPriceCents: operation.unit_price_cents
    }),
    [operation]
  );
  const [fields, setFields] = useState<EditableFields>(original);
  const [price, setPrice] = useState(
    operation.unit_price_cents
      ? (operation.unit_price_cents / 100).toFixed(2).replace(".", ",")
      : ""
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edited: EditableFields = {
    ...fields,
    unitPriceCents: parsePriceCents(price) ?? original.unitPriceCents
  };
  const changes = changedFields(
    original,
    edited,
    only ? [only] : open ? undefined : CLOSED_EDITABLE
  );
  const priceChanged = "unitPriceCents" in changes;
  const set = (key: keyof EditableFields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (Object.keys(changes).length === 0) {
      setError("Nada foi alterado.");
      return;
    }
    if (priceChanged && requiresPricePassword && !password) {
      setError("Digite a senha de alteracao de preco.");
      return;
    }
    setBusy(true);
    const ok = await sendRequest(toast, "update", {
      operationId: operation.id,
      data: changes,
      pricePassword: priceChanged && requiresPricePassword ? password : undefined
    });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title={`${only ? SINGLE_EDIT_TITLES[only] : "Ver / editar operacao"} — ${operationLabel(operation)}`}
      description={
        only
          ? `${operation.customer_name ?? ""} · ${operation.product_description ?? ""}`
          : open
            ? "Mude o que precisar. So o que for alterado vai para a balanca."
            : "Pesagem concluida: da para trocar cliente, produto ou transportadora."
      }
      wide={!only}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Salvar alteracao (Ctrl+Enter)"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        {only === "customerId" && (
          <Field label="Cliente">
            <Picker
              value={fields.customerId}
              options={catalog.customers}
              onChange={set("customerId")}
              autoFocus
            />
          </Field>
        )}
        {only === "productId" && (
          <Field label="Produto">
            <Picker
              value={fields.productId}
              options={catalog.products}
              onChange={set("productId")}
              autoFocus
            />
          </Field>
        )}
        {only === "carrierId" && (
          <Field label="Transportadora">
            <Picker
              value={fields.carrierId}
              options={catalog.carriers}
              onChange={set("carrierId")}
              allowEmpty
              emptyLabel="Sem transportadora"
              autoFocus
            />
          </Field>
        )}
        {!only && (
          <div className="grid-2">
            <Field label="Cliente">
              <Picker
                value={fields.customerId}
                options={catalog.customers}
                onChange={set("customerId")}
              />
            </Field>
            <Field label="Produto">
              <Picker
                value={fields.productId}
                options={catalog.products}
                onChange={set("productId")}
              />
            </Field>
            <Field label="Transportadora">
              <Picker
                value={fields.carrierId}
                options={catalog.carriers}
                onChange={set("carrierId")}
                allowEmpty
                emptyLabel="Sem transportadora"
              />
            </Field>
            {open && !only && (
              <>
                <Field label="Placa" hint={`Atual: ${formatPlate(operation.plate ?? "") || "—"}`}>
                  <Picker
                    value={fields.vehicleId}
                    options={catalog.vehicles}
                    onChange={set("vehicleId")}
                    placeholder="Manter a atual"
                  />
                </Field>
                <Field label="Motorista" hint={`Atual: ${operation.driver_name || "—"}`}>
                  <Picker
                    value={fields.driverId}
                    options={catalog.drivers}
                    onChange={set("driverId")}
                    placeholder="Manter o atual"
                  />
                </Field>
                <Field label="Tipo">
                  <select
                    className="select"
                    value={fields.operationType}
                    onChange={(event) => set("operationType")(event.target.value)}
                  >
                    <option value="invoice">Com nota (venda)</option>
                    <option value="internal">Sem nota (interna)</option>
                  </select>
                </Field>
                <Field label="Forma de pagamento">
                  <Picker
                    value={fields.paymentMethodId}
                    options={catalog.paymentMethods}
                    onChange={set("paymentMethodId")}
                    allowEmpty
                    emptyLabel="Sem forma"
                  />
                </Field>
                <Field label="Condicao de pagamento">
                  <Picker
                    value={fields.paymentTermId}
                    options={catalog.paymentTerms}
                    onChange={set("paymentTermId")}
                    allowEmpty
                    emptyLabel="A vista"
                  />
                </Field>
                <Field label="Preco por tonelada (R$)">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </Field>
                {priceChanged && requiresPricePassword && (
                  <Field label="Senha de alteracao de preco">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                )}
              </>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

function CancelModal({ operation, onClose, onSent, toast }: ModalProps & { operation: Operation }) {
  const formId = "cancel-form";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError("Escreva o motivo do cancelamento.");
      return;
    }
    setBusy(true);
    const ok = await sendRequest(toast, "cancel", {
      operationId: operation.id,
      data: { reason: reason.trim() }
    });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title={`Cancelar — ${operationLabel(operation)}`}
      description={
        operation.status === OPEN_STATUS
          ? "O caminhao sai do patio."
          : "Se o pedido ja foi para o OMIE, a balanca pede o cancelamento la tambem."
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn danger" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Cancelar pesagem"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Motivo">
          <textarea
            className="textarea"
            rows={3}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
