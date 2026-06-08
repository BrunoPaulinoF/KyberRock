import { supabaseConfig } from "../config/supabase-config";

const ADMIN_SESSION_KEY = "kyberrock_admin_session";

export interface AdminApiPayload {
  [key: string]: unknown;
}

export function getAdminSessionToken(): string | null {
  return localStorage.getItem(ADMIN_SESSION_KEY);
}

export function setAdminSessionToken(token: string): void {
  localStorage.setItem(ADMIN_SESSION_KEY, token);
}

export function clearAdminSessionToken(): void {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export async function callAdminFunction<TResponse>(
  functionName: "admin-auth" | "admin-api",
  body: unknown,
  sessionToken = getAdminSessionToken()
): Promise<TResponse> {
  const response = await fetch(`${supabaseConfig.url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseConfig.publishableKey,
      ...(sessionToken ? { "x-admin-session": sessionToken } : {})
    },
    body: JSON.stringify(body)
  });

  const data = (await response.json().catch(() => ({}))) as TResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Erro na API administrativa.");
  }
  return data;
}
