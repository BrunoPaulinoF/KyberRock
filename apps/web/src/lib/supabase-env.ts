/**
 * Projeto Supabase do site: endereco e chave publicavel, lidos do build (`VITE_SUPABASE_*`).
 *
 * Separado de `supabase.ts` (o cliente com o login do usuario) de proposito: quem fala direto
 * com uma Edge Function — o painel da plataforma, a pagina do link do WhatsApp, o link de
 * download do desktop — monta a URL daqui, sem passar pela sessao de ninguem.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && publishableKey);
}

export const SUPABASE_URL = url ?? "https://example.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = publishableKey ?? "sb_publishable_missing";

/** Endereco de uma Edge Function do projeto. */
export function edgeFunctionUrl(name: string, base: string = SUPABASE_URL): string {
  return `${base.trim().replace(/\/+$/, "")}/functions/v1/${name}`;
}
