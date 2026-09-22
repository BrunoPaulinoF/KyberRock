import {
  Building2,
  LogOut,
  Moon,
  ReceiptText,
  Sun,
  Tags,
  TrendingUp,
  Truck,
  Users,
  Wallet
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";
import { useTheme } from "../lib/theme";

/**
 * A casca do site: o mesmo menu lateral do KyberRock Desktop (secoes, icones, item ativo com
 * a barra ambar) e o rodape com usuario, tema e saida. Os icones sao os do desktop
 * (`lucide-react`), para a mesma tela ter o mesmo simbolo nos dois lugares.
 */
export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const roleLabel = user.role === "gestor" ? "Gestor" : "Comercial";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="./logo.png" alt="" className="sidebar-logo" />
          <span className="sidebar-brand">KyberRock</span>
          <span className="sidebar-meta">Web</span>
        </div>
        <nav className="sidebar-nav" aria-label="Navegacao principal">
          <div className="nav-section">Cadastro</div>
          <NavLink to="/clientes" className="nav-link">
            <Users size={16} strokeWidth={2.2} />
            Clientes
          </NavLink>
          <NavLink to="/veiculos" className="nav-link">
            <Truck size={16} strokeWidth={2.2} />
            Veiculos e motoristas
          </NavLink>
          <NavLink to="/transportadoras" className="nav-link">
            <Building2 size={16} strokeWidth={2.2} />
            Transportadoras
          </NavLink>
          {user.canManagePrices && (
            <NavLink to="/precos" className="nav-link">
              <Tags size={16} strokeWidth={2.2} />
              Precos
            </NavLink>
          )}
          <div className="nav-section">Financeiro</div>
          <NavLink to="/vendas" className="nav-link">
            <TrendingUp size={16} strokeWidth={2.2} />
            Relatorio de vendas
          </NavLink>
          {user.canManagePrices && (
            <>
              <NavLink to="/carteira" className="nav-link">
                <Wallet size={16} strokeWidth={2.2} />
                Carteira
              </NavLink>
              <NavLink to="/fechamento" className="nav-link">
                <ReceiptText size={16} strokeWidth={2.2} />
                Fechamento de faturas
              </NavLink>
            </>
          )}
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
