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
