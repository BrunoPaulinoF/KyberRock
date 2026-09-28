import "./price-code.css";

import {
  Ban,
  CheckCircle2,
  Copy,
  KeyRound,
  ListChecks,
  ShieldCheck,
  Tag,
  Trash2,
  UserCheck
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeskPanel } from "../components/desk";
import { PriceHistory } from "../components/PriceHistory";
import { Alert, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import {
  formatPriceCode,
  readPriceCode,
  secondsLeft,
  type PriceCodeResponse,
  type PriceCodeState
} from "../lib/price-code";

/** Nova tentativa quando a busca falha (sem internet, nuvem fora do ar). */
const RETRY_MS = 5_000;
/** Raio do anel de contagem (SVG de 132 px). */
const RING_RADIUS = 58;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Tela "Senha de preco" (comercial e administrador): o codigo de 6 digitos que libera mudar
 * preco e excluir cadastro para quem nao e do comercial. Ele troca sozinho a cada 45 s, sem
 * fim, e o vencido nao vale mais — por isso a tela mostra quanto tempo falta e busca o proximo
 * assim que o atual vence. Quem calcula e a `web-api` (`price_code`); ver `lib/price-code.ts`.
 */
export function PriceCodePage() {
  const toast = useToast();
  const [state, setState] = useState<PriceCodeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fetching = useRef(false);
  const retryAt = useRef(0);

  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const result = await callWebApi("price_code");
      const next = readPriceCode(result as unknown as Partial<PriceCodeResponse>, Date.now());
      if (!next) throw new Error("A nuvem respondeu sem a senha. Tente de novo.");
      setState(next);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, "Nao foi possivel buscar a senha."));
      retryAt.current = Date.now() + RETRY_MS;
    } finally {
      fetching.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [load]);

  const left = state ? secondsLeft(state, now) : 0;
  const expired = !state || left === 0;

  // Venceu: busca o proximo. Falhou: tenta de novo em alguns segundos.
  useEffect(() => {
    if (expired && now >= retryAt.current) void load();
  }, [expired, now, load]);

  const period = state?.periodSeconds ?? 45;
  const fraction = state && !expired ? Math.min(1, left / period) : 0;
  const ending = !expired && left <= 10;
  const digits = state && !expired ? formatPriceCode(state.code) : null;

  async function copy() {
    if (!state || expired) return;
    try {
      await navigator.clipboard.writeText(state.code);
      toast.push("Senha copiada.");
    } catch {
      toast.push("Nao foi possivel copiar. Leia os numeros na tela.", "error");
    }
  }

  return (
    <DeskPanel>
      <div className="pc">
        <header className="pc-head">
          <span className="pc-head-icon" aria-hidden="true">
            <KeyRound size={20} />
          </span>
          <div>
            <h1 className="desk-title">Senha de preco</h1>
            <p className="pc-head-text">
              O codigo que libera mudar preco e excluir cadastro para quem nao e do comercial. Ele
              troca sozinho a cada {period} segundos.
            </p>
          </div>
        </header>

        {error && <Alert kind="error">{error}</Alert>}

        <div className="pc-grid">
          <section className={`pc-code-card${ending ? " ending" : ""}`} aria-live="polite">
            <span className="pc-label">Senha de agora</span>
            {digits ? (
              <span
                className="pc-code"
                aria-label={`Senha ${state?.code.split("").join(" ")}`}
                translate="no"
              >
                {digits.split("").map((char, index) =>
                  char === " " ? (
                    <span key={index} className="pc-code-gap" aria-hidden="true" />
                  ) : (
                    <span key={index} className="pc-digit" aria-hidden="true">
                      {char}
                    </span>
                  )
                )}
              </span>
            ) : (
              <span className="pc-loading">
                {error ? "Sem senha no momento" : "Buscando a senha..."}
              </span>
            )}

            <div className="pc-timer">
              <svg
                className="pc-ring"
                viewBox="0 0 132 132"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={period}
                aria-valuenow={left}
                aria-label="Tempo ate a senha trocar"
              >
                <circle className="pc-ring-track" cx="66" cy="66" r={RING_RADIUS} />
                <circle
                  className="pc-ring-value"
                  cx="66"
                  cy="66"
                  r={RING_RADIUS}
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * (1 - fraction)}
                />
                <text className="pc-ring-number" x="66" y="64" textAnchor="middle">
                  {expired ? "—" : left}
                </text>
                <text className="pc-ring-unit" x="66" y="86" textAnchor="middle">
                  {left === 1 ? "segundo" : "segundos"}
                </text>
              </svg>
              <div className="pc-timer-text">
                <strong>
                  {expired ? "Trocando..." : ending ? "Vai trocar agora" : "Ainda vale"}
                </strong>
                <span>
                  {ending
                    ? "Se for ditar agora, espere a proxima senha aparecer."
                    : "Passe os 6 numeros para quem pediu. A senha vencida nao funciona mais."}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void copy()}
                  disabled={!digits}
                >
                  <Copy size={15} />
                  Copiar senha
                </button>
              </div>
            </div>
          </section>

          <div className="pc-info">
            <section className="pc-card">
              <h2>
                <ListChecks size={16} aria-hidden="true" /> Como usar
              </h2>
              <ol className="pc-steps">
                <li>A pessoa pede a senha na balanca ou no site.</li>
                <li>Voce le os 6 numeros desta tela para ela.</li>
                <li>Ela digita antes do anel acabar. Trocou? Passe a nova.</li>
              </ol>
            </section>

            <section className="pc-card">
              <h2>
                <CheckCircle2 size={16} aria-hidden="true" /> O que a senha libera
              </h2>
              <ul className="pc-list">
                <li>
                  <Tag size={15} aria-hidden="true" /> Mudar preco — padrao, especial do cliente e o
                  preco da pesagem. Preco especial mudado fica no historico abaixo.
                </li>
                <li>
                  <Trash2 size={15} aria-hidden="true" /> Excluir cliente, transportadora, motorista
                  e placa no site.
                </li>
                <li>
                  <Ban size={15} aria-hidden="true" /> Na balanca: limpar operacoes e liberar o
                  relatorio financeiro.
                </li>
              </ul>
            </section>

            <section className="pc-card">
              <h2>
                <UserCheck size={16} aria-hidden="true" /> Quem precisa pedir
              </h2>
              <ul className="pc-roles">
                <li>
                  <span>Operacao</span>
                  <strong className="pc-tag ask">Sempre pede</strong>
                </li>
                <li>
                  <span>Gestor</span>
                  <strong className="pc-tag maybe">Se marcado no painel</strong>
                </li>
                <li>
                  <span>Comercial e Administrador</span>
                  <strong className="pc-tag free">Nao precisam</strong>
                </li>
              </ul>
            </section>

            <section className="pc-card pc-safety">
              <h2>
                <ShieldCheck size={16} aria-hidden="true" /> Seguranca
              </h2>
              <p>
                So vale a senha que esta na tela agora. Cinco tentativas erradas travam quem digitou
                por 15 minutos. Nao precisa anotar nem mandar por mensagem: ela muda sozinha.
              </p>
            </section>
          </div>
        </div>
      </div>
      {/* O que foi feito com a senha: cada alteracao de preco especial, na hora. */}
      <div className="pc-history">
        <PriceHistory />
      </div>
    </DeskPanel>
  );
}
