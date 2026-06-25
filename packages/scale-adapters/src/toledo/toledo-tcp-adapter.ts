import { createConnection } from "node:net";
import type { Socket } from "node:net";

import { parseToledoLine } from "./toledo-protocol-parser.js";
import type { ParsedToledoReading, ToledoTcpConfig } from "./toledo-types.js";
import type { ScaleReading, ScaleSamplingOptions, ScaleStatus } from "../scale-adapter.js";

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

  /** Obter a ultima leitura recebida normalizada (nao bloqueia) */
  read(): Promise<ScaleReading>;

  /** Aguardar uma leitura estavel, recente e valida sem calcular media */
  readSampled(options?: ScaleSamplingOptions): Promise<ScaleReading>;

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

  function getDeviceId(): string | undefined {
    return config ? `${config.host}:${config.port}` : undefined;
  }

  function getLastScaleReading(): ScaleReading | null {
    if (!lastReading || !lastReadingAt) return null;
    return normalizeParsedReading(lastReading, lastReadingAt, "toledo-tcp", getDeviceId());
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

      const reading = getLastScaleReading();
      if (reading) return reading;

      throw new Error("Nenhuma leitura disponivel da balanca.");
    },

    async readSampled(options: ScaleSamplingOptions = {}): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca nao esta conectada.");
      }

      const timeoutMs = Math.max(500, options.durationMs ?? 5000);
      const sampleIntervalMs = Math.max(50, options.sampleIntervalMs ?? 250);
      const minStableMs = Math.max(0, options.minStableMs ?? 0);
      const start = Date.now();
      const maxReadingAgeMs = Math.max(1500, minStableMs + sampleIntervalMs * 2);
      const maxVariationKg = options.maxVariationKg ?? 0;
      const minWeightKg = options.minWeightKg;
      let stableSince: number | null = null;
      let stableReferenceWeightKg: number | null = null;
      let lastStatus: ScaleStatus = "no_data";

      while (Date.now() - start < timeoutMs) {
        const now = Date.now();
        const reading = getLastScaleReading();
        if (!reading) {
          await delay(sampleIntervalMs);
          continue;
        }

        lastStatus = reading.status;
        const receivedAt = Date.parse(reading.receivedAt);
        if (
          !Number.isFinite(receivedAt) ||
          now - receivedAt > maxReadingAgeMs ||
          (receivedAt < start && start - receivedAt > maxReadingAgeMs)
        ) {
          await delay(sampleIntervalMs);
          continue;
        }

        if (reading.status !== "stable" || !reading.stable) {
          assertNonRecoverableStatus(reading);
          stableSince = null;
          stableReferenceWeightKg = null;
          await delay(sampleIntervalMs);
          continue;
        }

        if (minWeightKg !== undefined && reading.weightKg < minWeightKg) {
          throw new Error(
            `Peso abaixo do minimo configurado (${Math.round(reading.weightKg)} kg < ${minWeightKg} kg).`
          );
        }

        if (stableReferenceWeightKg === null) {
          stableReferenceWeightKg = reading.weightKg;
          stableSince = now;
        }

        if (Math.abs(reading.weightKg - stableReferenceWeightKg) > maxVariationKg) {
          stableReferenceWeightKg = reading.weightKg;
          stableSince = now;
        }

        if (stableSince !== null && now - stableSince >= minStableMs) {
          return { ...reading, capturedAt: new Date().toISOString() };
        }

        await delay(sampleIntervalMs);
      }

      if (lastStatus === "unstable") {
        throw new Error("Peso instavel informado pela balanca.");
      }
      throw new Error("Nenhuma leitura estavel e recente recebida da balanca.");
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

function normalizeParsedReading(
  reading: ParsedToledoReading,
  receivedAt: string,
  adapterName: string,
  deviceId?: string
): ScaleReading {
  const status = getScaleStatusFromParsedReading(reading);
  return {
    weightKg: Math.round(reading.weightKg),
    unit: "kg",
    status,
    stable: status === "stable",
    capturedAt: receivedAt,
    receivedAt,
    rawFrame: reading.raw,
    adapterName,
    deviceId
  };
}

function getScaleStatusFromParsedReading(reading: ParsedToledoReading): ScaleStatus {
  if (!Number.isFinite(reading.weightKg)) return "error";
  if (reading.statusFlags.outOfRange || reading.weightKg === 90_000) return "overload";
  if (reading.statusFlags.negative || reading.weightKg < 0) return "negative";
  if (!reading.stable || reading.statusFlags.inMotion) return "unstable";
  if (reading.statusFlags.atZero || reading.weightKg === 0) return "zero";
  return "stable";
}

function assertNonRecoverableStatus(reading: ScaleReading): void {
  switch (reading.status) {
    case "unstable":
    case "no_data":
      return;
    case "overload":
      throw new Error("Balanca em sobrecarga ou fora de alcance.");
    case "negative":
      throw new Error("Balanca informou peso negativo.");
    case "zero":
      throw new Error("Balanca sem peso util para captura.");
    case "stable":
      return;
    default:
      throw new Error("Balanca informou erro de leitura.");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
