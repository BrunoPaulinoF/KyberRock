import { Eye, EyeOff, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { isStandaloneDisplay } from "../lib/pwa-install";
import { publicAsset } from "../lib/public-asset";
import { isSupabaseConfigured } from "../lib/supabase";

/**
 * Login do site (e do app instalado no celular do carregador). Tem a mesma cara do cartao de
 * login da pagina de apresentacao — fundo de pedra escura, cartao claro e botao ambar —, para o
 * cliente que entra pelo `/login` nao cair numa tela que parece de outro produto.
 */
export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <img src={publicAsset("logo-128.webp")} alt="" width={48} height={48} />
          <div>
            <strong>KyberRock</strong>
            <span>Pesagem, carregamento e faturamento</span>
          </div>
        </div>
        <h1 id="login-title">Entrar</h1>
        <p className="login-sub">Use o e-mail e a senha cadastrados pela Kybernan.</p>
        {!isSupabaseConfigured() && (
          <div className="alert error" role="alert">
            Site sem configuração do Supabase (ver .env.example).
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <form className="login-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="login-field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              name="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label className="login-field">
            <span>Senha</span>
            <span className="login-password">
              <input
                className="input"
                type={showPassword ? "text" : "password"}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="login-reveal"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                aria-pressed={showPassword}
                title={showPassword ? "Esconder senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          <button className="login-submit" type="submit" disabled={busy}>
            <LogIn size={18} aria-hidden="true" />
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p className="login-roles">
          Carregador, comercial, gestão e monitoramento entram por aqui: cada um cai direto na tela
          do seu perfil.
        </p>
        {/* No app instalado (carregador) a pagina de apresentacao nao faz sentido. */}
        {!isStandaloneDisplay() && (
          <p className="login-foot">
            <Link to="/">Conheça o KyberRock</Link>
          </p>
        )}
      </section>
    </main>
  );
}
