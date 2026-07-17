import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";

export function AdminLogin() {
  const { loginAdmin, error, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Se ja estiver logado como admin, redireciona para o dashboard. Feito num efeito (nao no
  // corpo do render) porque navigate() durante o render dispara uma atualizacao de estado do
  // router enquanto outro componente renderiza ("Cannot update a component while rendering a
  // different component") e pode causar render duplo.
  useEffect(() => {
    if (isAdmin) {
      navigate("/admin", { replace: true });
    }
  }, [isAdmin, navigate]);

  if (isAdmin) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);
    try {
      await loginAdmin(
        String(formData.get("username") ?? ""),
        String(formData.get("password") ?? "")
      );
      // Login bem-sucedido, navega para o admin dashboard
      navigate("/admin", { replace: true });
    } catch {
      // O contexto de auth ja expoe a mensagem para a tela.
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel" aria-hidden="true">
        <div className="auth-logo-row">
          <span className="auth-logo-mark">
            <img src="/kyberrocklogo.png" alt="" />
          </span>
          <div>
            <p className="auth-kicker">Painel administrativo</p>
            <strong className="auth-brand-name">KyberRock Admin</strong>
          </div>
        </div>
        <div>
          <p className="auth-kicker">Gestao centralizada</p>
          <h2 className="auth-brand-title">Empresas, usuarios e licencas em uma tela mais segura.</h2>
          <p className="auth-brand-copy">
            Interface administrativa com foco em leitura, decisao rapida e menor risco operacional.
          </p>
        </div>
        <div className="auth-metrics">
          <div className="auth-metric">
            <strong>ADM</strong>
            <span>acesso restrito</span>
          </div>
          <div className="auth-metric">
            <strong>API</strong>
            <span>segredos no Supabase</span>
          </div>
          <div className="auth-metric">
            <strong>WEB</strong>
            <span>controle por unidade</span>
          </div>
        </div>
      </section>

      <section className="auth-card" aria-labelledby="admin-login-title">
        <div className="auth-card-header">
          <img className="auth-card-logo" src="/kyberrocklogo.png" alt="KyberRock" />
          <div>
            <h1 id="admin-login-title" className="auth-card-title">
              Portal do administrador
            </h1>
            <p className="auth-card-subtitle">Gerencie empresas, unidades e acessos.</p>
          </div>
        </div>

        <div className="auth-notice">
          <strong>!</strong>
          <p>
            <strong>Acesso restrito.</strong> <br />
            Usuario e senha configurados nas variaveis seguras do Supabase.
          </p>
        </div>

        {error && (
          <div className="auth-alert" role="alert">
            <strong>!</strong>
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label">
            Usuario
            <input
              className="field-input"
              name="username"
              placeholder="Usuario admin"
              autoComplete="username"
              required
            />
          </label>
          <label className="field-label">
            Senha
            <input
              className="field-input"
              name="password"
              type="password"
              placeholder="Senha"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" disabled={isSubmitting} className="primary-action">
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="auth-switch">
          Operacao de patio? <a href="/login">Entrar como carregador</a>
        </p>
      </section>
    </main>
  );
}
