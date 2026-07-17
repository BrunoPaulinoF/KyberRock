import { createClient } from "@supabase/supabase-js";

import { supabaseConfig, isSupabaseConfigured } from "../config/supabase-config";

if (!isSupabaseConfigured()) {
  // Aviso alto e visivel no console em vez de falha silenciosa: sem VITE_SUPABASE_URL/
  // VITE_SUPABASE_PUBLISHABLE_KEY (ou SUPABASE_* no container), o app cai no projeto default
  // com uma chave invalida e as chamadas falham de forma obscura. assertSupabaseConfig ainda
  // bloqueia o login com uma mensagem clara.
  console.error(
    "[KyberRock] Supabase nao configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no build, ou SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no container Docker."
  );
}

export const supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

export const auth = supabase.auth as {
  getSession: () => Promise<{ data: { session: { user: { id: string } } | null } }>;
  onAuthStateChange: (callback: (event: string, session: { user: { id: string } } | null) => void) => { data: { subscription: { unsubscribe: () => void } } };
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ data: { user: { id: string } | null }; error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
};
