import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { supabaseConfig } from "../config/supabase-config";

// ---------------------------------------------------------------------------
// Pagina do link temporario de conexao do WhatsApp.
//
// Quem abre isto e o dono do celular, no proprio celular, com o operador da
// balanca do outro lado da linha esperando. E publica: nao ha login, e nao pode
// haver -- quem recebeu o link nao tem conta no sistema. Quem protege e o token
// de 256 bits do endereco e o prazo de 15 minutos, ambos conferidos no servidor
// a cada consulta.
//
// A pagina mora AQUI, e nao na Edge Function, porque as Edge Functions
// respondem HTML como `text/plain` com `nosniff` (protecao anti-phishing do
// dominio `*.supabase.co`): a mesma pagina servida de la chegaria ao celular do
// convidado como codigo-fonte. O que atravessa esse filtro e JSON -- e e so
// isso que a funcao devolve: o QR ja pronto, em data URL.
//
// Estilo proprio, sem depender do CSS do painel: esta e a unica tela do site
// que um estranho a operacao abre, quase sempre num celular, e ela precisa
// funcionar sozinha.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3000;

type LinkState = "loading" | "active" | "expired" | "revoked" | "connected" | "offline";

interface StateResponse {
  state?: string;
  companyName?: string | null;
  expiresAt?: string | null;
  status?: string | null;
  qrcode?: string | null;
  paircode?: string | null;
  profileName?: string | null;
  error?: string | null;
}

function isTerminalState(value: string): value is "expired" | "revoked" | "connected" {
  return value === "expired" || value === "revoked" || value === "connected";
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Endpoint de estado da Edge Function, montado a partir do projeto configurado. */
export function buildStateUrl(supabaseUrl: string, token: string): string {
  const base = supabaseUrl.trim().replace(/\/+$/, "");
  return `${base}/functions/v1/whatsapp-link/c/${encodeURIComponent(token)}/state`;
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    background: "#0f172a",
    color: "#e2e8f0",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  },
  card: {
    width: "min(420px, 100%)",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "16px",
    padding: "24px",
    textAlign: "center" as const,
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)"
  },
  brand: {
    margin: "0 0 6px 0",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "#94a3b8"
  },
  title: { margin: "0 0 6px 0", fontSize: "19px", color: "#f8fafc" },
  text: { margin: "0 0 12px 0", fontSize: "14px", lineHeight: 1.5, color: "#cbd5f5" },
  muted: { margin: "0 0 12px 0", fontSize: "13px", lineHeight: 1.5, color: "#94a3b8" },
  icon: { fontSize: "44px", lineHeight: 1, marginBottom: "10px" },
  qrFrame: {
    margin: "14px auto 10px auto",
    width: "260px",
    maxWidth: "100%",
    aspectRatio: "1 / 1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#ffffff",
    borderRadius: "12px",
    padding: "10px"
  },
  qrImage: { width: "100%", height: "100%", imageRendering: "pixelated" as const },
  qrPlaceholder: { color: "#475569", fontSize: "13px", padding: "0 16px" },
  countdown: (ending: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 12px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: 700,
    background: ending ? "#7f1d1d" : "#334155",
    color: ending ? "#fee2e2" : "#e2e8f0"
  }),
  steps: {
    textAlign: "left" as const,
    margin: "12px 0",
    paddingLeft: "20px",
    fontSize: "14px",
    lineHeight: 1.6,
    color: "#cbd5f5"
  },
  paircode: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: "20px",
    fontWeight: 800,
    letterSpacing: "0.16em",
    color: "#f8fafc"
  },
  alert: { margin: "0 0 12px 0", fontSize: "13px", color: "#fca5a5" }
};

function ClosedCard({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.brand}>KyberRock</p>
        <div style={styles.icon}>{icon}</div>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.text}>{message}</p>
        <p style={styles.muted}>
          Peca um link novo na tela de Relatorios do computador da balanca.
        </p>
      </div>
    </div>
  );
}

export function WhatsappConnect() {
  const { token = "" } = useParams<{ token: string }>();
  const [state, setState] = useState<LinkState>("loading");
  const [snapshot, setSnapshot] = useState<StateResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const expiresAtRef = useRef<number | null>(null);

  // O relogio da contagem e do proprio navegador, a partir do vencimento que
  // veio do servidor: consultar a nuvem de segundo em segundo so para mover um
  // numero gastaria bateria e dados. Quem decide continua sendo o servidor --
  // ele confere o prazo em toda resposta, entao relogio adiantado no celular
  // nao estica o link.
  const poll = useCallback(async () => {
    try {
      const response = await fetch(buildStateUrl(supabaseConfig.url, token), {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" }
      });
      const data = (await response.json().catch(() => ({}))) as StateResponse;
      const nextState = typeof data.state === "string" ? data.state : "expired";
      if (typeof data.expiresAt === "string") {
        const parsed = Date.parse(data.expiresAt);
        expiresAtRef.current = Number.isNaN(parsed) ? null : parsed;
      }
      setSnapshot(data);
      setState(isTerminalState(nextState) ? nextState : "active");
    } catch {
      // Sem rede o link nao acabou: a pagina avisa e continua tentando ate o
      // prazo vencer.
      setState((current) => (current === "loading" ? "offline" : current));
      setSnapshot((current) => ({
        ...(current ?? {}),
        error: "Sem conexao com o servidor. Tentando de novo..."
      }));
    }
  }, [token]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs =
    expiresAtRef.current === null ? null : Math.max(0, expiresAtRef.current - now);

  if (state === "loading") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={styles.brand}>KyberRock</p>
          <p style={styles.text}>Abrindo o link...</p>
        </div>
      </div>
    );
  }

  if (state === "connected") {
    return (
      <ClosedCard
        icon="✅"
        title="WhatsApp conectado!"
        message={
          snapshot?.profileName
            ? `Conectado como ${snapshot.profileName}. Pode fechar esta pagina.`
            : "Pareamento concluido. Pode fechar esta pagina."
        }
      />
    );
  }

  if (state === "revoked") {
    return (
      <ClosedCard
        icon="🚫"
        title="Link cancelado"
        message="Quem gerou este link cancelou o acesso antes de ele ser usado."
      />
    );
  }

  if (state === "expired" || remainingMs === 0) {
    return (
      <ClosedCard
        icon="⏳"
        title="Link expirado"
        message="Este link valia 15 minutos e ja passou do prazo."
      />
    );
  }

  const qrcode = snapshot?.qrcode ?? null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.brand}>KyberRock</p>
        <h1 style={styles.title}>
          {snapshot?.companyName
            ? `Conectar o WhatsApp de ${snapshot.companyName}`
            : "Conectar o WhatsApp"}
        </h1>
        <p style={styles.text}>
          Escaneie o QR code abaixo com o celular que vai enviar os relatorios.
        </p>

        <div style={styles.qrFrame}>
          {qrcode ? (
            <img src={qrcode} alt="QR code para conectar o WhatsApp" style={styles.qrImage} />
          ) : (
            <span style={styles.qrPlaceholder}>Gerando o QR code...</span>
          )}
        </div>

        {remainingMs === null ? null : (
          <span style={styles.countdown(remainingMs <= 60_000)}>
            Expira em {formatCountdown(remainingMs)}
          </span>
        )}

        {snapshot?.error ? <p style={styles.alert}>{snapshot.error}</p> : null}
        {snapshot?.paircode ? (
          <p style={styles.text}>
            Codigo de pareamento: <span style={styles.paircode}>{snapshot.paircode}</span>
          </p>
        ) : null}

        <ol style={styles.steps}>
          <li>Abra o WhatsApp no celular do numero da pedreira.</li>
          <li>
            Toque em <strong>Configuracoes &gt; Aparelhos conectados</strong>.
          </li>
          <li>
            Toque em <strong>Conectar aparelho</strong> e aponte a camera para o QR acima.
          </li>
        </ol>

        <p style={styles.muted}>
          O QR se renova sozinho enquanto esta pagina estiver aberta. Nao compartilhe este link:
          quem o abrir dentro do prazo pode conectar um aparelho ao WhatsApp da pedreira.
        </p>
      </div>
    </div>
  );
}
