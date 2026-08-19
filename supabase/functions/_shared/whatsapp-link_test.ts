import { describe, expect, it } from "vitest";

import {
  WHATSAPP_LINK_TTL_MINUTES,
  buildWhatsappLinkUrl,
  formatWhatsappLinkCountdown,
  generateWhatsappLinkToken,
  isWhatsappLinkToken,
  normalizeQrCodeDataUrl,
  routeWhatsappLinkPath,
  whatsappLinkExpiresAt,
  whatsappLinkRemainingMs,
  whatsappLinkState
} from "./whatsapp-link.ts";

const CREATED_AT = new Date("2026-08-19T12:00:00.000Z");

describe("whatsappLinkExpiresAt", () => {
  it("expires fifteen minutes after creation", () => {
    expect(WHATSAPP_LINK_TTL_MINUTES).toBe(15);
    expect(whatsappLinkExpiresAt(CREATED_AT)).toBe("2026-08-19T12:15:00.000Z");
  });
});

describe("whatsappLinkState", () => {
  const expiresAt = whatsappLinkExpiresAt(CREATED_AT);

  it("stays active until the deadline", () => {
    expect(whatsappLinkState({ expires_at: expiresAt }, new Date("2026-08-19T12:14:59Z"))).toBe(
      "active"
    );
  });

  it("expires exactly at the deadline", () => {
    expect(whatsappLinkState({ expires_at: expiresAt }, new Date("2026-08-19T12:15:00Z"))).toBe(
      "expired"
    );
  });

  it("reports connected even after the deadline — the pairing worked", () => {
    expect(
      whatsappLinkState(
        { expires_at: expiresAt, connected_at: "2026-08-19T12:05:00Z" },
        new Date("2026-08-19T13:00:00Z")
      )
    ).toBe("connected");
  });

  it("prefers revoked over expired so the page can name the real reason", () => {
    expect(
      whatsappLinkState(
        { expires_at: expiresAt, revoked_at: "2026-08-19T12:03:00Z" },
        new Date("2026-08-19T13:00:00Z")
      )
    ).toBe("revoked");
  });

  it("treats an unreadable deadline as expired", () => {
    expect(whatsappLinkState({ expires_at: "nao e data" }, CREATED_AT)).toBe("expired");
  });
});

describe("whatsappLinkRemainingMs", () => {
  it("never goes negative", () => {
    const expiresAt = whatsappLinkExpiresAt(CREATED_AT);
    expect(whatsappLinkRemainingMs(expiresAt, new Date("2026-08-19T12:14:00Z"))).toBe(60_000);
    expect(whatsappLinkRemainingMs(expiresAt, new Date("2026-08-19T13:00:00Z"))).toBe(0);
    expect(whatsappLinkRemainingMs(null, CREATED_AT)).toBe(0);
  });
});

describe("formatWhatsappLinkCountdown", () => {
  it("formats mm:ss and rounds the partial second up", () => {
    expect(formatWhatsappLinkCountdown(15 * 60_000)).toBe("15:00");
    expect(formatWhatsappLinkCountdown(61_200)).toBe("01:02");
    expect(formatWhatsappLinkCountdown(0)).toBe("00:00");
    expect(formatWhatsappLinkCountdown(-5_000)).toBe("00:00");
  });
});

describe("generateWhatsappLinkToken", () => {
  it("produces url-safe tokens that pass the shape check", () => {
    const token = generateWhatsappLinkToken();
    expect(isWhatsappLinkToken(token)).toBe(true);
    expect(token).toBe(encodeURIComponent(token));
  });

  it("does not repeat itself", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateWhatsappLinkToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("isWhatsappLinkToken", () => {
  it("rejects anything that is not a token, before touching the database", () => {
    expect(isWhatsappLinkToken("")).toBe(false);
    expect(isWhatsappLinkToken("abc")).toBe(false);
    expect(isWhatsappLinkToken(`${generateWhatsappLinkToken()}x`)).toBe(false);
    expect(isWhatsappLinkToken(null)).toBe(false);
  });
});

describe("buildWhatsappLinkUrl", () => {
  it("builds the public address on the project domain", () => {
    expect(buildWhatsappLinkUrl("https://projeto.supabase.co", "tok")).toBe(
      "https://projeto.supabase.co/functions/v1/whatsapp-link/c/tok"
    );
  });

  it("tolerates a trailing slash in the configured url", () => {
    expect(buildWhatsappLinkUrl("https://projeto.supabase.co/", "tok")).toBe(
      "https://projeto.supabase.co/functions/v1/whatsapp-link/c/tok"
    );
  });
});

describe("routeWhatsappLinkPath", () => {
  const token = generateWhatsappLinkToken();

  it("routes the deployed and the locally served prefixes the same way", () => {
    expect(routeWhatsappLinkPath("/functions/v1/whatsapp-link")).toEqual({
      kind: "api",
      token: null
    });
    expect(routeWhatsappLinkPath("/whatsapp-link/")).toEqual({ kind: "api", token: null });
    expect(routeWhatsappLinkPath(`/functions/v1/whatsapp-link/c/${token}`)).toEqual({
      kind: "page",
      token
    });
    expect(routeWhatsappLinkPath(`/whatsapp-link/c/${token}/state`)).toEqual({
      kind: "state",
      token
    });
  });

  it("refuses paths that do not carry a well formed token", () => {
    expect(routeWhatsappLinkPath("/whatsapp-link/c/abc")).toEqual({ kind: "unknown", token: null });
    expect(routeWhatsappLinkPath(`/whatsapp-link/c/${token}/qualquer`)).toEqual({
      kind: "unknown",
      token: null
    });
    expect(routeWhatsappLinkPath("/whatsapp-link/admin")).toEqual({ kind: "unknown", token: null });
  });
});

describe("normalizeQrCodeDataUrl", () => {
  it("keeps a data url and prefixes a bare base64 payload", () => {
    expect(normalizeQrCodeDataUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(normalizeQrCodeDataUrl("AAA")).toBe("data:image/png;base64,AAA");
    expect(normalizeQrCodeDataUrl("  ")).toBeNull();
    expect(normalizeQrCodeDataUrl(null)).toBeNull();
  });
});
