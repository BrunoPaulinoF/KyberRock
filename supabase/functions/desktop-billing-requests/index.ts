/** Entrada Deno: liga `handler.ts` ao Supabase (chave de servico). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PostgrestLikeError } from "../_shared/db-read-error.ts";
import {
  handleBillingRequests,
  type BillingRequestRow,
  type BillingRequestStore,
  type DeviceRow
} from "./handler.ts";

function throwIf(error: { message: string; code?: string } | null): void {
  if (error) throw new Error(`billing_requests: ${error.message} (code=${error.code ?? "n/a"})`);
}

function supabaseStore(client: SupabaseClient): BillingRequestStore {
  return {
    async getDevice(deviceId) {
      const { data, error } = await client
        .from("device_registrations")
        .select("id, company_id, unit_id, token_hash, is_active")
        .eq("id", deviceId)
        .single();
      return {
        data: (data as DeviceRow | null) ?? null,
        error: error as PostgrestLikeError | null
      };
    },
    async listPending(unitId, limit) {
      const { data, error } = await client
        .from("billing_requests")
        .select("id, operation_id, status, claimed_at")
        .eq("unit_id", unitId)
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(limit);
      throwIf(error);
      return (data as BillingRequestRow[] | null) ?? [];
    },
    async listProcessing(unitId) {
      const { data, error } = await client
        .from("billing_requests")
        .select("id, operation_id, status, claimed_at")
        .eq("unit_id", unitId)
        .eq("status", "processing");
      throwIf(error);
      return (data as BillingRequestRow[] | null) ?? [];
    },
    async claim(ids, deviceId, nowIso) {
      const { data, error } = await client
        .from("billing_requests")
        .update({
          status: "processing",
          claimed_by_device_id: deviceId,
          claimed_at: nowIso,
          updated_at: nowIso
        })
        .in("id", ids)
        .eq("status", "pending")
        .select("id, operation_id, status, claimed_at");
      throwIf(error);
      return (data as BillingRequestRow[] | null) ?? [];
    },
    async release(ids, nowIso) {
      const { error } = await client
        .from("billing_requests")
        .update({
          status: "pending",
          claimed_by_device_id: null,
          claimed_at: null,
          updated_at: nowIso
        })
        .in("id", ids)
        .eq("status", "processing");
      throwIf(error);
    },
    async report(id, deviceId, outcome, nowIso) {
      const { error } = await client
        .from("billing_requests")
        .update({
          status: outcome.status,
          result_message: outcome.message,
          processed_at: nowIso,
          updated_at: nowIso
        })
        .eq("id", id)
        .eq("claimed_by_device_id", deviceId);
      throwIf(error);
    }
  };
}

Deno.serve((req) => {
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  return handleBillingRequests(req, { store: supabaseStore(client) });
});
