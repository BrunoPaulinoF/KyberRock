import { parseToledoLine } from "./toledo-protocol-parser.js";
import { normalizeParsedReading } from "./toledo-reading.js";
import type { ParsedToledoReading, ToledoSerialConfig } from "./toledo-types.js";
import type { ScaleReading } from "../scale-adapter.js";
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

export function createToledoSerialAdapter(
  createTransport: SerialTransportFactory
): ToledoSerialAdapter {
  let transport: SerialTransport | null = null;
  let state: ToledoConnectionState = "disconnected";
  let lastReading: ParsedToledoReading | null = null;
  let lastReadingAt: string | null = null;
  let errorMessage: string | null = null;
  let reconnectCount = 0;
  let config: ToledoSerialConfig | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = "";
  const listeners: Array<(reading: ParsedToledoReading) => void> = [];

  function getDeviceId(): string | undefined {
    return config?.path;
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

  function closeTransport(): void {
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
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    closeTransport();
    state = "disconnected";
    config = null;
    reconnectCount = 0;
    buffer = "";
  }

  function scheduleReconnect(): void {
    if (!config) return;

    const maxAttempts = config.maxReconnectAttempts ?? 10;
    const interval = config.reconnectIntervalMs ?? 5000;

    if (reconnectCount >= maxAttempts) {
      state = "error";
      errorMessage = `Falha ao reconectar apos ${maxAttempts} tentativas.`;
      return;
    }

    reconnectCount++;
    state = "connecting";

    reconnectTimer = setTimeout(() => {
      if (config) {
        void attemptConnect(config).catch(() => {
          // attemptConnect ja agenda a proxima tentativa em caso de falha
        });
      }
    }, interval);
  }

  function handleChunk(chunk: Uint8Array): void {
    buffer += Buffer.from(chunk).toString("binary");

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

    candidate.onData(handleChunk);

    candidate.onError((err: Error) => {
      errorMessage = err.message;
      // Erro depois de conectado: derruba e tenta reconectar
      if (transport === candidate) {
        state = "error";
        closeTransport();
        scheduleReconnect();
      }
    });

    candidate.onClose(() => {
      if (transport === candidate && state === "connected") {
        transport = null;
        state = "disconnected";
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
    reconnectCount = 0;
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
      if (reading) return reading;

      throw new Error("Nenhuma leitura disponivel da balanca.");
    },

    getStatus(): ToledoTcpAdapterStatus {
      return {
        state,
        lastReading,
        lastReadingAt,
        errorMessage,
        reconnectAttempts: reconnectCount
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
