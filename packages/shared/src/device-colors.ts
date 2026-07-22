/**
 * Paleta de cores por computador/dispositivo da pedreira. Cada desktop ativado
 * recebe uma cor estavel, usada no contorno das operacoes e na legenda da tela
 * de Operacoes para identificar quem criou cada tarefa.
 *
 * IMPORTANTE: a Edge Function `desktop-activate` mantem uma copia desta paleta
 * em `supabase/functions/_shared/device-colors.ts` (Deno nao resolve este
 * workspace npm). Alteracoes aqui devem ser replicadas la.
 */
export const DEVICE_COLOR_PALETTE: readonly string[] = [
  "#2563eb", // azul
  "#ea580c", // laranja
  "#16a34a", // verde
  "#9333ea", // roxo
  "#db2777", // rosa
  "#0d9488", // teal
  "#ca8a04", // mostarda
  "#dc2626", // vermelho
  "#4f46e5", // indigo
  "#0891b2" // ciano
];

/**
 * Escolhe a proxima cor livre da paleta. Quando todas ja estao em uso,
 * recomeca do inicio (paleta ciclica) usando o total de dispositivos.
 */
export function pickNextDeviceColor(usedColors: readonly (string | null | undefined)[]): string {
  const used = new Set(
    usedColors
      .filter((color): color is string => typeof color === "string" && color.length > 0)
      .map((color) => color.toLowerCase())
  );
  for (const color of DEVICE_COLOR_PALETTE) {
    if (!used.has(color.toLowerCase())) {
      return color;
    }
  }
  return DEVICE_COLOR_PALETTE[used.size % DEVICE_COLOR_PALETTE.length];
}

/**
 * Cor deterministica de contingencia para dispositivos antigos que ainda nao
 * tem cor atribuida na nuvem: deriva um indice estavel do id do dispositivo.
 */
export function fallbackDeviceColor(deviceId: string | null | undefined): string {
  const id = deviceId ?? "";
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return DEVICE_COLOR_PALETTE[hash % DEVICE_COLOR_PALETTE.length];
}

/** Cor efetiva de um dispositivo: a atribuida na nuvem ou a de contingencia. */
export function resolveDeviceColor(
  deviceId: string | null | undefined,
  assignedColor: string | null | undefined
): string {
  if (typeof assignedColor === "string" && /^#[0-9a-fA-F]{6}$/.test(assignedColor.trim())) {
    return assignedColor.trim();
  }
  return fallbackDeviceColor(deviceId);
}
