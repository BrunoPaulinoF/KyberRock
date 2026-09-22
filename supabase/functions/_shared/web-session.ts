/**
 * Quem esta falando com a `web-api`.
 *
 * O site web entra com o login do Supabase Auth (e-mail e senha, o mesmo do carregador) e
 * manda o token da sessao em `Authorization: Bearer ...`. A Edge Function roda com a chave de
 * servico — que passa por cima de qualquer RLS —, entao a PRIMEIRA coisa que ela faz e
 * descobrir quem e o usuario e de que empresa ele e. Tudo que a funcao grava depois recebe o
 * `company_id` daqui, nunca do payload: um usuario de uma pedreira nao grava cadastro em
 * outra, mesmo que mande outro id.
 *
 * Dois perfis entram: `comercial` e `gestor`. O carregador (`loader`) tem login valido mas nao
 * tem o que fazer aqui, e cai em 403 — nao em 401, que o site trataria como "faca login de
 * novo".
 */

import type { PostgrestLikeError } from "./db-read-error.ts";
import { isReadUnavailable } from "./db-read-error.ts";

export const WEB_ROLES = ["comercial", "gestor"] as const;
export type WebRole = (typeof WEB_ROLES)[number];

export interface WebSession {
  userId: string;
  email: string;
  name: string;
  role: WebRole;
  companyId: string;
  unitId: string;
}

/** O minimo do cliente Supabase que a resolucao da sessao usa (facil de simular em teste). */
export interface WebSessionClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message: string } | null;
    }>;
  };
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): { maybeSingle(): Promise<{ data: unknown; error: PostgrestLikeError | null }> };
    };
  };
}

export type WebSessionResult =
  | { ok: true; session: WebSession }
  | { ok: false; status: number; error: string };

/** Extrai o token de um cabecalho `Authorization: Bearer <token>`. */
export function bearerToken(authorization: string | null | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((authorization ?? "").trim());
  const token = match?.[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

export function isWebRole(value: unknown): value is WebRole {
  return typeof value === "string" && (WEB_ROLES as readonly string[]).includes(value);
}

/** So o gestor mexe em preco e no bloco comercial/credito do cliente. */
export function canManagePrices(role: WebRole): boolean {
  return role === "gestor";
}

type ProfileRow = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  role?: unknown;
  company_id?: unknown;
  unit_id?: unknown;
  is_active?: unknown;
};

export async function resolveWebSession(
  client: WebSessionClient,
  authorization: string | null | undefined
): Promise<WebSessionResult> {
  const jwt = bearerToken(authorization);
  if (!jwt) return { ok: false, status: 401, error: "Faca login para continuar." };

  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Sessao invalida ou expirada. Faca login de novo." };
  }

  const profile = await client
    .from("user_profiles")
    .select("id, email, name, role, company_id, unit_id, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  // Ver `_shared/db-read-error.ts`: banco fora do ar nao pode virar "usuario sem acesso".
  if (profile.error && isReadUnavailable(profile.error)) {
    return { ok: false, status: 503, error: "Cadastro de usuarios indisponivel no momento." };
  }
  const row = (profile.error ? null : profile.data) as ProfileRow | null;
  if (!row || row.is_active !== true) {
    return { ok: false, status: 403, error: "Usuario inativo ou sem perfil de acesso." };
  }
  if (!isWebRole(row.role)) {
    return {
      ok: false,
      status: 403,
      error: "Este acesso e so para usuarios comerciais e gestores."
    };
  }
  if (typeof row.company_id !== "string" || typeof row.unit_id !== "string") {
    return { ok: false, status: 403, error: "Usuario sem empresa vinculada." };
  }

  return {
    ok: true,
    session: {
      userId: data.user.id,
      email: typeof row.email === "string" ? row.email : (data.user.email ?? ""),
      name: typeof row.name === "string" ? row.name : "",
      role: row.role,
      companyId: row.company_id,
      unitId: row.unit_id
    }
  };
}
