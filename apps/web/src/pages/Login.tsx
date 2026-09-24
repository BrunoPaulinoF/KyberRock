import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Field } from "../components/ui";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="login">
      <div className="panel">
        <div className="panel-body">
          <div className="login-brand">
            <img src="./logo.png" alt="" />
            <div>
              <h1>KyberRock</h1>
              <small>Comercial e gestao</small>
            </div>
          </div>
          <p className="sub">Entre com o e-mail e a senha cadastrados pela Kybernan.</p>
          {!isSupabaseConfigured() && (
            <div className="alert error">Site sem configuracao do Supabase (ver .env.example).</div>
          )}
          {error && <div className="alert error">{error}</div>}
          <form onSubmit={(e) => void onSubmit(e)}>
            <Field label="E-mail">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </Field>
            <Field label="Senha">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
