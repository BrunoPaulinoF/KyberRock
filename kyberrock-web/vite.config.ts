import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: 5175 },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node"
  }
});
