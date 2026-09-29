import "./landing.css";

import {
  ArrowRight,
  Building2,
  ChevronDown,
  CircleCheck,
  Download,
  FileText,
  KeyRound,
  Layers,
  LogIn,
  MonitorPlay,
  Moon,
  Printer,
  Receipt,
  Scale,
  Send,
  ShieldCheck,
  Smartphone,
  Sun,
  Truck,
  WifiOff
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

import { useAuth } from "../lib/auth";
import {
  buildWhatsAppLink,
  DESKTOP_DOWNLOAD_URL,
  formatWhatsAppNumber,
  GUIDE_PDF_URL,
  HAS_WHATSAPP_NUMBER,
  WHATSAPP_NUMBER
} from "../lib/marketing";
import { publicAsset } from "../lib/public-asset";
import { isSupabaseConfigured } from "../lib/supabase-env";
import { useTheme } from "../lib/theme";

/**
 * Pagina de apresentacao do KyberRock, em `/` para quem nao esta logado.
 *
 * Substitui a do loader-web (que saiu do ar junto com ele) e faz as duas coisas que aquela
 * fazia: vende o produto para quem chega pelo link e deixa o cliente entrar sem clique a mais —
 * o login fica no topo, ao lado da apresentacao. Quem ja esta logado nem ve esta pagina (vai
 * direto para a tela inicial do perfil), e o app instalado no celular abre no `/login`.
 *
 * Estilo em `landing.css`, tudo abaixo de `.lp`, com as cores do tema do site (`--kr-*`): a
 * pagina acompanha o claro/escuro como o resto do KyberRock. O topo e escuro nos dois temas.
 */

const PAGE_TITLE = "KyberRock | Pesagem, carregamento e faturamento para pedreiras";

const whatsAppLink = buildWhatsAppLink();

function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21h.01c5.45 0 9.89-4.44 9.89-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.24-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

/** Link para o WhatsApp comercial, sempre em aba nova. */
function WhatsAppButton({
  children,
  size = "md",
  variant = "solid"
}: {
  children: ReactNode;
  size?: "md" | "lg";
  variant?: "solid" | "ghost";
}) {
  return (
    <a
      className={`lp-btn lp-btn-whatsapp${size === "lg" ? " lp-btn-lg" : ""}${
        variant === "ghost" ? " lp-btn-whatsapp-ghost" : ""
      }`}
      href={whatsAppLink}
      target="_blank"
      rel="noreferrer"
    >
      <WhatsAppIcon />
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Demonstracao do produto (no lugar de um video): a balanca pesando e a fila no celular.
// ---------------------------------------------------------------------------

const DEMO_WEIGHTS = [18420, 18760, 19340, 19880, 20140, 20260];

function useDemoWeight(): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % DEMO_WEIGHTS.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  return DEMO_WEIGHTS[index];
}

const DEMO_YARD = [
  { plate: "RKX-2B47", product: "Brita 1", status: "Na balança", tone: "active" },
  { plate: "QPD-7F12", product: "Pó de pedra", status: "Carregando", tone: "loading" },
  { plate: "NBC-9A03", product: "Rachão", status: "Aguardando", tone: "wait" }
] as const;

function ProductDemo() {
  const weight = useDemoWeight();
  const full = weight >= DEMO_WEIGHTS[DEMO_WEIGHTS.length - 1];

  return (
    <figure
      className="lp-demo"
      aria-label="Demonstração do KyberRock: balança e fila do carregador"
    >
      <div className="lp-demo-stage">
        <div className="lp-window">
          <div className="lp-window-bar">
            <span className="lp-window-dot" />
            <span className="lp-window-dot" />
            <span className="lp-window-dot" />
            <span className="lp-window-title">KyberRock Desktop · Balança da portaria</span>
            <span className="lp-live">
              <span className="lp-live-dot" /> ao vivo
            </span>
          </div>
          <div className="lp-window-body">
            <div className="lp-scale">
              <p className="lp-scale-label">Peso na balança</p>
              <p className="lp-scale-weight">
                {weight.toLocaleString("pt-BR")} <small>kg</small>
              </p>
              <div className="lp-scale-plate">
                <span className="lp-plate">RKX-2B47</span>
                <span>Brita 1 · Cliente Construtora Serra</span>
              </div>
              <div className="lp-scale-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((weight / 24000) * 100)}%` }} />
              </div>
              <p className={`lp-scale-status${full ? " is-stable" : ""}`}>
                {full ? "Peso estável · pronto para imprimir" : "Pesando..."}
              </p>
            </div>
            <div className="lp-yard">
              <p className="lp-yard-title">Pátio agora</p>
              <ul>
                {DEMO_YARD.map((truck) => (
                  <li key={truck.plate}>
                    <span className="lp-plate lp-plate-sm">{truck.plate}</span>
                    <span className="lp-yard-info">
                      <span className="lp-yard-product">{truck.product}</span>
                      <em className={`lp-tag lp-tag-${truck.tone}`}>{truck.status}</em>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="lp-yard-events">
                <span>
                  <Printer size={14} aria-hidden="true" /> Ticket COD 003249 impresso
                </span>
                <span className="is-ok">
                  <CircleCheck size={14} aria-hidden="true" /> Pedido enviado ao OMIE
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="lp-phone" aria-hidden="true">
          <div className="lp-phone-notch" />
          <p className="lp-phone-title">Fila de carregamento</p>
          <div className="lp-phone-card is-first">
            <strong>1º · QPD-7F12</strong>
            <span>Pó de pedra · 18 t</span>
            <span className="lp-phone-action">Concluir carga</span>
          </div>
          <div className="lp-phone-card">
            <strong>2º · NBC-9A03</strong>
            <span>Rachão · 22 t</span>
          </div>
          <div className="lp-phone-card">
            <strong>3º · TRA-4C81</strong>
            <span>Brita 0 · 15 t</span>
          </div>
        </div>
      </div>

      <figcaption className="lp-demo-caption">
        Balança, pátio e escritório na mesma tela — funcionando mesmo sem internet.
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Conteudo
// ---------------------------------------------------------------------------

const PROOF = [
  { title: "Funciona sem internet", copy: "a balança nunca para por falta de conexão" },
  { title: "OMIE integrado", copy: "pedido de venda sem redigitar nada" },
  { title: "Tempo real", copy: "pátio, fila e vendas atualizados em segundos" }
];

const PLACES: Array<{ icon: LucideIcon; kicker: string; title: string; copy: string }> = [
  {
    icon: Scale,
    kicker: "Na balança",
    title: "KyberRock Desktop",
    copy: "Pesa, imprime o ticket e fecha a venda no computador da portaria. Tudo fica gravado ali mesmo, com ou sem internet."
  },
  {
    icon: Smartphone,
    kicker: "No pátio",
    title: "Celular do carregador",
    copy: "A carga aparece na fila do celular por ordem de chegada. Carregou, concluiu: a balança já fica sabendo."
  },
  {
    icon: Building2,
    kicker: "No escritório",
    title: "KyberRock Web",
    copy: "Cadastros, preços, relatórios e o painel de vendas ao vivo, de qualquer navegador — para o comercial e para a gestão."
  }
];

const FEATURES: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: Scale,
    title: "Peso direto do indicador",
    copy: "Leitura automática da balança rodoviária, pela porta serial ou pela rede. Sem digitar peso, sem erro no ticket."
  },
  {
    icon: WifiOff,
    title: "Funciona sem internet",
    copy: "A pesagem nasce e fecha no computador da balança. Caiu a conexão? A pedreira continua pesando e tudo sobe sozinho na volta."
  },
  {
    icon: Truck,
    title: "Fila do carregador",
    copy: "Placa, produto e ordem de chegada no celular de quem está na pá carregadeira. Sem rádio e sem gritaria."
  },
  {
    icon: Receipt,
    title: "Pedido no OMIE sozinho",
    copy: "Fechou a pesagem, o pedido de venda vai para o OMIE com a data certa — e de lá saem a nota e a conta a receber."
  },
  {
    icon: Printer,
    title: "Ticket na hora",
    copy: "Cupom de 80 mm para o motorista e relatórios em PDF e Excel para o escritório, com um clique."
  },
  {
    icon: MonitorPlay,
    title: "Vendas ao vivo",
    copy: "Painel de monitoramento com toneladas, faturamento e caminhões no pátio, atualizado em segundos."
  },
  {
    icon: Send,
    title: "Fechamento do dia",
    copy: "Resumo de cargas, produtos e faturamento chegando para a gestão por e-mail e WhatsApp, todo fim de dia."
  },
  {
    icon: KeyRound,
    title: "Preço protegido",
    copy: "Mudar preço só com a senha que troca a cada 45 segundos, e toda alteração fica registrada no histórico."
  },
  {
    icon: Layers,
    title: "Várias balanças, um cadastro",
    copy: "Cliente, preço e placa cadastrados em um computador aparecem nos outros em segundos."
  }
];

const STEPS = [
  {
    title: "O caminhão chega e pesa vazio",
    copy: "O operador registra placa, motorista, cliente e produto em segundos."
  },
  {
    title: "O carregador recebe a carga",
    copy: "A carga entra na fila do celular do carregador, por ordem de chegada."
  },
  {
    title: "Pesa cheio e imprime o ticket",
    copy: "Peso líquido e valor calculados na hora; o motorista sai com o ticket na mão."
  },
  {
    title: "O faturamento acontece sozinho",
    copy: "A venda sobe para a nuvem e vira pedido no OMIE, sem ninguém redigitar nada."
  }
];

const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: "Precisa de internet para pesar?",
    answer:
      "Não. A pesagem é gravada no computador da balança e o ticket sai na hora. A internet serve para enviar as vendas à nuvem e ao OMIE, e esse envio acontece sozinho quando a conexão volta. O computador só precisa se conectar pelo menos uma vez a cada 7 dias para validar a licença."
  },
  {
    question: "Funciona com a minha balança?",
    answer:
      "O KyberRock lê o indicador da balança pela porta serial (COM/USB) ou pela rede (TCP/IP), incluindo os indicadores Toledo. Na demonstração a gente confere o modelo da sua pedreira."
  },
  {
    question: "Como funciona a integração com o OMIE?",
    answer:
      "Ao fechar a pesagem, o KyberRock cria no OMIE o pedido de venda (ou a ordem de serviço) com a data da saída do caminhão, e dali saem a nota fiscal e a conta a receber. Clientes, produtos e formas de pagamento ficam sincronizados com o OMIE, então ninguém cadastra duas vezes."
  },
  {
    question: "Dá para ter mais de uma balança?",
    answer:
      "Sim. Cada computador é ativado com o código da pedreira, e o que é cadastrado em um — cliente, preço, placa, motorista — aparece nos outros em segundos."
  },
  {
    question: "O carregador precisa instalar alguma coisa?",
    answer:
      "Não. Ele entra pelo navegador do celular e, se quiser, instala o site como aplicativo na tela inicial com um toque."
  },
  {
    question: "Meus dados ficam seguros?",
    answer:
      "Cada pessoa entra com o próprio login e vê só o que o perfil dela permite. A integração com o OMIE roda no servidor: a chave de acesso do OMIE nunca fica no computador da balança nem no navegador."
  },
  {
    question: "Como é a instalação?",
    answer:
      "Você baixa o KyberRock Desktop, digita o código de ativação da pedreira e pronto. O guia em PDF mostra o passo a passo, e as atualizações chegam sozinhas, sem parar a operação."
  }
];

// ---------------------------------------------------------------------------
// Login de quem ja e cliente
// ---------------------------------------------------------------------------

function LoginCard() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      // A tela inicial depende do perfil (carregador, comercial, gestao): quem decide e o `/`.
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha no login.");
      setBusy(false);
    }
  }

  return (
    <section id="entrar" className="lp-login" aria-labelledby="lp-login-title">
      <div className="lp-login-head">
        <img src={publicAsset("logo-128.webp")} alt="" />
        <div>
          <h2 id="lp-login-title">Já é cliente?</h2>
          <p>Entre com o e-mail e a senha cadastrados pela Kybernan.</p>
        </div>
      </div>

      {!isSupabaseConfigured() && (
        <p className="lp-alert" role="alert">
          Site sem configuração do Supabase.
        </p>
      )}
      {error && (
        <p className="lp-alert" role="alert">
          {error}
        </p>
      )}

      <form className="lp-login-form" onSubmit={(event) => void onSubmit(event)}>
        <label className="lp-field">
          <span>E-mail</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="lp-field">
          <span>Senha</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button className="lp-btn lp-btn-primary lp-btn-block" type="submit" disabled={busy}>
          <LogIn size={18} aria-hidden="true" />
          {busy ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="lp-login-roles">
        Carregador, comercial, gestão e monitoramento entram por aqui: cada um cai direto na tela do
        seu perfil.
      </p>

      <div className="lp-login-links">
        <a href={DESKTOP_DOWNLOAD_URL} rel="noopener">
          <Download size={16} aria-hidden="true" />
          Baixar o KyberRock Desktop
        </a>
        <a href={GUIDE_PDF_URL} download>
          <FileText size={16} aria-hidden="true" />
          Guia de instalação e uso (PDF)
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="lp-icon-btn"
      onClick={toggle}
      aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
      title={dark ? "Tema claro" : "Tema escuro"}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Landing() {
  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  const year = new Date().getFullYear();

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-brand" href="#inicio">
          <img src={publicAsset("logo-128.webp")} alt="" />
          <strong>KyberRock</strong>
        </a>
        <nav className="lp-nav-links" aria-label="Seções da página">
          <a href="#plataforma">Plataforma</a>
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>
        <div className="lp-nav-actions">
          <ThemeToggle />
          <a className="lp-btn lp-btn-quiet lp-nav-enter" href="#entrar">
            <LogIn size={16} aria-hidden="true" />
            Entrar
          </a>
          <WhatsAppButton>
            <span className="lp-hide-sm">Falar no WhatsApp</span>
            <span className="lp-show-sm">WhatsApp</span>
          </WhatsAppButton>
        </div>
      </header>

      <main id="inicio">
        <section className="lp-hero">
          <div className="lp-hero-inner">
            <div className="lp-pitch">
              <p className="lp-kicker">Sistema de pesagem e carregamento para pedreiras</p>
              <h1>
                Sua pedreira pesando, carregando e faturando{" "}
                <span>sem papel e sem fila parada.</span>
              </h1>
              <p className="lp-lead">
                O KyberRock liga a balança, o carregador no pátio e o escritório num fluxo só.
                Ticket impresso na hora, fila no celular do carregador e pedido de venda direto no
                OMIE — mesmo quando a internet cai.
              </p>
              <div className="lp-hero-actions">
                <WhatsAppButton size="lg">Quero uma demonstração</WhatsAppButton>
                <a className="lp-btn lp-btn-outline lp-btn-lg" href="#recursos">
                  Conhecer os recursos
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
              </div>
              <ul className="lp-proof">
                {PROOF.map((item) => (
                  <li key={item.title}>
                    <CircleCheck size={18} aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong> {item.copy}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <LoginCard />
          </div>
        </section>

        <section className="lp-showcase" aria-label="Demonstração">
          <ProductDemo />
        </section>

        <section id="plataforma" className="lp-section">
          <div className="lp-section-head">
            <p className="lp-kicker">Plataforma</p>
            <h2>Um sistema, três lugares</h2>
            <p>
              Cada pessoa usa o KyberRock onde trabalha — e todo mundo enxerga a mesma operação.
            </p>
          </div>
          <div className="lp-places">
            {PLACES.map((place) => {
              const Icon = place.icon;
              return (
                <article key={place.title} className="lp-place">
                  <span className="lp-icon" aria-hidden="true">
                    <Icon size={24} />
                  </span>
                  <p className="lp-place-kicker">{place.kicker}</p>
                  <h3>{place.title}</h3>
                  <p>{place.copy}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="recursos" className="lp-section lp-section-alt">
          <div className="lp-section-head">
            <p className="lp-kicker">Recursos</p>
            <h2>Tudo o que o pátio precisa, nada que atrapalhe</h2>
            <p>
              Feito junto com quem opera balança todos os dias: menos cliques, menos papel e o
              escritório recebendo tudo pronto.
            </p>
          </div>
          <div className="lp-features">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="lp-feature">
                  <span className="lp-icon" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.copy}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="como-funciona" className="lp-section">
          <div className="lp-section-head">
            <p className="lp-kicker">Como funciona</p>
            <h2>Da portaria ao faturamento em 4 passos</h2>
          </div>
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

        <section id="duvidas" className="lp-section lp-section-alt">
          <div className="lp-section-head">
            <p className="lp-kicker">Dúvidas</p>
            <h2>Perguntas frequentes</h2>
          </div>
          <div className="lp-faq">
            {FAQ.map((item) => (
              <details key={item.question} className="lp-faq-item">
                <summary>
                  {item.question}
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="contato" className="lp-cta">
          <div className="lp-cta-inner">
            <ShieldCheck size={32} aria-hidden="true" />
            <h2>Quer ver o KyberRock rodando na sua pedreira?</h2>
            <p>
              Agende uma demonstração sem compromisso: mostramos a balança pesando, o ticket saindo
              e o pedido chegando no OMIE com os dados da sua operação.
            </p>
            <div className="lp-cta-actions">
              <WhatsAppButton size="lg">Chamar no WhatsApp</WhatsAppButton>
              <a className="lp-btn lp-btn-outline lp-btn-lg" href={DESKTOP_DOWNLOAD_URL}>
                <Download size={18} aria-hidden="true" />
                Baixar o app desktop
              </a>
            </div>
            {HAS_WHATSAPP_NUMBER && (
              <p className="lp-cta-number">{formatWhatsAppNumber(WHATSAPP_NUMBER)}</p>
            )}
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <img src={publicAsset("logo-128.webp")} alt="" />
          <span>
            <strong>KyberRock</strong> — pesagem, carregamento e faturamento para pedreiras. Um
            produto Kybernan.
          </span>
        </div>
        <nav className="lp-footer-links" aria-label="Links do rodapé">
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#duvidas">Dúvidas</a>
          <a href={DESKTOP_DOWNLOAD_URL} rel="noopener">
            Baixar app desktop
          </a>
          <a href={GUIDE_PDF_URL} download>
            Guia (PDF)
          </a>
          <a href="#entrar">Entrar</a>
        </nav>
        <p className="lp-footer-copy">© {year} Kybernan. Todos os direitos reservados.</p>
      </footer>

      <a
        className="lp-whatsapp-float"
        href={whatsAppLink}
        target="_blank"
        rel="noreferrer"
        aria-label="Conversar com a equipe KyberRock no WhatsApp"
      >
        <WhatsAppIcon size={26} />
      </a>
    </div>
  );
}
