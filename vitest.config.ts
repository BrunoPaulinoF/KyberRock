import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,functions}/**/*.test.{ts,tsx}"],
    passWithNoTests: false
  }
});
