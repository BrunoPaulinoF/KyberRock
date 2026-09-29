/**
 * Endereco de um arquivo de `public/` (logo, PDF do guia, service worker).
 *
 * Nunca `./logo.png` solto numa tela: relativo ao ENDERECO da pagina, ele vira
 * `/cadastros/logo.png` em `/cadastros/clientes` e `/whatsapp/logo.png` no link do WhatsApp — o
 * servidor devolve o `index.html` no lugar da imagem e ela some. O `BASE_URL` e a raiz do site
 * no build normal (`/`) e `./` no build com `VITE_ROUTER=hash`, em que a pagina fica sempre na
 * pasta de publicacao (`vite.config.ts`).
 */
export function publicAsset(file: string): string {
  return `${import.meta.env.BASE_URL}${file.replace(/^\/+/, "")}`;
}
