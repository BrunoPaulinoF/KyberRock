import { describe, expect, it } from "vitest";

import {
  assertSupabaseConfig,
  resolveKyberrockWebUrl,
  resolveSupabaseConfig
} from "./supabase-config";

describe("resolveKyberrockWebUrl", () => {
  it("prefere o container ao build e tira a barra do fim", () => {
    expect(
      resolveKyberrockWebUrl(
        { VITE_KYBERROCK_WEB_URL: "https://build.example.com" },
        { kyberrockWebUrl: "https://web.example.com/" }
      )
    ).toBe("https://web.example.com");
    expect(resolveKyberrockWebUrl({ VITE_KYBERROCK_WEB_URL: "https://build.example.com" })).toBe(
      "https://build.example.com"
    );
  });

  it("sem endereco, ou com endereco que nao e https, fica nulo", () => {
    expect(resolveKyberrockWebUrl({}, { kyberrockWebUrl: "  " })).toBeNull();
    expect(resolveKyberrockWebUrl({ VITE_KYBERROCK_WEB_URL: "javascript:alert(1)" })).toBeNull();
    expect(resolveKyberrockWebUrl({ VITE_KYBERROCK_WEB_URL: "http://site.com" })).toBeNull();
    expect(resolveKyberrockWebUrl({ VITE_KYBERROCK_WEB_URL: "http://localhost:5175" })).toBe(
      "http://localhost:5175"
    );
  });
});

describe("resolveSupabaseConfig", () => {
  it("prefers Docker runtime config over Vite env", () => {
    const config = resolveSupabaseConfig(
      {
        VITE_SUPABASE_URL: "https://build.example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "build-key"
      },
      {
        supabaseUrl: "https://runtime.example.supabase.co",
        supabasePublishableKey: "runtime-key"
      }
    );

    expect(config).toEqual({
      url: "https://runtime.example.supabase.co",
      publishableKey: "runtime-key"
    });
  });

  it("uses Vite env when runtime config is empty", () => {
    const config = resolveSupabaseConfig(
      {
        VITE_SUPABASE_URL: "https://build.example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "build-key"
      },
      {}
    );

    expect(config).toEqual({
      url: "https://build.example.supabase.co",
      publishableKey: "build-key"
    });
  });

  it("fails fast when the publishable key is missing", () => {
    const config = resolveSupabaseConfig({}, {});

    expect(() => assertSupabaseConfig(config)).toThrow("Supabase nao configurado");
  });
});
