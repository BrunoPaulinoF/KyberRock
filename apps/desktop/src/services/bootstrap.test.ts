import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  ensureInitialDesktopIdentity,
  ensureLocalDeviceRow,
  getLocalDesktopIdentity
} from "./bootstrap";

describe("ensureInitialDesktopIdentity", () => {
  it("creates company, unit, device and local settings", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);

      const identity = ensureInitialDesktopIdentity(
        database,
        {
          companyId: "company-1",
          companyLegalName: "KyberRock Mineracao LTDA",
          unitId: "unit-1",
          unitName: "Pedreira Principal",
          deviceId: "device-1",
          deviceName: "PC Balanca",
          installationId: "install-1"
        },
        new Date("2026-06-06T12:00:00.000Z")
      );

      expect(identity).toEqual({
        companyId: "company-1",
        unitId: "unit-1",
        deviceId: "device-1",
        installationId: "install-1"
      });
      expect(getLocalDesktopIdentity(database)).toEqual(identity);
      expect(database.prepare("SELECT COUNT(*) FROM companies").pluck().get()).toBe(1);
      expect(database.prepare("SELECT COUNT(*) FROM units").pluck().get()).toBe(1);
      expect(database.prepare("SELECT COUNT(*) FROM devices").pluck().get()).toBe(1);
    } finally {
      database.close();
    }
  });

  it("persists identity after closing and reopening the database", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-desktop-"));
    const databasePath = path.join(tempDirectory, "kyberrock.sqlite3");

    try {
      const firstDatabase = openDesktopDatabase({ databasePath });
      runDesktopMigrations(firstDatabase);
      const identity = ensureInitialDesktopIdentity(firstDatabase, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });
      firstDatabase.close();

      const reopenedDatabase = openDesktopDatabase({ databasePath });

      try {
        expect(getLocalDesktopIdentity(reopenedDatabase)).toEqual(identity);
      } finally {
        reopenedDatabase.close();
      }
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the local device id stable during reactivation to preserve foreign keys", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const firstIdentity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-local-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });
      database
        .prepare(
          `INSERT INTO scale_configs (
             id, device_id, adapter_type, connection_config_json, stability_config_json, created_at, updated_at
           ) VALUES (?, ?, 'virtual', '{}', '{}', ?, ?)`
        )
        .run(
          "scale-config-1",
          firstIdentity.deviceId,
          "2026-06-06T12:00:00.000Z",
          "2026-06-06T12:00:00.000Z"
        );

      const reactivatedIdentity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-cloud-new",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });

      expect(reactivatedIdentity.deviceId).toBe(firstIdentity.deviceId);
      expect(getLocalDesktopIdentity(database)).toEqual(reactivatedIdentity);
      expect(
        database
          .prepare("SELECT device_id FROM scale_configs WHERE id = ?")
          .pluck()
          .get("scale-config-1")
      ).toBe(firstIdentity.deviceId);
    } finally {
      database.close();
    }
  });

  it("adopts the cloud device id on activation, remapping local references", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const timestamp = "2026-07-22T12:00:00.000Z";
      const firstIdentity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "setup-device",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });
      database
        .prepare(
          `INSERT INTO scale_configs (
             id, device_id, adapter_type, connection_config_json, stability_config_json, created_at, updated_at
           ) VALUES (?, ?, 'virtual', '{}', '{}', ?, ?)`
        )
        .run("scale-config-1", firstIdentity.deviceId, timestamp, timestamp);
      database
        .prepare(
          `INSERT INTO weighing_operations (
             id, company_id, unit_id, device_id, status, operation_type, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'entry_registered', 'invoice', ?, ?)`
        )
        .run("op-1", "company-1", "unit-1", firstIdentity.deviceId, timestamp, timestamp);

      const activatedIdentity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "desktop-cloud-1",
        deviceName: "PC Balanca",
        deviceColor: "#2563eb",
        installationId: "install-1",
        adoptDeviceId: true
      });

      expect(activatedIdentity.deviceId).toBe("desktop-cloud-1");
      expect(getLocalDesktopIdentity(database)?.deviceId).toBe("desktop-cloud-1");
      expect(database.prepare("SELECT COUNT(*) FROM devices").pluck().get()).toBe(1);
      const device = database
        .prepare("SELECT id, color FROM devices WHERE installation_id = ?")
        .get("install-1") as { id: string; color: string | null };
      expect(device).toEqual({ id: "desktop-cloud-1", color: "#2563eb" });
      expect(
        database
          .prepare("SELECT device_id FROM weighing_operations WHERE id = 'op-1'")
          .pluck()
          .get()
      ).toBe("desktop-cloud-1");
      expect(
        database
          .prepare("SELECT device_id FROM scale_configs WHERE id = 'scale-config-1'")
          .pluck()
          .get()
      ).toBe("desktop-cloud-1");
    } finally {
      database.close();
    }
  });
});

describe("ensureLocalDeviceRow", () => {
  it("nao mexe em nada quando a linha do dispositivo esta no lugar", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const identity = createIdentity(database);

      expect(ensureLocalDeviceRow(database, identity)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("recria a linha que sumiu, e a gravacao volta a ser aceita", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const identity = createIdentity(database);
      // O estado real da balanca parada: a identidade continua em
      // `local_settings`, mas o `devices` que ela aponta nao existe mais.
      database.prepare("DELETE FROM devices WHERE id = ?").run(identity.deviceId);

      // Sem reparo, QUALQUER gravacao que referencie devices(id) estoura --
      // e e exatamente a mensagem que chegou do operador.
      expect(() => insertOperationForDevice(database, identity)).toThrow(
        /FOREIGN KEY constraint failed/
      );

      expect(ensureLocalDeviceRow(database, identity)).toBe(true);

      expect(() => insertOperationForDevice(database, identity)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("renomeia a linha desta instalacao em vez de criar uma segunda", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const identity = createIdentity(database);

      // Ativacao que adotou o id da nuvem sem terminar o remapeamento: a linha
      // desta instalacao ficou com o id antigo, e o historico da maquina foi
      // gravado apontando para ele.
      database
        .prepare("UPDATE devices SET id = 'device-antigo' WHERE installation_id = ?")
        .run(identity.installationId);
      insertOperationForDevice(database, { ...identity, deviceId: "device-antigo" }, "op-antiga");

      expect(ensureLocalDeviceRow(database, identity)).toBe(true);

      // Uma linha so, com o id ativo -- e o historico da maquina foi junto,
      // em vez de ficar orfao apontando para o id antigo.
      expect(database.prepare("SELECT count(*) FROM devices").pluck().get()).toBe(1);
      expect(
        database
          .prepare("SELECT id FROM devices WHERE installation_id = ?")
          .pluck()
          .get(identity.installationId)
      ).toBe(identity.deviceId);
      expect(
        database
          .prepare("SELECT device_id FROM weighing_operations WHERE id = 'op-antiga'")
          .pluck()
          .get()
      ).toBe(identity.deviceId);
    } finally {
      database.close();
    }
  });
});

function createIdentity(database: ReturnType<typeof openDesktopDatabase>) {
  return ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
}

/** Uma gravacao qualquer que dependa de `devices(id)` -- a mesma FK do cupom. */
function insertOperationForDevice(
  database: ReturnType<typeof openDesktopDatabase>,
  identity: { companyId: string; unitId: string; deviceId: string },
  operationId = "op-nova"
) {
  database
    .prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'draft', 'invoice', ?, ?)`
    )
    .run(
      operationId,
      identity.companyId,
      identity.unitId,
      identity.deviceId,
      "2026-08-29T12:00:00.000Z",
      "2026-08-29T12:00:00.000Z"
    );
}
