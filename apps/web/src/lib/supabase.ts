import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-env";

export { isSupabaseConfigured } from "./supabase-env";

if (!isSupabaseConfigured()) {
  console.error(
    "[KyberRock Web] Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no build (ver .env.example)."
  );
}

/** Cliente unico do site. Le com o login do usuario (RLS); grava so pela `web-api`. */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
