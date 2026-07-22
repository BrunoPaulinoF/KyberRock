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
  deviceColor?: string | null;
  installationId?: string;
  /**
   * Quando true (ativacao na nuvem), o id do dispositivo local desta instalacao
   * passa a ser exatamente `deviceId` — se a instalacao ja tinha outro id, as
   * referencias locais (operacoes, configs, auditoria) sao remapeadas. Assim o
   * device_id local coincide com o device_registrations.id da nuvem e as
   * operacoes ficam atribuidas ao computador certo em todas as maquinas.
   */
  adoptDeviceId?: boolean;
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
  const desiredDeviceId = input.deviceId.trim();
  const identity: LocalDesktopIdentity = {
    companyId: input.companyId.trim(),
    unitId: input.unitId.trim(),
    deviceId: input.adoptDeviceId ? desiredDeviceId : (existingDevice?.id ?? desiredDeviceId),
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
        `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, color, is_active, created_at, updated_at)
          VALUES (@id, @companyId, @unitId, @name, 'desktop_scale', @installationId, @color, 1, @createdAt, @updatedAt)
          ON CONFLICT(installation_id) DO UPDATE SET
            company_id = excluded.company_id,
            unit_id = excluded.unit_id,
            name = excluded.name,
           color = COALESCE(excluded.color, devices.color),
           is_active = 1,
           updated_at = excluded.updated_at`
      )
      .run({
        id: existingDevice?.id ?? identity.deviceId,
        companyId: identity.companyId,
        unitId: identity.unitId,
        name: input.deviceName.trim(),
        installationId: identity.installationId,
        color: input.deviceColor?.trim() || null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    if (input.adoptDeviceId && existingDevice && existingDevice.id !== identity.deviceId) {
      remapLocalDeviceId(database, existingDevice.id, identity.deviceId, identity.installationId);
    }

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

/**
 * Troca o id do dispositivo desta instalacao (ex.: a nuvem passou a dar um id
 * proprio por computador) atualizando todas as referencias locais. Roda dentro
 * da transacao de identidade; as FKs sao adiadas ate o commit.
 */
function remapLocalDeviceId(
  database: DesktopDatabase,
  previousDeviceId: string,
  nextDeviceId: string,
  installationId: string
): void {
  database.pragma("defer_foreign_keys = ON");
  // Libera o PK caso um espelho remoto (vindo de desktop-status/pull) ja use o novo id.
  database
    .prepare("DELETE FROM devices WHERE id = ? AND installation_id <> ?")
    .run(nextDeviceId, installationId);
  database
    .prepare("UPDATE devices SET id = ? WHERE installation_id = ?")
    .run(nextDeviceId, installationId);
  for (const table of ["weighing_operations", "scale_configs", "print_profiles", "audit_logs"]) {
    database
      .prepare(`UPDATE ${table} SET device_id = ? WHERE device_id = ?`)
      .run(nextDeviceId, previousDeviceId);
  }
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
