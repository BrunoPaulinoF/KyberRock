import "./price-code.css";

import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "../components/ui";
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

/**
 * Tela "Senha de preco" (comercial e administrador): o codigo de 6 digitos que libera mudar
 * preco na balanca e no site para quem nao e do comercial. Ele troca sozinho a cada 45 s, sem
 * fim, e o vencido nao vale mais — por isso a tela mostra quanto tempo falta e busca o proximo
 * assim que o atual vence. Quem calcula e a `web-api` (`price_code`); ver `lib/price-code.ts`.
 */
export function PriceCodePage() {
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
  const progress = state ? Math.min(100, (left / period) * 100) : 0;
  const ending = !expired && left <= 10;

  return (
    <section className="price-code">
      <header className="price-code-header">
        <h2 className="price-code-title">
          <KeyRound size={18} /> Senha de preco
        </h2>
        <p className="price-code-hint">
          Passe esta senha para quem precisa alterar preco ou cadastro na balanca ou no site. Ela
          troca sozinha a cada {period} segundos e a senha vencida nao funciona mais.
        </p>
      </header>

      {error && <Alert kind="error">{error}</Alert>}

      <div className={`price-code-card${ending ? " ending" : ""}`}>
        {state && !expired ? (
          <>
            <span
              className="price-code-value"
              aria-label={`Senha ${state.code.split("").join(" ")}`}
            >
              {formatPriceCode(state.code)}
            </span>
            <div
              className="price-code-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={period}
              aria-valuenow={left}
              aria-label="Tempo ate a senha trocar"
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <span className="price-code-timer">
              {left === 1 ? "Troca em 1 segundo" : `Troca em ${left} segundos`}
            </span>
          </>
        ) : (
          <span className="price-code-loading">
            {error ? "Sem senha no momento" : "Buscando a senha..."}
          </span>
        )}
      </div>
    </section>
  );
}
