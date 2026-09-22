import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && publishableKey);
}

if (!isSupabaseConfigured()) {
  console.error(
    "[KyberRock Web] Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no build (ver .env.example)."
  );
}

/** Cliente unico do site. Le com o login do usuario (RLS); grava so pela `web-api`. */
export const supabase = createClient<Database>(
  url ?? "https://example.supabase.co",
  publishableKey ?? "sb_publishable_missing",
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
