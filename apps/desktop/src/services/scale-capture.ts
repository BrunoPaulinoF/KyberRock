import type { ScaleReading } from "@kyberrock/scale-adapters";

export type ScaleCaptureOperationType = "entry" | "exit";

export interface ScaleCaptureOptions {
  timeoutMs?: number;
  operationType: ScaleCaptureOperationType;
}

export interface ScaleCaptureAdapter {
  read: () => Promise<ScaleReading>;
}

/**
 * Politica de captura fixa: apos clicar em "Capturar peso" o sistema aguarda a
 * balanca estabilizar e captura o valor exibido naquele momento. Condicoes
 * transitorias (peso instavel, balanca zerada enquanto o caminhao entra,
 * peso ainda abaixo do minimo) NAO derrubam a captura — apenas continuam
 * aguardando ate o tempo limite.
 */
export interface ScaleCapturePolicy {
  /** Tempo maximo aguardando a balanca estabilizar (ms) */
  timeoutMs: number;
  /** Intervalo entre leituras (ms) */
  pollIntervalMs: number;
  /** Janela continua de estabilidade exigida antes de capturar (ms) */
  minStableMs: number;
  /** Oscilacao tolerada dentro da janela de estabilidade (kg) */
  maxVariationKg: number;
  /** Peso minimo para considerar que ha um veiculo na balanca (kg) */
  minWeightKg: number;
  /** Idade maxima de uma leitura para ser considerada atual (ms) */
  maxReadingAgeMs: number;
}

export const DEFAULT_SCALE_CAPTURE_POLICY: ScaleCapturePolicy = {
  timeoutMs: 20_000,
  pollIntervalMs: 200,
  minStableMs: 1_000,
  maxVariationKg: 50,
  minWeightKg: 500,
  maxReadingAgeMs: 3_000
};

export interface ScaleCaptureServiceConfig {
  adapter: ScaleCaptureAdapter;
  policy?: Partial<ScaleCapturePolicy>;
  adapterName?: string;
  deviceId?: string;
}

/** Ultima condicao observada enquanto se aguardava a estabilizacao. */
type WaitCondition =
  | "no_data"
  | "stale"
  | "unstable"
  | "zero"
  | "below_min"
  | "negative"
  | "overload"
  | "error"
  | "read_error";

export class ScaleCaptureService {
  private readonly adapter: ScaleCaptureAdapter;
  private readonly policy: ScaleCapturePolicy;
  private readonly adapterName?: string;
  private readonly deviceId?: string;

  constructor(config: ScaleCaptureServiceConfig) {
    this.adapter = config.adapter;
    this.policy = { ...DEFAULT_SCALE_CAPTURE_POLICY, ...config.policy };
    this.adapterName = config.adapterName;
    this.deviceId = config.deviceId;
  }

  async captureStableWeight(options: ScaleCaptureOptions): Promise<ScaleReading> {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, options.timeoutMs ?? this.policy.timeoutMs);
    const pollIntervalMs = Math.max(50, this.policy.pollIntervalMs);
    const minStableMs = Math.max(0, this.policy.minStableMs);
    const maxReadingAgeMs = Math.max(1000, this.policy.maxReadingAgeMs);
    const maxVariationKg = Math.max(0, this.policy.maxVariationKg);
    const minWeightKg = Math.max(0, this.policy.minWeightKg);

    let stableSince: number | null = null;
    let stableReferenceWeightKg: number | null = null;
    let lastCondition: WaitCondition = "no_data";
    let lastError: Error | null = null;

    for (;;) {
      let reading: ScaleReading | null = null;
      try {
        reading = normalizeReading(await this.adapter.read(), this.adapterName, this.deviceId);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Falha desconhecida na balanca.");
        // Perdeu a conexao: nao adianta insistir — o operador precisa reconectar.
        if (isConnectionError(lastError)) throw lastError;
        lastCondition = "read_error";
      }

      const now = Date.now();

      if (reading) {
        const condition = classifyReading(reading, {
          startedAt,
          now,
          maxReadingAgeMs,
          minWeightKg
        });

        if (condition === null) {
          // Leitura estavel, recente e com peso valido: acompanha a janela de estabilidade
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
        } else {
          // Condicao transitoria: zera a janela e continua aguardando
          lastCondition = condition;
          stableSince = null;
          stableReferenceWeightKg = null;
        }
      }

      if (Date.now() - startedAt + pollIntervalMs >= timeoutMs) {
        throw new Error(buildTimeoutMessage(lastCondition, minWeightKg, lastError));
      }

      await delay(pollIntervalMs);
    }
  }
}

function classifyReading(
  reading: ScaleReading,
  context: { startedAt: number; now: number; maxReadingAgeMs: number; minWeightKg: number }
): WaitCondition | null {
  if (!isFreshReading(reading, context.startedAt, context.now, context.maxReadingAgeMs)) {
    return "stale";
  }

  switch (reading.status) {
    case "overload":
      return "overload";
    case "negative":
      return "negative";
    case "zero":
      return "zero";
    case "error":
      return "error";
    case "no_data":
      return "no_data";
    case "unstable":
      return "unstable";
    case "stable":
      break;
    default:
      return "error";
  }

  if (!reading.stable) return "unstable";
  if (!Number.isFinite(reading.weightKg)) return "error";
  if (reading.weightKg < context.minWeightKg) return "below_min";
  return null;
}

function buildTimeoutMessage(
  condition: WaitCondition,
  minWeightKg: number,
  lastError: Error | null
): string {
  switch (condition) {
    case "unstable":
      return "Peso nao estabilizou dentro do tempo limite. Aguarde o caminhao parar totalmente na balanca e capture novamente.";
    case "zero":
      return "Balanca zerada: nenhum peso detectado. Posicione o caminhao na balanca e capture novamente.";
    case "below_min":
      return `Peso abaixo do minimo para captura (${minWeightKg} kg). Verifique se o caminhao esta totalmente sobre a balanca.`;
    case "negative":
      return "Balanca informando peso negativo. Zere o indicador e capture novamente.";
    case "overload":
      return "Balanca em sobrecarga ou fora de alcance. Retire o excesso de peso e capture novamente.";
    case "error":
      return "Balanca informou erro de leitura. Verifique o indicador e a conexao.";
    case "read_error":
      return `Nao foi possivel ler a balanca: ${lastError?.message ?? "falha desconhecida"}.`;
    case "stale":
    case "no_data":
    default:
      return "Balanca conectada, mas sem enviar leituras recentes. Verifique o cabo/rede e se o indicador esta transmitindo.";
  }
}

function normalizeReading(
  reading: ScaleReading,
  adapterName?: string,
  deviceId?: string
): ScaleReading {
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

function isConnectionError(error: Error): boolean {
  return /nao esta conectada|não está conectada|desconectad/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
