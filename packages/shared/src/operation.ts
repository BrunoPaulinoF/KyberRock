export const OPERATION_STATUSES = [
  "draft",
  "entry_registered",
  "loading_requested",
  "awaiting_exit",
  "closed_local",
  "pending_firebase",
  "pending_omie",
  "synced",
  "sync_error",
  "cancelled"
] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export function calculateNetWeightKg(entryWeightKg: number, exitWeightKg: number): number {
  if (entryWeightKg < 0 || exitWeightKg < 0) {
    throw new Error("Weights cannot be negative.");
  }

  if (exitWeightKg <= entryWeightKg) {
    throw new Error("Exit weight must be greater than entry weight.");
  }

  return roundWeight(exitWeightKg - entryWeightKg);
}

export function isTerminalOperationStatus(status: OperationStatus): boolean {
  return status === "synced" || status === "cancelled";
}

function roundWeight(weightKg: number): number {
  return Math.round(weightKg * 1000) / 1000;
}
