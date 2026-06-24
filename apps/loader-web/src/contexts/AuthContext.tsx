import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { callAdminFunction, clearAdminSessionToken, getAdminSessionToken, setAdminSessionToken, getAdminSessionStatus } from "../lib/admin-api";
import { supabase, auth } from "../lib/supabase";

interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  role: "admin" | "loader" | null;
  companyId: string | null;
  unitId: string | null;
  isActive: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isLoader: boolean;
  loginAdmin: (username: string, password: string) => Promise<void>;
  loginLoader: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AdminAuthResponse {
  token: string;
  username: string;
}

interface LoaderProfileRow {
  id: string;
  email: string;
  name: string;
  role: "loader";
  company_id: string;
  unit_id: string;
  is_active: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const isLoader = user?.role === "loader";

  useEffect(() => {
    const { token: adminToken, isExpired } = getAdminSessionStatus();
    if (adminToken && !isExpired) {
      setUser({
        uid: "admin",
        email: null,
        name: "Administrador",
        role: "admin",
        companyId: null,
        unitId: null,
        isActive: true
      });
    } else if (isExpired) {
      clearAdminSessionToken();
      setUser(null);
    }

    auth.getSession().then(({ data }) => {
      if (data.session?.user && !adminToken) {
        void loadLoaderProfile(data.session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    const { data: subscription } = auth.onAuthStateChange((_event, session) => {
      const currentToken = getAdminSessionToken();
      if (session?.user && !currentToken) {
        void loadLoaderProfile(session.user.id);
      } else if (!currentToken) {
        setUser(null);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function loadLoaderProfile(userId: string): Promise<void> {
    setIsLoading(true);
    try {
      const { data, error: profileError } = await supabase
        .from("user_profiles")
        .select("id,email,name,role,company_id,unit_id,is_active")
        .eq("id", userId)
        .single<LoaderProfileRow>();

      if (profileError || !data || !data.is_active) {
        await auth.signOut();
        setUser(null);
        setError("Usuario inativo ou sem perfil de carregador.");
        return;
      }

      setUser({
        uid: data.id,
        email: data.email,
        name: data.name,
        role: "loader",
        companyId: data.company_id,
        unitId: data.unit_id,
        isActive: data.is_active
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function loginAdmin(username: string, password: string): Promise<void> {
    setError(null);
    try {
      const response = await callAdminFunction<AdminAuthResponse>("admin-auth", { username, password }, null);
      setAdminSessionToken(response.token);
      await auth.signOut();
      setUser({
        uid: "admin",
        email: null,
        name: response.username,
        role: "admin",
        companyId: null,
        unitId: null,
        isActive: true
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no login administrativo.");
      throw err;
    }
  }

  async function loginLoader(email: string, password: string): Promise<void> {
    setError(null);
    clearAdminSessionToken();
    const { data, error: loginError } = await auth.signInWithPassword({ email, password });
    if (loginError) {
      setError(loginError.message);
      throw loginError;
    }
    if (data.user) await loadLoaderProfile(data.user.id);
  }

  async function logout(): Promise<void> {
    clearAdminSessionToken();
    await auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isAdmin, isLoader, loginAdmin, loginLoader, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }
  return context;
}
