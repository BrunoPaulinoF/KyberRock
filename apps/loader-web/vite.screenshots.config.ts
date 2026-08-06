import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Config usada apenas para gerar as capturas de tela de documentacao: troca o cliente
 * Supabase real pelo mock de `screenshots/supabase-mock.ts`, para as telas renderizarem
 * com dados ficticios e sem rede.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^(.*\/)?lib\/supabase$/,
        replacement: fileURLToPath(new URL("./screenshots/supabase-mock.ts", import.meta.url))
      }
    ]
  },
  server: {
    host: "127.0.0.1",
    port: 5198
  }
});
