export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || "https://vksihzfrgqoemcqpquit.supabase.co",
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "missing-publishable-key"
};

export function assertSupabaseConfig(): void {
  if (!supabaseConfig.url || !supabaseConfig.publishableKey || supabaseConfig.publishableKey === "missing-publishable-key") {
    throw new Error("Supabase nao configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
}
