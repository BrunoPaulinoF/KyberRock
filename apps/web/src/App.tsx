import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { Carriers, VehiclesAndDrivers } from "./pages/Cadastros";
import { Customers } from "./pages/Customers";
import { InvoiceClosing } from "./pages/InvoiceClosing";
import { Login } from "./pages/Login";
import { Prices } from "./pages/Prices";
import { SalesReport } from "./pages/SalesReport";
import { Wallet } from "./pages/Wallet";

function Private({ gestorOnly, children }: { gestorOnly?: boolean; children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (gestorOnly && !user.canManagePrices) return <Navigate to="/clientes" replace />;
  return children;
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
                element={
                  <Private>
                    <Layout />
                  </Private>
                }
              >
                <Route index element={<Navigate to="/clientes" replace />} />
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
              <Route path="*" element={<Navigate to="/clientes" replace />} />
            </Routes>
          </Router>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
