import { Navigate } from "react-router-dom";

import "./admin-ui.css";
import { ADMIN_LOGIN_PATH, hasAdminSession } from "./lib/admin-session";
import { AdminDashboard } from "./pages/AdminDashboard";

/**
 * Painel da plataforma (console da Kybernan), em `/admin`: pedreiras, unidades, logins do site,
 * balancas e codigos de ativacao, atualizacoes do desktop, financeiro e assistente de IA.
 *
 * Veio inteiro do loader-web (as mesmas telas, as mesmas chamadas ao `admin-api` e ao
 * `admin-billing`) para o loader-web poder sair do ar. Mora em `src/admin/` e e um pedaco
 * separado do site: nem o carregador nem a pedreira baixam uma linha dele. O estilo e o do
 * console (`admin-ui.css`, tudo abaixo de `.adm`), que nao conversa com o `styles.css` do site.
 */
export function AdminPanel() {
  if (!hasAdminSession()) return <Navigate to={ADMIN_LOGIN_PATH} replace />;
  return <AdminDashboard />;
}
