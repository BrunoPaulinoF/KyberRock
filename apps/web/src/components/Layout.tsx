import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Cloud,
  Database,
  FileText,
  Handshake,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MonitorPlay,
  Moon,
  PlusCircle,
  Printer,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  Sun,
  Truck,
  UserSearch,
  Wallet
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

import { useAuth, useUser } from "../lib/auth";
import { canSee, ROLE_LABELS, type Screen } from "../lib/permissions";
import { useTheme } from "../lib/theme";

/**
 * A casca do site: o mesmo menu lateral do KyberRock Desktop — mesmas secoes (Operacional e
 * Analise), mesmos nomes, mesma ordem e mesmos icones (`lucide-react`) —, com o rodape de
 * usuario, tema e a engrenagem de configuracoes. Fica de fora so o que nao existe no site
 * (Exportar e Restaurar mexem no banco local da balanca); o que o perfil nao ve nem aparece
 * (`lib/permissions.ts`). Monitoramento abre em tela cheia; Logs e o suporte do administrador.
 */

interface NavItem {
  screen: Screen;
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Operacional",
    items: [
      { screen: "painel", to: "/painel", label: "Painel", icon: LayoutDashboard },
      { screen: "nova-entrada", to: "/nova-entrada", label: "Nova entrada", icon: PlusCircle },
      { screen: "operacoes", to: "/operacoes", label: "Operacoes", icon: ListChecks },
      { screen: "carteira", to: "/carteira", label: "Carteira", icon: Wallet },
      { screen: "cadastros", to: "/cadastros", label: "Cadastros", icon: Database }
    ]
  },
  {
    title: "Analise",
    items: [
      { screen: "comercial", to: "/comercial", label: "Comercial", icon: Handshake },
      { screen: "insights", to: "/insights", label: "Insights", icon: BarChart3 },
      {
        screen: "controle-caminhoes",
        to: "/controle-caminhoes",
        label: "Controle de caminhoes",
        icon: Truck
      },
      {
        screen: "relatorio-cliente",
        to: "/relatorio-cliente",
        label: "Relatorio por cliente",
        icon: UserSearch
      },
      {
        screen: "conferencia-faturamento",
        to: "/conferencia-faturamento",
        label: "Conferencia de faturamento",
        icon: ClipboardCheck
      },
      {
        screen: "fechamento",
        to: "/fechamento",
        label: "Fechamento de faturas",
        icon: ReceiptText
      },
      { screen: "relatorios", to: "/relatorios", label: "Relatorios", icon: FileText },
      { screen: "monitoramento", to: "/monitoramento", label: "Monitoramento", icon: MonitorPlay },
      { screen: "documentacao", to: "/documentacao", label: "Documentacao", icon: BookOpen }
    ]
  },
  {
    title: "Suporte",
    items: [{ screen: "suporte", to: "/suporte", label: "Logs", icon: ScrollText }]
  }
];
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
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => canSee(user.role, item.screen));
            if (items.length === 0) return null;
            return (
              <Fragment key={section.title}>
                <div className="nav-section">{section.title}</div>
                {items.map(({ screen, to, label, icon: Icon }) => (
                  <NavLink key={screen} to={to} className="nav-link">
                    <Icon size={16} strokeWidth={2.2} />
                    {label}
                  </NavLink>
                ))}
              </Fragment>
            );
          })}
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
            {!user.hasSettings && (
              <button
                type="button"
                className="icon-btn square"
                onClick={() => void logout()}
                aria-label="Sair"
                title="Sair"
              >
                <LogOut size={17} />
              </button>
            )}
            {user.hasSettings && (
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
            )}
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
