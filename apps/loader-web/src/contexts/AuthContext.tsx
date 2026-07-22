import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { assertSupabaseConfig } from "../config/supabase-config";
import { callAdminFunction, clearAdminSessionToken, getAdminSessionToken, setAdminSessionToken, getAdminSessionStatus } from "../lib/admin-api";
import { supabase, auth } from "../lib/supabase";

interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  role: "admin" | "loader" | "comercial" | null;
  companyId: string | null;
  unitId: string | null;
  isActive: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isLoader: boolean;
  /** Usuario do Comercial: extrai relatorios de venda da empresa. */
  isComercial: boolean;
  loginAdmin: (username: string, password: string) => Promise<void>;
  loginLoader: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  clearError: () => void;
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
  role: "loader" | "comercial";
  company_id: string;
  unit_id: string;
  is_active: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True enquanto loginLoader carrega o perfil explicitamente. Evita que o evento
  // onAuthStateChange(SIGNED_IN) dispare uma segunda carga concorrente do mesmo perfil.
  const explicitAuthRef = useRef(false);

  const isAdmin = user?.role === "admin";
  const isLoader = user?.role === "loader";
  const isComercial = user?.role === "comercial";

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

    auth
      .getSession()
      .then(({ data }) => {
        if (data.session?.user && !adminToken) {
          void loadLoaderProfile(data.session.user.id);
        } else {
          setIsLoading(false);
        }
      })
      .catch(() => {
        // Sem tratamento, uma rejeicao de getSession (rede instavel no boot, chave invalida)
        // deixava isLoading preso em true e a tela travada em "Carregando..." para sempre.
        setIsLoading(false);
      });

    const { data: subscription } = auth.onAuthStateChange((_event, session) => {
      const currentToken = getAdminSessionToken();
      if (session?.user && !currentToken) {
        // loginLoader ja carrega o perfil; evita a carga duplicada disparada pelo SIGNED_IN.
        if (explicitAuthRef.current) return;
        void loadLoaderProfile(session.user.id);
      } else if (!currentToken) {
        setUser(null);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function loadLoaderProfile(userId: string): Promise<boolean> {
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
        setError("Usuario inativo ou sem perfil de acesso.");
        return false;
      }

      setUser({
        uid: data.id,
        email: data.email,
        name: data.name,
        role: data.role === "comercial" ? "comercial" : "loader",
        companyId: data.company_id,
        unitId: data.unit_id,
        isActive: data.is_active
      });
      return true;
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
    explicitAuthRef.current = true;
    try {
      assertSupabaseConfig();
      const { data, error: loginError } = await auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      if (!data.user) throw new Error("Login nao retornou um usuario valido. Tente novamente.");
      // Propaga a falha de perfil inativo/ausente como excecao para que a tela de login NAO
      // navegue para /loader (o guard PrivateLoaderRoute redirecionaria de volta, causando um
      // "flash" de navegacao) e a mensagem de erro definida em loadLoaderProfile permaneca.
      const ok = await loadLoaderProfile(data.user.id);
      if (!ok) throw new Error("Usuario inativo ou sem perfil de acesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no login.");
      throw err;
    } finally {
      explicitAuthRef.current = false;
    }
  }

  async function logout(): Promise<void> {
    clearAdminSessionToken();
    await auth.signOut();
    setUser(null);
  }

  function clearError(): void {
    setError(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isAdmin, isLoader, isComercial, loginAdmin, loginLoader, logout, error, clearError }}>
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
