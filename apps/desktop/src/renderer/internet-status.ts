import { useEffect, useRef, useState } from "react";

/**
 * "Tem internet?" de verdade, para a trava de telas (`offline-lock.ts`).
 *
 * `navigator.onLine` sozinho nao serve: ele so fica falso quando TODAS as placas de
 * rede do Windows caem. Com adaptador virtual (VPN, Hyper-V, VirtualBox) ou com o
 * cabo ligado num roteador sem internet, ele continua dizendo "online" e a trava
 * nunca disparava. Por isso o app pergunta ao processo principal, de tempos em
 * tempos, se algum destino na internet responde (`desktop:probe-internet`).
 *
 * `navigator.onLine` ainda e usado no sentido que ele acerta: quando diz "offline",
 * a rede caiu mesmo, e a trava liga na hora, sem esperar o proximo teste.
 */

/** Intervalo entre testes enquanto ha internet. */
export const INTERNET_PROBE_ONLINE_INTERVAL_MS = 10_000;
/** Sem internet testa mais vezes, para liberar as telas logo que ela voltar. */
export const INTERNET_PROBE_OFFLINE_INTERVAL_MS = 5_000;
/** Falhas seguidas antes de declarar "caiu": um teste perdido nao trava a balanca. */
export const INTERNET_FAILURES_TO_GO_OFFLINE = 2;

export interface InternetState {
  online: boolean;
  /** Testes seguidos que falharam. */
  failures: number;
}

export function initialInternetState(networkUp: boolean): InternetState {
  return networkUp ? { online: true, failures: 0 } : forcedOfflineState();
}

/** A placa de rede avisou que caiu: trava na hora. */
export function forcedOfflineState(): InternetState {
  return { online: false, failures: INTERNET_FAILURES_TO_GO_OFFLINE };
}

/** Um teste que passou libera na hora; um que falhou so trava na N-esima vez seguida. */
export function nextInternetState(previous: InternetState, probeOk: boolean): InternetState {
  if (probeOk) return { online: true, failures: 0 };
  const failures = previous.failures + 1;
  return { online: failures < INTERNET_FAILURES_TO_GO_OFFLINE, failures };
}

/**
 * Acompanha a internet. `probe` e o teste do processo principal; sem ele (testes,
 * navegador fora do Electron) vale so o `navigator.onLine`.
 */
export function useInternetStatus(probe: (() => Promise<boolean>) | null): boolean {
  const [state, setState] = useState<InternetState>(() => initialInternetState(navigator.onLine));
  const stateRef = useRef(state);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let timer: number | undefined;

    const apply = (next: InternetState) => {
      stateRef.current = next;
      setState((current) =>
        current.online === next.online && current.failures === next.failures ? current : next
      );
    };

    const schedule = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void run(),
        stateRef.current.online
          ? INTERNET_PROBE_ONLINE_INTERVAL_MS
          : INTERNET_PROBE_OFFLINE_INTERVAL_MS
      );
    };

    const run = async () => {
      if (cancelled || running) return;
      running = true;
      let ok: boolean;
      if (!navigator.onLine) {
        ok = false;
      } else if (!probe) {
        ok = true;
      } else {
        try {
          ok = await probe();
        } catch {
          ok = false;
        }
      }
      running = false;
      if (cancelled) return;
      apply(nextInternetState(stateRef.current, ok));
      schedule();
    };

    const handleOffline = () => apply(forcedOfflineState());
    const handleOnline = () => void run();

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [probe]);

  return state.online;
}
