/**
 * Decide o que a tela de pesagem mostra sobre a conexao da balanca.
 *
 * O status do adaptador sozinho nao serve: ele oscila entre `connected`,
 * `disconnected` e `connecting` a cada reconexao automatica (queda de socket,
 * watchdog de silencio, indicador que so fala sob demanda). Com a UI presa a
 * esse valor, "Reconectar balanca" piscava na tela enquanto a balanca estava
 * funcionando e entregando peso — foi exatamente o que o operador relatou.
 *
 * Aqui as duas evidencias sao combinadas:
 *
 * 1. Leitura ao vivo recente prova que o link esta vivo. Se quadros estao
 *    chegando agora, a balanca esta utilizavel, diga o adaptador o que disser.
 * 2. Nenhuma das duas evidencias vale um pedido imediato de reconexao: o
 *    adaptador ja reconecta sozinho, entao o botao so aparece depois que a
 *    queda persiste — caso contrario a tela pisca a cada reconexao normal.
 */

export type ScaleConnectionState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Silencio maximo em que uma leitura ao vivo ainda prova que a balanca esta
 * respondendo. Fica acima do `staleReadingMs` (4s) do adaptador para nao
 * competir com o proprio watchdog dele.
 */
export const SCALE_LIVE_READING_GRACE_MS = 6000;

/**
 * Tempo que a queda precisa persistir antes de pedir acao ao operador. Cobre um
 * ciclo inteiro de reconexao automatica (`reconnectIntervalMs` = 5s) com folga,
 * para a reconexao silenciosa acontecer sem ninguem clicar em nada.
 */
export const SCALE_RECONNECT_PROMPT_DELAY_MS = 12_000;

export interface ScaleLinkInput {
  /** Estado relatado pelo adaptador na ultima consulta de status. */
  state: ScaleConnectionState;
  /** Instante (ms) da ultima leitura recebida pelo stream ao vivo; null se nenhuma. */
  lastReadingAt: number | null;
  /** Desde quando o adaptador esta fora de `connected` (ms); null enquanto conectado. */
  degradedSince: number | null;
  /** Relogio de referencia (ms). */
  now: number;
}

export interface ScaleLinkViewModel {
  /** Balanca utilizavel: adaptador conectado ou leituras chegando agora. */
  usable: boolean;
  /** Vale pedir reconexao manual ao operador. */
  showReconnect: boolean;
  /** Cor do indicador: verde / ambar / vermelho. */
  tone: "connected" | "connecting" | "down";
}

export function buildScaleLinkViewModel(input: ScaleLinkInput): ScaleLinkViewModel {
  const receivingLiveReadings =
    input.lastReadingAt !== null && input.now - input.lastReadingAt <= SCALE_LIVE_READING_GRACE_MS;
  const usable = input.state === "connected" || receivingLiveReadings;

  if (usable) {
    return { usable: true, showReconnect: false, tone: "connected" };
  }

  const degradedForMs =
    input.degradedSince === null ? 0 : Math.max(0, input.now - input.degradedSince);
  const showReconnect = degradedForMs >= SCALE_RECONNECT_PROMPT_DELAY_MS;

  return {
    usable: false,
    showReconnect,
    tone: showReconnect ? "down" : "connecting"
  };
}

/**
 * Mantem o marco de inicio da queda entre duas consultas de status. Conectado
 * zera o marco; qualquer outro estado preserva o marco anterior, senao a
 * carencia reiniciaria a cada consulta e o botao nunca apareceria.
 */
export function trackScaleDegradedSince(
  previous: number | null,
  state: ScaleConnectionState,
  now: number
): number | null {
  if (state === "connected") return null;
  return previous ?? now;
}

/** Mensagem mostrada abaixo do peso, coerente com o que o botao esta dizendo. */
export function buildScaleLinkMessage(
  link: ScaleLinkViewModel,
  status: { state: ScaleConnectionState; stale: boolean; errorMessage?: string | null }
): string {
  if (link.usable) {
    // Socket aberto nao significa balanca transmitindo: sem leitura recente o
    // rotulo precisa dizer isso, senao a tela afirma "conectada" enquanto a
    // captura de peso falha.
    if (status.state === "connected" && status.stale) {
      return "Conectada, mas sem leitura do indicador";
    }
    return "Leitura em tempo real";
  }

  if (!link.showReconnect) {
    return "Reconectando a balanca...";
  }

  // Qualquer estado, nao so `error`: desde que a reconexao deixou de desistir, uma
  // balanca fora do ar fica indefinidamente em `connecting`, e prender o diagnostico
  // ao estado `error` esconderia do operador justamente a causa da queda
  // ("Timeout de conexao", "Porta COM3 nao encontrada", baud rate divergente).
  if (status.errorMessage) {
    return status.errorMessage;
  }

  return "Balanca desconectada";
}
