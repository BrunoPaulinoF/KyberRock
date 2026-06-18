import { createConnection } from "node:net";
import type { Socket } from "node:net";

import { parseToledoLine } from "./toledo-protocol-parser.js";
import type { ParsedToledoReading, ToledoTcpConfig } from "./toledo-types.js";
import type { ScaleReading } from "../scale-adapter.js";

export type ToledoConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ToledoTcpAdapterStatus {
  state: ToledoConnectionState;
  lastReading: ParsedToledoReading | null;
  lastReadingAt: string | null;
  errorMessage: string | null;
  reconnectAttempts: number;
}

export interface ToledoTcpAdapter {
  /** Conectar ao indicador Toledo via TCP */
  connect(config: ToledoTcpConfig): Promise<void>;

  /** Desconectar do indicador */
  disconnect(): void;

  /** Obter a ultima leitura valida (nao bloqueia) */
  read(): Promise<ScaleReading>;

  /** Coletar leituras durante uma janela e devolver a media em kg */
  readSampled(options?: { durationMs?: number; sampleIntervalMs?: number }): Promise<ScaleReading>;

  /** Obter status da conexao e ultima leitura */
  getStatus(): ToledoTcpAdapterStatus;

  /** Registrar callback para leituras ao vivo (stream) */
  onReading(callback: (reading: ParsedToledoReading) => void): () => void;

  /** Limpar todos os callbacks */
  removeAllListeners(): void;
}

export function createToledoTcpAdapter(): ToledoTcpAdapter {
  let socket: Socket | null = null;
  let state: ToledoConnectionState = "disconnected";
  let lastReading: ParsedToledoReading | null = null;
  let lastReadingAt: string | null = null;
  let errorMessage: string | null = null;
  let reconnectCount = 0;
  let config: ToledoTcpConfig | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = "";
  const listeners: Array<(reading: ParsedToledoReading) => void> = [];

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

  function doDisconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.destroy();
      socket = null;
    }
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
      if (config) void attemptConnect(config);
    }, interval);
  }

  async function attemptConnect(cfg: ToledoTcpConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      socket = createConnection({ host: cfg.host, port: cfg.port }, () => {
        state = "connected";
        errorMessage = null;
        reconnectCount = 0;
        buffer = "";
        resolve();
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("binary");

        // Process complete lines (terminated by CR/LF)
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseToledoLine(Buffer.from(line, "binary"));
          if (parsed) {
            notify(parsed);
          }
        }
      });

      socket.on("error", (err: Error) => {
        errorMessage = err.message;
        state = "error";
        socket = null;
        scheduleReconnect();
        reject(err);
      });

      socket.on("close", () => {
        socket = null;
        if (state === "connected") {
          state = "disconnected";
          scheduleReconnect();
        }
      });

      const timeout = cfg.timeoutMs ?? 3000;
      socket.setTimeout(timeout, () => {
        if (state === "connecting") {
          socket?.destroy();
          reject(new Error(`Timeout de conexao (${timeout}ms)`));
        }
      });
    });
  }

  return {
    async connect(cfg: ToledoTcpConfig): Promise<void> {
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

      // Wait briefly for a stable reading if current one is unstable
      const maxWaitMs = 2000;
      const start = Date.now();

      while (Date.now() - start < maxWaitMs) {
        if (lastReading && lastReading.stable) {
          return {
            weightKg: lastReading.weightKg,
            unit: "kg",
            stable: true,
            capturedAt: lastReadingAt ?? new Date().toISOString()
          };
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // Return last reading even if unstable
      if (lastReading) {
        return {
          weightKg: lastReading.weightKg,
          unit: "kg",
          stable: lastReading.stable,
          capturedAt: lastReadingAt ?? new Date().toISOString()
        };
      }

      throw new Error("Nenhuma leitura disponivel da balanca.");
    },

    async readSampled(
      options: { durationMs?: number; sampleIntervalMs?: number } = {}
    ): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca nao esta conectada.");
      }

      const durationMs = Math.max(500, options.durationMs ?? 5000);
      const sampleIntervalMs = Math.max(50, options.sampleIntervalMs ?? 250);
      const samples: { weightKg: number; stable: boolean; at: number }[] = [];
      const start = Date.now();
      let lastSampleAt = 0;

      while (Date.now() - start < durationMs) {
        const now = Date.now();
        if (lastReading && now - lastSampleAt >= sampleIntervalMs) {
          samples.push({
            weightKg: lastReading.weightKg,
            stable: lastReading.stable,
            at: now
          });
          lastSampleAt = now;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      if (samples.length === 0 && lastReading) {
        samples.push({
          weightKg: lastReading.weightKg,
          stable: lastReading.stable,
          at: Date.now()
        });
      }

      if (samples.length === 0) {
        throw new Error("Nenhuma leitura recebida da balanca durante a amostragem.");
      }

      const mean = samples.reduce((sum, s) => sum + s.weightKg, 0) / samples.length;
      const allStable = samples.every((s) => s.stable);

      return {
        weightKg: Math.round(mean),
        unit: "kg",
        stable: allStable,
        capturedAt: new Date().toISOString()
      };
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
