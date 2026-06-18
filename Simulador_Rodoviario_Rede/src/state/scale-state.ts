/**
 * Estado da balanca simulada.
 *
 * A balanca e simulada como uma celula de carga que reporta:
 * - peso bruto instantaneo (kg)
 * - flag de movimento (true enquanto o peso nao estabiliza)
 * - flag de centro de zero (true quando |peso| < 5kg)
 * - tara ativa (true se uma tara foi capturada e nao foi liberada)
 * - modo de exibicao: bruto ou liquido
 * - flag de sobrecarga (true quando peso > capacidade)
 * - flag de peso negativo (true quando peso < 0)
 */
export type Phase = "IDLE" | "TARING" | "TARE_DONE" | "LOADING" | "WEIGHING_LOADED" | "RELEASED";

export interface ScaleSnapshot {
  sequence: number;
  phase: Phase;
  capacityKg: number;
  weightKg: number;
  tareKg: number;
  netKg: number;
  motion: boolean;
  atZero: boolean;
  tareActive: boolean;
  grossMode: boolean;
  netMode: boolean;
  overload: boolean;
  negative: boolean;
  /**
   * Janela de amostragem em milissegundos, controlada pela UI e pelo TCP.
   * Padrao 5000 (5 segundos).
   */
  sampleWindowMs: number;
  /**
   * Quando uma amostragem esta em curso (TARE ou WEIGH_LOADED),
   * guarda o peso final que sera aplicado. Antes da conclusao: null.
   */
  pendingMean: number | null;
  updatedAt: string;
}
