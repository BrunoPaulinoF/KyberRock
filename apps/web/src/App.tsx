import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { ConfirmProvider, ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { canSee, homeFor, usesSidebar, type Screen } from "./lib/permissions";
import { documentTitle, standaloneTitle } from "./lib/page-title";
import { publicAsset } from "./lib/public-asset";
import { isStandaloneDisplay } from "./lib/pwa-install";
import { SCREEN_MODULES } from "./lib/screens";
import { ThemeProvider } from "./lib/theme";
import { Login } from "./pages/Login";

/*
 * Cada tela vira um arquivo separado, baixado so quando e aberta. No celular (4G no patio) isso
 * e a diferenca entre abrir a fila do carregador na hora e esperar o site inteiro — relatorio,
 * monitoramento, documentacao — descer antes da primeira tela.
 */
function page<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K
): LazyExoticComponent<ComponentType> {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const BillingConference = page(SCREEN_MODULES["conferencia-faturamento"], "BillingConference");
const Comercial = page(SCREEN_MODULES.comercial, "Comercial");
const CustomerReport = page(SCREEN_MODULES["relatorio-cliente"], "CustomerReport");
const Dashboard = page(SCREEN_MODULES.painel, "Dashboard");
const Documentation = page(SCREEN_MODULES.documentacao, "Documentation");
const Insights = page(SCREEN_MODULES.insights, "Insights");
const InvoiceClosing = page(SCREEN_MODULES.fechamento, "InvoiceClosing");
const Loading = page(SCREEN_MODULES.carregamento, "Loading");
const Monitor = page(SCREEN_MODULES.monitoramento, "Monitor");
const Operations = page(SCREEN_MODULES.operacoes, "Operations");
const PriceCodePage = page(SCREEN_MODULES["senha-preco"], "PriceCodePage");
const Receipts = page(SCREEN_MODULES.cupons, "Receipts");
const Registrations = page(SCREEN_MODULES.cadastros, "Registrations");
const SalesReport = page(SCREEN_MODULES.relatorios, "SalesReport");
const Settings = page(SCREEN_MODULES.configuracoes, "Settings");
const SupportLogs = page(SCREEN_MODULES.suporte, "SupportLogs");
const TruckControl = page(SCREEN_MODULES["controle-caminhoes"], "TruckControl");
const Wallet = page(SCREEN_MODULES.carteira, "Wallet");
/*
 * A casca com o menu tambem vem em arquivo proprio: quem abre a pagina de apresentacao (e quem
 * so usa o celular do carregador) nao baixa o menu, o aviso ao vivo nem o cliente da nuvem que
 * ele usa antes da primeira tela.
 */
const Layout = page(() => import("./components/Layout"), "Layout");
const Landing = page(() => import("./pages/Landing"), "Landing");
const WhatsappConnect = page(() => import("./pages/WhatsappConnect"), "WhatsappConnect");

/*
 * Painel da plataforma (console da Kybernan), que veio do loader-web: login proprio (usuario e
 * senha da plataforma, nao o do Supabase Auth) e estilo proprio. Pedaco separado como as telas —
 * nenhum perfil de pedreira baixa o painel.
 */
const AdminPanel = page(() => import("./admin/AdminPanel"), "AdminPanel");
const AdminLogin = page(() => import("./admin/pages/AdminLogin"), "AdminLogin");

/** Vitrine do kit de pecas (`/kit`): so no `npm run dev`, fica fora do site publicado. */
const KitShowcase = import.meta.env.DEV
  ? page(() => import("./pages/KitShowcase"), "KitShowcase")
  : null;

/** Enquanto o login e conferido ou o arquivo da tela chega: o logo, sem texto piscando. */
function AppSplash() {
  return (
    <div className="app-splash" role="status" aria-label="Carregando">
      <img src={publicAsset("logo-128.webp")} alt="" width={56} height={56} />
    </div>
  );
}

/**
 * Guarda de rota. Cada perfil tem um conjunto fechado de telas (`lib/permissions.ts`): o
 * endereco de uma tela que nao e dele volta para a tela inicial dele. `sidebar` e a casca com o
 * menu lateral, que o carregador e o monitoramento (tela cheia so deles) nao usam.
 */
function Private({
  screen,
  sidebar,
  children
}: {
  screen?: Screen;
  sidebar?: boolean;
  children: React.ReactElement;
}) {
  const { user, loading } = useAuth();
  if (loading) return <AppSplash />;
  if (!user) return <Navigate to="/login" replace />;
  if (screen && !canSee(user.role, screen)) return <Navigate to={homeFor(user.role)} replace />;
  if (sidebar && !usesSidebar(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <AppSplash />;
  return <Navigate to={user ? homeFor(user.role) : "/"} replace />;
}

/**
 * `/`: quem esta logado vai para a tela inicial do perfil; quem nao esta ve a pagina de
 * apresentacao, com o login no topo. O app instalado no celular (o do carregador) abre direto
 * no login — ali a pagina de venda so atrapalha.
 */
function Entry() {
  const { user, loading } = useAuth();
  if (loading) return <AppSplash />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  if (isStandaloneDisplay()) return <Navigate to="/login" replace />;
  return <Landing />;
}

/**
 * Nome da aba do navegador nas telas fora da casca. Fica antes das rotas de proposito: o efeito
 * dele roda antes do da tela, e a casca (`Layout`) e a pagina de apresentacao, que escolhem o
 * proprio titulo, falam por ultimo.
 */
function RouteTitle() {
  const { pathname } = useLocation();
  const title = standaloneTitle(pathname);
  useEffect(() => {
    if (title) document.title = documentTitle(title);
  }, [title]);
  return null;
}

/** Atalho: a tela so monta para quem a ve. */
function only(screen: Screen, element: React.ReactElement) {
  return <Private screen={screen}>{element}</Private>;
}

/**
 * Hospedagem sem regra de rewrite (previa, pasta dentro de outro site) nao consegue servir
 * `/clientes` direto: `VITE_ROUTER=hash` troca para `/#/clientes`, que funciona em qualquer
 * servidor estatico. Na Hostinger fica o padrao (`.htaccess` faz o rewrite).
 */
const Router = import.meta.env.VITE_ROUTER === "hash" ? HashRouter : BrowserRouter;

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Router>
              <RouteTitle />
              <Suspense fallback={<AppSplash />}>
                <Routes>
                  <Route path="/" element={<Entry />} />
                  <Route path="/login" element={<Login />} />
                  {/*
                  Link temporario de conexao do WhatsApp. Publico de proposito: quem abre e o
                  dono do celular, sem conta no sistema. O que autoriza e o token de 256 bits do
                  endereco, conferido pela Edge Function junto com o prazo de 15 minutos.
                */}
                  <Route path="/whatsapp/:token" element={<WhatsappConnect />} />
                  <Route path="/admin" element={<AdminPanel />} />
                  <Route path="/admin/login" element={<AdminLogin />} />
                  <Route path="/carregamento" element={only("carregamento", <Loading />)} />
                  {/* Endereco da fila do carregador no loader-web, que sai do ar. */}
                  <Route path="/loader" element={<Navigate to="/carregamento" replace />} />
                  <Route path="/monitoramento" element={only("monitoramento", <Monitor />)} />
                  <Route
                    element={
                      <Private sidebar>
                        <Layout />
                      </Private>
                    }
                  >
                    <Route path="/painel" element={only("painel", <Dashboard />)} />
                    <Route path="/operacoes" element={only("operacoes", <Operations />)} />
                    <Route path="/carteira" element={only("carteira", <Wallet />)} />
                    <Route path="/cadastros" element={only("cadastros", <Registrations />)} />
                    <Route path="/cadastros/:tab" element={only("cadastros", <Registrations />)} />
                    <Route
                      path="/cadastros/:tab/:sub"
                      element={only("cadastros", <Registrations />)}
                    />
                    <Route path="/senha-preco" element={only("senha-preco", <PriceCodePage />)} />
                    <Route path="/cupons" element={only("cupons", <Receipts />)} />
                    <Route path="/comercial" element={only("comercial", <Comercial />)} />
                    <Route path="/insights" element={only("insights", <Insights />)} />
                    <Route
                      path="/controle-caminhoes"
                      element={only("controle-caminhoes", <TruckControl />)}
                    />
                    <Route
                      path="/relatorio-cliente"
                      element={only("relatorio-cliente", <CustomerReport />)}
                    />
                    <Route
                      path="/conferencia-faturamento"
                      element={only("conferencia-faturamento", <BillingConference />)}
                    />
                    <Route path="/fechamento" element={only("fechamento", <InvoiceClosing />)} />
                    <Route path="/relatorios" element={only("relatorios", <SalesReport />)} />
                    <Route path="/documentacao" element={only("documentacao", <Documentation />)} />
                    <Route path="/suporte" element={only("suporte", <SupportLogs />)} />
                    <Route
                      path="/configuracoes"
                      element={only(
                        "configuracoes",
                        <Navigate to="/configuracoes/balanca" replace />
                      )}
                    />
                    <Route
                      path="/configuracoes/:tab"
                      element={only("configuracoes", <Settings />)}
                    />
                    {/* Enderecos antigos (favoritos, links mandados por mensagem). */}
                    <Route path="/operacao" element={<Navigate to="/operacoes" replace />} />
                    {/* A entrada so nasce no KyberRock Desktop, na balanca. */}
                    <Route path="/nova-entrada" element={<Navigate to="/operacoes" replace />} />
                    <Route
                      path="/operacao/concluidas"
                      element={<Navigate to="/operacoes?aba=concluidas" replace />}
                    />
                    <Route
                      path="/clientes"
                      element={<Navigate to="/cadastros/clientes" replace />}
                    />
                    <Route
                      path="/veiculos"
                      element={<Navigate to="/cadastros/transporte/placas" replace />}
                    />
                    <Route
                      path="/transportadoras"
                      element={<Navigate to="/cadastros/transporte/transportadoras" replace />}
                    />
                    <Route path="/precos" element={<Navigate to="/cadastros/produtos" replace />} />
                    <Route path="/vendas" element={<Navigate to="/relatorios" replace />} />
                  </Route>
                  {KitShowcase && <Route path="/kit" element={<KitShowcase />} />}
                  <Route path="*" element={<Home />} />
                </Routes>
              </Suspense>
            </Router>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
