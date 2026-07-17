import { assertSupabaseConfig, supabaseConfig } from "../config/supabase-config";

const ADMIN_SESSION_KEY = "kyberrock_admin_session";

/**
 * Erro lancado quando a sessao administrativa expirou ou foi rejeitada (401). Tipado para que a
 * UI possa distingui-lo de erros comuns e forcar logout/redirect em vez de renderizar o dashboard
 * com listas vazias e nenhuma indicacao de que a sessao caiu.
 */
export class AdminSessionExpiredError extends Error {
  constructor(message = "Sessao administrativa expirada. Faca login novamente.") {
    super(message);
    this.name = "AdminSessionExpiredError";
  }
}

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

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const [encodedPayload] = token.split(".");
    if (!encodedPayload) return true;
    const payload = JSON.parse(atob(encodedPayload.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encodedPayload.length / 4) * 4, "="))) as {
      exp?: number;
    };
    return !payload.exp || payload.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

export function getAdminSessionStatus(): { token: string | null; isExpired: boolean } {
  const token = getAdminSessionToken();
  return { token, isExpired: isTokenExpired(token) };
}

export async function callAdminFunction<TResponse>(
  functionName: "admin-auth" | "admin-api",
  body: unknown,
  sessionToken = getAdminSessionToken()
): Promise<TResponse> {
  assertSupabaseConfig();

  if (functionName === "admin-api" && isTokenExpired(sessionToken)) {
    clearAdminSessionToken();
    throw new AdminSessionExpiredError();
  }

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
    if (response.status === 401) {
      clearAdminSessionToken();
      throw new AdminSessionExpiredError(data.error || undefined);
    }
    throw new Error(data.error || "Erro na API administrativa.");
  }
  return data;
}
