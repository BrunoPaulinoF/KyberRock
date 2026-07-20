import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Modulos puros das Edge Functions (sem imports Deno) usam o sufixo _test.ts;
    // os testes de omie-sync sao Deno (jsr:) e ficam fora do vitest.
    include: [
      "{apps,packages,functions}/**/*.test.{ts,tsx}",
      "supabase/functions/{_shared,daily-report-email,financial-report-email}/*_test.ts"
    ],
    passWithNoTests: false,
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_1234567890",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_1234567890"
    }
  }
});
