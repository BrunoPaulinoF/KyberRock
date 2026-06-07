import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  server: {
    host: "0.0.0.0",
    port: 5174
  }
});
