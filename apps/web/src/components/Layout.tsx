import { Cloud, LogOut, Menu, Moon, Printer, Scale, Search, Settings, Sun, X } from "lucide-react";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";
import { CadastroLiveProvider } from "../lib/cadastro-live-provider";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { currentLabel, NAV_SECTIONS } from "../lib/navigation";
import { canSee, ROLE_LABELS, type Screen } from "../lib/permissions";
import { usePageTitle } from "../lib/page-title";
import { publicAsset } from "../lib/public-asset";
import { q } from "../lib/queries";
import { preloadScreen } from "../lib/screens";
import { useTheme } from "../lib/theme";
import { useAsync } from "../lib/use-async";
import { CommandPalette, isPaletteShortcut } from "./CommandPalette";
import { PageSkeleton } from "./ui";

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

/**
 * Numero ao lado de um item do menu (as pesagens abertas em "Operacoes"): o que pede atencao
 * aparece sem abrir a tela. Atualiza pelo mesmo aviso ao vivo das telas; zero nao aparece.
 */
function useNavCounts(companyId: string, unitId: string, seesOperations: boolean) {
  const open = useAsync(
    () => (seesOperations ? q.openOperationCount(companyId, unitId) : Promise.resolve(0)),
    [companyId, unitId, seesOperations],
    { key: seesOperations ? `menu:abertas:${companyId}:${unitId}` : null }
  );
  useOnCadastroChange(open.refresh, CADASTRO_TABLES.operations);
  return { operacoes: open.data ?? 0 } as Partial<Record<Screen, number>>;
}

export function Layout() {
  const user = useUser();
  return (
    // Cadastro e pesagem gravados na balanca aparecem nas telas (e no menu) na hora
    // (`lib/cadastro-live.ts`).
    <CadastroLiveProvider companyId={user.companyId}>
      <Shell />
    </CadastroLiveProvider>
  );
}

function Shell() {
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
  const [searchOpen, setSearchOpen] = useState(false);
  const counts = useNavCounts(user.companyId, user.unitId, canSee(user.role, "operacoes"));
  usePageTitle(current);

  // Ctrl+K (Cmd+K no Mac) abre a busca rapida de qualquer tela.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setSearchOpen((open) => !open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        <img src={publicAsset("logo-128.webp")} alt="" className="sidebar-logo" />
        <span className="mobile-bar-title">{current ?? "KyberRock"}</span>
        <button
          type="button"
          className="mobile-bar-btn mobile-bar-search"
          onClick={() => setSearchOpen(true)}
          aria-label="Buscar tela, cliente ou placa"
        >
          <Search size={20} />
        </button>
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
          <img src={publicAsset("logo-128.webp")} alt="" className="sidebar-logo" />
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
        <button
          type="button"
          className="sidebar-search"
          onClick={() => setSearchOpen(true)}
          aria-label="Buscar tela, cliente ou placa (Ctrl+K)"
        >
          <Search size={15} aria-hidden="true" />
          <span>Buscar…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => canSee(user.role, item.screen));
            if (items.length === 0) return null;
            return (
              <Fragment key={section.title}>
                <div className="nav-section">{section.title}</div>
                {items.map(({ screen, to, label, icon: Icon }) => (
                  <NavLink
                    key={screen}
                    to={to}
                    className="nav-link"
                    onPointerEnter={() => preloadScreen(screen)}
                    onFocus={() => preloadScreen(screen)}
                    onTouchStart={() => preloadScreen(screen)}
                  >
                    <Icon size={16} strokeWidth={2.2} />
                    <span className="nav-label">{label}</span>
                    {(counts[screen] ?? 0) > 0 && (
                      <span className="nav-count" title={`${counts[screen]} em aberto`}>
                        {counts[screen]?.toLocaleString("pt-BR")}
                      </span>
                    )}
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
                  aria-label="Configurações"
                  aria-expanded={showSettings}
                  title="Configurações"
                >
                  <Settings size={17} />
                </button>
                {showSettings && (
                  <div className="settings-dropdown" role="menu">
                    <button type="button" role="menuitem" onClick={() => openSettings("balanca")}>
                      <Scale size={14} />
                      Balança
                    </button>
                    <button type="button" role="menuitem" onClick={() => openSettings("impressao")}>
                      <Printer size={14} />
                      Impressão
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
        {/* A tela chega em arquivo proprio (App.tsx): o menu fica na tela enquanto ela baixa. */}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
