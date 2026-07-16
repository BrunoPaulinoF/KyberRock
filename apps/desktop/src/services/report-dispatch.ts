// Agendamento local dos envios automaticos de relatorios (e-mail + WhatsApp),
// configurado na tela de Relatorios. O desktop e quem gera os anexos (PDF das
// telas de Insights/Controle de Caminhoes + Excel) e envia — a nuvem nao tem
// como renderizar os mesmos documentos das telas.
//
// Pacotes ("bundles") e seus periodos:
// - daily:   o proprio dia do envio
// - weekly:  ultimos 7 dias (a cada 7 dias contados do ultimo envio semanal)
// - monthly: mes anterior completo (na virada do mes)
// Quando mais de um pacote vence no mesmo dia (ex.: dia de semanal tambem tem
// o diario), os anexos sao combinados em um unico envio.

import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

export const REPORT_DISPATCH_SETTINGS_KEY = "report_dispatch_settings";
export const REPORT_DISPATCH_STATE_KEY = "report_dispatch_state";

export type DispatchBundleKind = "daily" | "weekly" | "monthly";

export interface ReportDispatchSettings {
  enabled: boolean;
  sendHour: number; // hora local (0-23) a partir da qual o envio do dia dispara
  daily: boolean;
  weekly: boolean;
  monthly: boolean;
  updatedAt: string | null;
}

export const DEFAULT_REPORT_DISPATCH_SETTINGS: ReportDispatchSettings = {
  enabled: false,
  sendHour: 18,
  daily: true,
  weekly: false,
  monthly: false,
  updatedAt: null
};

export interface ReportDispatchState {
  lastDailyDate: string | null; // "YYYY-MM-DD" do ultimo diario enviado
  lastWeeklyDate: string | null; // data do ultimo envio semanal
  lastMonthlyMonth: string | null; // "YYYY-MM" do ultimo mes coberto pelo mensal
  lastAttemptAt: string | null; // ultima tentativa (sucesso ou falha)
  lastError: string | null;
}

export const EMPTY_REPORT_DISPATCH_STATE: ReportDispatchState = {
  lastDailyDate: null,
  lastWeeklyDate: null,
  lastMonthlyMonth: null,
  lastAttemptAt: null,
  lastError: null
};

export interface DueBundle {
  kind: DispatchBundleKind;
  startDate: string;
  endDate: string;
  label: string;
}

export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days);
  return localIsoDate(date);
}

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = new Date(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const to = new Date(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

// Mes anterior ao dia informado: {month: "YYYY-MM", start, end}.
function previousMonthOf(todayIso: string): { month: string; start: string; end: string } {
  const [year, month] = todayIso.split("-").map(Number);
  const firstOfCurrent = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  const lastOfPrevious = new Date(firstOfCurrent.getTime() - 86_400_000);
  const start = `${lastOfPrevious.getFullYear()}-${String(lastOfPrevious.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    month: start.slice(0, 7),
    start,
    end: localIsoDate(lastOfPrevious)
  };
}

function formatBrDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// Quais pacotes vencem agora. Funcao pura: recebe settings/estado/relogio.
export function computeDueBundles(
  settings: ReportDispatchSettings,
  state: ReportDispatchState,
  now: Date
): DueBundle[] {
  if (!settings.enabled) return [];
  if (now.getHours() < settings.sendHour) return [];

  const today = localIsoDate(now);
  const due: DueBundle[] = [];

  if (settings.daily && state.lastDailyDate !== today) {
    due.push({
      kind: "daily",
      startDate: today,
      endDate: today,
      label: `Diario ${formatBrDate(today)}`
    });
  }

  if (
    settings.weekly &&
    (state.lastWeeklyDate === null || daysBetween(state.lastWeeklyDate, today) >= 7)
  ) {
    const start = addDays(today, -6);
    due.push({
      kind: "weekly",
      startDate: start,
      endDate: today,
      label: `Semanal ${formatBrDate(start)} a ${formatBrDate(today)}`
    });
  }

  if (settings.monthly) {
    const previous = previousMonthOf(today);
    if (state.lastMonthlyMonth !== previous.month) {
      due.push({
        kind: "monthly",
        startDate: previous.start,
        endDate: previous.end,
        label: `Mensal ${previous.month}`
      });
    }
  }

  return due;
}

// Pacotes para o botao "Enviar agora": mesmos periodos dos agendados, ignorando
// estado/horario — o que estiver marcado nas configuracoes sai na hora.
export function computeManualBundles(settings: ReportDispatchSettings, now: Date): DueBundle[] {
  const today = localIsoDate(now);
  const bundles: DueBundle[] = [];
  if (settings.daily) {
    bundles.push({
      kind: "daily",
      startDate: today,
      endDate: today,
      label: `Diario ${formatBrDate(today)}`
    });
  }
  if (settings.weekly) {
    const start = addDays(today, -6);
    bundles.push({
      kind: "weekly",
      startDate: start,
      endDate: today,
      label: `Semanal ${formatBrDate(start)} a ${formatBrDate(today)}`
    });
  }
  if (settings.monthly) {
    const previous = previousMonthOf(today);
    bundles.push({
      kind: "monthly",
      startDate: previous.start,
      endDate: previous.end,
      label: `Mensal ${previous.month}`
    });
  }
  if (bundles.length === 0) {
    bundles.push({
      kind: "daily",
      startDate: today,
      endDate: today,
      label: `Diario ${formatBrDate(today)}`
    });
  }
  return bundles;
}

export function readReportDispatchSettings(database: DesktopDatabase): ReportDispatchSettings {
  const stored = readLocalSetting<Partial<ReportDispatchSettings>>(
    database,
    REPORT_DISPATCH_SETTINGS_KEY
  );
  return { ...DEFAULT_REPORT_DISPATCH_SETTINGS, ...(stored ?? {}) };
}

export function readReportDispatchState(database: DesktopDatabase): ReportDispatchState {
  const stored = readLocalSetting<Partial<ReportDispatchState>>(
    database,
    REPORT_DISPATCH_STATE_KEY
  );
  return { ...EMPTY_REPORT_DISPATCH_STATE, ...(stored ?? {}) };
}

export function writeReportDispatchState(
  database: DesktopDatabase,
  patch: Partial<ReportDispatchState>
): ReportDispatchState {
  const next = { ...readReportDispatchState(database), ...patch };
  writeLocalSetting(database, REPORT_DISPATCH_STATE_KEY, next);
  return next;
}

// Salva as configuracoes ancorando o estado dos pacotes recem-ligados: semanal
// passa a contar 7 dias a partir de hoje e o mensal espera a proxima virada —
// ligar um pacote nao dispara envio retroativo imediato.
export function writeReportDispatchSettings(
  database: DesktopDatabase,
  patch: Partial<ReportDispatchSettings>,
  now: Date = new Date()
): ReportDispatchSettings {
  const current = readReportDispatchSettings(database);
  const next: ReportDispatchSettings = {
    ...current,
    ...patch,
    sendHour: normalizeSendHour(patch.sendHour ?? current.sendHour),
    updatedAt: now.toISOString()
  };

  const state = readReportDispatchState(database);
  const anchors: Partial<ReportDispatchState> = {};
  const today = localIsoDate(now);
  if (next.weekly && !current.weekly && state.lastWeeklyDate === null) {
    anchors.lastWeeklyDate = today;
  }
  if (next.monthly && !current.monthly && state.lastMonthlyMonth === null) {
    anchors.lastMonthlyMonth = previousMonthOf(today).month;
  }
  if (Object.keys(anchors).length > 0) {
    writeReportDispatchState(database, anchors);
  }

  writeLocalSetting(database, REPORT_DISPATCH_SETTINGS_KEY, next, next.updatedAt ?? undefined);
  return next;
}

export function normalizeSendHour(value: unknown): number {
  const hour = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return DEFAULT_REPORT_DISPATCH_SETTINGS.sendHour;
  }
  return hour;
}

// Anexo pronto para envio (e-mail e WhatsApp documento).
export interface ReportAttachment {
  filename: string;
  mimetype: string;
  content: Buffer;
  reportType: "sales" | "trucks";
  bundleLabel: string;
}

export interface DispatchSendResult {
  bundles: DispatchBundleKind[];
  recipients: number;
  emailsSent: number;
  emailErrors: string[];
  whatsappSent: number;
  whatsappErrors: string[];
}
