import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import type { BillingRequestClaim, BillingRequestOutcome } from "./billing-request-runner.js";
import { getCloudSettings, getFunctionErrorMessage, getSupabaseClient } from "./supabase-sync.js";

/**
 * A ponte com a Edge Function `desktop-billing-requests`: pegar os pedidos de faturamento do
 * site e devolver o resultado. Autentica como toda chamada da balanca (dispositivo + token).
 */

export async function claimCloudBillingRequests(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<BillingRequestClaim[]> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<{
    requests?: Array<{ id?: unknown; operationId?: unknown }>;
  }>("desktop-billing-requests", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, action: "claim" }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  return (data?.requests ?? [])
    .filter(
      (row): row is { id: string; operationId: string } =>
        typeof row?.id === "string" && typeof row?.operationId === "string"
    )
    .map((row) => ({ id: row.id, operationId: row.operationId }));
}

export async function reportCloudBillingRequests(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  outcomes: BillingRequestOutcome[]
): Promise<void> {
  if (outcomes.length === 0) return;
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("desktop-billing-requests", {
    body: {
      deviceId: settings.deviceId,
      deviceToken: settings.deviceToken,
      action: "report",
      results: outcomes
    }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}
