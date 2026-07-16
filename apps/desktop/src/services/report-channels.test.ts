import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  EMPTY_REPORT_CHANNEL_SETTINGS,
  normalizeUazapiBaseUrl,
  readReportChannelSettings,
  toCloudChannelSettingsRow,
  writeReportChannelSettings
} from "./report-channels";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  return db;
}

describe("report channel settings", () => {
  it("returns defaults when nothing is stored", () => {
    const db = createDatabase();
    try {
      expect(readReportChannelSettings(db)).toEqual(EMPTY_REPORT_CHANNEL_SETTINGS);
    } finally {
      db.close();
    }
  });

  it("persists partial patches and merges with defaults", () => {
    const db = createDatabase();
    try {
      writeReportChannelSettings(db, { smtpHost: "smtp.gmail.com", smtpUser: "a@b.com" });
      writeReportChannelSettings(db, {
        uazapiBaseUrl: "https://x.uazapi.com",
        uazapiInstanceToken: "tok-1",
        uazapiStatus: "connected"
      });

      const settings = readReportChannelSettings(db);
      expect(settings.smtpHost).toBe("smtp.gmail.com");
      expect(settings.smtpUser).toBe("a@b.com");
      expect(settings.smtpPort).toBe(587);
      expect(settings.uazapiInstanceToken).toBe("tok-1");
      expect(settings.uazapiStatus).toBe("connected");
      expect(settings.updatedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("maps to the cloud row with the instance token", () => {
    const row = toCloudChannelSettingsRow("comp-1", {
      ...EMPTY_REPORT_CHANNEL_SETTINGS,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "a@b.com",
      smtpPassword: "secret",
      uazapiBaseUrl: "https://x.uazapi.com",
      uazapiInstanceToken: "tok-1",
      uazapiInstanceName: "kyberrock-abc",
      uazapiStatus: "connected"
    });

    expect(row["company_id"]).toBe("comp-1");
    expect(row["smtp_host"]).toBe("smtp.gmail.com");
    expect(row["smtp_sender"]).toBe("a@b.com");
    expect(row["whatsapp_url"]).toBe("https://x.uazapi.com");
    expect(row["whatsapp_instance_token"]).toBe("tok-1");
    expect(row["whatsapp_instance_name"]).toBe("kyberrock-abc");
    expect(row["whatsapp_status"]).toBe("connected");
  });

  it("stores empty optional fields as null in the cloud row", () => {
    const row = toCloudChannelSettingsRow("comp-1", EMPTY_REPORT_CHANNEL_SETTINGS);
    expect(row["smtp_host"]).toBeNull();
    expect(row["whatsapp_url"]).toBeNull();
    expect(row["whatsapp_instance_token"]).toBeNull();
  });
});

describe("normalizeUazapiBaseUrl", () => {
  it("adds https and strips trailing slashes", () => {
    expect(normalizeUazapiBaseUrl("minha.uazapi.com/")).toBe("https://minha.uazapi.com");
    expect(normalizeUazapiBaseUrl("https://minha.uazapi.com///")).toBe("https://minha.uazapi.com");
    expect(normalizeUazapiBaseUrl("http://localhost:3333")).toBe("http://localhost:3333");
    expect(normalizeUazapiBaseUrl("  ")).toBe("");
  });
});
