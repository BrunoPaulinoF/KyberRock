/*
 * Sessao e chamadas do painel da plataforma (console da Kybernan).
 *
 * Veio do loader-web junto com o painel. O login NAO e o do Supabase Auth dos usuarios do site:
 * e o usuario e a senha da plataforma (`KYBERROCK_ADMIN_USERNAME` / `_PASSWORD_HASH` nos secrets
 * das Edge Functions), conferidos pelo `admin-auth`, que devolve uma sessao assinada de 8 h. Ela
 * vai no header `x-admin-session` de toda chamada ao `admin-api` e ao `admin-billing`. As duas
 * sessoes convivem no mesmo navegador sem se misturar: sair de uma nao derruba a outra.
 */
import {
  edgeFunctionUrl,
  isSupabaseConfigured,
  SUPABASE_PUBLISHABLE_KEY
} from "../../lib/supabase-env";

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
    const payload = JSON.parse(
      atob(
        encodedPayload
          .replaceAll("-", "+")
          .replaceAll("_", "/")
          .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=")
      )
    ) as {
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
  functionName: "admin-auth" | "admin-api" | "admin-billing",
  body: unknown,
  sessionToken = getAdminSessionToken()
): Promise<TResponse> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Site sem configuracao do Supabase: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no build."
    );
  }

  if (functionName !== "admin-auth" && isTokenExpired(sessionToken)) {
    clearAdminSessionToken();
    throw new AdminSessionExpiredError();
  }

  const response = await fetch(edgeFunctionUrl(functionName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
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
