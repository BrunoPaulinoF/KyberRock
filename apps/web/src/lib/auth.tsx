import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  capabilitiesFor,
  isRole,
  requiresPricePasswordFor,
  type Capabilities,
  type Role
} from "./permissions";
import { supabase, type Tables } from "./supabase";

export type { Role } from "./permissions";

export interface SessionUser extends Capabilities {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string;
  unitId: string;
  /** Digita a senha de preco da pedreira para mudar preco (a `web-api` confere). */
  requiresPricePassword: boolean;
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function toUser(profile: Tables<"user_profiles">): SessionUser | null {
  if (!profile.is_active) return null;
  if (!isRole(profile.role)) return null;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    companyId: profile.company_id,
    unitId: profile.unit_id,
    requiresPricePassword: requiresPricePasswordFor(
      profile.role,
      profile.requires_price_password === true
    ),
    ...capabilitiesFor(profile.role)
  };
}

async function loadProfile(userId: string): Promise<SessionUser | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return toUser(data);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id;
      const profile = id ? await loadProfile(id) : null;
      if (!cancelled) {
        setUser(profile);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) setUser(null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (signInError || !data.user) {
      const message = "E-mail ou senha incorretos.";
      setError(message);
      throw new Error(message);
    }
    const profile = await loadProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      const message = "Este login nao tem perfil de acesso ativo. Fale com o suporte da Kybernan.";
      setError(message);
      throw new Error(message);
    }
    setUser(profile);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fora do AuthProvider");
  return value;
}

/** O usuario logado, garantido (as telas so montam depois do guard de rota). */
export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error("Sem usuario logado");
  return user;
}
