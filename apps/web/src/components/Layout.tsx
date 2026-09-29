import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Cloud,
  Database,
  FileText,
  Handshake,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MonitorPlay,
  Moon,
  Printer,
  Receipt,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  Sun,
  Truck,
  UserSearch,
  Wallet,
  X
} from "lucide-react";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

import { useAuth, useUser } from "../lib/auth";
import { CadastroLiveProvider } from "../lib/cadastro-live-provider";
import { canSee, ROLE_LABELS, type Screen } from "../lib/permissions";
import { publicAsset } from "../lib/public-asset";
import { useTheme } from "../lib/theme";

/**
 * A casca do site: o mesmo menu lateral do KyberRock Desktop — mesmas secoes (Operacional e
 * Analise), mesmos nomes, mesma ordem e mesmos icones (`lucide-react`) —, com o rodape de
 * usuario, tema e a engrenagem de configuracoes. Fica de fora so o que nao existe no site
 * (Exportar e Restaurar mexem no banco local da balanca; a Nova entrada so e feita na balanca);
 * o que o perfil nao ve nem aparece
 * (`lib/permissions.ts`). Monitoramento abre em tela cheia; Logs e o suporte do administrador.
 *
 * No celular o menu nao cabe ao lado do conteudo: vira uma barra fina no topo (botao de menu +
 * nome da tela) e o mesmo menu desliza da esquerda por cima da tela, fechando ao escolher uma
 * tela, ao tocar fora ou no Esc. Um menu so, dois jeitos de mostrar — o CSS decide qual.
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
      { screen: "operacoes", to: "/operacoes", label: "Operacoes", icon: ListChecks },
      { screen: "carteira", to: "/carteira", label: "Carteira", icon: Wallet },
      { screen: "cadastros", to: "/cadastros", label: "Cadastros", icon: Database },
      { screen: "cupons", to: "/cupons", label: "Cupons", icon: Receipt },
      { screen: "senha-preco", to: "/senha-preco", label: "Senha de preco", icon: KeyRound }
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
/** Nome da tela aberta, para a barra do celular (a tela das configuracoes nao esta no menu). */
function currentLabel(pathname: string): string | null {
  if (pathname.startsWith("/configuracoes")) return "Configuracoes";
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item.label;
    }
  }
  return null;
}

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const roleLabel = ROLE_LABELS[user.role];
  const navigate = useNavigate();
  const location = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const current = currentLabel(location.pathname);

  // O menu fecha ao trocar de tela, ao clicar fora e no Esc — como o do desktop.
  useEffect(() => {
    setShowSettings(false);
    setNavOpen(false);
  }, [location.pathname]);

  // Menu do celular aberto: a pagina de tras nao rola junto e o Esc fecha.
  useEffect(() => {
    if (!navOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);
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
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      <header className="mobile-bar">
        <button
          type="button"
          className="mobile-bar-btn"
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={navOpen}
          aria-controls="kr-sidebar"
        >
          <Menu size={22} />
        </button>
        <img src={publicAsset("logo.png")} alt="" className="sidebar-logo" />
        <span className="mobile-bar-title">{current ?? "KyberRock"}</span>
      </header>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Fechar menu"
        tabIndex={-1}
        onClick={() => setNavOpen(false)}
      />
      <aside className="sidebar" id="kr-sidebar">
        <div className="sidebar-header">
          <img src={publicAsset("logo.png")} alt="" className="sidebar-logo" />
          <span className="sidebar-brand">KyberRock</span>
          <span className="sidebar-meta">Web</span>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setNavOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
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
        {/* Cadastro gravado na balanca aparece nas telas na hora (`lib/cadastro-live.ts`). */}
        <CadastroLiveProvider companyId={user.companyId}>
          {/* A tela chega em arquivo proprio (App.tsx): o menu fica na tela enquanto ela baixa. */}
          <Suspense fallback={<div className="empty">Carregando...</div>}>
            <Outlet />
          </Suspense>
        </CadastroLiveProvider>
      </main>
    </div>
  );
}
