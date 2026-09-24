import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { BillingConference } from "./pages/BillingConference";
import { CustomerReport } from "./pages/CustomerReport";
import { Dashboard } from "./pages/Dashboard";
import { Documentation } from "./pages/Documentation";
import { Insights } from "./pages/Insights";
import { InvoiceClosing } from "./pages/InvoiceClosing";
import { Loading } from "./pages/Loading";
import { Login } from "./pages/Login";
import { NewEntry } from "./pages/NewEntry";
import { Operations } from "./pages/Operation";
import { Registrations } from "./pages/Registrations";
import { SalesReport } from "./pages/SalesReport";
import { Settings } from "./pages/Settings";
import { TruckControl } from "./pages/TruckControl";
import { Wallet } from "./pages/Wallet";

/**
 * Onde cada perfil comeca: o carregador na fila, o comercial no relatorio de vendas (a tela
 * dele no antigo portal) e o resto na tela Operacoes — a mesma que o desktop abre para quem
 * opera a balanca.
 */
function homeFor(user: { isLoader: boolean; role: string }): string {
  if (user.isLoader) return "/carregamento";
  return user.role === "comercial" ? "/relatorios?aba=vendas" : "/operacoes";
}

/**
 * Guarda de rota. O carregador so tem a fila (`loaderOnly`); qualquer outra tela o manda de
 * volta para ela — e a fila manda quem nao e carregador para o cadastro.
 */
function Private({
  gestorOnly,
  loaderOnly,
  children
}: {
  gestorOnly?: boolean;
  loaderOnly?: boolean;
  children: React.ReactElement;
}) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (Boolean(loaderOnly) !== user.isLoader) return <Navigate to={homeFor(user)} replace />;
  if (gestorOnly && !user.canManagePrices) return <Navigate to={homeFor(user)} replace />;
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Carregando...</div>;
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
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
              <Route
                path="/carregamento"
                element={
                  <Private loaderOnly>
                    <Loading />
                  </Private>
                }
              />
              <Route
                element={
                  <Private>
                    <Layout />
                  </Private>
                }
              >
                <Route index element={<Home />} />
                <Route path="/painel" element={<Dashboard />} />
                <Route path="/nova-entrada" element={<NewEntry />} />
                <Route path="/operacoes" element={<Operations />} />
                <Route path="/cadastros" element={<Registrations />} />
                <Route path="/cadastros/:tab" element={<Registrations />} />
                <Route path="/cadastros/:tab/:sub" element={<Registrations />} />
                <Route path="/insights" element={<Insights />} />
                <Route path="/controle-caminhoes" element={<TruckControl />} />
                <Route path="/relatorio-cliente" element={<CustomerReport />} />
                <Route path="/conferencia-faturamento" element={<BillingConference />} />
                <Route path="/relatorios" element={<SalesReport />} />
                <Route path="/documentacao" element={<Documentation />} />
                <Route
                  path="/configuracoes"
                  element={<Navigate to="/configuracoes/balanca" replace />}
                />
                <Route path="/configuracoes/:tab" element={<Settings />} />
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
                <Route
                  path="/carteira"
                  element={
                    <Private gestorOnly>
                      <Wallet />
                    </Private>
                  }
                />
                <Route
                  path="/fechamento"
                  element={
                    <Private gestorOnly>
                      <InvoiceClosing />
                    </Private>
                  }
                />
              </Route>
              <Route path="*" element={<Home />} />
            </Routes>
          </Router>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
