export const SCALE_CONNECTION_TYPES = [
  "serial",
  "usb_serial",
  "tcp",
  "http",
  "file",
  "custom"
] as const;

export type ScaleConnectionType = (typeof SCALE_CONNECTION_TYPES)[number];

export interface ScaleReadingInput {
  value: number;
  unit: "kg" | "ton" | "raw";
  kgFactor?: number;
}

export interface NormalizedScaleReading {
  weightKg: number;
  unit: "kg";
}

export interface ScaleReading extends NormalizedScaleReading {
  stable: boolean;
  capturedAt: string;
}

export interface ScaleSamplingOptions {
  durationMs?: number;
  sampleIntervalMs?: number;
  minStableMs?: number;
  maxVariationKg?: number;
  minWeightKg?: number;
}

export interface ScaleAdapter {
  read: () => Promise<ScaleReading>;
}

export function isSupportedScaleConnection(value: string): value is ScaleConnectionType {
  return SCALE_CONNECTION_TYPES.includes(value as ScaleConnectionType);
}

export function normalizeScaleReading(input: ScaleReadingInput): NormalizedScaleReading {
  if (input.value < 0) {
    throw new Error("Scale reading cannot be negative.");
  }

  if (input.unit === "kg") {
    return { weightKg: input.value, unit: "kg" };
  }

  if (input.unit === "ton") {
    return { weightKg: input.value * 1000, unit: "kg" };
  }

  if (!input.kgFactor || input.kgFactor <= 0) {
    throw new Error("Raw scale readings require a positive kgFactor.");
  }

  return { weightKg: input.value * input.kgFactor, unit: "kg" };
}

export class MockScaleAdapter implements ScaleAdapter {
  private cursor = 0;
  private readonly readings: number[];

  constructor(readings: number[] = [12_000, 18_500, 12_250, 19_000]) {
    if (readings.length === 0) {
      throw new Error("Mock scale requires at least one reading.");
    }

    this.readings = readings;
  }

  async read(now: Date = new Date()): Promise<ScaleReading> {
    const index = Math.min(this.cursor, this.readings.length - 1);
    this.cursor += 1;

    return {
      weightKg: this.readings[index],
      unit: "kg",
      stable: true,
      capturedAt: now.toISOString()
    };
  }
}
