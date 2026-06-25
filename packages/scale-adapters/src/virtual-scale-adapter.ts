import type { ParsedToledoReading } from "./toledo/toledo-types.js";
import type { ToledoTcpAdapter, ToledoConnectionState, ToledoTcpAdapterStatus } from "./toledo/toledo-tcp-adapter.js";
import type { ScaleReading, ScaleSamplingOptions, ScaleStatus } from "./scale-adapter.js";

export type VirtualScaleMode = "tcp" | "virtual";

export interface VirtualScaleStatus {
  mode: VirtualScaleMode;
  tcpStatus: ToledoTcpAdapterStatus;
  virtualConnected: boolean;
}

export function createVirtualScaleAdapter(): ToledoTcpAdapter & {
  setWeight: (weightKg: number) => void;
} {
  let state: ToledoConnectionState = "disconnected";
  let lastReading: ParsedToledoReading | null = null;
  let lastReadingAt: string | null = null;
  let errorMessage: string | null = null;
  const listeners: Array<(reading: ParsedToledoReading) => void> = [];

  function makeReading(weightKg: number): ParsedToledoReading {
    return {
      weightKg,
      unit: "kg",
      stable: true,
      statusFlags: {
        outOfRange: false,
        negative: weightKg < 0,
        atZero: weightKg === 0,
        inMotion: false,
        tareActive: false,
        isGross: true,
        isNet: false
      },
      raw: `VIRTUAL:${weightKg}`
    };
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

  return {
    async connect(): Promise<void> {
      state = "connected";
      errorMessage = null;
    },

    disconnect(): void {
      state = "disconnected";
      lastReading = null;
      lastReadingAt = null;
      errorMessage = null;
    },

    async read(): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca virtual nao esta conectada.");
      }

      if (!lastReading) {
        throw new Error("Nenhum peso informado na balanca virtual.");
      }

      return toScaleReading(lastReading, lastReadingAt ?? new Date().toISOString());
    },

    async readSampled(options: ScaleSamplingOptions = {}): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca virtual nao esta conectada.");
      }

      if (!lastReading) {
        throw new Error("Nenhum peso informado na balanca virtual.");
      }

      const minWeightKg = options.minWeightKg;
      const weightKg = lastReading.weightKg;
      const reading = toScaleReading(lastReading, lastReadingAt ?? new Date().toISOString());

      if (reading.status !== "stable" || !reading.stable) {
        throw new Error("Balanca virtual sem peso util para captura.");
      }

      if (minWeightKg !== undefined && weightKg < minWeightKg) {
        throw new Error(
          `Peso abaixo do minimo configurado (${Math.round(weightKg)} kg < ${minWeightKg} kg).`
        );
      }

      return { ...reading, capturedAt: new Date().toISOString() };
    },

    getStatus(): ToledoTcpAdapterStatus {
      return {
        state,
        lastReading,
        lastReadingAt,
        errorMessage,
        reconnectAttempts: 0
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
    },

    setWeight(weightKg: number): void {
      if (weightKg < 0) {
        throw new Error("Peso nao pode ser negativo.");
      }

      if (state !== "connected") {
        throw new Error("Balanca virtual nao esta conectada. Conecte primeiro.");
      }

      const reading = makeReading(weightKg);
      notify(reading);
    }
  };
}

function toScaleReading(reading: ParsedToledoReading, receivedAt: string): ScaleReading {
  const status = getVirtualScaleStatus(reading);
  return {
    weightKg: Math.round(reading.weightKg),
    unit: "kg",
    status,
    stable: status === "stable",
    capturedAt: receivedAt,
    receivedAt,
    rawFrame: reading.raw,
    adapterName: "virtual"
  };
}

function getVirtualScaleStatus(reading: ParsedToledoReading): ScaleStatus {
  if (!Number.isFinite(reading.weightKg)) return "error";
  if (reading.statusFlags.outOfRange) return "overload";
  if (reading.statusFlags.negative || reading.weightKg < 0) return "negative";
  if (!reading.stable || reading.statusFlags.inMotion) return "unstable";
  if (reading.statusFlags.atZero || reading.weightKg === 0) return "zero";
  return "stable";
}
