/**
 * Contato comercial e links publicos da pagina de apresentacao (`/`).
 *
 * Veio do loader-web junto com a pagina. O numero do WhatsApp comercial e uma variavel de BUILD
 * (`VITE_WHATSAPP_NUMBER`, na Hostinger ao lado das do Supabase), no formato internacional so com
 * digitos (ex.: `5511999998888`). Sem ela vale o numero de exemplo — o mesmo que o loader-web
 * mostrava —, e a pagina nao exibe os digitos, so os botoes.
 */
import { publicAsset } from "./public-asset";
import { edgeFunctionUrl } from "./supabase-env";

/** Numero de exemplo: claramente falso de proposito, para ninguem confundir com um real. */
export const WHATSAPP_EXAMPLE_NUMBER = "5500000000000";

export const WHATSAPP_DEFAULT_MESSAGE =
  "Olá! Tenho uma pedreira e quero conhecer o KyberRock (pesagem, carregamento e faturamento).";

/** So os digitos; o que sobrar vazio (ou curto demais para ser telefone) nao vale. */
export function normalizeWhatsAppNumber(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

const configuredNumber = normalizeWhatsAppNumber(
  import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined
);

/** O numero que os botoes usam. */
export const WHATSAPP_NUMBER = configuredNumber ?? WHATSAPP_EXAMPLE_NUMBER;

/** Ha numero de verdade configurado no build? */
export const HAS_WHATSAPP_NUMBER = configuredNumber !== null;

export function buildWhatsAppLink(
  message: string = WHATSAPP_DEFAULT_MESSAGE,
  number: string = WHATSAPP_NUMBER
): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Numero para exibir: `+55 (11) 99999-8888`. Formato brasileiro so quando e um numero brasileiro
 * completo (55 + DDD + 8 ou 9 digitos); qualquer outro sai como `+<digitos>`.
 */
export function formatWhatsAppNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  if (!match) return `+${digits}`;
  return `+55 (${match[1]}) ${match[2]}-${match[3]}`;
}

/**
 * Link fixo do instalador do KyberRock Desktop: a Edge Function publica resolve o `.exe` da
 * versao de producao mais nova no GitHub e redireciona para o arquivo. (O site tambem responde
 * em `/download`, pelo `.htaccess`, para quem guardou o link antigo do loader-web.)
 */
export const DESKTOP_DOWNLOAD_URL = edgeFunctionUrl("desktop-download");

/** Guia de instalacao e manual de uso, em `public/`. */
export const GUIDE_PDF_FILE = "guia-kyberrock-instalacao-e-uso.pdf";
export const GUIDE_PDF_URL = publicAsset(GUIDE_PDF_FILE);
