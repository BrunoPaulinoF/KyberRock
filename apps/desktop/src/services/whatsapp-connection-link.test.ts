import { describe, expect, it } from "vitest";

import type { DesktopDatabase } from "../database/sqlite.js";
import { readWhatsappConnectionLink, writeWhatsappConnectionLink } from "./report-channels.js";
import {
  WHATSAPP_CONNECTION_LINK_SETTING_KEY,
  formatWhatsappConnectionLinkCountdown,
  isWhatsappConnectionLinkActive,
  parseWhatsappConnectionLink,
  whatsappConnectionLinkRemainingMs
} from "./whatsapp-connection-link.js";

const LINK = {
  id: "11111111-1111-1111-1111-111111111111",
  url: "https://projeto.supabase.co/functions/v1/whatsapp-link/c/token",
  createdAt: "2026-08-19T12:00:00.000Z",
  expiresAt: "2026-08-19T12:15:00.000Z"
};

/** local_settings em memoria, com a mesma forma que os servicos consultam. */
function fakeDatabase(): DesktopDatabase {
  const rows = new Map<string, string>();
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT value_json")) {
        return {
          get: (key: string) => {
            const value = rows.get(key);
            return value === undefined ? undefined : { value_json: value };
          }
        };
      }
      return {
        run: (key: string, valueJson: string) => {
          rows.set(key, valueJson);
        }
      };
    }
  } as unknown as DesktopDatabase;
}

describe("parseWhatsappConnectionLink", () => {
  it("accepts a complete record", () => {
    expect(parseWhatsappConnectionLink(LINK)).toEqual(LINK);
  });

  it("refuses a half-written record — a link without url or deadline cannot be shown", () => {
    expect(parseWhatsappConnectionLink(null)).toBeNull();
    expect(parseWhatsappConnectionLink({ ...LINK, url: "" })).toBeNull();
    expect(parseWhatsappConnectionLink({ ...LINK, expiresAt: undefined })).toBeNull();
    expect(parseWhatsappConnectionLink("https://exemplo")).toBeNull();
  });
});

describe("whatsappConnectionLinkRemainingMs", () => {
  it("counts down to the server deadline and stops at zero", () => {
    expect(whatsappConnectionLinkRemainingMs(LINK, new Date("2026-08-19T12:00:00Z"))).toBe(900_000);
    expect(whatsappConnectionLinkRemainingMs(LINK, new Date("2026-08-19T12:14:30Z"))).toBe(30_000);
    expect(whatsappConnectionLinkRemainingMs(LINK, new Date("2026-08-19T12:20:00Z"))).toBe(0);
  });

  it("treats an unreadable deadline as already over", () => {
    expect(whatsappConnectionLinkRemainingMs({ expiresAt: "ontem" })).toBe(0);
  });
});

describe("isWhatsappConnectionLinkActive", () => {
  it("dies exactly at the deadline", () => {
    expect(isWhatsappConnectionLinkActive(LINK, new Date("2026-08-19T12:14:59Z"))).toBe(true);
    expect(isWhatsappConnectionLinkActive(LINK, new Date("2026-08-19T12:15:00Z"))).toBe(false);
  });
});

describe("formatWhatsappConnectionLinkCountdown", () => {
  it("formats mm:ss", () => {
    expect(formatWhatsappConnectionLinkCountdown(900_000)).toBe("15:00");
    expect(formatWhatsappConnectionLinkCountdown(9_400)).toBe("00:10");
    expect(formatWhatsappConnectionLinkCountdown(0)).toBe("00:00");
  });
});

describe("readWhatsappConnectionLink", () => {
  it("returns the stored link while it is still valid", () => {
    const database = fakeDatabase();
    writeWhatsappConnectionLink(database, LINK);
    expect(readWhatsappConnectionLink(database, new Date("2026-08-19T12:10:00Z"))).toEqual(LINK);
  });

  it("hides an expired link instead of offering an address that no longer opens", () => {
    const database = fakeDatabase();
    writeWhatsappConnectionLink(database, LINK);
    expect(readWhatsappConnectionLink(database, new Date("2026-08-19T12:16:00Z"))).toBeNull();
  });

  it("returns null once the link is cleared", () => {
    const database = fakeDatabase();
    writeWhatsappConnectionLink(database, LINK);
    writeWhatsappConnectionLink(database, null);
    expect(readWhatsappConnectionLink(database, new Date("2026-08-19T12:01:00Z"))).toBeNull();
  });

  it("stores under a key of its own, outside the channel settings blob", () => {
    expect(WHATSAPP_CONNECTION_LINK_SETTING_KEY).toBe("whatsapp_connection_link");
  });
});
