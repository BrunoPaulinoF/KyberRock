import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { getCloudSettings, getFunctionErrorMessage, getSupabaseClient } from "./supabase-sync.js";
import {
  parseWebOperationClaims,
  type WebOperationClaim,
  type WebOperationOutcome
} from "./web-operation-requests.js";

/**
 * A ponte com a Edge Function `desktop-operation-requests`: pegar os pedidos de pesagem do
 * site e devolver o resultado. Autentica como toda chamada da balanca (dispositivo + token).
 */

export async function claimCloudWebOperationRequests(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ executor: boolean; claims: WebOperationClaim[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<{
    executor?: unknown;
    requests?: unknown;
  }>("desktop-operation-requests", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, action: "claim" }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  return {
    executor: data?.executor === true,
    claims: parseWebOperationClaims(data?.requests)
  };
}

export async function reportCloudWebOperationRequests(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  outcomes: WebOperationOutcome[]
): Promise<void> {
  if (outcomes.length === 0) return;
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("desktop-operation-requests", {
    body: {
      deviceId: settings.deviceId,
      deviceToken: settings.deviceToken,
      action: "report",
      results: outcomes
    }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}
