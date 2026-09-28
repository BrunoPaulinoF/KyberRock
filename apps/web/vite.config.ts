import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Caminhos relativos: o build funciona na raiz do dominio e tambem dentro de uma subpasta.
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas mudam menos que as telas: em arquivo proprio, o celular reaproveita do cache
        // depois de uma atualizacao do site em vez de baixar tudo de novo.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("lucide-react")) return "icons";
          return "vendor";
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5175
  }
});
