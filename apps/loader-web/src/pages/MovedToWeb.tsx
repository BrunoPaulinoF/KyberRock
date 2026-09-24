import { useEffect } from "react";

import { kyberrockWebUrl } from "../config/supabase-config";

/** Tempo para a pessoa ler o aviso antes de ir sozinha para o KyberRock Web. */
const REDIRECT_DELAY_MS = 4000;

/**
 * O carregador e o comercial nao entram mais por este portal: a fila de carregamento (feita
 * para celular e tablet) e o relatorio de vendas do comercial, junto com cadastro de cliente e
 * preco, moram no KyberRock Web (`apps/web`) — o mesmo login funciona la. Quem chega pelas
 * rotas antigas (`/`, `/login`, `/loader`, `/relatorios`, e o app instalado no celular, que
 * abre em `/`) cai aqui e segue para o site. O portal ficou so com o painel da Kybernan.
 */
export function MovedToWeb() {
  const target = kyberrockWebUrl;

  useEffect(() => {
    if (!target) return undefined;
    const timer = window.setTimeout(() => window.location.replace(target), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [target]);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="moved-title">
        <div className="auth-card-header">
          <img className="auth-card-logo" src="/kyberrocklogo.png" alt="KyberRock" />
          <div>
            <h1 id="moved-title" className="auth-card-title">
              O acesso mudou de lugar
            </h1>
            <p className="auth-card-subtitle">
              Carregador e comercial agora entram pelo KyberRock Web.
            </p>
          </div>
        </div>

        <div className="auth-notice">
          <strong>!</strong>
          <p>
            Use o <strong>mesmo e-mail e a mesma senha</strong> de antes. No celular, abra o site e
            toque em <strong>Instalar app</strong> para ter o atalho de novo.
          </p>
        </div>

        {target ? (
          <>
            <a className="primary-action" href={target}>
              Abrir o KyberRock Web
            </a>
            <p className="auth-switch">Voce vai ser levado para la em alguns segundos.</p>
          </>
        ) : (
          <p className="auth-switch">
            Peca o endereco do KyberRock Web ao administrador da sua pedreira.
          </p>
        )}

        <p className="auth-switch">
          Administrador da Kybernan? <a href="/admin/login">Entrar no painel</a>
        </p>
      </section>
    </main>
  );
}
