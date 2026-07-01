import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";

export function LoaderLogin() {
  const { loginLoader, error, isLoader, clearError } = useAuth();
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

  function handleEmailChange(value: string) {
    setEmail(value);
    if (error) clearError();
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (error) clearError();
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel" aria-hidden="true">
        <div className="auth-logo-row">
          <span className="auth-logo-mark">
            <img src="/kyberrocklogo.png" alt="" />
          </span>
          <div>
            <p className="auth-kicker">Operacao em tempo real</p>
            <strong className="auth-brand-name">KyberRock Loader</strong>
          </div>
        </div>
        <div>
          <p className="auth-kicker">Fila de carregamento</p>
          <h2 className="auth-brand-title">Controle a fila sem perder o ritmo da balanca.</h2>
          <p className="auth-brand-copy">
            Visual limpo para patio, foco na placa, motorista, produto e confirmacao rapida de carga.
          </p>
        </div>
        <div className="auth-metrics">
          <div className="auth-metric">
            <strong>1</strong>
            <span>fila priorizada por chegada</span>
          </div>
          <div className="auth-metric">
            <strong>15s</strong>
            <span>atualizacao automatica</span>
          </div>
          <div className="auth-metric">
            <strong>0</strong>
            <span>complexidade no operador</span>
          </div>
        </div>
      </section>

      <section className="auth-card" aria-labelledby="loader-login-title">
        <div className="auth-card-header">
          <img className="auth-card-logo" src="/kyberrocklogo.png" alt="KyberRock" />
          <div>
            <h1 id="loader-login-title" className="auth-card-title">
              Acesso do carregador
            </h1>
            <p className="auth-card-subtitle">Entre para acompanhar as cargas da sua unidade.</p>
          </div>
        </div>

        {error && (
          <div className="auth-alert" role="alert">
            <strong>!</strong>
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="loader-login-email" className="field-label">
            E-mail
            <input
              className="field-input"
              id="loader-login-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              required
            />
          </label>
          <label htmlFor="loader-login-password" className="field-label">
            Senha
            <input
              className="field-input"
              id="loader-login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => handlePasswordChange(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={isLoading} className="primary-action">
            {isLoading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="auth-switch">
          Area administrativa? <a href="/admin/login">Entrar como administrador</a>
        </p>
      </section>
    </main>
  );
}
