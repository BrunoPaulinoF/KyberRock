/**
 * Tela Logs (perfil `administrador`, a equipe de suporte da Kybernan): os tipos da resposta da
 * acao `support_overview` da `web-api` e as regras PURAS que a tela e o "Copiar relatorio para o
 * suporte" usam — o que conta como problema, a gravidade, os textos e o relatorio em texto.
 *
 * A nuvem so junta as linhas; quem decide "offline", "desatualizada", "fila parada", "pedido
 * travado" e "parado sem subir" e este modulo, com o relogio passado de fora (`now`) para que a
 * tela e os testes cheguem na mesma resposta.
 */

import { redactSecrets, truncateText, type ErrorLogEntry } from "./error-log";
import { formatMoney } from "./format";
import { DEFAULT_UNIT_TIMEZONE } from "./loading";
import { matchesSearch } from "./operation";
import { ROLE_LABELS, isRole } from "./permissions";

// ---------------------------------------------------------------------------
// Resposta da `web-api` (`support_overview`)
// ---------------------------------------------------------------------------

export type RequestKind = "entry" | "exit" | "update" | "cancel" | "reprint";
export type RequestStatus = "pending" | "processing" | "done" | "failed";

export interface SupportUnit {
  id: string;
  name: string;
}

export interface SupportDeviceHealth {
  queuePending: number | null;
  queueBlocked: number | null;
  oldestPendingAt: string | null;
  lastError: string | null;
  collectedAt: string | null;
}

export interface SupportDevice {
  id: string;
  name: string;
  unitId: string | null;
  isActive: boolean;
  deviceNumber: number | null;
  appVersion: string | null;
  updateChannel: "teste" | "producao";
  lastSeenAt: string | null;
  online: boolean;
  isPriceMaster: boolean;
  executesWebOperations: boolean;
  webExecutorSeenAt: string | null;
  health: SupportDeviceHealth;
}

export interface SupportOperationRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  operationId: string;
  unitId: string;
  requestedAt: string;
  requestedByName: string | null;
  claimedByDeviceId: string | null;
  claimedAt: string | null;
  processedAt: string | null;
  resultMessage: string | null;
  printStatus: "printed" | "failed" | "skipped" | null;
  printMessage: string | null;
}

export interface SupportBillingRequest {
  id: string;
  operationId: string;
  unitId: string;
  status: RequestStatus;
  requestedAt: string;
  processedAt: string | null;
  resultMessage: string | null;
}

export interface SupportOmieProblem {
  id: string;
  unitId: string;
  plate: string | null;
  customerName: string | null;
  productDescription: string | null;
  status: string;
  createdAt: string;
  closedAt: string | null;
  totalCents: number | null;
  omieBillingStatus: string | null;
  omieBillingMessage: string | null;
  omieSalesOrderId: number | null;
}

export interface SupportReportDispatch {
  id: string;
  kind: "diario" | "financeiro";
  reportDate: string;
  status: string;
  lastError: string | null;
  recipientsCount: number;
  dispatchedAt: string;
}

export interface SupportPricePasswordFailure {
  userId: string;
  userName: string | null;
  attemptedAt: string;
}

export interface SupportWebUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  requiresPricePassword: boolean;
  deviceId: string | null;
  unitId: string | null;
}

export interface SupportOverview {
  generatedAt: string;
  units: SupportUnit[];
  devices: SupportDevice[];
  latestAppVersion: string | null;
  operationRequests: SupportOperationRequest[];
  billingRequests: SupportBillingRequest[];
  omieProblems: SupportOmieProblem[];
  reportDispatches: SupportReportDispatch[];
  pricePasswordFailures: SupportPricePasswordFailure[];
  webUsers: SupportWebUser[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** So objetos: uma linha estranha na lista nao derruba a tela inteira. */
function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isRecord) as unknown as T[]) : [];
}

function normalizeHealth(value: unknown): SupportDeviceHealth {
  const health = isRecord(value) ? value : {};
  return {
    queuePending: count(health.queuePending),
    queueBlocked: count(health.queueBlocked),
    oldestPendingAt: text(health.oldestPendingAt),
    lastError: text(health.lastError),
    collectedAt: text(health.collectedAt)
  };
}

/**
 * A resposta da `web-api` com as listas garantidas (lista ausente vira vazia, `health` ausente
 * vira "nunca informou") — a acao e nova e a tela nao pode quebrar se um campo ainda nao
 * existir no servidor publicado.
 */
export function normalizeSupportOverview(raw: unknown, now: number = Date.now()): SupportOverview {
  const source = isRecord(raw) ? raw : {};
  const devices = rows<SupportDevice>(source.devices).map((device) => ({
    ...device,
    isActive: device.isActive !== false,
    online: device.online === true,
    health: normalizeHealth(device.health)
  }));
  return {
    generatedAt: text(source.generatedAt) ?? new Date(now).toISOString(),
    units: rows<SupportUnit>(source.units),
    devices,
    latestAppVersion:
      text(source.latestAppVersion) ??
      latestVersion(devices.filter((device) => device.isActive).map((d) => d.appVersion)),
    operationRequests: rows<SupportOperationRequest>(source.operationRequests),
    billingRequests: rows<SupportBillingRequest>(source.billingRequests),
    omieProblems: rows<SupportOmieProblem>(source.omieProblems),
    reportDispatches: rows<SupportReportDispatch>(source.reportDispatches),
    pricePasswordFailures: rows<SupportPricePasswordFailure>(source.pricePasswordFailures),
    webUsers: rows<SupportWebUser>(source.webUsers)
  };
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

export type SupportTab =
  | "balancas"
  | "pedidos"
  | "omie"
  | "fechamentos"
  | "relatorios"
  | "acessos"
  | "navegador";

export const SUPPORT_TABS: ReadonlyArray<{ id: SupportTab; label: string }> = [
  { id: "balancas", label: "Balancas" },
  { id: "pedidos", label: "Pedidos do site" },
  { id: "omie", label: "Envios OMIE" },
  { id: "fechamentos", label: "Fechamentos" },
  { id: "relatorios", label: "Relatorios" },
  { id: "acessos", label: "Acessos" },
  { id: "navegador", label: "Navegador" }
];

/** `?aba=` da URL; qualquer outra coisa abre Balancas. */
export function parseSupportTab(value: string | null | undefined): SupportTab {
  return SUPPORT_TABS.some((tab) => tab.id === value) ? (value as SupportTab) : "balancas";
}

// ---------------------------------------------------------------------------
// Gravidade e tons
// ---------------------------------------------------------------------------

export type Severity = "ok" | "warning" | "danger";
/** Os tons do `Pill` (components/desk.tsx). */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warning: 1, danger: 2 };

export function worstSeverity(values: Severity[]): Severity {
  return values.reduce<Severity>(
    (worst, value) => (SEVERITY_RANK[value] > SEVERITY_RANK[worst] ? value : worst),
    "ok"
  );
}

export function severityTone(severity: Severity): Tone {
  return severity === "ok" ? "success" : severity;
}

export interface StatusView {
  label: string;
  tone: Tone;
}

// ---------------------------------------------------------------------------
// Relogio: horario da pedreira e "ha X"
// ---------------------------------------------------------------------------

export const SUPPORT_TIMEZONE = DEFAULT_UNIT_TIMEZONE;

function timeParts(iso: string | null | undefined): Record<string, string> | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: SUPPORT_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** "25/09 14:32" (ou "25/09/2026 14:32"), no fuso da pedreira — nao no do navegador. */
export function formatStamp(iso: string | null | undefined, withYear = false): string {
  const parts = timeParts(iso);
  if (!parts) return "—";
  const day = withYear
    ? `${parts.day}/${parts.month}/${parts.year}`
    : `${parts.day}/${parts.month}`;
  return `${day} ${parts.hour}:${parts.minute}`;
}

/** "14:32", no fuso da pedreira. */
export function formatClock(iso: string | null | undefined): string {
  const parts = timeParts(iso);
  return parts ? `${parts.hour}:${parts.minute}` : "—";
}

/** "25/09/2026" de uma data AAAA-MM-DD (sem passar por fuso: e um dia, nao um instante). */
export function formatDay(day: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (day ?? "—");
}

/** Tempo por extenso curto: "12 min", "2 h 05 min", "3 d 4 h". */
export function formatSpan(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) {
    const seconds = Math.floor(safe / 1000);
    return seconds < 1 ? "menos de 1 s" : `${seconds} s`;
  }
  const totalMinutes = Math.floor(safe / 60_000);
  if (totalMinutes < 60) {
    const seconds = Math.floor((safe % 60_000) / 1000);
    return totalMinutes < 10 && seconds > 0
      ? `${totalMinutes} min ${String(seconds).padStart(2, "0")} s`
      : `${totalMinutes} min`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? `${totalHours} h`
      : `${totalHours} h ${String(minutes).padStart(2, "0")} min`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

function elapsedMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : now - at;
}

/**
 * "agora", "ha 3 min", "ha 2 h 05 min", "ha 3 d 4 h". Horario no FUTURO alem de um minuto vira
 * "daqui a X" de proposito: e o relogio da balanca adiantado, e o suporte precisa ver isso.
 */
export function formatAgo(iso: string | null | undefined, now: number): string {
  const diff = elapsedMs(iso, now);
  if (diff === null) return "—";
  if (diff < -60_000) return `daqui a ${formatSpan(-diff).replace(/ \d+ s$/, "")}`;
  if (diff < 60_000) return "agora";
  return `ha ${formatSpan(diff).replace(/ \d+ s$/, "")}`;
}

// ---------------------------------------------------------------------------
// Balancas
// ---------------------------------------------------------------------------

/** Pendente mais antigo que isso e "fila antiga" (a fila deveria andar em minutos). */
export const QUEUE_OLD_MS = 30 * 60_000;
/** Saude informada ha mais que isso ja nao diz como a balanca esta agora. */
export const HEALTH_STALE_MS = 60 * 60_000;

/** Compara versoes numero a numero: 0.8.9 < 0.8.10, que um compare de texto erra. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function latestVersion(versions: ReadonlyArray<string | null | undefined>): string | null {
  let latest: string | null = null;
  for (const version of versions) {
    if (!version?.trim()) continue;
    if (!latest || compareVersions(version, latest) > 0) latest = version;
  }
  return latest;
}

export function isOutdated(version: string | null, latest: string | null): boolean {
  return Boolean(version && latest && compareVersions(version, latest) < 0);
}

export interface DeviceCheck {
  offline: boolean;
  outdated: boolean;
  /** Envio parado por falha do dado (nao anda sozinho). */
  blocked: boolean;
  /** Pendente mais antigo passou de 30 min. */
  oldQueue: boolean;
  /** A saude foi informada ha mais de 1 h (ou nunca). */
  staleHealth: boolean;
  severity: Severity;
}

/** O que ha de errado com a balanca. Inativa nao conta: ela saiu da operacao de proposito. */
export function checkDevice(
  device: SupportDevice,
  latest: string | null,
  now: number
): DeviceCheck {
  if (!device.isActive) {
    return {
      offline: false,
      outdated: false,
      blocked: false,
      oldQueue: false,
      staleHealth: false,
      severity: "ok"
    };
  }
  const offline = !device.online;
  const outdated = isOutdated(device.appVersion, latest);
  const blocked = (device.health.queueBlocked ?? 0) > 0;
  const oldest = elapsedMs(device.health.oldestPendingAt, now);
  const oldQueue = oldest !== null && oldest > QUEUE_OLD_MS;
  const collected = elapsedMs(device.health.collectedAt, now);
  const staleHealth = collected === null || collected > HEALTH_STALE_MS;
  const severity: Severity =
    offline || blocked ? "danger" : outdated || oldQueue ? "warning" : "ok";
  return { offline, outdated, blocked, oldQueue, staleHealth, severity };
}

/** Problema primeiro, depois ativa antes de inativa, depois pelo nome. */
export function sortDevices(
  devices: SupportDevice[],
  latest: string | null,
  now: number
): SupportDevice[] {
  return [...devices].sort((a, b) => {
    const rank =
      SEVERITY_RANK[checkDevice(b, latest, now).severity] -
      SEVERITY_RANK[checkDevice(a, latest, now).severity];
    if (rank !== 0) return rank;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export function unitNames(overview: Pick<SupportOverview, "units">): Map<string, string> {
  return new Map(overview.units.map((unit) => [unit.id, unit.name]));
}

export function deviceNames(overview: Pick<SupportOverview, "devices">): Map<string, string> {
  return new Map(overview.devices.map((device) => [device.id, device.name]));
}

/** Nome da balanca pelo id; sem cadastro, o comeco do id (o suporte ainda acha no banco). */
export function deviceLabel(names: Map<string, string>, id: string | null): string {
  if (!id) return "—";
  return names.get(id) ?? shortId(id);
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

// ---------------------------------------------------------------------------
// Pedidos do site (pesagem) e fechamentos
// ---------------------------------------------------------------------------

/** Pedido de pesagem na fila ha mais que isso ja deveria ter sido pego pela balanca. */
export const REQUEST_STUCK_MS = 5 * 60_000;
/** Fechamento de faturas envolve varios pedidos no OMIE: tem mais folga. */
export const BILLING_STUCK_MS = 15 * 60_000;

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  entry: "Entrada",
  exit: "Saida",
  update: "Alteracao",
  cancel: "Cancelamento",
  reprint: "Reimpressao"
};

export function isWaiting(status: string): boolean {
  return status === "pending" || status === "processing";
}

export function isStuck(
  request: { status: string; requestedAt: string },
  now: number,
  limitMs: number = REQUEST_STUCK_MS
): boolean {
  if (!isWaiting(request.status)) return false;
  const waited = elapsedMs(request.requestedAt, now);
  return waited !== null && waited > limitMs;
}

export function requestStatusView(
  request: { status: string; requestedAt: string },
  now: number,
  limitMs: number = REQUEST_STUCK_MS
): StatusView {
  const stuck = isStuck(request, now, limitMs);
  switch (request.status) {
    case "failed":
      return { label: "Falhou", tone: "danger" };
    case "done":
      return { label: "Concluido", tone: "success" };
    case "pending":
      return stuck
        ? { label: "Parado na fila", tone: "warning" }
        : { label: "Na fila", tone: "neutral" };
    case "processing":
      return stuck
        ? { label: "Travado executando", tone: "warning" }
        : { label: "Executando", tone: "info" };
    default:
      return { label: request.status || "—", tone: "neutral" };
  }
}

export function requestIsProblem(
  request: { status: string; requestedAt: string },
  now: number,
  limitMs: number = REQUEST_STUCK_MS
): boolean {
  return request.status === "failed" || isStuck(request, now, limitMs);
}

/** Quanto a balanca levou do pedido ao resultado — ou quanto ja esta esperando. */
export function executionTime(
  request: { status: string; requestedAt: string; processedAt: string | null },
  now: number,
  limitMs: number = REQUEST_STUCK_MS
): StatusView {
  const requested = Date.parse(request.requestedAt);
  const processed = request.processedAt ? Date.parse(request.processedAt) : Number.NaN;
  if (!Number.isNaN(requested) && !Number.isNaN(processed)) {
    return { label: formatSpan(processed - requested), tone: "neutral" };
  }
  if (isWaiting(request.status)) {
    return {
      label: `esperando ${formatAgo(request.requestedAt, now)}`,
      tone: isStuck(request, now, limitMs) ? "warning" : "neutral"
    };
  }
  return { label: "—", tone: "neutral" };
}

export function printView(
  request: Pick<SupportOperationRequest, "printStatus">
): StatusView | null {
  switch (request.printStatus) {
    case "printed":
      return { label: "Impresso", tone: "success" };
    case "failed":
      return { label: "Nao imprimiu", tone: "danger" };
    case "skipped":
      return { label: "Nao precisou", tone: "neutral" };
    default:
      return null;
  }
}

export type RequestFilter =
  | "problemas"
  | "todos"
  | "falhas"
  | "aguardando"
  | "concluidos"
  | "cupom";

export const REQUEST_FILTERS: ReadonlyArray<{ id: RequestFilter; label: string }> = [
  { id: "problemas", label: "Falhas e parados" },
  { id: "falhas", label: "So falhas" },
  { id: "aguardando", label: "Aguardando a balanca" },
  { id: "cupom", label: "Cupom nao impresso" },
  { id: "concluidos", label: "Concluidos" },
  { id: "todos", label: "Todos (7 dias)" }
];

export function isRequestFilter(value: string): value is RequestFilter {
  return REQUEST_FILTERS.some((filter) => filter.id === value);
}

/** Recorte da aba Pedidos do site (a ordem da nuvem, mais novo primeiro, e mantida). */
export function filterRequests(
  requests: SupportOperationRequest[],
  filter: RequestFilter,
  search: string,
  devices: Map<string, string>,
  now: number
): SupportOperationRequest[] {
  return requests.filter((request) => {
    const keep =
      filter === "todos"
        ? true
        : filter === "problemas"
          ? requestIsProblem(request, now)
          : filter === "falhas"
            ? request.status === "failed"
            : filter === "aguardando"
              ? isWaiting(request.status)
              : filter === "concluidos"
                ? request.status === "done"
                : request.printStatus === "failed";
    if (!keep) return false;
    if (!search.trim()) return true;
    const haystack = [
      REQUEST_KIND_LABELS[request.kind] ?? request.kind,
      requestStatusView(request, now).label,
      request.requestedByName,
      request.resultMessage,
      request.printMessage,
      deviceLabel(devices, request.claimedByDeviceId),
      request.operationId,
      request.id
    ]
      .filter(Boolean)
      .join(" ");
    return matchesSearch(haystack, search);
  });
}

export function billingIsProblem(request: SupportBillingRequest, now: number): boolean {
  return requestIsProblem(request, now, BILLING_STUCK_MS);
}

/** Falha primeiro, depois o que esta esperando, depois o concluido; dentro, o mais novo. */
export function sortBillingRequests(
  requests: SupportBillingRequest[],
  now: number
): SupportBillingRequest[] {
  const rank = (request: SupportBillingRequest) =>
    request.status === "failed"
      ? 0
      : isStuck(request, now, BILLING_STUCK_MS)
        ? 1
        : isWaiting(request.status)
          ? 2
          : 3;
  return [...requests].sort(
    (a, b) => rank(a) - rank(b) || b.requestedAt.localeCompare(a.requestedAt)
  );
}

// ---------------------------------------------------------------------------
// Envios ao OMIE
// ---------------------------------------------------------------------------

export type OmieReasonKey =
  | "missing_in_omie"
  | "service_order_failed"
  | "failed"
  | "sync_error"
  | "cadastro_incompleto"
  | "stuck_cloud"
  | "stuck_omie"
  | "other";

export interface OmieReason {
  key: OmieReasonKey;
  label: string;
  hint: string;
  severity: Severity;
}

const STUCK_STATUSES = ["closed_local", "pending_cloud", "pending_omie"];

/** O motivo, em portugues de gente, de a pesagem estar na lista de problemas do OMIE. */
export function omieReason(problem: SupportOmieProblem, now: number): OmieReason {
  switch (problem.omieBillingStatus) {
    case "missing_in_omie":
      return {
        key: "missing_in_omie",
        label: "Nao encontrado no OMIE",
        hint: "O pedido/OS foi apagado ou nao existe mais no OMIE; a balanca parou de reenviar.",
        severity: "danger"
      };
    case "service_order_failed":
      return {
        key: "service_order_failed",
        label: "OMIE recusou a OS",
        hint: "A ordem de servico foi recusada. Corrija o cadastro e reenvie pela balanca.",
        severity: "danger"
      };
    case "failed":
      return {
        key: "failed",
        label: "Erro no envio",
        hint: "O envio parou de tentar sozinho (dead letter). Reenviar pela balanca.",
        severity: "danger"
      };
    case "cadastro_incompleto":
      return {
        key: "cadastro_incompleto",
        label: "Cadastro incompleto no OMIE",
        hint: "Falta dado obrigatorio do cliente (documento, endereco ou e-mail).",
        severity: "warning"
      };
  }
  if (problem.status === "sync_error") {
    return {
      key: "sync_error",
      label: "Erro na sincronizacao",
      hint: "A balanca marcou a pesagem com erro de sincronizacao.",
      severity: "danger"
    };
  }
  if (STUCK_STATUSES.includes(problem.status)) {
    const waited = elapsedMs(problem.closedAt ?? problem.createdAt, now) ?? 0;
    const hours = Math.max(1, Math.floor(waited / 3_600_000));
    const span = hours >= 48 ? `${Math.floor(hours / 24)} d` : `${hours} h`;
    const toOmie = problem.status === "pending_omie";
    return {
      key: toOmie ? "stuck_omie" : "stuck_cloud",
      label: `Parado ha ${span} sem subir`,
      hint: toOmie
        ? "Ja esta na nuvem, esperando a balanca enviar ao OMIE."
        : "Fechada na balanca; a sincronizacao com a nuvem nao terminou.",
      severity: "warning"
    };
  }
  return {
    key: "other",
    label: problem.omieBillingStatus ?? problem.status,
    hint: "Situacao fora das conhecidas.",
    severity: "warning"
  };
}

/** Mais grave primeiro, depois a mais nova (pela data de fechamento). */
export function sortOmieProblems(
  problems: SupportOmieProblem[],
  now: number
): SupportOmieProblem[] {
  return [...problems].sort((a, b) => {
    const rank =
      SEVERITY_RANK[omieReason(b, now).severity] - SEVERITY_RANK[omieReason(a, now).severity];
    if (rank !== 0) return rank;
    return (b.closedAt ?? b.createdAt).localeCompare(a.closedAt ?? a.createdAt);
  });
}

export interface ReasonCount {
  key: OmieReasonKey;
  /** Rotulo curto, em minusculas, para o resumo ("3 cadastro incompleto"). */
  label: string;
  count: number;
  severity: Severity;
}

const OMIE_REASON_SHORT: Record<OmieReasonKey, string> = {
  missing_in_omie: "nao encontrado no OMIE",
  service_order_failed: "OS recusada",
  failed: "erro no envio",
  sync_error: "erro de sincronizacao",
  cadastro_incompleto: "cadastro incompleto",
  stuck_cloud: "parado sem subir a nuvem",
  stuck_omie: "parado sem subir ao OMIE",
  other: "outra situacao"
};

/** "3 cadastro incompleto · 1 erro no envio" — o resumo por motivo acima da tabela. */
export function countOmieReasons(problems: SupportOmieProblem[], now: number): ReasonCount[] {
  const counts = new Map<OmieReasonKey, ReasonCount>();
  for (const problem of problems) {
    const reason = omieReason(problem, now);
    const current = counts.get(reason.key);
    if (current) current.count++;
    else {
      counts.set(reason.key, {
        key: reason.key,
        label: OMIE_REASON_SHORT[reason.key],
        count: 1,
        severity: reason.severity
      });
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.count - a.count ||
      a.label.localeCompare(b.label, "pt-BR")
  );
}

// ---------------------------------------------------------------------------
// Relatorios automaticos
// ---------------------------------------------------------------------------

export const DISPATCH_KIND_LABELS: Record<SupportReportDispatch["kind"], string> = {
  diario: "Fechamento diario",
  financeiro: "Relatorio financeiro"
};

export function dispatchStatusView(dispatch: Pick<SupportReportDispatch, "status">): StatusView {
  switch (dispatch.status) {
    case "sent":
      return { label: "Enviado", tone: "success" };
    case "partial":
      return { label: "Parcial", tone: "warning" };
    case "failed":
      return { label: "Falhou", tone: "danger" };
    case "skipped":
      return { label: "Pulado", tone: "neutral" };
    default:
      return { label: dispatch.status || "—", tone: "neutral" };
  }
}

export function dispatchIsProblem(
  dispatch: Pick<SupportReportDispatch, "status" | "lastError">
): boolean {
  if (dispatch.status === "failed" || dispatch.status === "partial") return true;
  return dispatch.status !== "sent" && dispatch.status !== "skipped" && Boolean(dispatch.lastError);
}

// ---------------------------------------------------------------------------
// Acessos
// ---------------------------------------------------------------------------

/** "Administrador", "Gestor"... — o rotulo do menu; perfil desconhecido sai como veio. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return isRole(role) ? ROLE_LABELS[role] : role;
}

/** Tentativas por usuario a partir desta quantidade (7 dias) ja pedem conversa. */
export const PASSWORD_ALERT_COUNT = 5;

export interface PasswordFailureGroup {
  userId: string;
  userName: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
}

/** Agrupa as tentativas erradas de senha de preco por usuario (mais tentativas primeiro). */
export function groupPasswordFailures(
  failures: SupportPricePasswordFailure[]
): PasswordFailureGroup[] {
  const groups = new Map<string, PasswordFailureGroup>();
  for (const failure of failures) {
    const current = groups.get(failure.userId);
    if (!current) {
      groups.set(failure.userId, {
        userId: failure.userId,
        userName: failure.userName,
        count: 1,
        firstAt: failure.attemptedAt,
        lastAt: failure.attemptedAt
      });
      continue;
    }
    current.count++;
    if (failure.attemptedAt > current.lastAt) {
      current.lastAt = failure.attemptedAt;
      current.userName = failure.userName ?? current.userName;
    }
    if (failure.attemptedAt < current.firstAt) current.firstAt = failure.attemptedAt;
    if (!current.userName) current.userName = failure.userName;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

export function passwordSeverity(groups: PasswordFailureGroup[]): Severity {
  if (groups.some((group) => group.count >= PASSWORD_ALERT_COUNT)) return "danger";
  return groups.length > 0 ? "warning" : "ok";
}

const ROLE_ORDER = ["administrador", "gestor", "comercial", "operacao", "monitoramento", "loader"];

/** Ativos primeiro, depois do perfil que mais pode ao que menos pode, depois o nome. */
export function sortWebUsers(users: SupportWebUser[]): SupportWebUser[] {
  const rank = (role: string) => {
    const index = ROLE_ORDER.indexOf(role);
    return index === -1 ? ROLE_ORDER.length : index;
  };
  return [...users].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      rank(a.role) - rank(b.role) ||
      a.name.localeCompare(b.name, "pt-BR")
  );
}

// ---------------------------------------------------------------------------
// Resumo (cartoes do topo) e contadores das abas
// ---------------------------------------------------------------------------

export interface SupportCard {
  id:
    | "offline"
    | "desatualizadas"
    | "fila"
    | "pedidos"
    | "omie"
    | "relatorios"
    | "senha"
    | "navegador";
  tab: SupportTab;
  label: string;
  value: string;
  detail: string;
  /** `unknown` enquanto a nuvem nao respondeu. */
  severity: Severity | "unknown";
}

function plural(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function names(list: string[], max = 2): string {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} e mais ${list.length - max}`;
}

/** Os oito cartoes do topo. Sem resposta da nuvem, so o do navegador tem valor. */
export function summarizeSupport(
  overview: SupportOverview | null,
  browserErrors: ErrorLogEntry[],
  now: number
): SupportCard[] {
  const lastBrowserError = browserErrors[0];
  const browserCard: SupportCard = {
    id: "navegador",
    tab: "navegador",
    label: "Erros deste navegador",
    value: String(browserErrors.length),
    detail: lastBrowserError
      ? `ultimo ${formatAgo(lastBrowserError.at, now)}`
      : "nenhum erro registrado",
    severity: browserErrors.length > 0 ? "warning" : "ok"
  };
  if (!overview) {
    const pending = (id: SupportCard["id"], tab: SupportTab, label: string): SupportCard => ({
      id,
      tab,
      label,
      value: "—",
      detail: "aguardando a nuvem",
      severity: "unknown"
    });
    return [
      pending("offline", "balancas", "Balancas offline"),
      pending("desatualizadas", "balancas", "Balancas desatualizadas"),
      pending("fila", "balancas", "Fila das balancas"),
      pending("pedidos", "pedidos", "Pedidos do site (7 dias)"),
      pending("omie", "omie", "Envios OMIE com problema"),
      pending("relatorios", "relatorios", "Relatorios com erro"),
      pending("senha", "acessos", "Senha de preco errada"),
      browserCard
    ];
  }

  const latest = overview.latestAppVersion;
  const active = overview.devices.filter((device) => device.isActive);
  const checks = active.map((device) => ({ device, check: checkDevice(device, latest, now) }));

  const offline = checks.filter(({ check }) => check.offline);
  const offlineCard: SupportCard = {
    id: "offline",
    tab: "balancas",
    label: "Balancas offline",
    value: active.length ? `${offline.length} de ${active.length}` : "0",
    detail:
      active.length === 0
        ? "nenhuma balanca ativa"
        : offline.length === 0
          ? "todas ligadas"
          : offline.length === 1
            ? `${offline[0].device.name} · ${formatAgo(offline[0].device.lastSeenAt, now)}`
            : names(offline.map(({ device }) => device.name)),
    severity: offline.length > 0 ? "danger" : "ok"
  };

  const outdated = checks.filter(({ check }) => check.outdated);
  const outdatedCard: SupportCard = {
    id: "desatualizadas",
    tab: "balancas",
    label: "Balancas desatualizadas",
    value: String(outdated.length),
    detail:
      outdated.length === 0
        ? latest
          ? `todas na ${latest}`
          : "versao nao informada"
        : `versao atual ${latest ?? "—"} · ${names(outdated.map(({ device }) => device.name))}`,
    severity: outdated.length > 0 ? "warning" : "ok"
  };

  const blockedJobs = active.reduce((sum, device) => sum + (device.health.queueBlocked ?? 0), 0);
  const queueIssues = checks.filter(({ check }) => check.blocked || check.oldQueue);
  const oldestPending = active
    .map((device) => device.health.oldestPendingAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const queueParts: string[] = [];
  if (blockedJobs > 0) queueParts.push(plural(blockedJobs, "envio parado", "envios parados"));
  if (checks.some(({ check }) => check.oldQueue)) {
    queueParts.push(`mais antiga ${formatAgo(oldestPending, now)}`);
  }
  const queueCard: SupportCard = {
    id: "fila",
    tab: "balancas",
    label: "Fila das balancas",
    value: String(queueIssues.length),
    detail: queueParts.length ? queueParts.join(" · ") : "fila andando",
    severity: blockedJobs > 0 ? "danger" : queueIssues.length > 0 ? "warning" : "ok"
  };

  const failedRequests = overview.operationRequests.filter((r) => r.status === "failed").length;
  const stuckRequests = overview.operationRequests.filter((r) => isStuck(r, now)).length;
  const requestCard: SupportCard = {
    id: "pedidos",
    tab: "pedidos",
    label: "Pedidos do site (7 dias)",
    value: String(failedRequests + stuckRequests),
    detail:
      failedRequests + stuckRequests === 0
        ? `${plural(overview.operationRequests.length, "pedido", "pedidos")}, nenhuma falha`
        : [
            failedRequests ? plural(failedRequests, "falhou", "falharam") : "",
            stuckRequests ? plural(stuckRequests, "parado", "parados") : ""
          ]
            .filter(Boolean)
            .join(" · "),
    severity: failedRequests > 0 ? "danger" : stuckRequests > 0 ? "warning" : "ok"
  };

  const reasons = countOmieReasons(overview.omieProblems, now);
  const omieCard: SupportCard = {
    id: "omie",
    tab: "omie",
    label: "Envios OMIE com problema",
    value: String(overview.omieProblems.length),
    detail: reasons.length
      ? reasons
          .slice(0, 2)
          .map((reason) => `${reason.count} ${reason.label}`)
          .join(" · ")
      : "tudo chegou ao OMIE (30 dias)",
    severity: worstSeverity(reasons.map((reason) => reason.severity))
  };

  const badDispatches = overview.reportDispatches.filter(dispatchIsProblem);
  const reportCard: SupportCard = {
    id: "relatorios",
    tab: "relatorios",
    label: "Relatorios com erro",
    value: String(badDispatches.length),
    detail: badDispatches.length
      ? `ultimo em ${formatDay(badDispatches[0].reportDate)}`
      : `${plural(overview.reportDispatches.length, "envio", "envios")} em 30 dias`,
    severity: badDispatches.some((dispatch) => dispatch.status === "failed")
      ? "danger"
      : badDispatches.length > 0
        ? "warning"
        : "ok"
  };

  const groups = groupPasswordFailures(overview.pricePasswordFailures);
  const top = groups[0];
  const passwordCard: SupportCard = {
    id: "senha",
    tab: "acessos",
    label: "Senha de preco errada",
    value: String(overview.pricePasswordFailures.length),
    detail: top
      ? `${top.userName ?? "Sem nome"}: ${plural(top.count, "tentativa", "tentativas")}`
      : "nenhuma em 7 dias",
    severity: passwordSeverity(groups)
  };

  return [
    offlineCard,
    outdatedCard,
    queueCard,
    requestCard,
    omieCard,
    reportCard,
    passwordCard,
    browserCard
  ];
}

export interface TabBadge {
  count: number;
  severity: Severity;
}

/** O numero ao lado do nome de cada aba: quantos problemas ha nela (`null` = nada). */
export function tabBadges(
  overview: SupportOverview | null,
  browserErrors: ErrorLogEntry[],
  now: number
): Record<SupportTab, TabBadge | null> {
  const badge = (value: number, severity: Severity): TabBadge | null =>
    value > 0 ? { count: value, severity } : null;
  const browser = badge(browserErrors.length, "warning");
  if (!overview) {
    return {
      balancas: null,
      pedidos: null,
      omie: null,
      fechamentos: null,
      relatorios: null,
      acessos: null,
      navegador: browser
    };
  }
  const deviceChecks = overview.devices.map((device) =>
    checkDevice(device, overview.latestAppVersion, now)
  );
  const badDevices = deviceChecks.filter((check) => check.severity !== "ok");
  const requests = overview.operationRequests.filter((request) => requestIsProblem(request, now));
  const billing = overview.billingRequests.filter((request) => billingIsProblem(request, now));
  const dispatches = overview.reportDispatches.filter(dispatchIsProblem);
  const groups = groupPasswordFailures(overview.pricePasswordFailures);
  return {
    balancas: badge(badDevices.length, worstSeverity(badDevices.map((check) => check.severity))),
    pedidos: badge(
      requests.length,
      requests.some((request) => request.status === "failed") ? "danger" : "warning"
    ),
    omie: badge(
      overview.omieProblems.length,
      worstSeverity(overview.omieProblems.map((problem) => omieReason(problem, now).severity))
    ),
    fechamentos: badge(
      billing.length,
      billing.some((request) => request.status === "failed") ? "danger" : "warning"
    ),
    relatorios: badge(
      dispatches.length,
      dispatches.some((dispatch) => dispatch.status === "failed") ? "danger" : "warning"
    ),
    acessos: badge(overview.pricePasswordFailures.length, passwordSeverity(groups)),
    navegador: browser
  };
}

// ---------------------------------------------------------------------------
// "Copiar relatorio para o suporte"
// ---------------------------------------------------------------------------

export interface SupportDiagnostics {
  /** "production · versao 1.2.3 · commit abc1234" */
  build: string;
  userName: string;
  role: string;
  companyId: string;
  unitId: string;
  userAgent: string;
  online: boolean;
  timeZone: string;
  screen: string;
  language?: string;
  /** Endereco da tela (sem query string). */
  page?: string;
}

export interface ConnectionProbe {
  ok: boolean;
  ms: number;
  error?: string;
}

export interface ConnectionTest {
  at: string;
  api: ConnectionProbe;
  db: ConnectionProbe;
}

export function formatProbe(probe: ConnectionProbe): string {
  const ms = `${Math.round(probe.ms)} ms`;
  return probe.ok ? ms : `falhou em ${ms}: ${probe.error ?? "sem mensagem"}`;
}

const REPORT_ITEMS = 10;
const REPORT_LINE_MAX = 280;

/** Uma linha so, sem segredo e com tamanho de gente. */
function reportText(value: string | null | undefined, max = 180): string {
  if (!value) return "";
  return truncateText(redactSecrets(value).replace(/\s+/g, " ").trim(), max);
}

function line(parts: Array<string | null | undefined | false>): string {
  return truncateText(parts.filter(Boolean).join(" · "), REPORT_LINE_MAX);
}

function section<T>(
  title: string,
  items: T[],
  render: (item: T) => string,
  empty: string
): string[] {
  const out = [``, `== ${title} ==`];
  if (items.length === 0) {
    out.push(empty);
    return out;
  }
  for (const item of items.slice(0, REPORT_ITEMS)) out.push(`- ${render(item)}`);
  if (items.length > REPORT_ITEMS) out.push(`... e mais ${items.length - REPORT_ITEMS}`);
  return out;
}

/**
 * O texto que o administrador cola no WhatsApp/chamado do suporte: diagnostico do navegador,
 * os numeros do resumo e os problemas mais recentes de cada aba. Sem e-mail, sem senha (tudo
 * passa por `redactSecrets`) e com cada lista cortada — um relatorio que ninguem le inteiro
 * nao ajuda ninguem.
 */
export function buildSupportReport(input: {
  overview: SupportOverview | null;
  diagnostics: SupportDiagnostics;
  browserErrors: ErrorLogEntry[];
  connection?: ConnectionTest | null;
  loadError?: string | null;
  now: number;
}): string {
  const { overview, diagnostics, browserErrors, connection, loadError, now } = input;
  const nowIso = new Date(now).toISOString();
  const out: string[] = [
    "KyberRock Web — relatorio para o suporte",
    `Gerado em ${formatStamp(nowIso, true)} (horario de ${SUPPORT_TIMEZONE})`
  ];
  if (overview) out.push(`Dados da nuvem de ${formatStamp(overview.generatedAt, true)}`);
  if (loadError) out.push(`Nuvem: nao respondeu (${reportText(loadError)})`);

  out.push(
    "",
    "== Diagnostico ==",
    `Site: ${diagnostics.build}`,
    `Usuario: ${diagnostics.userName} (${roleLabel(diagnostics.role)})`,
    `Empresa: ${diagnostics.companyId} · Unidade: ${diagnostics.unitId}`,
    `Navegador: ${diagnostics.userAgent}`,
    line([
      `Online: ${diagnostics.online ? "sim" : "NAO"}`,
      `Fuso: ${diagnostics.timeZone}`,
      `Tela: ${diagnostics.screen}`,
      diagnostics.language ? `Idioma: ${diagnostics.language}` : null
    ])
  );
  if (diagnostics.page) out.push(`Pagina: ${diagnostics.page}`);
  if (connection) {
    out.push(
      `Teste de conexao (${formatStamp(connection.at)}): web-api ${formatProbe(connection.api)} · banco ${formatProbe(connection.db)}`
    );
  }

  out.push("", "== Resumo ==");
  for (const card of summarizeSupport(overview, browserErrors, now)) {
    const flag = card.severity === "danger" ? " [!!]" : card.severity === "warning" ? " [!]" : "";
    out.push(`${card.label}: ${card.value} — ${card.detail}${flag}`);
  }

  if (overview) {
    const units = unitNames(overview);
    const devices = deviceNames(overview);
    const latest = overview.latestAppVersion;

    out.push(
      ...section(
        `Balancas (versao mais nova: ${latest ?? "—"})`,
        sortDevices(overview.devices, latest, now),
        (device) => {
          const check = checkDevice(device, latest, now);
          const health = device.health;
          return line([
            `${device.name}${device.deviceNumber ? ` (No ${device.deviceNumber})` : ""}`,
            device.unitId ? (units.get(device.unitId) ?? shortId(device.unitId)) : null,
            !device.isActive ? "INATIVA" : null,
            `v${device.appVersion ?? "?"}${check.outdated ? " DESATUALIZADA" : ""}`,
            device.updateChannel === "teste" ? "canal teste" : null,
            device.isActive
              ? `${device.online ? "online" : "OFFLINE"} (visto ${formatAgo(device.lastSeenAt, now)})`
              : null,
            device.executesWebOperations ? "executa o site" : null,
            device.isPriceMaster ? "principal de precos" : null,
            `fila ${health.queuePending ?? "?"} pendentes / ${health.queueBlocked ?? "?"} parados`,
            health.oldestPendingAt ? `mais antiga ${formatAgo(health.oldestPendingAt, now)}` : null,
            health.lastError ? `ultimo erro: ${reportText(health.lastError, 140)}` : null
          ]);
        },
        "Nenhuma balanca cadastrada."
      )
    );

    out.push(
      ...section(
        "Pedidos do site com problema (7 dias)",
        overview.operationRequests.filter((request) => requestIsProblem(request, now)),
        (request) =>
          line([
            formatStamp(request.requestedAt),
            REQUEST_KIND_LABELS[request.kind] ?? request.kind,
            requestStatusView(request, now).label,
            request.requestedByName ? `por ${request.requestedByName}` : null,
            `balanca ${deviceLabel(devices, request.claimedByDeviceId)}`,
            `pesagem ${shortId(request.operationId)}`,
            reportText(request.resultMessage)
          ]),
        "Nenhum."
      )
    );

    const printFailures = overview.operationRequests.filter((r) => r.printStatus === "failed");
    if (printFailures.length > 0) {
      out.push(
        ...section(
          "Cupons que nao imprimiram (7 dias)",
          printFailures,
          (request) =>
            line([
              formatStamp(request.requestedAt),
              REQUEST_KIND_LABELS[request.kind] ?? request.kind,
              `balanca ${deviceLabel(devices, request.claimedByDeviceId)}`,
              reportText(request.printMessage)
            ]),
          "Nenhum."
        )
      );
    }

    out.push(
      ...section(
        "Envios OMIE com problema (30 dias)",
        sortOmieProblems(overview.omieProblems, now),
        (problem) =>
          line([
            formatStamp(problem.closedAt ?? problem.createdAt),
            problem.plate,
            problem.customerName,
            problem.totalCents !== null ? formatMoney(problem.totalCents) : null,
            omieReason(problem, now).label,
            `status ${problem.status}${problem.omieBillingStatus ? `/${problem.omieBillingStatus}` : ""}`,
            `pesagem ${shortId(problem.id)}`,
            reportText(problem.omieBillingMessage)
          ]),
        "Nenhum."
      )
    );

    out.push(
      ...section(
        "Fechamentos de faturas com problema (30 dias)",
        sortBillingRequests(overview.billingRequests, now).filter((request) =>
          billingIsProblem(request, now)
        ),
        (request) =>
          line([
            formatStamp(request.requestedAt),
            requestStatusView(request, now, BILLING_STUCK_MS).label,
            units.get(request.unitId) ?? null,
            `pedido ${shortId(request.id)}`,
            reportText(request.resultMessage)
          ]),
        "Nenhum."
      )
    );

    out.push(
      ...section(
        "Relatorios automaticos com erro (30 dias)",
        overview.reportDispatches.filter(dispatchIsProblem),
        (dispatch) =>
          line([
            formatDay(dispatch.reportDate),
            DISPATCH_KIND_LABELS[dispatch.kind] ?? dispatch.kind,
            dispatchStatusView(dispatch).label,
            plural(dispatch.recipientsCount, "destinatario", "destinatarios"),
            reportText(dispatch.lastError)
          ]),
        "Nenhum."
      )
    );

    out.push(
      ...section(
        "Senha de preco errada (7 dias)",
        groupPasswordFailures(overview.pricePasswordFailures),
        (group) =>
          line([
            group.userName ?? `usuario ${shortId(group.userId)}`,
            plural(group.count, "tentativa", "tentativas"),
            `ultima ${formatStamp(group.lastAt)}`
          ]),
        "Nenhuma."
      )
    );
  }

  out.push(
    ...section(
      "Erros deste navegador",
      browserErrors,
      (entry) =>
        line([
          formatStamp(entry.at),
          `[${entry.source}] ${reportText(entry.message)}`,
          entry.path ? `em ${entry.path}` : null
        ]),
      "Nenhum."
    )
  );

  return out.join("\n");
}
