import { createClient } from "@supabase/supabase-js";

import { supabaseConfig } from "../config/supabase-config";

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
