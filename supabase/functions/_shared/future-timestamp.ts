/**
 * Cadastro chegando com `updated_at` NO FUTURO: a nuvem grava a hora dela.
 *
 * Cada balanca carimbava o cadastro com o relogio do Windows dela. Em 28/09/2026 havia
 * linhas gravadas 5 a 17 min a frente do servidor. O pull levava essa hora para as outras
 * balancas, e o cursor do push delas (que anda pelo `updated_at` das linhas locais) pulava
 * para o futuro: o cadastro feito ali, na hora certa, ficava atras do cursor e demorava ate
 * 14 h para chegar ao site.
 *
 * O desktop novo usa a hora da nuvem (`apps/desktop/src/services/cloud-clock.ts`) e o cursor
 * dele nao passa do relogio. Esta guarda e para as balancas que ainda nao atualizaram: hora
 * alem da tolerancia e trocada pela do servidor na ENTRADA, e o futuro nao se espalha.
 * O passado nao e mexido: hora atrasada nao empurra o cursor de ninguem.
 */

/** Folga para a diferenca normal entre relogios e o tempo da propria requisicao. */
export const FUTURE_TIMESTAMP_TOLERANCE_MS = 60_000;

export function clampFutureTimestamps<T extends Record<string, unknown>>(
  rows: T[] | undefined,
  nowMs: number,
  column = "updated_at"
): { rows: T[] | undefined; clamped: number } {
  if (!rows?.length) return { rows, clamped: 0 };
  const limit = nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS;
  const nowIso = new Date(nowMs).toISOString();
  let clamped = 0;
  const next = rows.map((row) => {
    const value = row[column];
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= limit) return row;
    clamped++;
    return { ...row, [column]: nowIso };
  });
  return { rows: next, clamped };
}
