import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { canSee, homeFor, usesSidebar, type Screen } from "./lib/permissions";
import { isStandaloneDisplay } from "./lib/pwa-install";
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

const BillingConference = page(() => import("./pages/BillingConference"), "BillingConference");
const Comercial = page(() => import("./pages/Comercial"), "Comercial");
const CustomerReport = page(() => import("./pages/CustomerReport"), "CustomerReport");
const Dashboard = page(() => import("./pages/Dashboard"), "Dashboard");
const Documentation = page(() => import("./pages/Documentation"), "Documentation");
const Insights = page(() => import("./pages/Insights"), "Insights");
const InvoiceClosing = page(() => import("./pages/InvoiceClosing"), "InvoiceClosing");
const Loading = page(() => import("./pages/Loading"), "Loading");
const Monitor = page(() => import("./pages/Monitor"), "Monitor");
const Operations = page(() => import("./pages/Operation"), "Operations");
const PriceCodePage = page(() => import("./pages/PriceCode"), "PriceCodePage");
const Receipts = page(() => import("./pages/Receipts"), "Receipts");
const Registrations = page(() => import("./pages/Registrations"), "Registrations");
const SalesReport = page(() => import("./pages/SalesReport"), "SalesReport");
const Settings = page(() => import("./pages/Settings"), "Settings");
const SupportLogs = page(() => import("./pages/SupportLogs"), "SupportLogs");
const TruckControl = page(() => import("./pages/TruckControl"), "TruckControl");
const Wallet = page(() => import("./pages/Wallet"), "Wallet");
const Landing = page(() => import("./pages/Landing"), "Landing");
const WhatsappConnect = page(() => import("./pages/WhatsappConnect"), "WhatsappConnect");

/*
 * Painel da plataforma (console da Kybernan), que veio do loader-web: login proprio (usuario e
 * senha da plataforma, nao o do Supabase Auth) e estilo proprio. Pedaco separado como as telas —
 * nenhum perfil de pedreira baixa o painel.
 */
const AdminPanel = page(() => import("./admin/AdminPanel"), "AdminPanel");
const AdminLogin = page(() => import("./admin/pages/AdminLogin"), "AdminLogin");

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
  if (loading) return <div className="empty">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (screen && !canSee(user.role, screen)) return <Navigate to={homeFor(user.role)} replace />;
  if (sidebar && !usesSidebar(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Carregando...</div>;
  return <Navigate to={user ? homeFor(user.role) : "/"} replace />;
}

/**
 * `/`: quem esta logado vai para a tela inicial do perfil; quem nao esta ve a pagina de
 * apresentacao, com o login no topo. O app instalado no celular (o do carregador) abre direto
 * no login — ali a pagina de venda so atrapalha.
 */
function Entry() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Carregando...</div>;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  if (isStandaloneDisplay()) return <Navigate to="/login" replace />;
  return <Landing />;
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
          <Router>
            <Suspense fallback={<div className="empty">Carregando...</div>}>
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
                  <Route path="/configuracoes/:tab" element={only("configuracoes", <Settings />)} />
                  {/* Enderecos antigos (favoritos, links mandados por mensagem). */}
                  <Route path="/operacao" element={<Navigate to="/operacoes" replace />} />
                  {/* A entrada so nasce no KyberRock Desktop, na balanca. */}
                  <Route path="/nova-entrada" element={<Navigate to="/operacoes" replace />} />
                  <Route
                    path="/operacao/concluidas"
                    element={<Navigate to="/operacoes?aba=concluidas" replace />}
                  />
                  <Route path="/clientes" element={<Navigate to="/cadastros/clientes" replace />} />
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
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </Router>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
