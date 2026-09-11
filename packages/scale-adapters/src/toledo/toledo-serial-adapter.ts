import { reconnectDelayMs } from "./reconnect-backoff.js";
import { parseToledoLine } from "./toledo-protocol-parser.js";
import { normalizeParsedReading } from "./toledo-reading.js";
import type { ParsedToledoReading, ToledoSerialConfig } from "./toledo-types.js";
import type { ScaleReading } from "../scale-adapter.js";
import { DEFAULT_SILENCE_ROTATE_MS, DEFAULT_STALE_READING_MS } from "./toledo-tcp-adapter.js";
import type { ToledoConnectionState, ToledoTcpAdapterStatus } from "./toledo-tcp-adapter.js";

/**
 * Transporte serial minimo injetado pelo app (que possui a dependencia nativa
 * `serialport`). O pacote scale-adapters fica livre de modulos nativos e o
 * adaptador pode ser testado com um transporte fake.
 */
export interface SerialTransport {
  /** Abre a porta. Rejeita com erro claro se a porta nao existir/estiver em uso. */
  open(): Promise<void>;
  /** Fecha a porta. Nunca deve lancar. */
  close(): void;
  onData(callback: (chunk: Uint8Array) => void): void;
  onError(callback: (error: Error) => void): void;
  onClose(callback: () => void): void;
}

export type SerialTransportFactory = (options: {
  path: string;
  baudRate: number;
}) => SerialTransport;

export interface ToledoSerialAdapter {
  /** Conectar ao indicador Toledo via porta serial (COM/USB) */
  connect(config: ToledoSerialConfig): Promise<void>;

  /** Desconectar do indicador */
  disconnect(): void;

  /** Obter a ultima leitura recebida normalizada (nao bloqueia) */
  read(): Promise<ScaleReading>;

  /** Obter status da conexao e ultima leitura */
  getStatus(): ToledoTcpAdapterStatus;

  /** Registrar callback para leituras ao vivo (stream) */
  onReading(callback: (reading: ParsedToledoReading) => void): () => void;

  /** Limpar todos os callbacks */
  removeAllListeners(): void;
}

/** Diagnostico exibido quando a porta esta aberta e o indicador nao fala. */
const SILENT_PORT_MESSAGE =
  "Porta aberta, mas o indicador nao envia nada. Verifique o cabo entre o indicador " +
  "e o computador, se o indicador esta em transmissao continua e se nenhum outro " +
  "programa esta ocupando a porta.";

export function createToledoSerialAdapter(
  createTransport: SerialTransportFactory
): ToledoSerialAdapter {
  let transport: SerialTransport | null = null;
  let state: ToledoConnectionState = "disconnected";
  let lastReading: ParsedToledoReading | null = null;
  let lastReadingAt: string | null = null;
  let lastDataAt: number | null = null;
  // Inicio da sessao atual: enquanto nenhum byte chegou, e daqui que se mede ha
  // quanto tempo o indicador esta calado.
  let sessionOpenedAt: number | null = null;
  let lastRawSample: string | null = null;
  let errorMessage: string | null = null;
  let reconnectCount = 0;
  let config: ToledoSerialConfig | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let dataWatchdog: ReturnType<typeof setTimeout> | null = null;
  // Invalida os callbacks de portas antigas. O transporte entrega `onData` a quem
  // registrou, e a fabrica cria um objeto novo por tentativa: sem este selo, uma
  // porta que ainda nao terminou de fechar seguia alimentando `lastDataAt` e o
  // adaptador acreditava estar recebendo peso de um canal ja abandonado.
  let generation = 0;
  let buffer = "";
  const listeners: Array<(reading: ParsedToledoReading) => void> = [];

  function getDeviceId(): string | undefined {
    return config?.path;
  }

  function staleThresholdMs(): number {
    return config?.staleReadingMs ?? DEFAULT_STALE_READING_MS;
  }

  function silenceRotateThresholdMs(): number {
    return Math.max(staleThresholdMs(), config?.silenceRotateMs ?? DEFAULT_SILENCE_ROTATE_MS);
  }

  /** Ha quanto tempo nenhum byte chega nesta sessao. */
  function silentForMs(now: number): number {
    const since = lastDataAt ?? sessionOpenedAt ?? now;
    return Math.max(0, now - since);
  }

  function isStale(): boolean {
    if (!lastReadingAt) return true;
    const receivedAt = Date.parse(lastReadingAt);
    if (!Number.isFinite(receivedAt)) return true;
    return Date.now() - receivedAt > staleThresholdMs();
  }

  /**
   * Zera apenas o PESO. O rastro de trafego bruto (`lastDataAt`, `lastRawSample`)
   * fica de fora de proposito: e com ele que se mede ha quanto tempo o indicador
   * esta calado e se separa "porta muda" de "porta entregando lixo" (baud errado).
   * Apagando os dois juntos, o relogio do silencio voltava a zero toda vez que a
   * leitura vencia e a rotacao da porta nunca chegava a acontecer. A limpeza do
   * rastro acontece onde a SESSAO acaba: `doDisconnect` e a abertura da proxima porta.
   */
  function clearLastReading(): void {
    lastReading = null;
    lastReadingAt = null;
  }

  function clearSessionTrace(): void {
    lastDataAt = null;
    sessionOpenedAt = null;
    lastRawSample = null;
  }

  /** Ha bytes recentes na porta, independentemente de formarem quadro valido. */
  function isReceivingRawData(): boolean {
    if (lastDataAt === null) return false;
    return Date.now() - lastDataAt <= staleThresholdMs();
  }

  function getLastScaleReading(): ScaleReading | null {
    if (!lastReading || !lastReadingAt) return null;
    return normalizeParsedReading(lastReading, lastReadingAt, "toledo-serial", getDeviceId());
  }

  function notify(reading: ParsedToledoReading): void {
    lastReading = reading;
    lastReadingAt = new Date().toISOString();
    for (const listener of listeners) {
      try {
        listener(reading);
      } catch {
        // Ignore listener errors
      }
    }
  }

  function clearDataWatchdog(): void {
    if (dataWatchdog) {
      clearTimeout(dataWatchdog);
      dataWatchdog = null;
    }
  }

  /**
   * Vigia o silencio da porta em dois estagios, igual ao adaptador TCP.
   *
   * 1. Passado `staleReadingMs`, o peso exibido morre na hora — a tela nunca pode
   *    seguir mostrando o caminhao anterior.
   * 2. Passado `silenceRotateMs` de silencio absoluto, a porta e fechada e reaberta.
   *
   * Este segundo estagio nao existia aqui, e era a falha: uma porta COM que fica
   * ABERTA e muda (cabo solto no lado do indicador, conversor USB que perde o canal,
   * indicador desligado e religado) nao emite `close` nem `error`, entao o adaptador
   * ficava `connected` para sempre, `read()` respondia "sem leitura recente" a cada
   * captura e a unica saida era reiniciar o aplicativo — foi assim que a operacao
   * acabou pesando tudo no braco. Reabrir a porta e o que devolve o canal.
   */
  function armDataWatchdog(): void {
    clearDataWatchdog();
    const currentGeneration = generation;
    dataWatchdog = setTimeout(() => {
      if (currentGeneration !== generation || state !== "connected") return;

      const silent = silentForMs(Date.now());
      clearLastReading();

      if (silent >= silenceRotateThresholdMs()) {
        errorMessage = SILENT_PORT_MESSAGE;
        closeTransport();
        state = "disconnected";
        scheduleReconnect();
        return;
      }

      // Porta mantida aberta: enquanto ela estiver de pe, o primeiro quadro que o
      // indicador enviar chega na hora. Derrubar ja aqui transformaria um indicador
      // momentaneamente calado num ciclo de reabertura a cada poucos segundos.
      armDataWatchdog();
    }, staleThresholdMs());
  }

  function closeTransport(): void {
    clearDataWatchdog();
    if (!transport) return;
    const current = transport;
    transport = null;
    try {
      current.close();
    } catch {
      // Fechar nunca deve derrubar o app
    }
  }

  function doDisconnect(): void {
    generation++;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    closeTransport();
    state = "disconnected";
    config = null;
    reconnectCount = 0;
    buffer = "";
    // Zera a leitura: peso de uma sessao anterior nunca pode reaparecer apos reconectar.
    clearLastReading();
    clearSessionTrace();
  }

  function scheduleReconnect(): void {
    if (!config) return;

    // Erro e fechamento podem chegar juntos na mesma queda; sem limpar o timer
    // anterior, duas tentativas concorrentes disputavam a mesma porta COM.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const maxAttempts = config.maxReconnectAttempts ?? 10;
    const interval = config.reconnectIntervalMs ?? 5000;

    if (reconnectCount >= maxAttempts) {
      state = "error";
      errorMessage = `Falha ao reconectar apos ${maxAttempts} tentativas.`;
      return;
    }

    reconnectCount++;
    state = "connecting";

    reconnectTimer = setTimeout(
      () => {
        if (config) {
          void attemptConnect(config).catch(() => {
            // attemptConnect ja agenda a proxima tentativa em caso de falha
          });
        }
      },
      reconnectDelayMs(reconnectCount, interval, config.reconnectBackoffMaxMs)
    );
  }

  function handleChunk(candidate: SerialTransport, chunk: Uint8Array): void {
    // So a porta viva fala pelo adaptador. Um conversor USB que demora a fechar
    // continuava entregando bytes depois de trocado, e esses bytes zeravam o
    // relogio do silencio de uma sessao que nem era mais essa.
    if (transport !== candidate) return;
    const text = Buffer.from(chunk).toString("binary");
    // Registrado antes do parser: numa porta serial, baud errado entrega lixo em vez
    // de silencio, e sem esta distincao os dois casos ficavam identicos na tela.
    lastDataAt = Date.now();
    // Abrir a porta nao prova nada — dados, sim. Zerar a contagem no `open` fazia o
    // backoff nunca engatar numa porta que abre e cai em seguida (conversor USB
    // instavel), e a reconexao ficava batendo de 5 em 5s indefinidamente.
    reconnectCount = 0;
    lastRawSample = text.replace(/[^\x20-\x7e]/g, ".").slice(-120);
    // Trafego de verdade limpa o diagnostico de porta muda; o watchdog recomeca a
    // contar a partir de agora.
    if (errorMessage === SILENT_PORT_MESSAGE) errorMessage = null;
    armDataWatchdog();
    buffer += text;

    // Protecao contra indicadores que nunca enviam CR/LF: nao deixa o buffer crescer sem limite
    if (buffer.length > 4096) {
      buffer = buffer.slice(-1024);
    }

    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseToledoLine(Buffer.from(line, "binary"));
      if (parsed) {
        notify(parsed);
      }
    }
  }

  async function attemptConnect(cfg: ToledoSerialConfig): Promise<void> {
    closeTransport();
    buffer = "";
    const candidate = createTransport({ path: cfg.path, baudRate: cfg.baudRate });

    const currentGeneration = generation;

    candidate.onData((chunk) => {
      if (currentGeneration !== generation) return;
      handleChunk(candidate, chunk);
    });

    candidate.onError((err: Error) => {
      if (currentGeneration !== generation) return;
      errorMessage = err.message;
      // Erro depois de conectado: derruba e tenta reconectar
      if (transport === candidate) {
        state = "error";
        closeTransport();
        scheduleReconnect();
        return;
      }
      // Erro numa porta que nunca chegou a ser adotada (falhou no meio da abertura,
      // ou ja foi trocada). Fechar mesmo assim e obrigatorio: no Windows o handle
      // solto mantem a COM ocupada e a tentativa seguinte morre em "porta em uso"
      // ate o aplicativo ser reiniciado.
      try {
        candidate.close();
      } catch {
        // Fechar nunca deve derrubar o app
      }
    });

    candidate.onClose(() => {
      if (currentGeneration !== generation) return;
      if (transport === candidate && state === "connected") {
        transport = null;
        clearDataWatchdog();
        state = "disconnected";
        // Paridade com o adaptador TCP: o peso morre junto com a sessao, senao o
        // status segue publicando a ultima leitura de uma porta ja fechada.
        clearLastReading();
        scheduleReconnect();
      }
    });

    try {
      await candidate.open();
    } catch (error) {
      try {
        candidate.close();
      } catch {
        // ignore
      }
      errorMessage = error instanceof Error ? error.message : "Falha ao abrir a porta serial.";
      state = "error";
      scheduleReconnect();
      throw error instanceof Error ? error : new Error(errorMessage);
    }

    transport = candidate;
    state = "connected";
    errorMessage = null;
    // Cada sessao comeca sem historico de trafego: o que chegou na porta anterior
    // nao diz nada sobre esta, e o relogio do silencio precisa partir de agora.
    lastDataAt = null;
    lastRawSample = null;
    sessionOpenedAt = Date.now();
    armDataWatchdog();
  }

  return {
    async connect(cfg: ToledoSerialConfig): Promise<void> {
      doDisconnect();
      config = cfg;
      state = "connecting";
      errorMessage = null;
      reconnectCount = 0;
      await attemptConnect(cfg);
    },

    disconnect: doDisconnect,

    async read(): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca nao esta conectada.");
      }

      const reading = getLastScaleReading();
      if (!reading) {
        throw new Error("Nenhuma leitura disponivel da balanca.");
      }

      // Ha leitura, mas ja venceu: melhor falhar do que devolver um peso antigo.
      if (isStale()) {
        throw new Error(
          "Balanca conectada, mas sem leitura recente. Confirme se o indicador esta em " +
            "modo de transmissao continua e se o baud rate da porta esta correto."
        );
      }

      return reading;
    },

    getStatus(): ToledoTcpAdapterStatus {
      const stale = isStale();
      const receivingRawData = isReceivingRawData();
      // Porta viva entregando conteudo ilegivel: quase sempre baud rate divergente.
      const protocolMismatch =
        state === "connected" && stale && receivingRawData
          ? "Recebendo dados na porta, mas nenhum quadro reconhecido como Toledo. " +
            `Confira o baud rate configurado. Amostra: "${lastRawSample ?? ""}"`
          : null;

      return {
        state,
        // Leitura vencida nao sai daqui: evita a tela continuar exibindo o peso do
        // caminhao anterior quando o indicador para de transmitir.
        lastReading: stale ? null : lastReading,
        lastReadingAt,
        errorMessage: protocolMismatch ?? errorMessage,
        reconnectAttempts: reconnectCount,
        stale,
        receivingRawData,
        lastRawSample
      };
    },

    onReading(callback): () => void {
      listeners.push(callback);
      return () => {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },

    removeAllListeners(): void {
      listeners.length = 0;
    }
  };
}
