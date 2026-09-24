import { describe, expect, it } from "vitest";

import { assertSupabaseConfig, resolveSupabaseConfig } from "./supabase-config";

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
