import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  capabilitiesFor,
  isRole,
  requiresPricePasswordFor,
  type Capabilities,
  type Role
} from "./permissions";
import { clearQueryCache } from "./query-cache";
import { SUPABASE_URL } from "./supabase-env";
import type { Tables } from "./supabase";

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

/**
 * O cliente da nuvem (~50 kB comprimido) chega em arquivo proprio, pedido so quando precisa:
 * quem abre a pagina de apresentacao sem estar logado ve a pagina sem esperar por ele.
 */
function cloud() {
  return import("./supabase").then((module) => module.supabase);
}

/**
 * Tem sessao guardada neste navegador? E a chave onde o `supabase-js` grava o login
 * (`sb-<projeto>-auth-token`). Sem ela nao ha o que conferir e o site responde "nao logado" na
 * hora. Na duvida (navegador sem armazenamento, endereco estranho) a resposta e "talvez", e o
 * site confere pelo caminho completo.
 */
export function hasStoredSession(url: string = SUPABASE_URL): boolean {
  try {
    const project = new URL(url).hostname.split(".")[0];
    return window.localStorage.getItem(`sb-${project}-auth-token`) !== null;
  } catch {
    return true;
  }
}

async function loadProfile(userId: string): Promise<SessionUser | null> {
  const supabase = await cloud();
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
  // Sem sessao guardada nao ha o que esperar: a pagina de apresentacao aparece na hora.
  const [loading, setLoading] = useState(hasStoredSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const storedSession = hasStoredSession();
    const start = () =>
      void cloud()
        .then(async (supabase) => {
          if (cancelled) return;
          const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_OUT" || !session) setUser(null);
          });
          unsubscribe = () => sub.subscription.unsubscribe();
          if (!storedSession) return;
          const { data } = await supabase.auth.getSession();
          const id = data.session?.user.id;
          const profile = id ? await loadProfile(id) : null;
          if (!cancelled) {
            setUser(profile);
            setLoading(false);
          }
        })
        .catch(() => {
          // Arquivo do cliente nao chegou (rede caiu no meio): a tela de entrar aparece, em vez do
          // logo girando para sempre. Entrar de novo tenta baixar outra vez.
          if (!cancelled) setLoading(false);
        });
    // Sem sessao, o cliente da nuvem so vem depois que a pagina ja apareceu (fica pronto para o
    // "Entrar" sem disputar a rede com a primeira tela).
    let cancelIdle: (() => void) | null = null;
    if (storedSession) start();
    else if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start, { timeout: 3000 });
      cancelIdle = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(start, 1200);
      cancelIdle = () => window.clearTimeout(handle);
    }
    return () => {
      cancelled = true;
      cancelIdle?.();
      unsubscribe?.();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    // Leitura guardada de outro login nao pode aparecer para este.
    clearQueryCache();
    const supabase = await cloud();
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
      const message = "Este login não tem perfil de acesso ativo. Fale com o suporte da Kybernan.";
      setError(message);
      throw new Error(message);
    }
    setUser(profile);
  }, []);

  const logout = useCallback(async () => {
    const supabase = await cloud();
    await supabase.auth.signOut();
    clearQueryCache();
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
  if (!user) throw new Error("Sem usuário logado");
  return user;
}
