import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { canSee, homeFor, usesSidebar, type Screen } from "./lib/permissions";
import { ThemeProvider } from "./lib/theme";
import { BillingConference } from "./pages/BillingConference";
import { CustomerReport } from "./pages/CustomerReport";
import { Dashboard } from "./pages/Dashboard";
import { Documentation } from "./pages/Documentation";
import { Insights } from "./pages/Insights";
import { InvoiceClosing } from "./pages/InvoiceClosing";
import { Loading } from "./pages/Loading";
import { Login } from "./pages/Login";
import { Monitor } from "./pages/Monitor";
import { NewEntry } from "./pages/NewEntry";
import { Operations } from "./pages/Operation";
import { Registrations } from "./pages/Registrations";
import { SalesReport } from "./pages/SalesReport";
import { Settings } from "./pages/Settings";
import { SupportLogs } from "./pages/SupportLogs";
import { TruckControl } from "./pages/TruckControl";
import { Wallet } from "./pages/Wallet";

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
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
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
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/carregamento" element={only("carregamento", <Loading />)} />
              <Route path="/monitoramento" element={only("monitoramento", <Monitor />)} />
              <Route
                element={
                  <Private sidebar>
                    <Layout />
                  </Private>
                }
              >
                <Route index element={<Home />} />
                <Route path="/painel" element={only("painel", <Dashboard />)} />
                <Route path="/nova-entrada" element={only("nova-entrada", <NewEntry />)} />
                <Route path="/operacoes" element={only("operacoes", <Operations />)} />
                <Route path="/carteira" element={only("carteira", <Wallet />)} />
                <Route path="/cadastros" element={only("cadastros", <Registrations />)} />
                <Route path="/cadastros/:tab" element={only("cadastros", <Registrations />)} />
                <Route path="/cadastros/:tab/:sub" element={only("cadastros", <Registrations />)} />
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
                  element={only("configuracoes", <Navigate to="/configuracoes/balanca" replace />)}
                />
                <Route path="/configuracoes/:tab" element={only("configuracoes", <Settings />)} />
                {/* Enderecos antigos (favoritos, links mandados por mensagem). */}
                <Route path="/operacao" element={<Navigate to="/operacoes" replace />} />
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
          </Router>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
