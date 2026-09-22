import { NavLink, Outlet } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          KyberRock
          <small>Comercial</small>
        </div>
        <div className="nav-section">Cadastro</div>
        <NavLink to="/clientes" className="nav-link">
          Clientes
        </NavLink>
        <NavLink to="/veiculos" className="nav-link">
          Veiculos e motoristas
        </NavLink>
        <NavLink to="/transportadoras" className="nav-link">
          Transportadoras
        </NavLink>
        {user.canManagePrices && (
          <NavLink to="/precos" className="nav-link">
            Precos
          </NavLink>
        )}
        <div className="nav-section">Financeiro</div>
        <NavLink to="/vendas" className="nav-link">
          Relatorio de vendas
        </NavLink>
        {user.canManagePrices && (
          <>
            <NavLink to="/carteira" className="nav-link">
              Carteira
            </NavLink>
            <NavLink to="/fechamento" className="nav-link">
              Fechamento de faturas
            </NavLink>
          </>
        )}
        <div className="sidebar-footer">
          <strong>{user.name}</strong>
          {user.role === "gestor" ? "Gestor" : "Comercial"}
          <div>
            <button className="btn link" style={{ color: "#9fb2c6" }} onClick={() => void logout()}>
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
