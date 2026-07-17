const DEFAULT_SUPABASE_URL = "https://vksihzfrgqoemcqpquit.supabase.co";
const MISSING_PUBLISHABLE_KEY = "missing-publishable-key";

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

interface SupabaseConfigEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface LoaderRuntimeConfig {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

declare global {
  interface Window {
    __KYBERROCK_LOADER_CONFIG__?: LoaderRuntimeConfig;
  }
}

function getRuntimeConfig(): LoaderRuntimeConfig | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__KYBERROCK_LOADER_CONFIG__;
}

function normalizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveSupabaseConfig(
  env: SupabaseConfigEnv,
  runtimeConfig?: LoaderRuntimeConfig
): SupabaseConfig {
  return {
    url:
      normalizeConfigValue(runtimeConfig?.supabaseUrl) ??
      normalizeConfigValue(env.VITE_SUPABASE_URL) ??
      DEFAULT_SUPABASE_URL,
    publishableKey:
      normalizeConfigValue(runtimeConfig?.supabasePublishableKey) ??
      normalizeConfigValue(env.VITE_SUPABASE_PUBLISHABLE_KEY) ??
      MISSING_PUBLISHABLE_KEY
  };
}

export const supabaseConfig = resolveSupabaseConfig(import.meta.env, getRuntimeConfig());

/**
 * True quando a URL e a publishable key estao realmente configuradas (nao os placeholders/
 * sentinelas de fallback). Usado para avisar cedo e claramente quando o container/build subiu
 * sem as variaveis de ambiente, em vez de deixar o app apontar em silencio para o projeto
 * default com uma chave invalida e falhar de formas obscuras depois.
 */
export function isSupabaseConfigured(config: SupabaseConfig = supabaseConfig): boolean {
  return Boolean(
    config.url &&
      config.publishableKey &&
      config.publishableKey !== MISSING_PUBLISHABLE_KEY &&
      config.publishableKey !== "your_publishable_key_here"
  );
}

export function assertSupabaseConfig(config: SupabaseConfig = supabaseConfig): void {
  if (!isSupabaseConfigured(config)) {
    throw new Error(
      "Supabase nao configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no build, ou SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no container Docker."
    );
  }
}
