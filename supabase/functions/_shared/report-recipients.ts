/**
 * Destinatarios do fechamento diario (`report_recipients`) editados pelo site. As MESMAS regras
 * de `apps/desktop/src/services/report-recipients.ts` (canal obrigatorio, e-mail e WhatsApp
 * validos, hora cheia, tipos de relatorio) — a balanca puxa a tabela no `desktop-pull` e o
 * agendador da nuvem le dela, entao uma linha que o desktop recusaria nao pode entrar por aqui.
 */

export type ScheduleFrequency = "daily" | "weekly" | "monthly";
export type ReportType = "sales" | "trucks" | "both";

const FREQUENCIES: readonly ScheduleFrequency[] = ["daily", "weekly", "monthly"];
const REPORT_TYPES: readonly ReportType[] = ["sales", "trucks", "both"];

export interface ReportRecipientInput {
  displayName: string | null;
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  scheduleFrequency: ScheduleFrequency;
  scheduleTime: string;
  reportTypes: ReportType;
  sendFinancial: boolean;
  financialScheduleTime: string | null;
  isActive: boolean;
}

type Row = Record<string, unknown>;

export function normalizeScheduleTime(value: unknown, fallback = "20:00"): string {
  const hour = parseInt(String(value ?? "").split(":")[0] ?? "", 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fallback;
  return `${String(hour).padStart(2, "0")}:00`;
}

export function normalizeOptionalScheduleTime(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const hour = parseInt(String(value).split(":")[0] ?? "", 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:00`;
}

/** DDD + numero (10 ou 11 digitos) ganha o 55 do Brasil, como no desktop. */
export function normalizeWhatsappPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function validateReportRecipient(
  payload: Row
): { ok: true; value: ReportRecipientInput } | { ok: false; error: string } {
  const sendEmail = payload.sendEmail !== false;
  const sendWhatsapp = payload.sendWhatsapp === true;
  const email =
    typeof payload.email === "string" && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : null;
  const whatsappPhone =
    typeof payload.whatsappPhone === "string" && payload.whatsappPhone.trim()
      ? normalizeWhatsappPhone(payload.whatsappPhone)
      : null;
  if (!sendEmail && !sendWhatsapp) {
    return { ok: false, error: "Selecione pelo menos um canal de envio." };
  }
  if (sendEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: "E-mail invalido." };
  }
  if (sendWhatsapp && (!whatsappPhone || !/^\d{12,13}$/.test(whatsappPhone))) {
    return { ok: false, error: "WhatsApp invalido. Informe DDD e numero, ou o codigo do pais." };
  }
  const frequency = FREQUENCIES.includes(payload.scheduleFrequency as ScheduleFrequency)
    ? (payload.scheduleFrequency as ScheduleFrequency)
    : "daily";
  const reportTypes = REPORT_TYPES.includes(payload.reportTypes as ReportType)
    ? (payload.reportTypes as ReportType)
    : "sales";
  const displayName =
    typeof payload.displayName === "string" && payload.displayName.trim()
      ? payload.displayName.trim().slice(0, 120)
      : null;
  return {
    ok: true,
    value: {
      displayName,
      email,
      whatsappPhone,
      sendEmail,
      sendWhatsapp,
      scheduleFrequency: frequency,
      scheduleTime: normalizeScheduleTime(payload.scheduleTime),
      reportTypes,
      sendFinancial: payload.sendFinancial === true,
      financialScheduleTime: normalizeOptionalScheduleTime(payload.financialScheduleTime),
      isActive: payload.isActive !== false
    }
  };
}

/** Linha do banco com os nomes de coluna de `public.report_recipients`. */
export function recipientColumns(value: ReportRecipientInput): Row {
  return {
    display_name: value.displayName,
    email: value.email,
    whatsapp_phone: value.whatsappPhone,
    send_email: value.sendEmail,
    send_whatsapp: value.sendWhatsapp,
    schedule_frequency: value.scheduleFrequency,
    schedule_time: value.scheduleTime,
    report_types: value.reportTypes,
    send_financial: value.sendFinancial,
    financial_schedule_time: value.financialScheduleTime,
    is_active: value.isActive
  };
}
