import type { ScaleSnapshot } from "./scale-state.js";
export type { ScaleSnapshot } from "./scale-state.js";

/**
 * Cria um snapshot inicial IDLE, sem tara, sem peso.
 */
export function createInitialSnapshot(capacityKg: number, sampleWindowMs: number): ScaleSnapshot {
  const now = new Date().toISOString();
  return {
    sequence: 0,
    phase: "IDLE",
    capacityKg,
    weightKg: 0,
    tareKg: 0,
    netKg: 0,
    motion: false,
    atZero: true,
    tareActive: false,
    grossMode: true,
    netMode: false,
    overload: false,
    negative: false,
    sampleWindowMs,
    pendingMean: null,
    updatedAt: now
  };
}

/**
 * Recalcula flags e valores derivados (tareActive, grossMode, netMode,
 * atZero, overload, negative, netKg) a partir do peso bruto e tara.
 */
export function deriveFlags(snapshot: ScaleSnapshot): ScaleSnapshot {
  const rounded = Math.round(snapshot.weightKg);
  const gross = Math.max(0, rounded);
  const tare = Math.max(0, Math.round(snapshot.tareKg));
  const tareActive = tare > 0;
  const atZero = Math.abs(rounded) < 5;
  const overload = gross > snapshot.capacityKg;
  const negative = rounded < 0;
  const netKg = tareActive ? Math.max(0, gross - tare) : gross;
  return {
    ...snapshot,
    tareActive,
    grossMode: !tareActive,
    netMode: tareActive,
    atZero,
    overload,
    negative,
    netKg
  };
}

/**
 * Aplica um valor medio ao snapshot: tara (se tareForGross=false) ou
 * peso bruto (se tareForGross=true).
 */
export function applyMean(snapshot: ScaleSnapshot, mean: number, asGross: boolean): ScaleSnapshot {
  if (asGross) {
    return deriveFlags({ ...snapshot, weightKg: mean, pendingMean: Math.round(mean) });
  }
  return deriveFlags({
    ...snapshot,
    tareKg: Math.max(0, Math.round(mean)),
    pendingMean: Math.round(mean)
  });
}
