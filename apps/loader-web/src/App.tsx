import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { MovedToWeb } from "./pages/MovedToWeb";
import { WhatsappConnect } from "./pages/WhatsappConnect";

/**
 * As telas do painel administrativo saem do pacote inicial: quem mais abre este endereco ainda
 * e o celular do carregador com o app antigo instalado, que so precisa do aviso `MovedToWeb`
 * (carregador e comercial entram pelo KyberRock Web). `WhatsappConnect` fica fora do lazy: e o
 * link aberto no celular do dono do numero, na hora de conectar.
 */
const AdminLogin = lazy(() =>
  import("./pages/AdminLogin").then((m) => ({ default: m.AdminLogin }))
);
const AdminDashboard = lazy(() =>
  import("./pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard }))
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

function AppRoutes() {
  return (
    <Routes>
      {/* Carregador e comercial mudaram para o KyberRock Web: as rotas antigas avisam e levam. */}
      <Route path="/" element={<MovedToWeb />} />
      <Route path="/login" element={<MovedToWeb />} />
      <Route path="/loader" element={<MovedToWeb />} />
      <Route path="/relatorios" element={<MovedToWeb />} />
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
