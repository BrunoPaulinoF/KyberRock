/**
 * Paleta de cores por dispositivo (copia Deno de
 * `packages/shared/src/device-colors.ts` — mantenha as duas em sincronia).
 * Usada na ativacao para atribuir uma cor estavel a cada computador da pedreira.
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
