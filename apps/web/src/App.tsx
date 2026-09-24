import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { Carriers, VehiclesAndDrivers } from "./pages/Cadastros";
import { Customers } from "./pages/Customers";
import { InvoiceClosing } from "./pages/InvoiceClosing";
import { Loading } from "./pages/Loading";
import { Login } from "./pages/Login";
import { Prices } from "./pages/Prices";
import { SalesReport } from "./pages/SalesReport";
import { Wallet } from "./pages/Wallet";

/** Onde cada perfil comeca: o carregador na fila, os outros no cadastro. */
function homeFor(user: { isLoader: boolean }): string {
  return user.isLoader ? "/carregamento" : "/clientes";
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
  if (gestorOnly && !user.canManagePrices) return <Navigate to="/clientes" replace />;
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
                <Route path="/clientes" element={<Customers />} />
                <Route path="/veiculos" element={<VehiclesAndDrivers />} />
                <Route path="/transportadoras" element={<Carriers />} />
                <Route path="/vendas" element={<SalesReport />} />
                <Route
                  path="/precos"
                  element={
                    <Private gestorOnly>
                      <Prices />
                    </Private>
                  }
                />
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
