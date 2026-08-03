/**
 * Utilitarios de exclusao/criacao de usuarios do Auth usados pelo admin-api.
 *
 * O ponto central: `user_profiles` vive no Postgres e `auth.users` vive no schema do Auth, que
 * SQL comum (e as RPCs `delete_company`/`delete_unit`) nao alcanca. Toda exclusao que remove
 * perfis precisa remover as contas do Auth pela API admin, senao o e-mail continua ocupado e a
 * recriacao falha com "A user with this email address has already been registered".
 *
 * As funcoes aqui recebem gateways minimos em vez do cliente Supabase inteiro para poderem ser
 * testadas sem Deno nem rede.
 */

export interface AuthUserRef {
  id: string;
  email?: string | null;
}

export interface AuthUserGateway {
  deleteUser(userId: string): Promise<{ error: unknown }>;
  getUserById(userId: string): Promise<{ user: AuthUserRef | null; error: unknown }>;
}

/**
 * Exclui a conta do Auth e **confirma** o resultado antes de aceitar um erro como inofensivo.
 *
 * Tratar "404" ou "not found" como sucesso presumido esconde falha real: o perfil acabava
 * apagado enquanto a conta continuava viva no Auth. Aqui um erro so e ignorado quando a
 * consulta seguinte mostra que a conta realmente nao existe mais.
 */
export async function deleteAuthUser(gateway: AuthUserGateway, userId: string): Promise<void> {
  const deleted = await gateway.deleteUser(userId);
  if (!deleted.error) return;
  const existing = await gateway.getUserById(userId);
  if (existing.user) throw deleted.error;
}

export interface AuthUserListPage {
  users: AuthUserRef[];
}

/**
 * Procura o id de uma conta do Auth pelo e-mail. A API admin do Supabase nao expoe busca por
 * e-mail, entao paginamos ate encontrar (ou ate `maxPages`, para nao varrer bases enormes).
 */
export async function findAuthUserIdByEmail(
  listPage: (page: number) => Promise<AuthUserListPage>,
  email: string,
  maxPages = 20
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= maxPages; page++) {
    const { users } = await listPage(page);
    if (users.length === 0) return null;
    const match = users.find((user) => (user.email ?? "").trim().toLowerCase() === target);
    if (match) return match.id;
  }
  return null;
}

/** Erro do Auth quando o e-mail informado ja pertence a alguma conta. */
export function isEmailAlreadyRegisteredError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = String((error as { code?: unknown }).code ?? "");
  if (code === "email_exists") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /already\s+been\s+registered|email\s+address\s+has\s+already|already\s+exists/i.test(
    message
  );
}
