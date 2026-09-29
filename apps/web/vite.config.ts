import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hashRouter = env.VITE_ROUTER === "hash";
  return {
    plugins: [react()],
    /*
     * Na Hostinger (rotas de verdade, `.htaccess` devolvendo o `index.html`) os arquivos saem da
     * RAIZ: com caminho relativo, abrir direto um endereco de dois niveis — `/cadastros/clientes`
     * no F5, `/admin/login`, o link `/whatsapp/<token>` que chega por mensagem — pedia
     * `/cadastros/assets/...`, recebia o `index.html` no lugar do script e a tela ficava em
     * branco. O build com `VITE_ROUTER=hash` (previa numa pasta dentro de outro site) continua
     * relativo: ali o endereco da pagina e sempre a propria pasta, e o caminho relativo e o que
     * faz o build funcionar fora da raiz do dominio.
     */
    base: hashRouter ? "./" : "/",
    build: {
      rollupOptions: {
        output: {
          // Bibliotecas mudam menos que as telas: em arquivo proprio, o celular reaproveita do
          // cache depois de uma atualizacao do site em vez de baixar tudo de novo.
          manualChunks(id: string) {
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
  };
});
