import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import {
  callAdminFunction,
  clearAdminSessionToken,
  getAdminSessionStatus,
  setAdminSessionToken
} from "./admin-api";

/** Onde o painel da plataforma mora no site. */
export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * Ha sessao do painel valida neste navegador? Token vencido e apagado aqui mesmo, para o
 * proximo carregamento nao tentar usa-lo.
 */
export function hasAdminSession(): boolean {
  const { token, isExpired } = getAdminSessionStatus();
  if (token && isExpired) clearAdminSessionToken();
  return Boolean(token) && !isExpired;
}

/** Confere usuario e senha da plataforma no `admin-auth` e guarda a sessao de 8 h. */
export async function loginAdmin(username: string, password: string): Promise<void> {
  const response = await callAdminFunction<{ token: string; username: string }>(
    "admin-auth",
    { username: username.trim(), password },
    null
  );
  setAdminSessionToken(response.token);
}

/**
 * Sair do painel: apaga a sessao e volta ao login dele. A sessao do site (Supabase Auth) fica
 * como esta — sao acessos diferentes.
 *
 * A identidade da funcao e estavel enquanto o endereco nao muda (o `navigate` do React Router so
 * muda com o caminho), e isso importa: o painel a usa como dependencia do carregamento dos
 * cadastros, e uma funcao nova a cada render recarregaria a lista sem parar.
 */
export function useAdminLogout(): () => Promise<void> {
  const navigate = useNavigate();
  return useCallback(async () => {
    clearAdminSessionToken();
    navigate(ADMIN_LOGIN_PATH, { replace: true });
  }, [navigate]);
}
