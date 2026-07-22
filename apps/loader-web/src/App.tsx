import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminDashboard } from "./pages/AdminDashboard";
import { LoaderLogin } from "./pages/LoaderLogin";
import { LoaderDashboard } from "./pages/LoaderDashboard";
import { SalesReport } from "./pages/SalesReport";

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
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
