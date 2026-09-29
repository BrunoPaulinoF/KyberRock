import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import "../admin-ui.css";
import { publicAsset } from "../../lib/public-asset";
import { Button, Field, Note } from "../components";
import { ADMIN_HOME_PATH, hasAdminSession, loginAdmin } from "../lib/admin-session";

/**
 * Entrada do painel da plataforma (console da Kybernan), em `/admin/login`.
 *
 * Usuario e senha sao os da PLATAFORMA — os mesmos do painel antigo do loader-web, guardados nos
 * secrets das Edge Functions —, e nao um login de pedreira: quem cria pedreira, unidade, login do
 * site e codigo de ativacao nao pode depender de um cadastro que ele mesmo administra.
 */
export function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (hasAdminSession()) return <Navigate to={ADMIN_HOME_PATH} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginAdmin(username, password);
      navigate(ADMIN_HOME_PATH, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar.");
      setBusy(false);
    }
  }

  return (
    <main className="adm adm-login">
      <section className="adm-login-card" aria-labelledby="adm-login-title">
        <div className="adm-login-brand">
          <img src={publicAsset("logo-128.webp")} alt="" />
          <div>
            <h1 id="adm-login-title">KyberRock Console</h1>
            <p>Administração da plataforma</p>
          </div>
        </div>

        <Note>
          <strong>Acesso restrito à equipe Kybernan.</strong> Use o mesmo usuário e a mesma senha do
          painel administrativo de sempre.
        </Note>

        {error && <Note tone="danger">{error}</Note>}

        <form className="adm-form adm-login-form" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Usuário">
            <input
              className="adm-input"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Senha">
            <input
              className="adm-input"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Entrando..." : "Entrar no painel"}
          </Button>
        </form>

        <p className="adm-login-foot">
          <Link to="/login">Entrar como usuário da pedreira</Link>
          <Link to="/">Voltar para o site</Link>
        </p>
      </section>
    </main>
  );
}
