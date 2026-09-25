import "./support-logs.css";

import {
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardCopy,
  CloudUpload,
  Download,
  KeyRound,
  Mail,
  MonitorSmartphone,
  PlugZap,
  ReceiptText,
  RefreshCw,
  Scale,
  Send,
  Trash2,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { EmptyState, Pill, PlateBadge, SearchBar, SectionHead } from "../components/desk";
import { Alert, DataTable, Modal, useToast } from "../components/ui";
import { WebApiError, callWebApi, errorMessage } from "../lib/api";
import { useUser, type SessionUser } from "../lib/auth";
import {
  clearErrorLog,
  readErrorLog,
  subscribeErrorLog,
  type ErrorLogEntry,
  type ErrorLogSource
} from "../lib/error-log";
import { formatMoney, formatPlate } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  BILLING_STUCK_MS,
  DISPATCH_KIND_LABELS,
  PASSWORD_ALERT_COUNT,
  REQUEST_FILTERS,
  REQUEST_KIND_LABELS,
  SUPPORT_TABS,
  billingIsProblem,
  buildSupportReport,
  checkDevice,
  countOmieReasons,
  deviceLabel,
  deviceNames,
  dispatchIsProblem,
  dispatchStatusView,
  executionTime,
  filterRequests,
  formatAgo,
  formatClock,
  formatDay,
  formatStamp,
  groupPasswordFailures,
  isRequestFilter,
  normalizeSupportOverview,
  omieReason,
  parseSupportTab,
  printView,
  requestStatusView,
  roleLabel,
  severityTone,
  shortId,
  sortBillingRequests,
  sortDevices,
  sortOmieProblems,
  sortWebUsers,
  summarizeSupport,
  tabBadges,
  unitNames,
  type ConnectionProbe,
  type ConnectionTest,
  type RequestFilter,
  type Severity,
  type SupportCard,
  type SupportDiagnostics,
  type SupportOverview,
  type SupportTab,
  type TabBadge
} from "../lib/support";

/**
 * Logs — a tela de suporte do perfil `administrador` (equipe Kybernan). Junta num lugar so o
 * que antes o suporte descobria por telefone: balanca fora do ar ou desatualizada, fila de envio
 * parada, pedido do site que a balanca nao executou, pesagem que nao chegou ao OMIE, relatorio
 * automatico que nao saiu, tentativa errada de senha de preco e os erros DESTE navegador.
 *
 * Dividida em duas partes de proposito: `SupportLogs` busca (web-api `support_overview`,
 * relogio, diario de erros, teste de conexao) e `SupportLogsView` so desenha — assim a tela
 * pode ser vista com dados de exemplo sem login nem nuvem.
 */

const FORBIDDEN_MESSAGE = "So o perfil Administrador ve os logs.";

const TAB_ICONS: Record<SupportTab, LucideIcon> = {
  balancas: Scale,
  pedidos: Send,
  omie: CloudUpload,
  fechamentos: ReceiptText,
  relatorios: Mail,
  acessos: KeyRound,
  navegador: MonitorSmartphone
};

const SOURCE_LABELS: Record<ErrorLogSource, string> = {
  api: "web-api",
  window: "script",
  promise: "promessa",
  app: "site"
};

export interface ConnectionState {
  running: boolean;
  result: ConnectionTest | null;
}

export interface SupportLogsViewProps {
  /** Resposta da nuvem (`null` enquanto carrega ou quando falhou). */
  data: SupportOverview | null;
  loading: boolean;
  /** Mensagem pronta para a tela (o 403 ja vem traduzido). */
  error: string | null;
  /** Relogio da tela (ms): os "ha X" e as regras de parado usam ele. */
  now: number;
  tab: SupportTab;
  onTabChange: (tab: SupportTab) => void;
  onRefresh: () => void;
  diagnostics: SupportDiagnostics;
  browserErrors: ErrorLogEntry[];
  onClearBrowserErrors: () => void;
  connection: ConnectionState;
  onTestConnection: () => void;
}

// ---------------------------------------------------------------------------
// Busca (rota /suporte)
// ---------------------------------------------------------------------------

export function SupportLogs() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tab = parseSupportTab(params.get("aba"));
  const now = useClock();
  const browserErrors = useBrowserErrors();
  const [state, setState] = useState<{
    data: SupportOverview | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });
  const [connection, setConnection] = useState<ConnectionState>({ running: false, result: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await callWebApi("support_overview");
      setState({ data: normalizeSupportOverview(result), loading: false, error: null });
    } catch (caught) {
      setState((current) => ({ ...current, loading: false, error: loadErrorText(caught) }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const testConnection = useCallback(async () => {
    setConnection((current) => ({ ...current, running: true }));
    const api = await probe(async () => {
      await callWebApi("me");
    });
    const db = await probe(async () => {
      const { error } = await supabase.from("units").select("id").limit(1);
      if (error) throw new Error(error.message);
    });
    setConnection({ running: false, result: { at: new Date().toISOString(), api, db } });
  }, []);

  // `now` entra de proposito: "online" e o tamanho da janela mudam com a tela aberta.
  const diagnostics = useMemo(() => collectDiagnostics(user), [user, now]);

  return (
    <SupportLogsView
      data={state.data}
      loading={state.loading}
      error={state.error}
      now={now}
      tab={tab}
      onTabChange={(next) => setParams(next === "balancas" ? {} : { aba: next }, { replace: true })}
      onRefresh={() => void load()}
      diagnostics={diagnostics}
      browserErrors={browserErrors}
      onClearBrowserErrors={clearErrorLog}
      connection={connection}
      onTestConnection={() => void testConnection()}
    />
  );
}

function loadErrorText(caught: unknown): string {
  if (caught instanceof WebApiError && caught.status === 403) return FORBIDDEN_MESSAGE;
  if (caught instanceof WebApiError && caught.status === 401) {
    return "Sessao expirada. Entre de novo para ver os logs.";
  }
  return errorMessage(caught, "Falha ao carregar os logs da nuvem.");
}

/** Relogio de 30 s (os "ha X" andam) que tambem acorda quando a rede cai ou volta. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("online", tick);
    window.addEventListener("offline", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", tick);
      window.removeEventListener("offline", tick);
    };
  }, []);
  return now;
}

/** O diario de erros deste navegador, ao vivo. */
function useBrowserErrors(): ErrorLogEntry[] {
  const [entries, setEntries] = useState<ErrorLogEntry[]>(() => readErrorLog());
  useEffect(() => {
    setEntries(readErrorLog());
    return subscribeErrorLog(setEntries);
  }, []);
  return entries;
}

async function probe(run: () => Promise<void>): Promise<ConnectionProbe> {
  const started = performance.now();
  try {
    await run();
    return { ok: true, ms: performance.now() - started };
  } catch (caught) {
    return {
      ok: false,
      ms: performance.now() - started,
      error: errorMessage(caught, "sem mensagem")
    };
  }
}

function envText(env: Record<string, unknown>, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** "production · versao 2.3.0 · commit abc1234" (versao e commit so quando o build informa). */
function siteBuild(): string {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const version = envText(env, "VITE_APP_VERSION");
  const commit = envText(env, "VITE_COMMIT");
  return [
    envText(env, "MODE") ?? "desconhecido",
    version ? `versao ${version}` : null,
    commit ? `commit ${commit.slice(0, 12)}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function collectDiagnostics(user: SessionUser): SupportDiagnostics {
  let timeZone = "—";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
  } catch {
    // Navegador sem Intl completo: fica o traco.
  }
  const nav = typeof navigator === "undefined" ? null : navigator;
  const screenSize =
    typeof window === "undefined"
      ? "—"
      : `${window.screen.width}x${window.screen.height} (janela ${window.innerWidth}x${window.innerHeight}, zoom ${Math.round(window.devicePixelRatio * 100)}%)`;
  const page =
    typeof window === "undefined"
      ? undefined
      : `${window.location.origin}${window.location.pathname}${window.location.hash.split("?")[0]}`;
  return {
    build: siteBuild(),
    userName: user.name,
    role: user.role,
    companyId: user.companyId,
    unitId: user.unitId,
    userAgent: nav?.userAgent ?? "—",
    online: nav?.onLine ?? true,
    timeZone,
    screen: screenSize,
    language: nav?.language,
    page
  };
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function SupportLogsView(props: SupportLogsViewProps) {
  const { data, loading, error, now, tab, onTabChange, onRefresh, browserErrors } = props;
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [manualReport, setManualReport] = useState<string | null>(null);

  const cards = useMemo(
    () => summarizeSupport(data, browserErrors, now),
    [data, browserErrors, now]
  );
  const badges = useMemo(() => tabBadges(data, browserErrors, now), [data, browserErrors, now]);
  const attention = cards.filter(
    (card) => card.severity === "warning" || card.severity === "danger"
  ).length;
  const worst: Severity = cards.some((card) => card.severity === "danger")
    ? "danger"
    : attention > 0
      ? "warning"
      : "ok";

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyReport() {
    const text = buildSupportReport({
      overview: data,
      diagnostics: props.diagnostics,
      browserErrors,
      connection: props.connection.result,
      loadError: error,
      now: Date.now()
    });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Area de transferencia indisponivel");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.push("Relatorio copiado. Cole na conversa com o suporte.");
    } catch {
      // Sem permissao (http, iframe, navegador antigo): o texto aparece para copiar a mao.
      setManualReport(text);
    }
  }

  return (
    <section className="desk-panel fill support">
      <header className="support-head">
        <div className="support-head-text">
          <p className="desk-kicker">Suporte</p>
          <div className="support-title-row">
            <h1 className="support-title">Logs</h1>
            {data && (
              <Pill tone={severityTone(worst)}>
                {attention === 0
                  ? "Tudo em ordem"
                  : `${attention} ${attention === 1 ? "ponto" : "pontos"} de atencao`}
              </Pill>
            )}
          </div>
          <p className="support-lead">
            Saude das balancas, pedidos do site, envios ao OMIE e erros deste navegador — para achar
            a falha sem depender de ligacao.
          </p>
        </div>
        <div className="support-head-actions">
          <span
            className="support-generated"
            title={data ? formatStamp(data.generatedAt, true) : ""}
          >
            {data
              ? `gerado as ${formatClock(data.generatedAt)}`
              : loading
                ? "carregando..."
                : "sem dados da nuvem"}
          </span>
          <button
            type="button"
            className={`icon-action support-refresh${loading ? " loading" : ""}`}
            aria-label="Atualizar"
            title="Atualizar"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={15} />
          </button>
          <button type="button" className="btn primary" onClick={() => void copyReport()}>
            {copied ? <Check size={15} /> : <ClipboardCopy size={15} />}
            {copied ? "Copiado" : "Copiar relatorio para o suporte"}
          </button>
        </div>
      </header>

      {error && (
        <Alert kind="error">
          {error}
          {data ? ` Mostrando os dados de ${formatClock(data.generatedAt)}.` : ""}
        </Alert>
      )}

      <HealthCards cards={cards} active={tab} onSelect={onTabChange} />

      <SupportTabs active={tab} badges={badges} onChange={onTabChange} />

      <div className="support-body" role="tabpanel">
        {tab === "navegador" ? (
          <BrowserTab {...props} />
        ) : !data ? (
          loading ? (
            <div className="support-loading">
              <RefreshCw size={16} />
              Carregando os logs da nuvem...
            </div>
          ) : (
            <EmptyState
              title="Sem dados da nuvem."
              hint="A aba Navegador continua funcionando: ela le so este computador."
            />
          )
        ) : tab === "balancas" ? (
          <DevicesTab data={data} now={now} />
        ) : tab === "pedidos" ? (
          <RequestsTab data={data} now={now} />
        ) : tab === "omie" ? (
          <OmieTab data={data} now={now} />
        ) : tab === "fechamentos" ? (
          <BillingTab data={data} now={now} />
        ) : tab === "relatorios" ? (
          <DispatchesTab data={data} now={now} />
        ) : (
          <AccessTab data={data} now={now} />
        )}
      </div>

      {manualReport !== null && (
        <Modal
          title="Copiar relatorio"
          description="O navegador nao deixou copiar sozinho. Selecione o texto (Ctrl+A) e copie (Ctrl+C), ou baixe o arquivo."
          wide
          onClose={() => setManualReport(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => downloadText(manualReport)}>
                <Download size={15} />
                Baixar .txt
              </button>
              <button type="button" className="btn primary" onClick={() => setManualReport(null)}>
                Fechar
              </button>
            </>
          }
        >
          <textarea
            className="textarea support-report-text"
            readOnly
            value={manualReport}
            rows={18}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
        </Modal>
      )}
    </section>
  );
}

function downloadText(text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kyberrock-suporte-${new Date().toISOString().slice(0, 16).replace(":", "")}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Cartoes do topo e abas
// ---------------------------------------------------------------------------

function HealthCards({
  cards,
  active,
  onSelect
}: {
  cards: SupportCard[];
  active: SupportTab;
  onSelect: (tab: SupportTab) => void;
}) {
  return (
    <div className="support-cards">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className={`support-card ${card.severity}${card.tab === active ? " current" : ""}`}
          title={`${card.label}: ${card.detail}`}
          onClick={() => onSelect(card.tab)}
        >
          <span className="support-card-label">
            <span className="support-dot" aria-hidden="true" />
            {card.label}
          </span>
          <strong className="support-card-value">{card.value}</strong>
          <span className="support-card-detail">{card.detail}</span>
        </button>
      ))}
    </div>
  );
}

function SupportTabs({
  active,
  badges,
  onChange
}: {
  active: SupportTab;
  badges: Record<SupportTab, TabBadge | null>;
  onChange: (tab: SupportTab) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  // No celular as abas rolam de lado: a ativa (vinda de um cartao ou do ?aba=) fica a vista.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>(".support-tab.active");
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [active]);
  return (
    <nav ref={navRef} className="tabs support-tabs" role="tablist" aria-label="Secoes dos logs">
      {SUPPORT_TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.id];
        const badge = badges[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className={`tab support-tab${tab.id === active ? " active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={15} strokeWidth={2} />
            {tab.label}
            {badge && <span className={`support-tab-count ${badge.severity}`}>{badge.count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Pecas de celula
// ---------------------------------------------------------------------------

/** Texto comprido (mensagem de erro): uma linha cortada que abre por inteiro, em monoespaco. */
function LongText({
  text,
  mono,
  limit = 80,
  wide
}: {
  text: string | null | undefined;
  mono?: boolean;
  limit?: number;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const value = text?.trim();
  if (!value) return <span className="support-dim">—</span>;
  const flat = value.replace(/\s+/g, " ");
  if (flat.length <= limit && !value.includes("\n")) {
    return <span className={`support-text${mono ? " support-mono" : ""}`}>{value}</span>;
  }
  return (
    <div className={`support-long${open ? " open" : ""}${wide ? " wide" : ""}`}>
      <button
        type="button"
        className="support-long-toggle"
        aria-expanded={open}
        title={open ? "Recolher" : "Ver a mensagem completa"}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight size={14} className="support-long-chevron" />
        <span className={`support-long-preview${mono ? " support-mono" : ""}`}>
          {open ? "Recolher" : flat}
        </span>
      </button>
      {open && <pre className="support-pre">{value}</pre>}
    </div>
  );
}

/** Horario da pedreira em cima, "ha X" embaixo; a data completa no title. */
function When({
  iso,
  now,
  empty = "—"
}: {
  iso: string | null | undefined;
  now: number;
  empty?: string;
}) {
  if (!iso) return <span className="support-dim">{empty}</span>;
  return (
    <>
      <span title={formatStamp(iso, true)}>{formatStamp(iso)}</span>
      <span className="cell-sub">{formatAgo(iso, now)}</span>
    </>
  );
}

function IdText({ id, prefix }: { id: string | null | undefined; prefix?: string }) {
  if (!id) return <span className="support-dim">—</span>;
  return (
    <span className="support-mono support-id" title={id}>
      {prefix ? `${prefix} ` : ""}
      {shortId(id)}
    </span>
  );
}

function AllClear({ title = "Nada de errado aqui", hint }: { title?: string; hint: string }) {
  return (
    <div className="empty-state support-clear">
      <CircleCheck size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

function OkLine({ children }: { children: ReactNode }) {
  return (
    <p className="support-ok">
      <CircleCheck size={15} aria-hidden="true" />
      {children}
    </p>
  );
}

function rowClass(severity: Severity | null, inactive = false): string | undefined {
  if (inactive) return "inactive";
  if (severity === "danger") return "support-row-danger";
  if (severity === "warning") return "support-row-warning";
  return undefined;
}

// ---------------------------------------------------------------------------
// Aba Balancas
// ---------------------------------------------------------------------------

function DevicesTab({ data, now }: { data: SupportOverview; now: number }) {
  const latest = data.latestAppVersion;
  const units = unitNames(data);
  const devices = sortDevices(data.devices, latest, now);
  const active = devices.filter((device) => device.isActive).length;

  return (
    <>
      <SectionHead
        title="Balancas"
        count={devices.length}
        description={`${active} ativa(s) em ${data.units.length} unidade(s). Versao mais nova em uso: ${latest ?? "—"}. Offline e envio parado em vermelho; desatualizada e fila antiga (mais de 30 min) em amarelo.`}
      />
      {devices.length === 0 ? (
        <EmptyState
          title="Nenhuma balanca ativada nesta empresa."
          hint="A balanca aparece aqui depois de ativada no painel admin."
        />
      ) : (
        <DataTable
          rows={devices}
          rowKey={(device) => device.id}
          rowClassName={(device) =>
            rowClass(checkDevice(device, latest, now).severity, !device.isActive)
          }
          columns={[
            {
              key: "name",
              header: "Balanca",
              render: (device) => (
                <>
                  <strong>{device.name}</strong>
                  <span className="cell-sub">
                    {[
                      device.deviceNumber ? `No ${device.deviceNumber}` : null,
                      device.unitId ? (units.get(device.unitId) ?? shortId(device.unitId)) : null,
                      device.isActive ? null : "inativa"
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </>
              )
            },
            {
              key: "version",
              header: "Versao / canal",
              render: (device) => {
                const check = checkDevice(device, latest, now);
                return (
                  <>
                    <span className="support-inline">
                      <span className="support-mono">{device.appVersion ?? "—"}</span>
                      {check.outdated && <Pill tone="warning">desatualizada</Pill>}
                    </span>
                    <span className="cell-sub">
                      {device.updateChannel === "teste" ? (
                        <Pill tone="info">canal teste</Pill>
                      ) : (
                        "canal producao"
                      )}
                    </span>
                  </>
                );
              }
            },
            {
              key: "status",
              header: "Situacao",
              render: (device) => (
                <>
                  {!device.isActive ? (
                    <Pill>Inativa</Pill>
                  ) : device.online ? (
                    <Pill tone="success">Online</Pill>
                  ) : (
                    <Pill tone="danger">Offline</Pill>
                  )}
                  <span className="cell-sub" title={formatStamp(device.lastSeenAt, true)}>
                    {device.lastSeenAt
                      ? `visto ${formatAgo(device.lastSeenAt, now)}`
                      : "nunca visto"}
                  </span>
                </>
              )
            },
            {
              key: "roles",
              header: "Funcao",
              render: (device) =>
                device.executesWebOperations || device.isPriceMaster ? (
                  <>
                    <span className="support-stack">
                      {device.executesWebOperations && <Pill>Executa o site</Pill>}
                      {device.isPriceMaster && <Pill>Principal de precos</Pill>}
                    </span>
                    {device.executesWebOperations && device.webExecutorSeenAt && (
                      <span
                        className="cell-sub"
                        title={formatStamp(device.webExecutorSeenAt, true)}
                      >
                        executor {formatAgo(device.webExecutorSeenAt, now)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="support-dim">—</span>
                )
            },
            {
              key: "queue",
              header: "Fila",
              render: (device) => {
                const { queuePending, queueBlocked, oldestPendingAt, collectedAt } = device.health;
                const check = checkDevice(device, latest, now);
                const informed = collectedAt ? (
                  <span
                    className={`cell-sub${check.staleHealth && device.isActive ? " support-warn-text" : ""}`}
                    title={formatStamp(collectedAt, true)}
                  >
                    coletado {formatAgo(collectedAt, now)}
                  </span>
                ) : (
                  <span className="cell-sub">nunca coletado</span>
                );
                if (queuePending === null && queueBlocked === null) {
                  return (
                    <>
                      <span className="support-dim-text">nao informada</span>
                      {informed}
                    </>
                  );
                }
                return (
                  <>
                    <span className="support-inline">
                      <span>
                        {queuePending === 1 ? "1 pendente" : `${queuePending ?? "—"} pendentes`}
                      </span>
                      {(queueBlocked ?? 0) > 0 && (
                        <Pill tone="danger">
                          {queueBlocked === 1 ? "1 parado" : `${queueBlocked} parados`}
                        </Pill>
                      )}
                    </span>
                    {oldestPendingAt && (
                      <span className={`cell-sub${check.oldQueue ? " support-warn-text" : ""}`}>
                        mais antiga {formatAgo(oldestPendingAt, now)}
                      </span>
                    )}
                    {informed}
                  </>
                );
              }
            },
            {
              key: "error",
              header: "Ultimo erro",
              render: (device) => <LongText text={device.health.lastError} mono limit={40} />
            }
          ]}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Pedidos do site
// ---------------------------------------------------------------------------

function RequestsTab({ data, now }: { data: SupportOverview; now: number }) {
  const [filter, setFilter] = useState<RequestFilter>("problemas");
  const [search, setSearch] = useState("");
  const devices = useMemo(() => deviceNames(data), [data]);
  const rows = filterRequests(data.operationRequests, filter, search, devices, now);

  return (
    <>
      <SectionHead
        title="Pedidos do site"
        count={rows.length}
        description={`Pesagens pedidas pelo site e executadas pela balanca (7 dias, ${data.operationRequests.length} no total). Parado = na fila ha mais de 5 minutos.`}
      />
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar por quem pediu, mensagem, balanca ou id"
      >
        <select
          className="select support-filter"
          value={filter}
          aria-label="Filtrar pedidos"
          onChange={(event) => {
            if (isRequestFilter(event.target.value)) setFilter(event.target.value);
          }}
        >
          {REQUEST_FILTERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SearchBar>
      {rows.length === 0 ? (
        filter === "problemas" && !search.trim() ? (
          <AllClear hint="Nenhum pedido do site falhou ou ficou parado nos ultimos 7 dias." />
        ) : (
          <EmptyState title="Nenhum pedido neste filtro." />
        )
      ) : (
        <DataTable
          rows={rows}
          rowKey={(request) => request.id}
          rowClassName={(request) => {
            const view = requestStatusView(request, now);
            return rowClass(
              view.tone === "danger" ? "danger" : view.tone === "warning" ? "warning" : null
            );
          }}
          columns={[
            {
              key: "when",
              header: "Quando",
              render: (request) => <When iso={request.requestedAt} now={now} />
            },
            {
              key: "kind",
              header: "Pedido",
              render: (request) => (
                <>
                  <strong>{REQUEST_KIND_LABELS[request.kind] ?? request.kind}</strong>
                  <span className="cell-sub">
                    {request.requestedByName ? `por ${request.requestedByName}` : "sem nome"}
                  </span>
                  <span className="cell-sub">
                    <IdText id={request.operationId} prefix="pesagem" />
                  </span>
                </>
              )
            },
            {
              key: "status",
              header: "Status",
              render: (request) => {
                const view = requestStatusView(request, now);
                const time = executionTime(request, now);
                return (
                  <>
                    <Pill tone={view.tone}>{view.label}</Pill>
                    <span
                      className={`cell-sub${time.tone === "warning" ? " support-warn-text" : ""}`}
                    >
                      {request.processedAt ? `executado em ${time.label}` : time.label}
                    </span>
                  </>
                );
              }
            },
            {
              key: "device",
              header: "Balanca",
              render: (request) =>
                request.claimedByDeviceId ? (
                  <>
                    {deviceLabel(devices, request.claimedByDeviceId)}
                    {request.claimedAt && (
                      <span className="cell-sub">pegou {formatAgo(request.claimedAt, now)}</span>
                    )}
                  </>
                ) : (
                  <span className="support-dim-text">nenhuma pegou</span>
                )
            },
            {
              key: "message",
              header: "Mensagem",
              render: (request) => <LongText text={request.resultMessage} />
            },
            {
              key: "print",
              header: "Impressao",
              render: (request) => {
                const view = printView(request);
                if (!view) return <span className="support-dim">—</span>;
                return (
                  <>
                    <Pill tone={view.tone}>{view.label}</Pill>
                    {request.printMessage && (
                      <span className="cell-sub">
                        <LongText text={request.printMessage} limit={36} />
                      </span>
                    )}
                  </>
                );
              }
            }
          ]}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Envios OMIE
// ---------------------------------------------------------------------------

function OmieTab({ data, now }: { data: SupportOverview; now: number }) {
  const units = unitNames(data);
  const multiUnit = data.units.length > 1;
  const rows = sortOmieProblems(data.omieProblems, now);
  const reasons = countOmieReasons(data.omieProblems, now);

  return (
    <>
      <SectionHead
        title="Envios OMIE com problema"
        count={rows.length}
        description="Pesagens dos ultimos 30 dias com erro de envio, cadastro incompleto, nao encontradas no OMIE ou fechadas ha mais de 2 h sem subir."
      />
      {rows.length === 0 ? (
        <AllClear hint="Todas as pesagens dos ultimos 30 dias chegaram ao OMIE." />
      ) : (
        <>
          <div className="support-chips" aria-label="Resumo por motivo">
            {reasons.map((reason) => (
              <span key={reason.key} className={`support-chip ${reason.severity}`}>
                <strong>{reason.count}</strong> {reason.label}
              </span>
            ))}
          </div>
          <DataTable
            rows={rows}
            rowKey={(problem) => problem.id}
            rowClassName={(problem) => rowClass(omieReason(problem, now).severity)}
            columns={[
              {
                key: "reason",
                header: "Motivo",
                render: (problem) => {
                  const reason = omieReason(problem, now);
                  return (
                    <>
                      <Pill tone={severityTone(reason.severity)}>{reason.label}</Pill>
                      <span className="cell-sub support-wrap support-hint">{reason.hint}</span>
                    </>
                  );
                }
              },
              {
                key: "operation",
                header: "Pesagem",
                render: (problem) => (
                  <>
                    <PlateBadge plate={formatPlate(problem.plate)} />
                    <span className="cell-sub support-wrap support-customer">
                      {problem.customerName ?? "Sem cliente"}
                    </span>
                    <span className="cell-sub">
                      {[
                        problem.productDescription,
                        multiUnit ? (units.get(problem.unitId) ?? null) : null
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </>
                )
              },
              {
                key: "total",
                header: "Valor",
                numeric: true,
                render: (problem) =>
                  problem.totalCents === null ? (
                    <span className="support-dim">—</span>
                  ) : (
                    formatMoney(problem.totalCents)
                  )
              },
              {
                key: "closed",
                header: "Fechada",
                render: (problem) => <When iso={problem.closedAt ?? problem.createdAt} now={now} />
              },
              {
                key: "message",
                header: "Mensagem / situacao",
                render: (problem) => (
                  <>
                    <LongText text={problem.omieBillingMessage} />
                    <span className="cell-sub support-mono">
                      {problem.status}
                      {problem.omieBillingStatus ? ` / ${problem.omieBillingStatus}` : ""}
                    </span>
                    <span className="cell-sub">
                      {problem.omieSalesOrderId ? (
                        `Pedido OMIE ${problem.omieSalesOrderId}`
                      ) : (
                        <IdText id={problem.id} prefix="pesagem" />
                      )}
                    </span>
                  </>
                )
              }
            ]}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Fechamentos
// ---------------------------------------------------------------------------

function BillingTab({ data, now }: { data: SupportOverview; now: number }) {
  const units = unitNames(data);
  const rows = sortBillingRequests(data.billingRequests, now);
  const problems = rows.filter((request) => billingIsProblem(request, now)).length;

  return (
    <>
      <SectionHead
        title="Fechamentos de faturas"
        count={rows.length}
        description="Pedidos de faturamento feitos pelo site nos ultimos 30 dias (a balanca executa). Falha e parado (mais de 15 min) primeiro."
      />
      {rows.length === 0 ? (
        <AllClear hint="Nenhum fechamento de faturas pedido pelo site nos ultimos 30 dias." />
      ) : (
        <>
          {problems === 0 && (
            <OkLine>Nada de errado aqui: nenhum fechamento falhou ou ficou parado.</OkLine>
          )}
          <DataTable
            rows={rows}
            rowKey={(request) => request.id}
            rowClassName={(request) =>
              rowClass(
                request.status === "failed"
                  ? "danger"
                  : billingIsProblem(request, now)
                    ? "warning"
                    : null
              )
            }
            columns={[
              {
                key: "status",
                header: "Status",
                render: (request) => {
                  const view = requestStatusView(request, now, BILLING_STUCK_MS);
                  return <Pill tone={view.tone}>{view.label}</Pill>;
                }
              },
              {
                key: "requested",
                header: "Pedido em",
                render: (request) => <When iso={request.requestedAt} now={now} />
              },
              {
                key: "processed",
                header: "Tempo ate executar",
                render: (request) => {
                  const view = executionTime(request, now, BILLING_STUCK_MS);
                  return (
                    <span className={view.tone === "warning" ? "support-warn-text" : undefined}>
                      {view.label}
                    </span>
                  );
                }
              },
              {
                key: "unit",
                header: "Unidade",
                render: (request) => units.get(request.unitId) ?? <IdText id={request.unitId} />
              },
              {
                key: "ref",
                header: "Referencia",
                render: (request) => <IdText id={request.operationId} />
              },
              {
                key: "message",
                header: "Mensagem",
                render: (request) => <LongText text={request.resultMessage} />
              }
            ]}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Relatorios automaticos
// ---------------------------------------------------------------------------

function DispatchesTab({ data, now }: { data: SupportOverview; now: number }) {
  const rows = data.reportDispatches;
  const problems = rows.filter(dispatchIsProblem).length;

  return (
    <>
      <SectionHead
        title="Relatorios automaticos"
        count={rows.length}
        description="Envios do fechamento diario e do relatorio financeiro por e-mail nos ultimos 30 dias, do mais novo ao mais antigo."
      />
      {rows.length === 0 ? (
        <AllClear
          title="Nenhum envio automatico"
          hint="Nenhum relatorio automatico foi disparado nos ultimos 30 dias (ou nao ha destinatarios)."
        />
      ) : (
        <>
          {problems === 0 && <OkLine>Nada de errado aqui: todos os envios sairam.</OkLine>}
          <DataTable
            rows={rows}
            rowKey={(dispatch) => `${dispatch.kind}-${dispatch.id}`}
            rowClassName={(dispatch) =>
              rowClass(
                dispatch.status === "failed"
                  ? "danger"
                  : dispatchIsProblem(dispatch)
                    ? "warning"
                    : null
              )
            }
            columns={[
              {
                key: "kind",
                header: "Relatorio",
                render: (dispatch) => (
                  <strong>{DISPATCH_KIND_LABELS[dispatch.kind] ?? dispatch.kind}</strong>
                )
              },
              {
                key: "day",
                header: "Dia do relatorio",
                render: (dispatch) => formatDay(dispatch.reportDate)
              },
              {
                key: "status",
                header: "Status",
                render: (dispatch) => {
                  const view = dispatchStatusView(dispatch);
                  return <Pill tone={view.tone}>{view.label}</Pill>;
                }
              },
              {
                key: "recipients",
                header: "Destinatarios",
                numeric: true,
                render: (dispatch) => dispatch.recipientsCount
              },
              {
                key: "sent",
                header: "Disparado",
                render: (dispatch) => <When iso={dispatch.dispatchedAt} now={now} />
              },
              {
                key: "error",
                header: "Erro",
                render: (dispatch) => <LongText text={dispatch.lastError} mono limit={48} />
              }
            ]}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Acessos
// ---------------------------------------------------------------------------

function AccessTab({ data, now }: { data: SupportOverview; now: number }) {
  const units = unitNames(data);
  const devices = deviceNames(data);
  const groups = groupPasswordFailures(data.pricePasswordFailures);
  const users = sortWebUsers(data.webUsers);

  return (
    <>
      <SectionHead
        title="Senha de preco errada"
        count={data.pricePasswordFailures.length}
        description={`Tentativas erradas nos ultimos 7 dias, por usuario. A partir de ${PASSWORD_ALERT_COUNT} vale uma conversa: senha esquecida ou alguem tentando adivinhar.`}
      />
      {groups.length === 0 ? (
        <OkLine>Nada de errado aqui: nenhuma tentativa errada nos ultimos 7 dias.</OkLine>
      ) : (
        <DataTable
          rows={groups}
          rowKey={(group) => group.userId}
          rowClassName={(group) =>
            rowClass(group.count >= PASSWORD_ALERT_COUNT ? "danger" : "warning")
          }
          columns={[
            {
              key: "user",
              header: "Usuario",
              render: (group) => (
                <strong>{group.userName ?? `Usuario ${shortId(group.userId)}`}</strong>
              )
            },
            {
              key: "count",
              header: "Tentativas",
              numeric: true,
              render: (group) =>
                group.count >= PASSWORD_ALERT_COUNT ? (
                  <Pill tone="danger">{group.count}</Pill>
                ) : (
                  group.count
                )
            },
            {
              key: "first",
              header: "Primeira",
              render: (group) => <When iso={group.firstAt} now={now} />
            },
            {
              key: "last",
              header: "Ultima",
              render: (group) => <When iso={group.lastAt} now={now} />
            }
          ]}
        />
      )}

      <SectionHead
        title="Usuarios do site"
        count={users.length}
        description="Logins da empresa com o perfil de cada um e a maquina vinculada (quem usa a balanca pelo site)."
      />
      {users.length === 0 ? (
        <EmptyState title="Nenhum usuario cadastrado." />
      ) : (
        <DataTable
          rows={users}
          rowKey={(user) => user.id}
          rowClassName={(user) => rowClass(null, !user.isActive)}
          columns={[
            {
              key: "name",
              header: "Usuario",
              render: (user) => (
                <>
                  <strong>{user.name || "Sem nome"}</strong>
                  <span className="cell-sub">{user.email}</span>
                </>
              )
            },
            {
              key: "role",
              header: "Perfil",
              render: (user) => (
                <Pill tone={user.role === "administrador" ? "info" : "neutral"}>
                  {roleLabel(user.role)}
                </Pill>
              )
            },
            {
              key: "active",
              header: "Situacao",
              render: (user) =>
                user.isActive ? <Pill tone="success">Ativo</Pill> : <Pill>Inativo</Pill>
            },
            {
              key: "password",
              header: "Senha de preco",
              render: (user) =>
                user.requiresPricePassword ? (
                  "Pede"
                ) : (
                  <span className="support-dim-text">Nao pede</span>
                )
            },
            {
              key: "device",
              header: "Maquina vinculada",
              render: (user) =>
                user.deviceId ? (
                  deviceLabel(devices, user.deviceId)
                ) : (
                  <span className="support-dim">—</span>
                )
            },
            {
              key: "unit",
              header: "Unidade",
              render: (user) =>
                user.unitId ? (
                  (units.get(user.unitId) ?? <IdText id={user.unitId} />)
                ) : (
                  <span className="support-dim">—</span>
                )
            }
          ]}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Navegador
// ---------------------------------------------------------------------------

function probeTone(result: ConnectionProbe): "success" | "warning" | "danger" {
  if (!result.ok) return "danger";
  return result.ms > 2000 ? "warning" : "success";
}

function ProbeLine({ label, probe }: { label: string; probe: ConnectionProbe }) {
  return (
    <li>
      <span>{label}</span>
      <span className="support-probe-result">
        <Pill tone={probeTone(probe)}>
          {probe.ok ? `${Math.round(probe.ms)} ms` : `falhou (${Math.round(probe.ms)} ms)`}
        </Pill>
        {!probe.ok && probe.error && <span className="support-probe-error">{probe.error}</span>}
      </span>
    </li>
  );
}

function BrowserTab({
  browserErrors,
  onClearBrowserErrors,
  diagnostics,
  connection,
  onTestConnection,
  now
}: SupportLogsViewProps) {
  const result = connection.result;
  return (
    <div className="support-browser">
      <div className="support-browser-log">
        <SectionHead
          title="Erros deste navegador"
          count={browserErrors.length}
          description="Chamadas recusadas pela web-api, erros de script e promessas sem tratamento, gravados so neste computador (ultimos 100)."
          action={
            <button
              type="button"
              className="btn small ghost-danger"
              disabled={browserErrors.length === 0}
              onClick={onClearBrowserErrors}
            >
              <Trash2 size={14} />
              Limpar
            </button>
          }
        />
        {browserErrors.length === 0 ? (
          <AllClear hint="Nenhum erro registrado neste navegador. O que der errado nas telas aparece aqui sozinho." />
        ) : (
          <ol className="support-log">
            {browserErrors.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="support-log-item">
                <div className="support-log-meta">
                  <Pill tone={entry.source === "api" ? "danger" : "warning"}>
                    {SOURCE_LABELS[entry.source]}
                  </Pill>
                  <span title={formatStamp(entry.at, true)}>
                    {formatStamp(entry.at)} · {formatAgo(entry.at, now)}
                  </span>
                  {entry.path && <span className="support-mono">{entry.path}</span>}
                </div>
                <div className="support-log-message">{entry.message}</div>
                {entry.detail && <LongText text={entry.detail} mono limit={90} wide />}
              </li>
            ))}
          </ol>
        )}
      </div>

      <aside className="support-diag" aria-label="Diagnostico">
        <h3>Diagnostico</h3>
        <dl>
          <dt>Site</dt>
          <dd>{diagnostics.build}</dd>
          <dt>Usuario</dt>
          <dd>
            {diagnostics.userName} · {roleLabel(diagnostics.role)}
          </dd>
          <dt>Empresa</dt>
          <dd className="support-mono">{diagnostics.companyId}</dd>
          <dt>Unidade</dt>
          <dd className="support-mono">{diagnostics.unitId}</dd>
          <dt>Internet</dt>
          <dd>
            {diagnostics.online ? (
              <Pill tone="success">Online</Pill>
            ) : (
              <Pill tone="danger">Sem conexao</Pill>
            )}
          </dd>
          <dt>Fuso</dt>
          <dd>{diagnostics.timeZone}</dd>
          <dt>Tela</dt>
          <dd>{diagnostics.screen}</dd>
          {diagnostics.language && (
            <>
              <dt>Idioma</dt>
              <dd>{diagnostics.language}</dd>
            </>
          )}
          <dt>Navegador</dt>
          <dd className="support-ua">{diagnostics.userAgent}</dd>
        </dl>

        <div className="support-probe">
          <button
            type="button"
            className="btn"
            disabled={connection.running}
            onClick={onTestConnection}
          >
            <PlugZap size={15} />
            {connection.running ? "Testando..." : "Testar conexao"}
          </button>
          {result ? (
            <ul>
              <ProbeLine label="web-api" probe={result.api} />
              <ProbeLine label="Banco (leitura)" probe={result.db} />
              <li className="support-dim-text">Testado as {formatClock(result.at)}</li>
            </ul>
          ) : (
            <p className="support-dim-text">
              Mede o tempo de ida e volta ate a web-api e ate o banco, com o login atual.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
