// Alerta de balanca por WhatsApp: QUANDO avisar, e o QUE dizer.
//
// O painel ja classificava a saude de cada balanca (`apps/web/src/admin/lib/device-health.ts`),
// mas so na tela: balanca desligada no meio do dia, envio parado esperando um clique e fila
// atrasada so eram descobertos por quem abrisse o /admin — ou pelo telefone, quando a pedreira
// ligava porque a nota nao tinha saido. A passada `device-health-alerts` (pg_cron, 10 em 10 min)
// usa esta regra para avisar quem esta cadastrado em `device_alert_recipients`.
//
// Cada problema vira UM aviso quando comeca e UM quando termina (`device_alerts` guarda o que
// esta aberto). Repetir a cada passada ensinaria o suporte a ignorar a mensagem.
//
// Puro de proposito (sem Deno): o vitest exercita a regra inteira.

import { localNow } from "./report-schedule.ts";

export type DeviceAlertKind = "offline" | "queue_blocked" | "queue_stuck";

/** `active` abre (ou mantem) o alerta; `clear` resolve; `unknown` nao mexe no que existe. */
export type DeviceAlertState = "active" | "clear" | "unknown";

/**
 * Silencio a partir do qual a balanca conta como parada. O dobro dos 15 min com que o painel
 * pinta "Sem contato": reinicio do Windows e oscilacao de link de pedreira sao rotina, e um
 * aviso no celular custa mais atencao que uma cor na tela.
 */
export const OFFLINE_ALERT_AFTER_MS = 30 * 60 * 1000;

/**
 * Envio na fila ha mais que isso e atraso, nao ritmo: a varredura completa roda a cada 30
 * minutos (mesmo limite do painel, `QUEUE_STUCK_THRESHOLD_MS`).
 */
export const QUEUE_STUCK_AFTER_MS = 60 * 60 * 1000;

/**
 * Horario em que balanca calada e problema: segunda a sabado, das 6h as 18h de Sao Paulo.
 * Fora dele a pedreira fecha e desliga o computador, e avisar isso todo dia as 18h30 faria o
 * alerta de verdade se perder no meio.
 */
export const ALERT_WINDOW_START_HOUR = 6;
export const ALERT_WINDOW_END_HOUR = 18;

export interface DeviceAlertInput {
  deviceId: string;
  companyId: string;
  isActive: boolean;
  lastSeenAt: string | null;
  queuePending: number | null;
  queueBlocked: number | null;
  oldestPendingAt: string | null;
  lastError: string | null;
}

export interface DeviceAlertEvaluation {
  kind: DeviceAlertKind;
  state: DeviceAlertState;
  /** Frase do aviso, quando `active`. */
  detail: string | null;
}

/**
 * Situacao de cada tipo de alerta numa balanca, agora.
 *
 * Fila e envio parado so sao julgados com a balanca falando: calada, o ultimo resumo dela
 * e velho e nao diz nada do que ela tem hoje — o que estava aberto continua aberto, sem aviso
 * novo, ate ela voltar.
 */
export function evaluateDeviceAlerts(input: DeviceAlertInput, now: Date): DeviceAlertEvaluation[] {
  // Balanca desligada pelo administrador nao sincroniza nada de proposito: tudo resolvido.
  if (!input.isActive) {
    return (["offline", "queue_blocked", "queue_stuck"] as const).map((kind) => ({
      kind,
      state: "clear",
      detail: null
    }));
  }

  const silenceMs = elapsedMs(input.lastSeenAt, now);
  const talking = silenceMs !== null && silenceMs < OFFLINE_ALERT_AFTER_MS;

  return [
    evaluateOffline(input, silenceMs, now),
    talking ? evaluateBlocked(input) : unknown("queue_blocked"),
    talking ? evaluateStuck(input, now) : unknown("queue_stuck")
  ];
}

function evaluateOffline(
  input: DeviceAlertInput,
  silenceMs: number | null,
  now: Date
): DeviceAlertEvaluation {
  // Nunca falou: e instalacao nova ou cadastro sem uso, nao queda.
  if (silenceMs === null || !input.lastSeenAt) return unknown("offline");
  if (silenceMs < OFFLINE_ALERT_AFTER_MS) return { kind: "offline", state: "clear", detail: null };

  // Calada so vira alerta NOVO quando ligou HOJE e parou no horario de trabalho. A que nao
  // ligou hoje pode ser feriado, folga ou maquina aposentada — nada disso e queda. O alerta
  // ja aberto continua aberto ate ela voltar (`unknown` nao resolve).
  const local = localNow(now);
  const seenToday = localNow(new Date(input.lastSeenAt)).date === local.date;
  if (!isWithinAlertWindow(now) || !seenToday) return unknown("offline");

  return {
    kind: "offline",
    state: "active",
    detail: `parou de responder às ${formatClock(input.lastSeenAt)} (há ${formatDuration(silenceMs)}).`
  };
}

function evaluateBlocked(input: DeviceAlertInput): DeviceAlertEvaluation {
  // Balanca em versao sem o resumo de saude: nao sabemos, e "nao sei" nao resolve nem abre.
  if (input.queueBlocked === null) return unknown("queue_blocked");
  if (input.queueBlocked <= 0) return { kind: "queue_blocked", state: "clear", detail: null };
  const count = input.queueBlocked;
  return {
    kind: "queue_blocked",
    state: "active",
    detail: joinSentences([
      count === 1
        ? "1 envio parou e espera alguém na balança (tela Cloud / Fila OMIE)."
        : `${count} envios pararam e esperam alguém na balança (tela Cloud / Fila OMIE).`,
      input.lastError ? `Último erro: ${input.lastError}` : null
    ])
  };
}

function evaluateStuck(input: DeviceAlertInput, now: Date): DeviceAlertEvaluation {
  if (input.queuePending === null) return unknown("queue_stuck");
  const oldestMs = elapsedMs(input.oldestPendingAt, now);
  if (input.queuePending <= 0 || oldestMs === null || oldestMs < QUEUE_STUCK_AFTER_MS) {
    return { kind: "queue_stuck", state: "clear", detail: null };
  }
  const count = input.queuePending;
  return {
    kind: "queue_stuck",
    state: "active",
    detail: joinSentences([
      `${count} ${count === 1 ? "envio está" : "envios estão"} na fila há ${formatDuration(oldestMs)} sem chegar à nuvem/OMIE.`,
      input.lastError ? `Último erro: ${input.lastError}` : null
    ])
  };
}

export function isWithinAlertWindow(now: Date): boolean {
  const local = localNow(now);
  const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return false;
  return local.hour >= ALERT_WINDOW_START_HOUR && local.hour < ALERT_WINDOW_END_HOUR;
}

export interface OpenDeviceAlert {
  id: string;
  deviceId: string;
  kind: DeviceAlertKind;
  notifiedAt: string | null;
}

export interface DeviceAlertPlan {
  /** Problemas novos: inserir em `device_alerts`. */
  open: Array<{ deviceId: string; companyId: string; kind: DeviceAlertKind; detail: string }>;
  /** Alertas abertos cujo problema acabou. */
  resolve: OpenDeviceAlert[];
}

/**
 * Compara o que cada balanca tem agora com os alertas abertos. Nunca abre o mesmo tipo duas
 * vezes para a mesma balanca (o indice unico tambem garante), e so resolve com `clear`.
 */
export function planDeviceAlerts(input: {
  devices: DeviceAlertInput[];
  openAlerts: OpenDeviceAlert[];
  now: Date;
}): DeviceAlertPlan {
  const openByKey = new Map(
    input.openAlerts.map((alert) => [`${alert.deviceId}:${alert.kind}`, alert])
  );
  const plan: DeviceAlertPlan = { open: [], resolve: [] };
  const seenDevices = new Set<string>();

  for (const device of input.devices) {
    seenDevices.add(device.deviceId);
    for (const evaluation of evaluateDeviceAlerts(device, input.now)) {
      const existing = openByKey.get(`${device.deviceId}:${evaluation.kind}`);
      if (evaluation.state === "active" && !existing && evaluation.detail) {
        plan.open.push({
          deviceId: device.deviceId,
          companyId: device.companyId,
          kind: evaluation.kind,
          detail: evaluation.detail
        });
      } else if (evaluation.state === "clear" && existing) {
        plan.resolve.push(existing);
      }
    }
  }

  // Balanca excluida do cadastro: o alerta dela nao tem mais como resolver sozinho.
  for (const alert of input.openAlerts) {
    if (!seenDevices.has(alert.deviceId)) plan.resolve.push(alert);
  }

  return plan;
}

export interface DeviceAlertRecipient {
  /** `null` = suporte: recebe de todas as pedreiras. */
  companyId: string | null;
  whatsappPhone: string;
  isActive: boolean;
}

/** Telefones que recebem os avisos de uma pedreira: os dela e os do suporte, sem repetir. */
export function recipientsForCompany(
  recipients: DeviceAlertRecipient[],
  companyId: string
): string[] {
  const phones = new Set<string>();
  for (const recipient of recipients) {
    if (!recipient.isActive) continue;
    if (recipient.companyId !== null && recipient.companyId !== companyId) continue;
    const phone = normalizeAlertPhone(recipient.whatsappPhone);
    if (phone) phones.add(phone);
  }
  return [...phones];
}

/**
 * So digitos, com o 55 na frente quando vier o numero nacional (DDD + 8 ou 9 digitos) — o
 * mesmo formato que o UAZAPI espera e que o desktop grava nos destinatarios de relatorio.
 */
export function normalizeAlertPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : "";
}

export interface DeviceAlertLine {
  deviceLabel: string;
  kind: DeviceAlertKind;
  detail: string | null;
}

const KIND_TITLE: Record<DeviceAlertKind, string> = {
  offline: "Balança sem contato",
  queue_blocked: "Envio parado",
  queue_stuck: "Fila atrasada"
};

const KIND_RESOLVED: Record<DeviceAlertKind, string> = {
  offline: "voltou a responder.",
  queue_blocked: "não tem mais envio parado.",
  queue_stuck: "fila voltou ao normal."
};

/** Uma mensagem por pedreira, com tudo o que abriu e fechou nesta passada. */
export function buildDeviceAlertMessage(input: {
  companyName: string;
  opened: DeviceAlertLine[];
  resolved: DeviceAlertLine[];
}): string {
  const lines: string[] = [`*KyberRock — ${input.companyName}*`];
  for (const item of input.opened) {
    lines.push("", `⚠️ *${KIND_TITLE[item.kind]}* — ${item.deviceLabel}`);
    if (item.detail) lines.push(item.detail);
  }
  for (const item of input.resolved) {
    lines.push("", `✅ *Resolvido* — ${item.deviceLabel}: ${KIND_RESOLVED[item.kind]}`);
  }
  return lines.join("\n");
}

/** "Balança 2 (Expedição) — Unidade Matriz", sem os pedacos que faltarem. */
export function deviceAlertLabel(input: {
  deviceName: string | null;
  deviceNumber: number | null;
  unitName: string | null;
}): string {
  const name = (input.deviceName ?? "").trim() || "Balança";
  const numbered =
    typeof input.deviceNumber === "number" &&
    input.deviceNumber > 0 &&
    !name.includes(String(input.deviceNumber))
      ? `${name} (nº ${input.deviceNumber})`
      : name;
  const unit = (input.unitName ?? "").trim();
  return unit ? `${numbered} — ${unit}` : numbered;
}

function unknown(kind: DeviceAlertKind): DeviceAlertEvaluation {
  return { kind, state: "unknown", detail: null };
}

function elapsedMs(value: string | null, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, now.getTime() - parsed);
}

function formatClock(value: string): string {
  const shifted = new Date(Date.parse(value) - 3 * 3_600_000);
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

function joinSentences(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
