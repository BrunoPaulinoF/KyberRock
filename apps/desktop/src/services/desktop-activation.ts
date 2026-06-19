import type { DesktopDatabase } from "../database/sqlite.js";
import {
  ensureInitialDesktopIdentity,
  getLocalDesktopIdentity
} from "./bootstrap.js";
import { getSupabaseClient } from "./supabase-sync.js";
import { readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

export const DESKTOP_ACCESS_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const DESKTOP_ACCESS_CHECK_INTERVAL_MS = 30 * 1000; // 30 segundos quando online para detectar bloqueio em tempo real

export type DesktopAccessStatusCode =
  | "not_activated"
  | "approved"
  | "offline_grace"
  | "validation_expired"
  | "company_blocked"
  | "unit_blocked"
  | "device_blocked"
  | "invalid_device"
  | "validation_error";

export interface DesktopAccessStatus {
  status: DesktopAccessStatusCode;
  canOperate: boolean;
  requiresActivation: boolean;
  message: string;
  companyId: string | null;
  companyName: string | null;
  unitId: string | null;
  unitName: string | null;
  deviceId: string | null;
  lastSuccessfulCheckAt: string | null;
  graceExpiresAt: string | null;
  checkedAt: string;
}

export interface ActivateDesktopInput {
  activationCode: string;
  deviceName: string;
}

interface CloudCredentials {
  companyId: string;
  unitId: string;
  deviceId: string;
  deviceToken: string;
}

interface ActivateDesktopResponse {
  status?: string;
  message?: string;
  companyId?: string;
  companyLegalName?: string;
  companyTradeName?: string;
  companyDocument?: string | null;
  unitId?: string;
  unitName?: string;
  unitTimezone?: string;
  deviceId?: string;
  deviceToken?: string;
  checkedAt?: string;
}

interface DesktopStatusResponse {
  status?: DesktopAccessStatusCode;
  allowed?: boolean;
  message?: string;
  companyId?: string;
  unitId?: string;
  deviceId?: string;
  checkedAt?: string;
}

export async function activateDesktop(
  database: DesktopDatabase,
  input: ActivateDesktopInput,
  now: Date = new Date()
): Promise<DesktopAccessStatus> {
  const activationCode = input.activationCode.trim();
  if (!/^\d{6}$/.test(activationCode)) {
    throw new Error("Informe o codigo de 6 digitos da pedreira.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<ActivateDesktopResponse>(
    "desktop-activate",
    {
      body: {
        activationCode,
        deviceName: input.deviceName.trim() || "Desktop balanca"
      }
    }
  );

  if (error) {
    throw new Error(error.message || "Falha ao ativar desktop.");
  }

  if (!data?.companyId || !data.unitId || !data.deviceId || !data.deviceToken) {
    throw new Error(data?.message || "Resposta de ativacao invalida.");
  }

  const checkedAt = data.checkedAt ?? now.toISOString();
  ensureInitialDesktopIdentity(database, {
    companyId: data.companyId,
    companyLegalName: data.companyLegalName ?? data.companyTradeName ?? "KyberRock",
    companyTradeName: data.companyTradeName ?? data.companyLegalName ?? "KyberRock",
    companyDocument: data.companyDocument ?? undefined,
    unitId: data.unitId,
    unitName: data.unitName ?? "Unidade ativada",
    unitTimezone: data.unitTimezone,
    deviceId: data.deviceId,
    deviceName: input.deviceName.trim() || "Desktop balanca",
    installationId: getLocalDesktopIdentity(database)?.installationId
  }, new Date(checkedAt));

  saveCloudCredentials(database, {
    companyId: data.companyId,
    unitId: data.unitId,
    deviceId: data.deviceId,
    deviceToken: data.deviceToken
  }, checkedAt);
  saveAccessStatus(database, "approved", data.message ?? "Acesso aprovado. Sistema liberado.", checkedAt);

  return buildAccessStatus(database, {
    status: "approved",
    canOperate: true,
    requiresActivation: false,
    message: data.message ?? "Acesso aprovado. Sistema liberado.",
    checkedAt
  });
}

export async function validateDesktopAccess(
  database: DesktopDatabase,
  options: { internetOnline?: boolean; force?: boolean; now?: Date } = {}
): Promise<DesktopAccessStatus> {
  const now = options.now ?? new Date();
  const credentials = getCloudCredentials(database);
  if (!credentials) {
    return buildAccessStatus(database, {
      status: "not_activated",
      canOperate: false,
      requiresActivation: true,
      message: "Primeiro acesso exige internet e codigo de ativacao da pedreira.",
      checkedAt: now.toISOString()
    });
  }

  const stored = getStoredDesktopAccessStatus(database, now);
  const lastSuccessfulCheckAt = readStringLocalSetting(database, "last_license_check_at");
  if (options.internetOnline === false) {
    return buildOfflineStatus(database, stored, now);
  }

  // Se estiver online, SEMPRE valida na nuvem (nunca usa cache) para detectar bloqueio em tempo real
  // Se estiver offline, usa o cache + grace period
  if (!options.force && lastSuccessfulCheckAt && now.getTime() - Date.parse(lastSuccessfulCheckAt) < DESKTOP_ACCESS_CHECK_INTERVAL_MS && stored.canOperate && options.internetOnline !== true) {
    return stored;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke<DesktopStatusResponse>("desktop-status", {
      body: {
        deviceId: credentials.deviceId,
        deviceToken: credentials.deviceToken
      }
    });

    if (error) {
      throw new Error(error.message || "Falha ao validar acesso.");
    }

    const status = data?.status ?? "validation_error";
    const message = data?.message ?? "Falha ao validar acesso.";
    const checkedAt = data?.checkedAt ?? now.toISOString();
    saveAccessStatus(database, status, message, checkedAt);
    if (data?.allowed) {
      writeLocalSetting(database, "last_license_check_at", checkedAt, checkedAt);
    }
    return buildAccessStatus(database, {
      status,
      canOperate: data?.allowed === true,
      requiresActivation: false,
      message,
      checkedAt
    });
  } catch {
    return buildOfflineStatus(database, stored, now);
  }
}

export function getStoredDesktopAccessStatus(
  database: DesktopDatabase,
  now: Date = new Date()
): DesktopAccessStatus {
  const credentials = getCloudCredentials(database);
  const storedMessage = readStringLocalSetting(database, "desktop_access_message");
  if (!credentials) {
    return buildAccessStatus(database, {
      status: "not_activated",
      canOperate: false,
      requiresActivation: true,
      message: storedMessage ?? "Primeiro acesso exige internet e codigo de ativacao da pedreira.",
      checkedAt: now.toISOString()
    });
  }

  const blockedStatus = readStringLocalSetting(database, "desktop_access_status") as DesktopAccessStatusCode | null;
  const blockedMessage = readStringLocalSetting(database, "desktop_access_message");
  if (blockedStatus && isBlockingStatus(blockedStatus)) {
    return buildAccessStatus(database, {
      status: blockedStatus,
      canOperate: false,
      requiresActivation: false,
      message: blockedMessage ?? "Acesso bloqueado pelo administrador.",
      checkedAt: now.toISOString()
    });
  }

  const lastSuccessfulCheckAt = readStringLocalSetting(database, "last_license_check_at");
  if (!lastSuccessfulCheckAt) {
    return buildAccessStatus(database, {
      status: "validation_expired",
      canOperate: false,
      requiresActivation: false,
      message: "Validação expirada. Conecte à internet para continuar usando.",
      checkedAt: now.toISOString()
    });
  }

  const graceExpiresAt = new Date(Date.parse(lastSuccessfulCheckAt) + DESKTOP_ACCESS_GRACE_PERIOD_MS);
  if (Number.isNaN(graceExpiresAt.getTime()) || graceExpiresAt.getTime() < now.getTime()) {
    return buildAccessStatus(database, {
      status: "validation_expired",
      canOperate: false,
      requiresActivation: false,
      message: "Validação expirada. Conecte à internet para continuar usando.",
      checkedAt: now.toISOString()
    });
  }

  return buildAccessStatus(database, {
    status: "approved",
    canOperate: true,
    requiresActivation: false,
    message: "Sistema liberado.",
    checkedAt: now.toISOString()
  });
}

function buildOfflineStatus(
  database: DesktopDatabase,
  stored: DesktopAccessStatus,
  now: Date
): DesktopAccessStatus {
  if (!stored.canOperate) {
    return stored;
  }

  return buildAccessStatus(database, {
    status: "offline_grace",
    canOperate: true,
    requiresActivation: false,
    message: "Sem internet. Operando offline dentro do prazo de 7 dias.",
    checkedAt: now.toISOString()
  });
}

function saveCloudCredentials(database: DesktopDatabase, credentials: CloudCredentials, updatedAt: string): void {
  writeLocalSetting(database, "cloud_company_id", credentials.companyId, updatedAt);
  writeLocalSetting(database, "cloud_unit_id", credentials.unitId, updatedAt);
  writeLocalSetting(database, "cloud_device_id", credentials.deviceId, updatedAt);
  writeLocalSetting(database, "cloud_device_token", credentials.deviceToken, updatedAt);
  writeLocalSetting(database, "cloud_configured", true, updatedAt);
  writeLocalSetting(database, "last_license_check_at", updatedAt, updatedAt);
}

function saveAccessStatus(
  database: DesktopDatabase,
  status: DesktopAccessStatusCode,
  message: string,
  updatedAt: string
): void {
  writeLocalSetting(database, "desktop_access_status", status, updatedAt);
  writeLocalSetting(database, "desktop_access_message", message, updatedAt);
}

function getCloudCredentials(database: DesktopDatabase): CloudCredentials | null {
  const companyId = readStringLocalSetting(database, "cloud_company_id");
  const unitId = readStringLocalSetting(database, "cloud_unit_id");
  const deviceId = readStringLocalSetting(database, "cloud_device_id");
  const deviceToken = readStringLocalSetting(database, "cloud_device_token");

  if (!companyId || !unitId || !deviceId || !deviceToken) {
    return null;
  }

  return { companyId, unitId, deviceId, deviceToken };
}

function buildAccessStatus(
  database: DesktopDatabase,
  input: Pick<DesktopAccessStatus, "status" | "canOperate" | "requiresActivation" | "message" | "checkedAt">
): DesktopAccessStatus {
  const lastSuccessfulCheckAt = readStringLocalSetting(database, "last_license_check_at");
  const credentials = getCloudCredentials(database);
  const graceExpiresAt = lastSuccessfulCheckAt
    ? new Date(Date.parse(lastSuccessfulCheckAt) + DESKTOP_ACCESS_GRACE_PERIOD_MS).toISOString()
    : null;
  const { companyName, unitName } = getCompanyAndUnitNames(database, credentials ?? undefined);

  return {
    ...input,
    companyId: credentials?.companyId ?? null,
    companyName,
    unitId: credentials?.unitId ?? null,
    unitName,
    deviceId: credentials?.deviceId ?? null,
    lastSuccessfulCheckAt,
    graceExpiresAt
  };
}

function getCompanyAndUnitNames(
  database: DesktopDatabase,
  credentials?: { companyId?: string; unitId?: string }
): { companyName: string | null; unitName: string | null } {
  if (!credentials?.companyId || !credentials?.unitId) {
    return { companyName: null, unitName: null };
  }

  try {
    const companyRow = database
      .prepare("SELECT trade_name FROM companies WHERE id = ?")
      .get(credentials.companyId) as { trade_name: string } | undefined;
    const unitRow = database
      .prepare("SELECT name FROM units WHERE id = ?")
      .get(credentials.unitId) as { name: string } | undefined;

    return {
      companyName: companyRow?.trade_name ?? null,
      unitName: unitRow?.name ?? null
    };
  } catch {
    return { companyName: null, unitName: null };
  }
}

export function logoutDesktop(database: DesktopDatabase, now: Date = new Date()): void {
  const timestamp = now.toISOString();
  const keysToRemove = [
    "cloud_company_id",
    "cloud_unit_id",
    "cloud_device_id",
    "cloud_device_token",
    "cloud_configured",
    "last_license_check_at",
    "desktop_access_status",
    "desktop_access_message",
    "omie_app_key",
    "omie_app_secret",
    "omie_configured"
  ];

  for (const key of keysToRemove) {
    database.prepare("DELETE FROM local_settings WHERE key = ?").run(key);
  }

  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    )
    .run("desktop_access_status", JSON.stringify("not_activated"), timestamp);

  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    )
    .run(
      "desktop_access_message",
      JSON.stringify("Faça o requerimento de um novo código de acesso."),
      timestamp
    );
}

function isBlockingStatus(status: DesktopAccessStatusCode): boolean {
  return ["company_blocked", "unit_blocked", "device_blocked", "invalid_device"].includes(status);
}
