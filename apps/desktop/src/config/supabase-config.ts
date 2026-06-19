export const supabaseConfig = {
  get url(): string {
    return process.env.SUPABASE_URL ?? "";
  },
  get publishableKey(): string {
    return process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  }
};

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseConfig.url && supabaseConfig.publishableKey);
}

export function assertSupabaseConfig(): void {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.");
  }
}
