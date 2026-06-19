import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting } from "./local-settings";

describe("DesktopRuntime OMIE status", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports OMIE configured when cloud credentials are present", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      writeLocalSetting(database, "cloud_company_id", "company-1");
      writeLocalSetting(database, "cloud_unit_id", "unit-1");
      writeLocalSetting(database, "cloud_device_id", "device-1");
      writeLocalSetting(database, "cloud_device_token", "token-1");
      writeLocalSetting(database, "cloud_configured", true);

      expect(runtime.getOmieSyncStatus()).toMatchObject({
        configured: true,
        hasSyncedData: false,
        totalCustomers: 0,
        totalProducts: 0,
        totalPaymentTerms: 0
      });
    } finally {
      runtime.close();
    }
  });
});
