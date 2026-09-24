import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Database,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  PlusCircle,
  ReceiptText,
  Sun,
  Truck,
  UserSearch,
  Wallet
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";
import { ROLE_LABELS } from "../lib/permissions";
import { useTheme } from "../lib/theme";

/**
 * A casca do site: o mesmo menu lateral do KyberRock Desktop — mesmas secoes (Operacional e
 * Analise), mesmos nomes, mesma ordem e mesmos icones (`lucide-react`) —, com o rodape de
 * usuario, tema e saida. Fica de fora so o que nao existe no site; o que o perfil nao pode
 * usar nem aparece.
 */
export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const roleLabel = ROLE_LABELS[user.role];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="./logo.png" alt="" className="sidebar-logo" />
          <span className="sidebar-brand">KyberRock</span>
          <span className="sidebar-meta">Web</span>
        </div>
        <nav className="sidebar-nav" aria-label="Navegacao principal">
          <div className="nav-section">Operacional</div>
          <NavLink to="/painel" className="nav-link">
            <LayoutDashboard size={16} strokeWidth={2.2} />
            Painel
          </NavLink>
          {user.canOperate && (
            <NavLink to="/nova-entrada" className="nav-link">
              <PlusCircle size={16} strokeWidth={2.2} />
              Nova entrada
            </NavLink>
          )}
          <NavLink to="/operacoes" className="nav-link">
            <ListChecks size={16} strokeWidth={2.2} />
            Operacoes
          </NavLink>
          {user.canManagePrices && (
            <NavLink to="/carteira" className="nav-link">
              <Wallet size={16} strokeWidth={2.2} />
              Carteira
            </NavLink>
          )}
          <NavLink to="/cadastros" className="nav-link">
            <Database size={16} strokeWidth={2.2} />
            Cadastros
          </NavLink>
          <div className="nav-section">Analise</div>
          <NavLink to="/insights" className="nav-link">
            <BarChart3 size={16} strokeWidth={2.2} />
            Insights
          </NavLink>
          <NavLink to="/controle-caminhoes" className="nav-link">
            <Truck size={16} strokeWidth={2.2} />
            Controle de caminhoes
          </NavLink>
          <NavLink to="/relatorio-cliente" className="nav-link">
            <UserSearch size={16} strokeWidth={2.2} />
            Relatorio por cliente
          </NavLink>
          <NavLink to="/conferencia-faturamento" className="nav-link">
            <ClipboardCheck size={16} strokeWidth={2.2} />
            Conferencia de faturamento
          </NavLink>
          {user.canManagePrices && (
            <NavLink to="/fechamento" className="nav-link">
              <ReceiptText size={16} strokeWidth={2.2} />
              Fechamento de faturas
            </NavLink>
          )}
          <NavLink to="/relatorios" className="nav-link">
            <FileText size={16} strokeWidth={2.2} />
            Relatorios
          </NavLink>
          <NavLink to="/documentacao" className="nav-link">
            <BookOpen size={16} strokeWidth={2.2} />
            Documentacao
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <strong title={user.email}>{user.name}</strong>
            {roleLabel}
          </div>
          <div className="sidebar-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={toggle}
              aria-label="Alternar tema"
              title={theme === "light" ? "Tema escuro" : "Tema claro"}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
              {theme === "light" ? "Escuro" : "Claro"}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void logout()}
              title="Sair da conta"
            >
              <LogOut size={17} />
              Sair
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
