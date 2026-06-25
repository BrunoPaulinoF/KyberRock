import type { ScaleReading, ScaleStatus } from "@kyberrock/scale-adapters";

import type { ScaleStabilityConfig } from "./scale-configs.js";

export type ScaleCaptureOperationType = "entry" | "exit";

export interface ScaleCaptureOptions {
  timeoutMs?: number;
  maxReadingAgeMs?: number;
  operationType: ScaleCaptureOperationType;
}

export interface ScaleCaptureAdapter {
  read: () => Promise<ScaleReading>;
}

export interface ScaleCaptureServiceConfig {
  adapter: ScaleCaptureAdapter;
  stability: ScaleStabilityConfig;
  adapterName?: string;
  deviceId?: string;
}

export class ScaleCaptureService {
  private readonly adapter: ScaleCaptureAdapter;
  private readonly stability: ScaleStabilityConfig;
  private readonly adapterName?: string;
  private readonly deviceId?: string;

  constructor(config: ScaleCaptureServiceConfig) {
    this.adapter = config.adapter;
    this.stability = config.stability;
    this.adapterName = config.adapterName;
    this.deviceId = config.deviceId;
  }

  async captureStableWeight(options: ScaleCaptureOptions): Promise<ScaleReading> {
    const startedAt = Date.now();
    const timeoutMs = Math.max(500, options.timeoutMs ?? this.stability.sampleDurationMs);
    const pollIntervalMs = Math.max(50, this.stability.sampleIntervalMs);
    const minStableMs = Math.max(0, this.stability.requireStable ? this.stability.minStableMs : 0);
    const maxReadingAgeMs = Math.max(
      1000,
      options.maxReadingAgeMs ?? Math.max(1500, minStableMs + pollIntervalMs * 2)
    );
    const maxVariationKg = Math.max(0, this.stability.maxVariationKg);
    const minWeightKg = Math.max(0, this.stability.minWeightKg);
    let stableSince: number | null = null;
    let stableReferenceWeightKg: number | null = null;
    let lastStatus: ScaleStatus = "no_data";
    let lastError: Error | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      let reading: ScaleReading;
      try {
        reading = normalizeReading(await this.adapter.read(), this.adapterName, this.deviceId);
      } catch (error) {
        lastStatus = "no_data";
        lastError = error instanceof Error ? error : new Error("Falha desconhecida na balanca.");
        if (isConnectionError(lastError)) throw lastError;
        await delay(pollIntervalMs);
        continue;
      }

      const now = Date.now();
      lastStatus = reading.status;

      if (!isFreshReading(reading, startedAt, now, maxReadingAgeMs)) {
        lastStatus = "no_data";
        stableSince = null;
        stableReferenceWeightKg = null;
        await delay(pollIntervalMs);
        continue;
      }

      const blockingMessage = getBlockingStatusMessage(reading.status);
      if (blockingMessage) {
        throw new Error(blockingMessage);
      }

      if (reading.status !== "stable" || !reading.stable) {
        stableSince = null;
        stableReferenceWeightKg = null;
        await delay(pollIntervalMs);
        continue;
      }

      if (!Number.isFinite(reading.weightKg) || reading.weightKg < minWeightKg) {
        throw new Error(
          `Peso abaixo do minimo configurado (${Math.round(reading.weightKg)} kg < ${minWeightKg} kg).`
        );
      }

      if (
        stableReferenceWeightKg === null ||
        Math.abs(reading.weightKg - stableReferenceWeightKg) > maxVariationKg
      ) {
        stableReferenceWeightKg = reading.weightKg;
        stableSince = now;
      }

      if (stableSince !== null && now - stableSince >= minStableMs) {
        return { ...reading, capturedAt: new Date().toISOString() };
      }

      await delay(pollIntervalMs);
    }

    if (lastStatus === "unstable") {
      throw new Error("Peso instavel. Aguarde o indicador da balanca ficar estavel e tente novamente.");
    }
    if (lastError) {
      throw new Error(`Nao foi possivel ler a balanca: ${lastError.message}.`);
    }
    throw new Error("Balanca sem leitura estavel e recente dentro do tempo limite.");
  }
}

function normalizeReading(reading: ScaleReading, adapterName?: string, deviceId?: string): ScaleReading {
  const partial = reading as Partial<ScaleReading>;
  const status = partial.status ?? (partial.stable ? "stable" : "unstable");
  const receivedAt = partial.receivedAt ?? partial.capturedAt ?? new Date().toISOString();
  return {
    ...reading,
    status,
    stable: status === "stable" && partial.stable !== false,
    capturedAt: partial.capturedAt ?? receivedAt,
    receivedAt,
    adapterName: partial.adapterName ?? adapterName,
    deviceId: partial.deviceId ?? deviceId
  };
}

function isFreshReading(
  reading: ScaleReading,
  startedAt: number,
  now: number,
  maxReadingAgeMs: number
): boolean {
  const receivedAt = Date.parse(reading.receivedAt);
  if (!Number.isFinite(receivedAt)) return false;
  if (now - receivedAt > maxReadingAgeMs) return false;
  if (receivedAt < startedAt && startedAt - receivedAt > maxReadingAgeMs) return false;
  return true;
}

function getBlockingStatusMessage(status: ScaleStatus): string | null {
  switch (status) {
    case "overload":
      return "Balanca em sobrecarga ou fora de alcance. Retire excesso de peso e tente novamente.";
    case "negative":
      return "Balanca informou peso negativo. Zere ou ajuste a balanca antes de capturar.";
    case "zero":
      return "Balanca sem peso util para captura. Posicione o caminhao e aguarde estabilidade.";
    case "error":
      return "Balanca informou erro de leitura. Verifique o indicador e a conexao.";
    default:
      return null;
  }
}

function isConnectionError(error: Error): boolean {
  return /nao esta conectada|não está conectada|desconectad/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
