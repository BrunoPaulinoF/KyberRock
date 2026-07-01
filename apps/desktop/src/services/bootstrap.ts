import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface InitialDesktopIdentityInput {
  companyId: string;
  companyLegalName: string;
  companyTradeName?: string;
  companyDocument?: string;
  unitId: string;
  unitName: string;
  unitTimezone?: string;
  deviceId: string;
  deviceName: string;
  installationId?: string;
}

export interface LocalDesktopIdentity {
  companyId: string;
  unitId: string;
  deviceId: string;
  installationId: string;
}

interface LocalSettingRow {
  value_json: string;
}

export function ensureInitialDesktopIdentity(
  database: DesktopDatabase,
  input: InitialDesktopIdentityInput,
  now: Date = new Date()
): LocalDesktopIdentity {
  validateInitialDesktopIdentityInput(input);

  const timestamp = now.toISOString();
  const installationId = input.installationId?.trim() || randomUUID();
  const existingDevice = database
    .prepare("SELECT id FROM devices WHERE installation_id = ?")
    .get(installationId) as { id: string } | undefined;
  const identity: LocalDesktopIdentity = {
    companyId: input.companyId.trim(),
    unitId: input.unitId.trim(),
    deviceId: existingDevice?.id ?? input.deviceId.trim(),
    installationId
  };

  const writeIdentity = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, document, created_at, updated_at)
         VALUES (@id, @legalName, @tradeName, @document, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           legal_name = excluded.legal_name,
           trade_name = excluded.trade_name,
           document = excluded.document,
           updated_at = excluded.updated_at`
      )
      .run({
        id: identity.companyId,
        legalName: input.companyLegalName.trim(),
        tradeName: input.companyTradeName?.trim() || input.companyLegalName.trim(),
        document: input.companyDocument?.trim() || null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    database
      .prepare(
        `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
         VALUES (@id, @companyId, @name, @timezone, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           company_id = excluded.company_id,
           name = excluded.name,
           timezone = excluded.timezone,
           updated_at = excluded.updated_at`
      )
      .run({
        id: identity.unitId,
        companyId: identity.companyId,
        name: input.unitName.trim(),
        timezone: input.unitTimezone?.trim() || "America/Sao_Paulo",
        createdAt: timestamp,
        updatedAt: timestamp
      });

    database
      .prepare(
        `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, is_active, created_at, updated_at)
          VALUES (@id, @companyId, @unitId, @name, 'desktop_scale', @installationId, 1, @createdAt, @updatedAt)
          ON CONFLICT(installation_id) DO UPDATE SET
            company_id = excluded.company_id,
            unit_id = excluded.unit_id,
            name = excluded.name,
           is_active = 1,
           updated_at = excluded.updated_at`
      )
      .run({
        id: identity.deviceId,
        companyId: identity.companyId,
        unitId: identity.unitId,
        name: input.deviceName.trim(),
        installationId: identity.installationId,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    writeLocalSetting(database, "active_company_id", identity.companyId, timestamp);
    writeLocalSetting(database, "active_unit_id", identity.unitId, timestamp);
    writeLocalSetting(database, "active_device_id", identity.deviceId, timestamp);
    writeLocalSetting(database, "installation_id", identity.installationId, timestamp);
  });

  writeIdentity();

  return identity;
}

export function getLocalDesktopIdentity(database: DesktopDatabase): LocalDesktopIdentity | null {
  const companyId = readStringLocalSetting(database, "active_company_id");
  const unitId = readStringLocalSetting(database, "active_unit_id");
  const deviceId = readStringLocalSetting(database, "active_device_id");
  const installationId = readStringLocalSetting(database, "installation_id");

  if (!companyId || !unitId || !deviceId || !installationId) {
    return null;
  }

  return {
    companyId,
    unitId,
    deviceId,
    installationId
  };
}

function validateInitialDesktopIdentityInput(input: InitialDesktopIdentityInput): void {
  const requiredFields: Array<[string, string]> = [
    ["companyId", input.companyId],
    ["companyLegalName", input.companyLegalName],
    ["unitId", input.unitId],
    ["unitName", input.unitName],
    ["deviceId", input.deviceId],
    ["deviceName", input.deviceName]
  ];

  for (const [fieldName, value] of requiredFields) {
    if (!value.trim()) {
      throw new Error(`${fieldName} is required to initialize the desktop identity.`);
    }
  }
}

function writeLocalSetting(
  database: DesktopDatabase,
  key: string,
  value: string,
  updatedAt: string
): void {
  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), updatedAt);
}

function readStringLocalSetting(database: DesktopDatabase, key: string): string | null {
  const row = database.prepare("SELECT value_json FROM local_settings WHERE key = ?").get(key) as
    | LocalSettingRow
    | undefined;

  if (!row) {
    return null;
  }

  const value = JSON.parse(row.value_json);

  return typeof value === "string" ? value : null;
}
