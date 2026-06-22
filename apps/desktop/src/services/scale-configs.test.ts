import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import {
  readScaleConfiguration,
  writeScaleConfiguration,
  DEFAULT_SCALE_CONNECTION_CONFIG,
  DEFAULT_SCALE_STABILITY_CONFIG
} from "./scale-configs";

describe("scale-configs", () => {
  it("returns defaults when the device has no saved scale config", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const identity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });

      expect(readScaleConfiguration(database, identity)).toMatchObject({
        id: null,
        adapterType: "tcp",
        connection: DEFAULT_SCALE_CONNECTION_CONFIG,
        stability: DEFAULT_SCALE_STABILITY_CONFIG
      });
    } finally {
      database.close();
    }
  });

  it("persists normalized connection and stability settings", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const identity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });

      const saved = writeScaleConfiguration(
        database,
        identity,
        {
          connection: {
            host: " 10.0.0.50 ",
            port: 4002,
            autoConnect: true
          },
          stability: {
            sampleDurationMs: 8000,
            sampleIntervalMs: 200,
            requireStable: true,
            minStableMs: 2000,
            maxVariationKg: 75,
            minWeightKg: 1500
          }
        },
        new Date("2026-06-22T10:00:00.000Z")
      );

      expect(saved.id).toEqual(expect.any(String));
      expect(readScaleConfiguration(database, identity)).toMatchObject({
        id: saved.id,
        connection: {
          host: "10.0.0.50",
          port: 4002,
          autoConnect: true
        },
        stability: {
          sampleDurationMs: 8000,
          sampleIntervalMs: 200,
          requireStable: true,
          minStableMs: 2000,
          maxVariationKg: 75,
          minWeightKg: 1500
        }
      });
    } finally {
      database.close();
    }
  });
});
