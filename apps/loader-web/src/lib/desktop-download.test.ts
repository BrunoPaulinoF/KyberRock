import { describe, expect, it } from "vitest";

import { resolveDesktopDownloadUrl } from "./desktop-download";

describe("resolveDesktopDownloadUrl", () => {
  it("points to the public desktop-download edge function", () => {
    expect(resolveDesktopDownloadUrl("https://example.supabase.co")).toBe(
      "https://example.supabase.co/functions/v1/desktop-download"
    );
  });

  it("does not duplicate slashes when the base url has a trailing slash", () => {
    expect(resolveDesktopDownloadUrl("https://example.supabase.co/")).toBe(
      "https://example.supabase.co/functions/v1/desktop-download"
    );
  });
});
