import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Caminhos relativos: o build funciona na raiz do dominio e tambem dentro de uma subpasta.
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5175
  }
});
