import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Cloud,
  Database,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  PlusCircle,
  Printer,
  ReceiptText,
  RefreshCw,
  Scale,
  Settings,
  Sun,
  Truck,
  UserSearch,
  Wallet
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";
import { ROLE_LABELS } from "../lib/permissions";
import { useTheme } from "../lib/theme";

/**
 * A casca do site: o mesmo menu lateral do KyberRock Desktop — mesmas secoes (Operacional e
 * Analise), mesmos nomes, mesma ordem e mesmos icones (`lucide-react`) —, com o rodape de
 * usuario, tema e a engrenagem de configuracoes. Fica de fora so o que nao existe no site
 * (Logs, Exportar e Restaurar mexem no banco local da balanca); o que o perfil nao pode usar
 * nem aparece.
 */
export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const roleLabel = ROLE_LABELS[user.role];
  const navigate = useNavigate();
  const location = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // O menu fecha ao trocar de tela, ao clicar fora e no Esc — como o do desktop.
  useEffect(() => setShowSettings(false), [location.pathname]);
  useEffect(() => {
    if (!showSettings) return undefined;
    function onPointer(event: MouseEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) setShowSettings(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setShowSettings(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showSettings]);

  function openSettings(tab: string) {
    setShowSettings(false);
    navigate(`/configuracoes/${tab}`);
  }

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
              className="icon-btn square"
              onClick={toggle}
              aria-label="Alternar tema"
              title={theme === "light" ? "Tema escuro" : "Tema claro"}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <div className="settings-menu" ref={settingsRef}>
              <button
                type="button"
                className={`icon-btn square${showSettings ? " active" : ""}`}
                onClick={() => setShowSettings((open) => !open)}
                aria-label="Configuracoes"
                aria-expanded={showSettings}
                title="Configuracoes"
              >
                <Settings size={17} />
              </button>
              {showSettings && (
                <div className="settings-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick={() => openSettings("balanca")}>
                    <Scale size={14} />
                    Balanca
                  </button>
                  <button type="button" role="menuitem" onClick={() => openSettings("impressao")}>
                    <Printer size={14} />
                    Impressao
                  </button>
                  <button type="button" role="menuitem" onClick={() => openSettings("cloud")}>
                    <Cloud size={14} />
                    Cloud
                  </button>
                  <div className="settings-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => window.location.reload()}
                    title="Carrega a versao mais nova do site"
                  >
                    <RefreshCw size={14} />
                    Atualizar site
                  </button>
                  <div className="settings-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setShowSettings(false);
                      void logout();
                    }}
                  >
                    <LogOut size={14} />
                    Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
