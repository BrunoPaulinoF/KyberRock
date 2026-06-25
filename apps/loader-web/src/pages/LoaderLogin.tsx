import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";

export function LoaderLogin() {
  const { loginLoader, error, isLoader } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isLoader) {
      navigate("/loader", { replace: true });
    }
  }, [isLoader, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    try {
      await loginLoader(email, password);
      navigate("/loader", { replace: true });
    } catch {
      // O contexto de auth ja expoe a mensagem para a tela.
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <section style={{ background: "#fff", padding: "48px", borderRadius: "20px", boxShadow: "0 18px 60px rgba(15, 23, 42, 0.08)", maxWidth: "420px", width: "100%" }}>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "32px" }}>KyberRock</h1>
        <p style={{ color: "#64748b", margin: "0 0 24px 0" }}>Acesso do Carregador</p>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #ef4444", borderRadius: "12px", padding: "12px", marginBottom: "16px", color: "#991b1b", fontSize: "14px" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontWeight: 700 }}>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ padding: "12px", borderRadius: "10px", border: "1px solid #cbd5e1", font: "inherit" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontWeight: 700 }}>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ padding: "12px", borderRadius: "10px", border: "1px solid #cbd5e1", font: "inherit" }}
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              fontWeight: 700,
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {isLoading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "#64748b" }}>
          <a href="/admin/login" style={{ color: "#0f172a", textDecoration: "none", fontWeight: 700 }}>
            Sou administrador
          </a>
        </p>
      </section>
    </main>
  );
}
