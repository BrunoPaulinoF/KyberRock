import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,functions}/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_1234567890",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_1234567890"
    }
  }
});
