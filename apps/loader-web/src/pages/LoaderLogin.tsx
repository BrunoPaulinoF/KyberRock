import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";
import {
  buildWhatsAppLink,
  WHATSAPP_DISPLAY_NUMBER
} from "../config/marketing";
import { desktopDownloadUrl } from "../lib/desktop-download";
import { documentationUrl } from "../lib/documentation";

const whatsAppLink = buildWhatsAppLink();

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21h.01c5.45 0 9.89-4.44 9.89-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.24-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <span className="lp-feature-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

// Simula a leitura "ao vivo" da balanca no mockup do hero, no lugar de um
// video real do produto. Troque por um <video> em public/ quando houver
// gravacao oficial.
const MOCK_WEIGHTS = [18420, 18760, 19340, 19880, 20140, 20260];

function useLiveWeight(): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % MOCK_WEIGHTS.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  return MOCK_WEIGHTS[index];
}

function ProductMockup() {
  const weight = useLiveWeight();

  return (
    <figure className="lp-mockup" aria-label="Demonstracao do painel de pesagem KyberRock">
      <div className="lp-mockup-window">
        <div className="lp-mockup-titlebar">
          <span className="lp-dot" />
          <span className="lp-dot" />
          <span className="lp-dot" />
          <span className="lp-mockup-title">KyberRock Desktop - Patio ao vivo</span>
          <span className="lp-live-pill">
            <span className="lp-live-dot" /> AO VIVO
          </span>
        </div>
        <div className="lp-mockup-body">
          <div className="lp-mockup-scale">
            <p className="lp-mockup-label">Balanca rodoviaria</p>
            <p className="lp-mockup-weight">
              {weight.toLocaleString("pt-BR")} <small>kg</small>
            </p>
            <p className="lp-mockup-plate">Placa RKX-2B47 - Brita 1</p>
            <div className="lp-mockup-bar">
              <span style={{ width: `${Math.round((weight / 24000) * 100)}%` }} />
            </div>
          </div>
          <ul className="lp-mockup-queue">
            <li>
              <strong>RKX-2B47</strong>
              <span>Carregando - Brita 1</span>
              <em className="lp-tag lp-tag-active">na balanca</em>
            </li>
            <li>
              <strong>QPD-7F12</strong>
              <span>Aguardando - Po de pedra</span>
              <em className="lp-tag">fila 1</em>
            </li>
            <li>
              <strong>NBC-9A03</strong>
              <span>Aguardando - Rachao</span>
              <em className="lp-tag">fila 2</em>
            </li>
          </ul>
        </div>
      </div>
      <figcaption className="lp-mockup-caption">
        Pesagem, fila e ticket em uma unica tela - funcionando mesmo sem internet.
      </figcaption>
    </figure>
  );
}

const FEATURES = [
  {
    title: "Pesagem direto da balanca",
    copy: "Leitura automatica do indicador, sem digitacao e sem erro de peso na hora do ticket.",
    icon: (
      <>
        <path d="M12 3v4" />
        <path d="M5 7h14l2 13H3L5 7Z" />
        <circle cx="12" cy="13" r="3.2" />
        <path d="M12 13l1.8-1.8" />
      </>
    )
  },
  {
    title: "Funciona sem internet",
    copy: "A operacao nasce e fecha no patio. Caiu a conexao? A pedreira continua pesando e faturando.",
    icon: (
      <>
        <path d="M12 3l8 4v5c0 4.6-3.2 8-8 9-4.8-1-8-4.4-8-9V7l8-4Z" />
        <path d="M9 12.5l2 2 4-4.5" />
      </>
    )
  },
  {
    title: "Fila do carregador em tempo real",
    copy: "O operador da pa ve placa, produto e ordem de chegada no celular. Sem radio, sem gritaria.",
    icon: (
      <>
        <path d="M3 16h10l1-4h4l3 4v3h-2" />
        <circle cx="7" cy="19" r="1.8" />
        <circle cx="16" cy="19" r="1.8" />
        <path d="M3 12V8h8v4" />
      </>
    )
  },
  {
    title: "Integracao com o ERP OMIE",
    copy: "Pedido de venda gerado automaticamente ao fechar a operacao, sem redigitar nota nenhuma.",
    icon: (
      <>
        <path d="M8 7h8M8 12h8M8 17h5" />
        <rect x="4" y="3" width="16" height="18" rx="3" />
      </>
    )
  },
  {
    title: "Ticket impresso na hora",
    copy: "Cupom de 80 mm para o motorista e relatorio A4 para o escritorio, com um clique.",
    icon: (
      <>
        <path d="M7 8V4h10v4" />
        <rect x="4" y="8" width="16" height="8" rx="2" />
        <path d="M8 16h8v4H8z" />
      </>
    )
  },
  {
    title: "Fechamento diario por e-mail",
    copy: "Resumo do dia com cargas, produtos e faturamento chegando na sua caixa de entrada.",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 8l9 6 9-6" />
      </>
    )
  }
];

const STEPS = [
  {
    title: "Caminhao chega e pesa vazio",
    copy: "O operador registra a entrada com placa, motorista e produto em segundos."
  },
  {
    title: "Carregador recebe o pedido",
    copy: "A carga aparece na fila do celular do carregador, priorizada por ordem de chegada."
  },
  {
    title: "Pesa cheio e imprime o ticket",
    copy: "Peso liquido calculado na hora, ticket na mao do motorista, operacao fechada no patio."
  },
  {
    title: "Faturamento automatico",
    copy: "O pedido sobe para a nuvem e vira pedido de venda no OMIE, sem retrabalho."
  }
];

export function LoaderLogin() {
  const { loginLoader, error, isLoader, isComercial, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isLoader) {
      navigate("/loader", { replace: true });
    } else if (isComercial) {
      navigate("/relatorios", { replace: true });
    }
  }, [isLoader, isComercial, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    try {
      await loginLoader(email, password);
      // O redirecionamento por papel (carregador vs. comercial) acontece no
      // useEffect acima, apos o perfil carregar.
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
    <div className="lp-page">
      <header className="lp-nav">
        <a className="lp-nav-brand" href="#inicio">
          <span className="auth-logo-mark lp-nav-logo">
            <img src="/kyberrocklogo.png" alt="" />
          </span>
          <strong>KyberRock</strong>
        </a>
        <nav className="lp-nav-links" aria-label="Secoes da pagina">
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#contato">Contato</a>
          <a href="#entrar">Entrar</a>
        </nav>
        <a className="lp-whatsapp-cta lp-nav-cta" href={whatsAppLink} target="_blank" rel="noreferrer">
          <WhatsAppIcon />
          Falar no WhatsApp
        </a>
      </header>

      <main id="inicio">
        <section className="lp-hero">
          <div className="lp-hero-pitch">
            <p className="auth-kicker">Sistema de pesagem e carregamento para pedreiras</p>
            <h1 className="lp-hero-title">
              Sua pedreira pesando, carregando e faturando <span>sem papel e sem fila parada</span>.
            </h1>
            <p className="lp-hero-copy">
              O KyberRock conecta a balanca, o carregador no patio e o seu ERP em um unico fluxo.
              Ticket impresso na hora, fila organizada no celular e pedido de venda gerado sozinho
              no OMIE - mesmo quando a internet cai.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-whatsapp-cta" href={whatsAppLink} target="_blank" rel="noreferrer">
                <WhatsAppIcon />
                Quero uma demonstracao
              </a>
              <a className="lp-ghost-cta" href="#recursos">
                Conhecer os recursos
              </a>
            </div>
            <ul className="lp-hero-proof">
              <li>
                <strong>100% offline-first</strong>
                <span>a balanca nunca para por falta de internet</span>
              </li>
              <li>
                <strong>OMIE integrado</strong>
                <span>pedido de venda sem redigitacao</span>
              </li>
              <li>
                <strong>15s</strong>
                <span>atualizacao da fila do carregador</span>
              </li>
            </ul>
            <ProductMockup />
          </div>

          <section id="entrar" className="auth-card lp-login-card" aria-labelledby="loader-login-title">
            <div className="auth-card-header">
              <img className="auth-card-logo" src="/kyberrocklogo.png" alt="KyberRock" />
              <div>
                <h1 id="loader-login-title" className="auth-card-title">
                  Acesso do carregador
                </h1>
                <p className="auth-card-subtitle">Ja e cliente? Entre para acompanhar as cargas da sua unidade.</p>
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

            <a className="secondary-action auth-download" href={desktopDownloadUrl} rel="noopener">
              Baixar o app desktop (versao mais recente)
            </a>

            <a className="secondary-action auth-download" href={documentationUrl} download>
              Baixar guia de instalacao e manual (PDF)
            </a>

            <p className="auth-switch">
              Area administrativa? <a href="/admin/login">Entrar como administrador</a>
            </p>

            <p className="lp-login-hint">
              Ainda nao e cliente?{" "}
              <a href={whatsAppLink} target="_blank" rel="noreferrer">
                Chame no WhatsApp
              </a>{" "}
              e veja o KyberRock rodando na sua pedreira.
            </p>
          </section>
        </section>

        <section id="recursos" className="lp-section">
          <p className="auth-kicker">Recursos</p>
          <h2 className="lp-section-title">Tudo que o patio precisa, nada que atrapalhe</h2>
          <p className="lp-section-copy">
            Feito junto com quem opera balanca todos os dias: menos cliques, menos papel e o
            escritorio recebendo tudo pronto.
          </p>
          <div className="lp-feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="lp-feature-card">
                <FeatureIcon>{feature.icon}</FeatureIcon>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="lp-section lp-section-alt">
          <p className="auth-kicker">Como funciona</p>
          <h2 className="lp-section-title">Da portaria ao faturamento em 4 passos</h2>
          <ol className="lp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="lp-step">
                <span className="lp-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="contato" className="lp-section lp-final-cta">
          <h2 className="lp-section-title">Quer ver o KyberRock rodando na sua pedreira?</h2>
          <p className="lp-section-copy">
            Agende uma demonstracao sem compromisso. Mostramos o sistema pesando, imprimindo ticket
            e gerando pedido no OMIE com os dados da sua operacao.
          </p>
          <a className="lp-whatsapp-cta lp-whatsapp-cta-lg" href={whatsAppLink} target="_blank" rel="noreferrer">
            <WhatsAppIcon />
            Chamar no WhatsApp
          </a>
          <p className="lp-contact-number">
            {WHATSAPP_DISPLAY_NUMBER} <em>(numero de exemplo - em breve o canal oficial)</em>
          </p>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <img src="/kyberrocklogo.png" alt="" />
          <span>KyberRock - operacao de pesagem e carregamento para pedreiras</span>
        </div>
        <nav className="lp-footer-links" aria-label="Links do rodape">
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href={desktopDownloadUrl} rel="noopener">
            Baixar app desktop
          </a>
          <a href={documentationUrl} download>
            Guia e manual (PDF)
          </a>
          <a href="/admin/login">Area administrativa</a>
        </nav>
      </footer>

      <a
        className="lp-whatsapp-float"
        href={whatsAppLink}
        target="_blank"
        rel="noreferrer"
        aria-label="Conversar com a equipe KyberRock no WhatsApp"
      >
        <WhatsAppIcon />
      </a>
    </div>
  );
}
