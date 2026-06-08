import { createClient } from "@supabase/supabase-js";

import { supabaseConfig } from "../config/supabase-config";

export const supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});
