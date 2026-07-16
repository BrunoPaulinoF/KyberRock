// Configuracao dos canais de envio de relatorios (SMTP e WhatsApp/UAZAPI),
// cadastrada na tela de Relatorios do desktop. Fica em local_settings e e
// empurrada para o cloud (report_channel_settings) para o daily-report-email
// usar sem depender de envs nas Edge Functions.

import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

export const REPORT_CHANNELS_SETTING_KEY = "report_channel_settings";

export type WhatsappConnectionStatus = "disconnected" | "connecting" | "connected" | "hibernated";

export interface ReportChannelSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSender: string;
  uazapiBaseUrl: string;
  uazapiInstanceToken: string;
  uazapiInstanceName: string;
  uazapiStatus: WhatsappConnectionStatus | "";
  uazapiProfileName: string;
  // Push pendente para o cloud (falha de rede na ultima tentativa).
  cloudPushPending: boolean;
  cloudPushError: string | null;
  updatedAt: string | null;
}

export const EMPTY_REPORT_CHANNEL_SETTINGS: ReportChannelSettings = {
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPassword: "",
  smtpSender: "",
  uazapiBaseUrl: "",
  uazapiInstanceToken: "",
  uazapiInstanceName: "",
  uazapiStatus: "",
  uazapiProfileName: "",
  cloudPushPending: false,
  cloudPushError: null,
  updatedAt: null
};

export function readReportChannelSettings(database: DesktopDatabase): ReportChannelSettings {
  const stored = readLocalSetting<Partial<ReportChannelSettings>>(
    database,
    REPORT_CHANNELS_SETTING_KEY
  );
  return { ...EMPTY_REPORT_CHANNEL_SETTINGS, ...(stored ?? {}) };
}

export function writeReportChannelSettings(
  database: DesktopDatabase,
  patch: Partial<ReportChannelSettings>,
  now: Date = new Date()
): ReportChannelSettings {
  const next: ReportChannelSettings = {
    ...readReportChannelSettings(database),
    ...patch,
    updatedAt: now.toISOString()
  };
  writeLocalSetting(database, REPORT_CHANNELS_SETTING_KEY, next, next.updatedAt ?? undefined);
  return next;
}

// Linha enviada ao cloud (tabela report_channel_settings). O cloud so precisa
// do token da instancia (provisionada pelos admins na UAZAPI) para enviar.
export function toCloudChannelSettingsRow(
  companyId: string,
  settings: ReportChannelSettings
): Record<string, unknown> {
  return {
    company_id: companyId,
    smtp_host: settings.smtpHost || null,
    smtp_port: settings.smtpPort || null,
    smtp_user: settings.smtpUser || null,
    smtp_password: settings.smtpPassword || null,
    smtp_sender: settings.smtpSender || settings.smtpUser || null,
    whatsapp_url: settings.uazapiBaseUrl || null,
    whatsapp_instance_token: settings.uazapiInstanceToken || null,
    whatsapp_instance_name: settings.uazapiInstanceName || null,
    whatsapp_status: settings.uazapiStatus || null,
    updated_at: new Date().toISOString()
  };
}

export function normalizeUazapiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export interface UazapiInstanceState {
  status: WhatsappConnectionStatus;
  connected: boolean;
  loggedIn: boolean;
  qrcode: string | null;
  paircode: string | null;
  profileName: string | null;
  owner: string | null;
  instanceToken: string | null;
  lastDisconnectReason: string | null;
}

interface UazapiInstancePayload {
  id?: string;
  token?: string;
  status?: string;
  qrcode?: string;
  paircode?: string;
  profileName?: string;
  owner?: string;
  lastDisconnectReason?: string;
}

function normalizeStatus(value: unknown): WhatsappConnectionStatus {
  return value === "connected" || value === "connecting" || value === "hibernated"
    ? value
    : "disconnected";
}

function mapInstanceState(payload: {
  instance?: UazapiInstancePayload;
  token?: string;
  connected?: boolean;
  loggedIn?: boolean;
  status?: { connected?: boolean; loggedIn?: boolean };
}): UazapiInstanceState {
  const instance = payload.instance ?? {};
  const connected = payload.status?.connected ?? payload.connected ?? false;
  const loggedIn = payload.status?.loggedIn ?? payload.loggedIn ?? false;
  return {
    status: normalizeStatus(instance.status),
    connected: connected === true,
    loggedIn: loggedIn === true,
    qrcode: instance.qrcode || null,
    paircode: instance.paircode || null,
    profileName: instance.profileName || null,
    owner: instance.owner || null,
    instanceToken: payload.token || instance.token || null,
    lastDisconnectReason: instance.lastDisconnectReason || null
  };
}

async function uazapiRequest(
  baseUrl: string,
  path: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown }
): Promise<Record<string, unknown>> {
  const url = `${normalizeUazapiBaseUrl(baseUrl)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha de rede";
    throw new Error(`Nao foi possivel falar com o servidor UAZAPI (${url}): ${message}`);
  }
  const text = await response.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    const detail =
      (typeof json["error"] === "string" && json["error"]) ||
      (typeof json["message"] === "string" && json["message"]) ||
      text.slice(0, 200) ||
      `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new Error(`UAZAPI recusou o token (401): ${detail}`);
    }
    throw new Error(`UAZAPI ${path} falhou (${response.status}): ${detail}`);
  }
  return json;
}

// POST /instance/connect (header token) — inicia a conexao; o QR code sai no
// campo instance.qrcode (e rotaciona: use uazapiInstanceStatus para atualizar).
export async function uazapiConnectInstance(input: {
  baseUrl: string;
  instanceToken: string;
}): Promise<UazapiInstanceState> {
  const json = await uazapiRequest(input.baseUrl, "/instance/connect", {
    method: "POST",
    headers: { token: input.instanceToken },
    body: {}
  });
  return mapInstanceState(json as Parameters<typeof mapInstanceState>[0]);
}

// GET /instance/status (header token) — estado atual + QR atualizado.
export async function uazapiInstanceStatus(input: {
  baseUrl: string;
  instanceToken: string;
}): Promise<UazapiInstanceState> {
  const json = await uazapiRequest(input.baseUrl, "/instance/status", {
    method: "GET",
    headers: { token: input.instanceToken }
  });
  return mapInstanceState(json as Parameters<typeof mapInstanceState>[0]);
}

// POST /instance/disconnect (header token).
export async function uazapiDisconnectInstance(input: {
  baseUrl: string;
  instanceToken: string;
}): Promise<UazapiInstanceState> {
  const json = await uazapiRequest(input.baseUrl, "/instance/disconnect", {
    method: "POST",
    headers: { token: input.instanceToken },
    body: {}
  });
  return mapInstanceState(json as Parameters<typeof mapInstanceState>[0]);
}
