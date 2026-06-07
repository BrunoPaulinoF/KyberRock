import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  type User
} from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

import { firebaseWebConfig } from "../config/firebase-config";

const ADMIN_EMAIL = "kybernantech@gmail.com";

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
  loginAdmin: () => Promise<void>;
  loginLoader: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

let firebaseApp: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseWebConfig);
  }
  return firebaseApp;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const isLoader = user?.role === "loader";

  useEffect(() => {
    const app = getFirebaseApp();
    const auth = getAuth(app);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await loadUserData(firebaseUser);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  async function loadUserData(firebaseUser: User): Promise<void> {
    try {
      const db = getFirestore(getFirebaseApp());
      const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));

      if (userDoc.exists()) {
        const data = userDoc.data();
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: data.name || firebaseUser.displayName || null,
          role: data.role || null,
          companyId: data.companyId || null,
          unitId: data.unitId || null,
          isActive: data.isActive !== false
        });
      } else if (firebaseUser.email === ADMIN_EMAIL) {
        // Admin sem documento no Firestore ainda
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: firebaseUser.displayName || "Admin",
          role: "admin",
          companyId: null,
          unitId: null,
          isActive: true
        });
      } else {
        setUser(null);
        await signOut(getAuth(getFirebaseApp()));
      }
    } catch {
      setUser(null);
    }
  }

  async function loginAdmin(): Promise<void> {
    setError(null);
    try {
      const auth = getAuth(getFirebaseApp());
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account",
        login_hint: ADMIN_EMAIL
      });
      const result = await signInWithPopup(auth, provider);

      if (result.user.email !== ADMIN_EMAIL) {
        await signOut(auth);
        throw new Error("Acesso restrito ao administrador.");
      }

      await loadUserData(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no login.");
      throw err;
    }
  }

  async function loginLoader(email: string, password: string): Promise<void> {
    setError(null);
    try {
      const auth = getAuth(getFirebaseApp());
      const result = await signInWithEmailAndPassword(auth, email, password);
      await loadUserData(result.user);

      if (!user?.isActive) {
        await signOut(auth);
        throw new Error("Usuario inativo. Contate o administrador.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no login.");
      throw err;
    }
  }

  async function logout(): Promise<void> {
    const auth = getAuth(getFirebaseApp());
    await signOut(auth);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAdmin, isLoader, loginAdmin, loginLoader, logout, error }}
    >
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
