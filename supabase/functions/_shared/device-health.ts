/**
 * Resumo de saude que a balanca manda no `desktop-status`.
 *
 * O ping ja carregava `appVersion`; este e o segundo passageiro dele. O painel
 * enxergava da frota so "esta ligada" (`last_seen_at`) e "esta em tal versao"
 * (`app_version`) — nada dizia se a balanca esta ENTREGANDO o que fecha. Fila
 * parada, envio esperando clique do operador e o motivo da ultima recusa
 * ficavam so na tela daquele computador, e o suporte descobria por telefone.
 *
 * A normalizacao vive aqui, pura e testada, porque o valor vem do corpo de uma
 * requisicao publica (`verify_jwt = false`): o handler autentica a balanca por
 * `deviceId` + `deviceToken`, mas o conteudo do resumo e o que o cliente disser
 * que e. Nada daqui pode ir para o banco sem passar por este filtro.
 *
 * Todo campo invalido vira ausencia, e o resumo inteiro so e aceito quando
 * traz alguma coisa util. `null` significa "esta balanca nao reportou" — que na
 * coluna do painel e diferente de "fila limpa".
 */
export interface DeviceHealthReport {
  queuePending: number;
  queueBlocked: number;
  oldestPendingAt: string | null;
  lastError: string | null;
  collectedAt: string | null;
}

/**
 * Teto da mensagem gravada. O desktop ja trunca em 300; este limite existe
 * porque o corpo da requisicao nao e confiavel — sem ele, um cliente forjado
 * escreveria um texto de megabytes numa coluna que o painel exibe em uma linha.
 */
export const DEVICE_HEALTH_MAX_ERROR_LENGTH = 300;

/**
 * Teto das contagens. A fila de uma balanca nao chega perto disso; o limite
 * existe para a coluna `integer` do Postgres nunca estourar com um numero
 * inventado, o que faria o update INTEIRO falhar e levar junto o `last_seen_at`
 * de uma balanca que esta apenas ligada.
 */
export const DEVICE_HEALTH_MAX_COUNT = 1_000_000;

/**
 * Le o resumo do corpo da requisicao. Devolve `null` quando nao veio nada
 * aproveitavel — desktop anterior a este campo, ou payload fora do formato.
 */
export function normalizeDeviceHealth(value: unknown): DeviceHealthReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const queuePending = normalizeCount(raw.queuePending);
  const queueBlocked = normalizeCount(raw.queueBlocked);
  const oldestPendingAt = normalizeTimestamp(raw.oldestPendingAt);
  const lastError = normalizeErrorMessage(raw.lastError);
  const collectedAt = normalizeTimestamp(raw.collectedAt);

  // Objeto sem nenhum campo reconhecido nao e "fila limpa": e ruido. Grava-lo
  // como zero faria uma balanca de origem duvidosa aparecer saudavel no painel.
  const reportedSomething =
    queuePending !== null ||
    queueBlocked !== null ||
    oldestPendingAt !== null ||
    lastError !== null ||
    collectedAt !== null;
  if (!reportedSomething) return null;

  return {
    queuePending: queuePending ?? 0,
    queueBlocked: queueBlocked ?? 0,
    oldestPendingAt,
    lastError,
    collectedAt
  };
}

/**
 * As colunas do `device_registrations` correspondentes ao resumo.
 *
 * `collectedAt` ausente (balanca com relogio sem hora, payload truncado) e
 * substituido pela hora da nuvem: a coluna e o que separa "reportou" de "nunca
 * reportou", e deixa-la nula guardaria um resumo que o painel nunca mostraria.
 */
export function deviceHealthColumns(
  report: DeviceHealthReport,
  checkedAt: string
): Record<string, unknown> {
  return {
    health_queue_pending: report.queuePending,
    health_queue_blocked: report.queueBlocked,
    health_oldest_pending_at: report.oldestPendingAt,
    health_last_error: report.lastError,
    health_collected_at: report.collectedAt ?? checkedAt
  };
}

function normalizeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const count = Math.trunc(value);
  if (count < 0) return 0;
  return Math.min(count, DEVICE_HEALTH_MAX_COUNT);
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Texto que nao e data cairia direto num `timestamptz` e o update INTEIRO
  // falharia — levando junto o `last_seen_at`, que e o campo que nao pode
  // faltar.
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > DEVICE_HEALTH_MAX_ERROR_LENGTH
    ? `${trimmed.slice(0, DEVICE_HEALTH_MAX_ERROR_LENGTH - 1)}…`
    : trimmed;
}
