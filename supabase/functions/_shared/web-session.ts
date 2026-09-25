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
 * Cinco perfis entram (migracoes `202609240001` e `202609260001`). Cada um ve um conjunto
 * fechado de telas (`apps/web/src/lib/permissions.ts`); aqui mora o que cada um GRAVA:
 *
 *   - `monitoramento` so consulta (a tela dele e o painel de vendas em tempo real);
 *   - `comercial`     todo o CADASTRO (cliente, bloco comercial, frota e preco), sem senha de
 *                     preco; nao pesa, nao mexe em carteira, fechamento nem destinatarios;
 *   - `gestor`        tudo, menos a Nova entrada (fecha, altera, cancela e reimprime);
 *   - `operacao`      tudo, e mudanca de preco SEMPRE pede a senha da pedreira;
 *   - `administrador` tudo, sem senha nenhuma, mais os logs de suporte.
 *
 * O carregador (`loader`) tem login valido mas nao tem o que fazer aqui — a tela dele le a fila
 * direto, por RLS —, e cai em 403, nao em 401, que o site trataria como "faca login de novo".
 */

import type { PostgrestLikeError } from "./db-read-error.ts";
import { isReadUnavailable } from "./db-read-error.ts";

export const WEB_ROLES = [
  "monitoramento",
  "comercial",
  "gestor",
  "operacao",
  "administrador"
] as const;
export type WebRole = (typeof WEB_ROLES)[number];

/** Nome do perfil para mensagem ao usuario. */
export const WEB_ROLE_LABELS: Record<WebRole, string> = {
  monitoramento: "Monitoramento",
  comercial: "Comercial",
  gestor: "Gestor",
  operacao: "Operacao",
  administrador: "Administrador"
};

export interface WebSession {
  userId: string;
  email: string;
  name: string;
  role: WebRole;
  companyId: string;
  unitId: string;
  /**
   * Pede a senha de preco da pedreira para mudar preco (da pesagem e do cadastro). Ja resolvido
   * pelo perfil: ver `requiresPricePasswordFor`.
   */
  requiresPricePassword: boolean;
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

/** Todo perfil menos o monitoramento grava alguma coisa pelo site. */
export function canWrite(role: WebRole): boolean {
  return role !== "monitoramento";
}

/** Gestor, operacao e administrador: pesagem, carteira, fechamento e destinatarios. */
function runsTheQuarry(role: WebRole): boolean {
  return role === "gestor" || role === "operacao" || role === "administrador";
}

/**
 * Carteira, fechamento de faturas e destinatarios dos relatorios. O nome ficou da epoca em que
 * isso era so do gestor.
 */
export function canManagePrices(role: WebRole): boolean {
  return runsTheQuarry(role);
}

/** Preco (padrao, especial por cliente e tabelas de preco): tambem o comercial. */
export function canEditPrices(role: WebRole): boolean {
  return canWrite(role);
}

/** Cadastro de cliente (sobe ao OMIE) e o bloco comercial/credito dele: tambem o comercial. */
export function canEditCustomers(role: WebRole): boolean {
  return canWrite(role);
}

/**
 * Pesagem que ja existe pelo site (saida, alterar, cancelar, reimprimir). Quem executa e a
 * balanca da unidade — o site so pede (`operation_requests`).
 */
export function canOperate(role: WebRole): boolean {
  return runsTheQuarry(role);
}

/** Nova entrada pelo site: o gestor faz tudo MENOS isto. */
export function canCreateEntry(role: WebRole): boolean {
  return role === "operacao" || role === "administrador";
}

/** Veiculo, motorista e transportadora. */
export function canEditFleet(role: WebRole): boolean {
  return canWrite(role);
}

/** Logs de suporte (saude das balancas, pedidos que falharam, envios parados): administrador. */
export function canSeeSupport(role: WebRole): boolean {
  return role === "administrador";
}

/**
 * Quem digita a senha de alteracao de preco da pedreira: a `operacao` sempre, o `administrador`
 * e o `comercial` nunca (negociar preco e o trabalho do comercial), e o gestor conforme a marca do
 * login no painel (`requires_price_password`).
 */
export function requiresPricePasswordFor(role: WebRole, flagged: boolean): boolean {
  if (role === "administrador" || role === "comercial") return false;
  if (role === "operacao") return true;
  return flagged;
}

type ProfileRow = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  role?: unknown;
  company_id?: unknown;
  unit_id?: unknown;
  is_active?: unknown;
  requires_price_password?: unknown;
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
    // `*` e nao a lista: coluna nova (ex.: `requires_price_password`) com a migracao ainda
    // pendente nao pode derrubar o login de todo mundo.
    .select("*")
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
      error: "Este perfil de acesso nao usa o cadastro do site."
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
      unitId: row.unit_id,
      requiresPricePassword: requiresPricePasswordFor(
        row.role,
        row.requires_price_password === true
      )
    }
  };
}
