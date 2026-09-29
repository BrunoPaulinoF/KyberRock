import "./operation.css";

import {
  Ban,
  Check,
  Clock,
  Package,
  Pencil,
  Printer,
  Truck,
  UserRound,
  type LucideIcon
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { CountBadge, DeskPanel, LoaderLight, PillTabs, PlateBadge } from "../components/desk";
import { Picker, type PickerOption } from "../components/Picker";
import {
  ActionMenu,
  Alert,
  EmptyState,
  ErrorState,
  Field,
  LoadMore,
  Modal,
  PAGE_SIZE,
  PageHeader,
  Pill,
  SkeletonRows,
  useShowMore,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  dedupeByNameAndCode,
  dedupeDrivers,
  dedupePaymentMethods,
  dedupeVehicles,
  representativeIds
} from "../lib/dedupe";
import {
  formatDateTime,
  formatDocument,
  formatMoney,
  formatPlate,
  formatTons
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
  parsePriceCents,
  parseWeight,
  printWarning,
  requestStatusText,
  type EditableFields,
  type OperationRequest,
  type RequestKind
} from "../lib/operation";
import { PRICE_CODE_HINT } from "../lib/price-code";
import { q, type Operation } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { closedPeriodBounds } from "../lib/closed-operations";
import { invoiceNumberLabel } from "../lib/desktop/invoice-number-label";
import { rememberedKey, useUrlState } from "../lib/url-state";
import { useAsync } from "../lib/use-async";
import { usePaged } from "../lib/use-paged";
import { useDebounced } from "./Customers";

/**
 * Pesagem pelo site, nas mesmas telas do desktop. O site PEDE (web-api `request_operation`) e a balanca executora da
 * unidade EXECUTA pelas mesmas funcoes dos botoes do desktop, imprimindo o cupom do fechamento
 * na impressora dela. Esta tela e a "Operacoes" do desktop (abertas, canceladas, concluidas),
 * com os mesmos botoes; cada clique vira um pedido, acompanhado ao vivo (enviando -> balanca
 * registrando -> pronto). Nova entrada nao ha no site: so no KyberRock Desktop. Contrato em
 * `docs/web-api.md`.
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
  /** Id de qualquer copia -> id da representante que o seletor mostra (`lib/dedupe.ts`). */
  representatives: { paymentMethods: Map<string, string>; paymentTerms: Map<string, string> };
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

export function representativeOf(map: Map<string, string>, id: string | null): string {
  if (!id) return "";
  return map.get(id) ?? id;
}

/**
 * Os seletores da pesagem pelo site. Cliente, placa ou motorista cadastrado na balanca entra
 * aqui na hora, sem recarregar a pagina (`useOnCadastroChange`).
 */
export function useCatalog(companyId: string) {
  const catalog = useAsync(
    async (): Promise<Catalog> => {
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
      // Cada balanca subiu a sua copia de placa, motorista, forma e condicao: o seletor mostra
      // uma de cada, e o padrao do cliente (que pode ser a copia de outra maquina) aponta para a
      // representante (`lib/dedupe.ts`).
      const vehicleGroups = dedupeVehicles(vehicles.filter((row) => row.is_active));
      const driverGroups = dedupeDrivers(drivers.filter((row) => row.is_active));
      const methodGroups = dedupePaymentMethods(methods.filter((row) => row.is_active));
      const termGroups = dedupeByNameAndCode(terms);
      const methodIds = representativeIds(methodGroups);
      const termIds = representativeIds(termGroups);
      return {
        customers: liveCustomers.map((row) => ({
          value: row.id,
          label: row.trade_name || row.legal_name,
          hint: formatDocument(row.document) || undefined
        })),
        vehicles: vehicleGroups.map(({ row }) => ({
          value: row.id,
          label: formatPlate(row.plate),
          hint: row.description ?? undefined
        })),
        drivers: driverGroups.map(({ row }) => ({
          value: row.id,
          label: row.name,
          hint: row.document ?? undefined
        })),
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
        paymentMethods: methodGroups.map(({ row }) => ({ value: row.id, label: row.name })),
        paymentTerms: termGroups.map(({ row }) => ({ value: row.id, label: row.name })),
        representatives: { paymentMethods: methodIds, paymentTerms: termIds },
        customerDefaults: new Map(
          liveCustomers.map((row) => [
            row.id,
            {
              paymentMethodId: representativeOf(methodIds, row.default_payment_method_id),
              paymentTermId: representativeOf(termIds, row.default_payment_term_id),
              carrierId: row.default_carrier_id ?? "",
              nfRequired: row.nf_required,
              freightModality: row.default_freight_modality
            }
          ])
        )
      };
    },
    [companyId],
    { key: `operacoes:catalogo:${companyId}` }
  );
  useOnCadastroChange(catalog.refresh, [
    ...CADASTRO_TABLES.customers,
    ...CADASTRO_TABLES.vehicles,
    ...CADASTRO_TABLES.drivers,
    ...CADASTRO_TABLES.products,
    ...CADASTRO_TABLES.carriers,
    ...CADASTRO_TABLES.payment
  ]);
  return catalog;
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

/**
 * Manda o pedido para a web-api. Aviso (balanca fora do ar) e "gravou, mas...": o pedido foi
 * aceito, entao vai como aviso, nao como erro.
 */
export async function sendRequest(
  toast: ReturnType<typeof useToast>,
  kind: RequestKind,
  body: { operationId?: string; data?: Record<string, unknown>; pricePassword?: string }
): Promise<boolean> {
  try {
    const result = await callWebApi("request_operation", { kind, ...body });
    for (const warning of result.warnings) toast.push(warning, "warn");
    toast.push(`Pedido de ${REQUEST_KIND_LABELS[kind].toLowerCase()} enviado para a balança.`);
    return true;
  } catch (caught) {
    toast.push(errorMessage(caught), "error");
    return false;
  }
}

/** A coluna "Nota fiscal" das concluidas: o numero, "Sem nota" ou "—" (venda interna). */
function InvoiceNumberCell({ number, internal }: { number: string | null; internal: boolean }) {
  const label = invoiceNumberLabel(number, internal ? "internal" : "invoice");
  return (
    <span className="op-cell op-line" data-label="Nota fiscal" title={label.title ?? undefined}>
      {label.state === "number" ? <strong>NF {label.text}</strong> : <small>{label.text}</small>}
    </span>
  );
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
  if (!status) return <Pill>Balança: verificando...</Pill>;
  if (!status.executor) {
    return <Pill tone="warning">Nenhuma balança executa os pedidos do site</Pill>;
  }
  return status.executor.online ? (
    <Pill tone="success">Balança: {status.executor.name} conectada</Pill>
  ) : (
    <Pill tone="danger">Balança: {status.executor.name} fora do ar</Pill>
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
/** O valor vai no endereco (`?periodo=semana`), por isso em portugues. */
type CanceledPeriod = "hoje" | "semana" | "mes";

const OPERATIONS_TABS: Array<{ id: OperationsTab; label: string; icon: LucideIcon }> = [
  { id: "abertas", label: "Abertas", icon: Clock },
  { id: "canceladas", label: "Canceladas", icon: Ban },
  { id: "concluidas", label: "Concluídas", icon: Check }
];

function isOperationsTab(value: string | null): value is OperationsTab {
  return value === "abertas" || value === "canceladas" || value === "concluidas";
}

function isCanceledPeriod(value: string): value is CanceledPeriod {
  return value === "hoje" || value === "semana" || value === "mes";
}

/** Inicio do periodo das canceladas (Hoje / Ultimos 7 dias / Este mes), como no desktop. */
function canceledSince(period: CanceledPeriod, now: Date = new Date()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "semana") start.setDate(start.getDate() - 6);
  if (period === "mes") start.setDate(1);
  return start.toISOString();
}

/**
 * Dia (AAAA-MM-DD) vindo do endereco. Endereco editado a mao com data invalida viraria erro na
 * conta do periodo (`toISOString` de data invalida lanca); fica como "sem data".
 */
function isoDayOrEmpty(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : "";
}

// ---------------------------------------------------------------------------
// Filtros no endereco (`lib/url-state.ts`)
// ---------------------------------------------------------------------------

/** Esquece o filtro lembrado desta tela sem mexer no endereco. */
function forgetRemembered(pathname: string, key: string): void {
  try {
    window.sessionStorage.removeItem(rememberedKey(pathname, key));
  } catch {
    // Navegador sem armazenamento: nao ha o que esquecer.
  }
}

/**
 * Campo digitado (busca, data) que mora no endereco. O roteador troca o endereco dentro de uma
 * transicao, e o campo controlado por ela volta ao valor antigo a cada tecla (o cursor pula para
 * o fim e letra digitada rapido se perde). Por isso o campo guarda o que se digita e so copia o
 * endereco quando a mudanca vem de fora — link da busca rapida, "Todas as datas" —, isto e, com
 * o campo sem foco. Devolve o valor do endereco (o que filtra) e as props do campo.
 */
function useUrlField(key: string, clean: (value: string) => string = (value) => value) {
  const [raw, setValue] = useUrlState(key);
  const value = clean(raw);
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const input = {
    value: draft,
    onFocus: () => {
      editing.current = true;
    },
    onBlur: () => {
      editing.current = false;
    },
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value);
      setValue(event.target.value);
    }
  };
  return [value, input] as const;
}

/**
 * Limpa varios filtros num clique so. Dois `set` do `useUrlState` seguidos partem do mesmo
 * endereco (o do ultimo desenho da tela), e o segundo devolveria o que o primeiro tirou.
 */
function useClearUrlFilters() {
  const [, setParams] = useSearchParams();
  const { pathname } = useLocation();
  return useCallback(
    (keys: string[]) => {
      for (const key of keys) forgetRemembered(pathname, key);
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          for (const key of keys) copy.delete(key);
          return copy;
        },
        { replace: true }
      );
    },
    [pathname, setParams]
  );
}

/** A fila enquanto a primeira leitura chega: a moldura da tabela com as linhas em cinza. */
function QueueSkeleton({ columns }: { columns: number }) {
  return (
    <div className="op-table">
      <SkeletonRows rows={5} columns={columns} />
    </div>
  );
}

/** Qual janela esta aberta, e para qual pesagem. */
type Dialog =
  | { kind: "close"; operation: Operation }
  | { kind: "edit"; operation: Operation; only?: SingleEditField }
  | { kind: "cancel"; operation: Operation };

export function Operations() {
  const user = useUser();
  const toast = useToast();
  const location = useLocation();
  const [params] = useSearchParams();
  const executor = useExecutorStatus();
  const catalog = useCatalog(user.companyId);
  const [now, setNow] = useState(() => Date.now());

  // Filtros no endereco e lembrados ao voltar pelo menu (`lib/url-state.ts`): a placa das
  // abertas (`?placa=`, tambem o link da busca rapida), o periodo das canceladas e a busca, as
  // datas e o produto das concluidas.
  const [plateSearch, plateInput] = useUrlField("placa");
  const [periodParam, setCanceledPeriod] = useUrlState("periodo", "hoje");
  const canceledPeriod: CanceledPeriod = isCanceledPeriod(periodParam) ? periodParam : "hoje";
  // Periodo opcional: sem data, a lista traz todas as concluidas, da mais nova para a mais antiga.
  const [closedStart, closedStartInput] = useUrlField("de", isoDayOrEmpty);
  const [closedEnd, closedEndInput] = useUrlField("ate", isoDayOrEmpty);
  const [closedProduct, setClosedProduct] = useUrlState("produto");
  const [closedSearch, closedSearchInput] = useUrlField("busca");
  const clearUrlFilters = useClearUrlFilters();

  // Link direto da busca rapida (`/operacoes?placa=ABC1D23`, sem `aba`) pede a fila de abertas:
  // a aba lembrada de outra visita (Concluidas, por exemplo) nao pode esconder o caminhao
  // procurado, entao ela e esquecida ANTES de o `useUrlState` da aba ler a memoria. So conta
  // endereco novo (`location.key`): o mesmo endereco redesenhado (o relogio da fila) enquanto a
  // aba recem-escolhida ainda esta a caminho do endereco nao apaga a escolha.
  const handledPlateLink = useRef<string | null>(null);
  if (params.has("placa") && !params.has("aba") && handledPlateLink.current !== location.key) {
    handledPlateLink.current = location.key;
    forgetRemembered(location.pathname, "aba");
  }
  // A aba vem DEPOIS dos outros filtros de proposito. Voltando pelo menu, cada filtro lembrado
  // volta ao endereco no efeito do seu `useUrlState`, e na mesma rodada o ultimo a escrever
  // vence: com a aba por ultimo, ela chega ao endereco antes da placa, e nunca aparece um
  // endereco com placa e sem aba — que a regra acima leria como o link da busca rapida.
  const [tabParam, setTab] = useUrlState("aba", "abertas");
  const tab: OperationsTab = isOperationsTab(tabParam) ? tabParam : "abertas";
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const open = useAsync(
    () => q.openOperations(user.companyId, user.unitId),
    [user.companyId, user.unitId],
    { key: `operacoes:abertas:${user.companyId}:${user.unitId}` }
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
  const closedPeriod = useMemo(
    () => closedPeriodBounds(closedStart, closedEnd),
    [closedStart, closedEnd]
  );
  const closedSearchText = useDebounced(closedSearch);
  // 50 por vez, ja filtradas no banco ("Ver mais" traz as proximas): o historico inteiro da
  // unidade nao cabe numa leitura so.
  const closed = usePaged(
    (from, to) =>
      tab === "concluidas"
        ? q.closedOperationsPage(
            user.companyId,
            user.unitId,
            {
              startIso: closedPeriod.startIso,
              endIso: closedPeriod.endIso,
              product: closedProduct || null,
              search: closedSearchText
            },
            from,
            to
          )
        : Promise.resolve({ rows: [] as Operation[], total: 0 }),
    [
      tab,
      user.companyId,
      user.unitId,
      closedPeriod.startIso,
      closedPeriod.endIso,
      closedProduct,
      closedSearchText
    ],
    PAGE_SIZE
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

  // Aviso da balanca: entrada, saida, cancelamento ou carga do carregador aparecem na hora, sem
  // esperar o tique acima (que fica de rede de seguranca). Releitura silenciosa.
  useOnCadastroChange(open.refresh, CADASTRO_TABLES.operationsAndLoading);
  useOnCadastroChange(loading.refresh, CADASTRO_TABLES.operationsAndLoading);
  useOnCadastroChange(closed.refresh, CADASTRO_TABLES.operations);
  useOnCadastroChange(canceled.refresh, CADASTRO_TABLES.operations);

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

  const visibleClosed = closed.rows;
  const closedProducts = useMemo(
    () =>
      [...new Set((catalog.data?.products ?? []).map((product) => product.label))].sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [catalog.data]
  );
  const canceledRows = canceled.data ?? [];
  // 50 por vez em cada aba ("Ver mais" traz outros 50): o dia cheio desenhava centenas de linhas.
  const openPage = useShowMore(`${tab}|${plateNeedle}`);
  const canceledPage = useShowMore(tab);

  const countLabel =
    tab === "abertas"
      ? plateNeedle
        ? `${visibleOpen.length} de ${openRows.length} abertas`
        : `${openRows.length} abertas`
      : tab === "canceladas"
        ? `${canceledRows.length} canceladas`
        : `${closed.total.toLocaleString("pt-BR")} concluídas`;
  // Contador em cada aba quando ele e conhecido: as abertas vem sempre; canceladas e concluidas
  // so sao lidas com a aba aberta, e um "0" nas outras seria mentira.
  const tabCounts: Record<OperationsTab, number | null> = {
    abertas: open.data ? open.data.length : null,
    canceladas: tab === "canceladas" && !canceled.loading ? canceledRows.length : null,
    concluidas:
      tab === "concluidas" && !(closed.loading && closed.rows.length === 0) ? closed.total : null
  };
  const tabs = OPERATIONS_TABS.map((item) => ({ ...item, count: tabCounts[item.id] }));

  async function reprint(operation: Operation) {
    await sendRequest(toast, "reprint", { operationId: operation.id });
    void feed.reload();
  }

  function actionsFor(operation: Operation, children: ReactNode) {
    if (!user.canOperate) return <span className="row-actions" />;
    if (pendingOps.has(operation.id)) {
      return (
        <span className="row-actions">
          <Pill tone="warning">Aguardando a balança</Pill>
        </span>
      );
    }
    return <span className="row-actions">{children}</span>;
  }

  // Cada linha tem UM botao visivel — o que mais se faz ali — e o resto no "⋯", com o nome
  // escrito. O lapis e so "Alterar pesagem" (a janela com todos os campos), nas duas abas.
  function openActions(row: Operation) {
    return actionsFor(
      row,
      <>
        <button
          type="button"
          className="btn primary op-main-action"
          onClick={() => setDialog({ kind: "close", operation: row })}
        >
          <Check size={16} aria-hidden="true" />
          Fechar saída
        </button>
        <ActionMenu
          label={`Mais ações — ${operationLabel(row)}`}
          actions={[
            {
              label: "Alterar pesagem",
              icon: Pencil,
              hint: "Placa, motorista, pagamento, preço e os demais campos",
              onClick: () => setDialog({ kind: "edit", operation: row })
            },
            {
              label: "Alterar material",
              icon: Package,
              onClick: () => setDialog({ kind: "edit", operation: row, only: "productId" })
            },
            {
              label: "Alterar cliente",
              icon: UserRound,
              onClick: () => setDialog({ kind: "edit", operation: row, only: "customerId" })
            },
            {
              label: "Alterar transportadora",
              icon: Truck,
              onClick: () => setDialog({ kind: "edit", operation: row, only: "carrierId" })
            },
            {
              label: "Cancelar pesagem",
              icon: Ban,
              tone: "danger",
              onClick: () => setDialog({ kind: "cancel", operation: row })
            }
          ]}
        />
      </>
    );
  }

  function closedActions(row: Operation) {
    return actionsFor(
      row,
      <>
        <button
          type="button"
          className="btn op-main-action"
          title="Reimprimir o cupom na impressora da balança"
          onClick={() => void reprint(row)}
        >
          <Printer size={16} aria-hidden="true" />
          Reimprimir
        </button>
        <ActionMenu
          label={`Mais ações — ${operationLabel(row)}`}
          actions={[
            {
              label: "Alterar pesagem",
              icon: Pencil,
              hint: "Cliente, produto ou transportadora",
              onClick: () => setDialog({ kind: "edit", operation: row })
            },
            {
              label: "Cancelar venda",
              icon: Ban,
              tone: "danger",
              onClick: () => setDialog({ kind: "cancel", operation: row })
            }
          ]}
        />
      </>
    );
  }

  const error = open.error ?? closed.error ?? canceled.error ?? catalog.error;
  const catalogReload = catalog.reload;
  function retry() {
    void reloadOpen();
    void reloadClosed();
    void reloadCanceled();
    void catalogReload();
  }

  return (
    <DeskPanel fill>
      <PageHeader
        kicker="Fila operacional"
        title="Operações"
        help="Cada botão desta tela vira um pedido para a balança executora da unidade, que o registra pelas mesmas funções do KyberRock Desktop; o cupom do fechamento sai na impressora dela. Nova entrada só no KyberRock Desktop."
        meta={
          <>
            <ExecutorBadge status={executor} />
            {/* Enquanto a lista chega, "0 abertas" seria mentira: o contador espera. */}
            {tabCounts[tab] !== null && <CountBadge>{countLabel}</CountBadge>}
          </>
        }
        actions={
          tab === "abertas" && (
            <label className="op-filter op-plate-search">
              Buscar placa
              <input
                className="input"
                type="search"
                {...plateInput}
                placeholder="Placa do caminhão"
                aria-label="Buscar operação aberta pela placa"
              />
            </label>
          )
        }
      />

      <div className="op-toolbar">
        <PillTabs label="Situação das operações" tabs={tabs} active={tab} onChange={setTab} />
        {tab === "canceladas" && (
          <div className="op-filters">
            <label className="op-filter op-period">
              Período
              <select
                className="select"
                value={canceledPeriod}
                onChange={(event) => setCanceledPeriod(event.target.value)}
              >
                <option value="hoje">Hoje</option>
                <option value="semana">Últimos 7 dias</option>
                <option value="mes">Este mês</option>
              </select>
            </label>
          </div>
        )}
        {tab === "concluidas" && (
          <div className="op-filters">
            <label className="op-filter op-date">
              De
              <input
                className="input"
                type="date"
                {...closedStartInput}
                aria-label="Data inicial (opcional)"
              />
            </label>
            <label className="op-filter op-date">
              Até
              <input
                className="input"
                type="date"
                {...closedEndInput}
                aria-label="Data final (opcional)"
              />
            </label>
            {(closedStart || closedEnd) && (
              <button
                type="button"
                className="btn op-clear-dates"
                onClick={() => clearUrlFilters(["de", "ate"])}
              >
                Todas as datas
              </button>
            )}
            <div className="op-filter op-product">
              Produto
              <Picker
                value={closedProduct}
                options={closedProducts.map((product) => ({ value: product, label: product }))}
                onChange={setClosedProduct}
                placeholder="Buscar produto..."
                allowEmpty
                emptyLabel="Todos"
              />
            </div>
            <label className="op-filter op-search">
              Buscar
              <input
                className="input"
                type="search"
                {...closedSearchInput}
                placeholder="Cliente, placa, produto ou NF"
              />
            </label>
          </div>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={retry} />}
      <RequestFeed requests={feed.requests} />

      {tab === "abertas" &&
        (openRows.length === 0 ? (
          open.loading ? (
            <QueueSkeleton columns={4} />
          ) : (
            <EmptyState
              title="Nenhuma operação aberta"
              hint="As entradas registradas pela balança aparecem aqui para fechamento."
            />
          )
        ) : (
          <>
            <div
              className="product-counters"
              role="list"
              aria-label="Operações abertas por produto"
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
                <span>Entrada / Preço</span>
                <span>Ações</span>
              </div>
              {visibleOpen.length === 0 && (
                <EmptyState
                  title="Nenhuma operação aberta com essa placa"
                  hint="Confira a placa digitada ou limpe a busca para ver a fila inteira."
                />
              )}
              {visibleOpen.slice(0, openPage.limit).map((row) => (
                <div
                  key={row.id}
                  className={`op-row open${pendingOps.has(row.id) ? " waiting" : ""}`}
                >
                  {/* `op-line` + `data-label`: no celular cada dado vira "rotulo: valor" do
                      cartao (operation.css); no computador a linha fica como era. */}
                  <span className="op-plate">
                    <PlateBadge plate={formatPlate(row.plate ?? "")} />
                    <span className="op-line" data-label="Carregador">
                      <LoaderLight completedAt={loaderDone.get(row.id)} />
                    </span>
                  </span>
                  <span className="op-cell">
                    <strong className="op-title">
                      {row.customer_name || "Cliente não informado"}
                    </strong>
                    <span className="op-line" data-label="Produto">
                      {row.product_description || "Produto não informado"}
                    </span>
                    <small className="op-line" data-label="Motorista">
                      <span className="op-desk-label">Motorista: </span>
                      {row.driver_name || "—"}
                    </small>
                  </span>
                  <span className="op-cell">
                    <strong className="op-line" data-label="Peso de entrada (kg)">
                      {formatWeightNumber(row.entry_weight_kg)}
                    </strong>
                    <span className="op-line" data-label="Preço">
                      {formatMoney(row.unit_price_cents)}/ton
                    </span>
                    <small
                      className="op-line"
                      data-label="Entrou"
                      title={formatDateTime(row.created_at)}
                    >
                      <span className="op-desk-label">Entrou </span>
                      {formatElapsedSince(row.created_at, now)}
                    </small>
                  </span>
                  {openActions(row)}
                </div>
              ))}
              <LoadMore
                shown={Math.min(openPage.limit, visibleOpen.length)}
                total={visibleOpen.length}
                onMore={openPage.more}
              />
            </div>
          </>
        ))}

      {tab === "canceladas" &&
        (canceledRows.length === 0 ? (
          canceled.loading ? (
            <QueueSkeleton columns={4} />
          ) : (
            <EmptyState
              title="Nenhuma operação cancelada"
              hint="Altere o período no filtro para consultar outros cancelamentos."
            />
          )
        ) : (
          <div className="op-table">
            <div className="op-row canceled head">
              <span>Placa</span>
              <span>Cliente / Produto</span>
              <span>Cancelada em</span>
              <span>Motivo</span>
            </div>
            {canceledRows.slice(0, canceledPage.limit).map((row) => (
              <div key={row.id} className="op-row canceled">
                <PlateBadge plate={formatPlate(row.plate ?? "")} />
                <span className="op-cell">
                  <strong className="op-title">
                    {row.customer_name || "Cliente não informado"}
                  </strong>
                  <span className="op-line" data-label="Produto">
                    {row.product_description || "Produto não informado"}
                  </span>
                </span>
                <span className="op-line" data-label="Cancelada em">
                  {formatDateTime(row.updated_at)}
                </span>
                <span className="op-line" data-label="Motivo">
                  {row.cancel_reason || "Sem motivo registrado"}
                </span>
              </div>
            ))}
            <LoadMore
              shown={Math.min(canceledPage.limit, canceledRows.length)}
              total={canceledRows.length}
              onMore={canceledPage.more}
            />
          </div>
        ))}

      {tab === "concluidas" &&
        (visibleClosed.length === 0 ? (
          closed.loading ? (
            <QueueSkeleton columns={6} />
          ) : (
            <EmptyState
              title="Nenhuma operação concluída"
              hint={
                closedStart || closedEnd
                  ? "Nenhuma operação fechada no período escolhido."
                  : "As operações fechadas aparecem aqui, da mais nova para a mais antiga."
              }
            />
          )
        ) : (
          <div className="op-table">
            <div className="op-row closed head">
              <span>Placa</span>
              <span>Cliente / Produto</span>
              <span>Peso líquido / Receita</span>
              <span>Concluída em</span>
              <span>Nota fiscal</span>
              <span>Fiscal OMIE</span>
              <span>Ações</span>
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
                    <strong className="op-title">
                      {row.customer_name || "Cliente não informado"}
                    </strong>
                    <span className="op-line" data-label="Produto">
                      {row.product_description || "Produto não informado"}
                    </span>
                    <small className="op-line" data-label="Motorista">
                      <span className="op-desk-label">Motorista: </span>
                      {row.driver_name || "—"}
                    </small>
                  </span>
                  <span className="op-cell">
                    <strong className="op-line" data-label="Peso líquido (kg)">
                      {formatWeightNumber(row.net_weight_kg)}
                    </strong>
                    <span className="op-line" data-label="Receita">
                      {formatMoney(row.total_cents)}
                    </span>
                  </span>
                  <span className="op-line" data-label="Concluída em">
                    {formatDateTime(row.closed_at ?? row.created_at)}
                  </span>
                  <InvoiceNumberCell
                    number={row.omie_invoice_number}
                    internal={row.operation_type === "internal"}
                  />
                  <span className="op-cell op-line" data-label="Fiscal OMIE">
                    <span className="op-cell op-value">
                      <Pill tone={fiscal.tone}>{fiscal.label}</Pill>
                      <small>{fiscal.detail}</small>
                    </span>
                  </span>
                  {closedActions(row)}
                </div>
              );
            })}
            <LoadMore
              shown={visibleClosed.length}
              total={closed.total}
              loading={closed.loading}
              onMore={() => void closed.more()}
            />
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
      setError("Digite o peso de saída em kg.");
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
      title={`Fechar saída — ${operationLabel(operation)}`}
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
          <Field label="Peso de saída (kg)" hint="Ex.: 40.120">
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
              <span>Líquido</span>
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
          Frete, crédito e o valor final a balança calcula no fechamento. O cupom sai na impressora
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
      paymentMethodId: representativeOf(
        catalog.representatives.paymentMethods,
        operation.payment_method_id
      ),
      paymentTermId: representativeOf(
        catalog.representatives.paymentTerms,
        operation.payment_term_id
      ),
      operationType: operation.operation_type,
      unitPriceCents: operation.unit_price_cents
    }),
    [operation, catalog]
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
      setError("Digite a senha de preço que o comercial passou.");
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
      title={`${only ? SINGLE_EDIT_TITLES[only] : "Ver / editar operação"} — ${operationLabel(operation)}`}
      description={
        only
          ? `${operation.customer_name ?? ""} · ${operation.product_description ?? ""}`
          : open
            ? "Mude o que precisar. Só o que for alterado vai para a balança."
            : "Pesagem concluída: dá para trocar cliente, produto ou transportadora."
      }
      wide={!only}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Salvar alteração (Ctrl+Enter)"}
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
                <Field label="Condição de pagamento">
                  <Picker
                    value={fields.paymentTermId}
                    options={catalog.paymentTerms}
                    onChange={set("paymentTermId")}
                    allowEmpty
                    emptyLabel="À vista"
                  />
                </Field>
                <Field label="Preço por tonelada (R$)">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </Field>
                {priceChanged && requiresPricePassword && (
                  <Field label="Senha de preço (do comercial)" hint={PRICE_CODE_HINT}>
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={7}
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
          ? "O caminhão sai do pátio."
          : "Se o pedido já foi para o OMIE, a balança pede o cancelamento lá também."
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
