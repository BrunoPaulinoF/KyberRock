import { useState } from "react";

import { useAuth } from "../contexts/AuthContext";

export function AdminLogin() {
  const { loginAdmin, error } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);
    try {
      await loginAdmin(String(formData.get("username") ?? ""), String(formData.get("password") ?? ""));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <section style={{ background: "#fff", padding: "48px", borderRadius: "20px", boxShadow: "0 18px 60px rgba(15, 23, 42, 0.08)", maxWidth: "420px", width: "100%" }}>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "32px" }}>KyberRock</h1>
        <p style={{ color: "#64748b", margin: "0 0 24px 0" }}>Portal do Administrador</p>

        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
          <p style={{ margin: 0, fontSize: "14px", color: "#92400e" }}>
            <strong>Acesso restrito</strong><br />
            Usuario e senha configurados nas variaveis seguras do Supabase.
          </p>
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #ef4444", borderRadius: "12px", padding: "12px", marginBottom: "16px", color: "#991b1b", fontSize: "14px" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <input name="username" placeholder="Usuario admin" autoComplete="username" required style={{ padding: "12px", borderRadius: "10px", border: "1px solid #cbd5e1" }} />
          <input name="password" type="password" placeholder="Senha" autoComplete="current-password" required style={{ padding: "12px", borderRadius: "10px", border: "1px solid #cbd5e1" }} />
          <button type="submit" disabled={isSubmitting} style={{ width: "100%", padding: "14px", borderRadius: "12px", border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "#64748b" }}>
          <a href="/login" style={{ color: "#0f172a", textDecoration: "none", fontWeight: 700 }}>
            Sou carregador
          </a>
        </p>
      </section>
    </main>
  );
}
