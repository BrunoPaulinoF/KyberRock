const DEFAULT_SUPABASE_URL = "https://vksihzfrgqoemcqpquit.supabase.co";

let cachedUrl: string | null = null;
let cachedPublishableKey: string | null = null;

export const supabaseConfig = {
  get url(): string {
    if (cachedUrl !== null) return cachedUrl;
    const fromEnv = process.env.SUPABASE_URL?.trim();
    if (fromEnv) return fromEnv;
    return DEFAULT_SUPABASE_URL;
  },
  get publishableKey(): string {
    if (cachedPublishableKey !== null) return cachedPublishableKey;
    return process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  }
};

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseConfig.url && supabaseConfig.publishableKey);
}

export function assertSupabaseConfig(): void {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_PUBLISHABLE_KEY na pedreira no admin (loader-web) e reative o desktop."
    );
  }
}

export function setSupabaseConfigCache(url: string | null, publishableKey: string | null): void {
  cachedUrl = url && url.length > 0 ? url : null;
  cachedPublishableKey = publishableKey && publishableKey.length > 0 ? publishableKey : null;
}

export function resetSupabaseConfigCache(): void {
  cachedUrl = null;
  cachedPublishableKey = null;
}

export function getDefaultSupabaseUrl(): string {
  return DEFAULT_SUPABASE_URL;
}
