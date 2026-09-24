import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LoaderLogin } from "./pages/LoaderLogin";
import { LoaderDashboard } from "./pages/LoaderDashboard";
import { WhatsappConnect } from "./pages/WhatsappConnect";

/**
 * As telas do painel administrativo saem do pacote inicial.
 *
 * Quem abre este site na esmagadora maioria das vezes e o carregador, no celular,
 * dentro da pedreira -- e ele so precisa de `LoaderDashboard`. O pacote unico fazia
 * esse celular baixar tambem o painel inteiro: `AdminDashboard` mais o backoffice
 * financeiro e a tela de atualizacoes do desktop, que ele nunca abre. Agora cada uma
 * vira um pedaco separado, buscado so quando alguem entra na rota.
 *
 * `LoaderLogin`, `LoaderDashboard` e `WhatsappConnect` ficam de fora do lazy de
 * proposito: sao o caminho comum e um pedaco separado so adicionaria uma ida a rede
 * na hora em que a conexao da pedreira e o gargalo.
 */
const AdminLogin = lazy(() =>
  import("./pages/AdminLogin").then((m) => ({ default: m.AdminLogin }))
);
const AdminDashboard = lazy(() =>
  import("./pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard }))
);
const SalesReport = lazy(() =>
  import("./pages/SalesReport").then((m) => ({ default: m.SalesReport }))
);

/** O mesmo texto que os guardas de rota ja mostram enquanto a sessao carrega. */
function RouteFallback() {
  return <div>Carregando...</div>;
}

function PrivateAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return <div>Carregando...</div>;
  }

  if (!isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function PrivateLoaderRoute({ children }: { children: React.ReactNode }) {
  const { isLoader, isLoading } = useAuth();

  if (isLoading) {
    return <div>Carregando...</div>;
  }

  if (!isLoader) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PrivateComercialRoute({ children }: { children: React.ReactNode }) {
  const { isComercial, isLoading } = useAuth();

  if (isLoading) {
    return <div>Carregando...</div>;
  }

  if (!isComercial) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LoaderLogin />} />
      <Route path="/login" element={<LoaderLogin />} />
      <Route
        path="/loader"
        element={
          <PrivateLoaderRoute>
            <LoaderDashboard />
          </PrivateLoaderRoute>
        }
      />
      <Route
        path="/relatorios"
        element={
          <PrivateComercialRoute>
            <SalesReport />
          </PrivateComercialRoute>
        }
      />
      {/*
        Link temporario de conexao do WhatsApp. Publica de proposito e sem
        AuthProvider no caminho: quem abre e o dono do celular, que nao tem (nem
        precisa ter) conta no sistema. O que autoriza e o token de 256 bits do
        proprio endereco, conferido no servidor junto com o prazo de 15 minutos.
      */}
      <Route path="/whatsapp/:token" element={<WhatsappConnect />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <PrivateAdminRoute>
            <AdminDashboard />
          </PrivateAdminRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <AppRoutes />
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
