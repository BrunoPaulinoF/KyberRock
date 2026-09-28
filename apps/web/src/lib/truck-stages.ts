/**
 * Etapas do caminhao na pedreira, em tempo real: ENTRADA -> CARREGANDO -> SAIDA (tela Comercial,
 * perfis comercial e gestor).
 *
 * Tudo sai da pesagem que a BALANCA grava — nada depende de marca do carregador:
 *
 *   - ENTRADA    pesou a entrada ha menos de `ENTRY_WINDOW_MINUTES` (acabou de chegar)
 *   - CARREGANDO operacao ainda em aberto depois disso (aguardando carregar e pesar a saida)
 *   - SAIDA      operacao concluida: pesou a saida (`weighing_operations.closed_at`)
 *
 * Na balanca a operacao aberta so tem um estado ("Aguardando") ate fechar; a janela da entrada e
 * o que separa quem acabou de chegar de quem ja esta no patio.
 */

export type TruckStage = "entrada" | "carregando" | "saida";

export const TRUCK_STAGES: readonly TruckStage[] = ["entrada", "carregando", "saida"];

/** Quanto tempo depois da pesagem de entrada o caminhao ainda conta como "chegando". */
export const ENTRY_WINDOW_MINUTES = 10;
const ENTRY_WINDOW_MS = ENTRY_WINDOW_MINUTES * 60_000;

export const STAGE_LABELS: Record<TruckStage, string> = {
  entrada: "Entrada",
  carregando: "Carregando",
  saida: "Saida"
};

/** O que cada etapa quer dizer, para quem esta olhando a tela. */
export const STAGE_HINTS: Record<TruckStage, string> = {
  entrada: `Pesou a entrada nos ultimos ${ENTRY_WINDOW_MINUTES} minutos.`,
  carregando: "Operacao em aberto: aguardando carregar e pesar a saida.",
  saida: "Operacao concluida hoje: ja pesou a saida."
};

export interface StageTruck {
  operationId: string;
  plate: string;
  customerName: string;
  productDescription: string;
  driverName: string;
  /** Pesagem de entrada. */
  entryAt: string;
  /** Pesagem de saida (so na operacao concluida). */
  exitAt: string | null;
}

export interface StageDurations {
  /** Em ms. A entrada vai ate a janela (ou ate a saida, se saiu antes dela). */
  entrada: number;
  /** Depois da janela ate a saida (ou ate agora); `null` quando saiu dentro da janela. */
  carregando: number | null;
  total: number;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/** Etapa do caminhao agora. */
export function stageOf(truck: Pick<StageTruck, "entryAt" | "exitAt">, nowMs: number): TruckStage {
  if (truck.exitAt) return "saida";
  const entry = ms(truck.entryAt) ?? nowMs;
  return nowMs - entry < ENTRY_WINDOW_MS ? "entrada" : "carregando";
}

/** Tempo em cada etapa. Para quem ainda nao saiu, conta ate `nowMs`. */
export function stageDurations(truck: StageTruck, nowMs: number): StageDurations {
  const entry = ms(truck.entryAt) ?? nowMs;
  const end = Math.max(entry, ms(truck.exitAt) ?? nowMs);
  const total = end - entry;
  return {
    entrada: Math.min(total, ENTRY_WINDOW_MS),
    carregando: total > ENTRY_WINDOW_MS ? total - ENTRY_WINDOW_MS : null,
    total
  };
}

/** Ha quanto tempo na etapa atual; na SAIDA, o tempo total que ficou na pedreira. */
export function timeInCurrentStage(truck: StageTruck, nowMs: number): number {
  const durations = stageDurations(truck, nowMs);
  const stage = stageOf(truck, nowMs);
  if (stage === "entrada") return durations.entrada;
  if (stage === "carregando") return durations.carregando ?? 0;
  return durations.total;
}

/**
 * Os caminhoes por etapa. Na ENTRADA e no CARREGANDO, quem esta ha mais tempo primeiro; na
 * SAIDA, quem saiu por ultimo primeiro.
 */
export function groupByStage(
  trucks: readonly StageTruck[],
  nowMs: number
): Record<TruckStage, StageTruck[]> {
  const groups: Record<TruckStage, StageTruck[]> = { entrada: [], carregando: [], saida: [] };
  for (const truck of trucks) groups[stageOf(truck, nowMs)].push(truck);
  for (const stage of ["entrada", "carregando"] as const) {
    groups[stage].sort(
      (a, b) =>
        timeInCurrentStage(b, nowMs) - timeInCurrentStage(a, nowMs) ||
        a.operationId.localeCompare(b.operationId)
    );
  }
  groups.saida.sort(
    (a, b) =>
      (ms(b.exitAt) ?? 0) - (ms(a.exitAt) ?? 0) || a.operationId.localeCompare(b.operationId)
  );
  return groups;
}

/**
 * Medias (ms) de quem ja saiu hoje: quanto tempo ficou aguardando depois da entrada (so quem
 * passou da janela) e quanto tempo ficou na pedreira ao todo.
 */
export function averageDurations(
  finished: readonly StageTruck[],
  nowMs: number
): { carregando: number | null; total: number | null } {
  let waitSum = 0;
  let waitCount = 0;
  let totalSum = 0;
  for (const truck of finished) {
    const durations = stageDurations(truck, nowMs);
    totalSum += durations.total;
    if (durations.carregando !== null) {
      waitSum += durations.carregando;
      waitCount += 1;
    }
  }
  return {
    carregando: waitCount === 0 ? null : Math.round(waitSum / waitCount),
    total: finished.length === 0 ? null : Math.round(totalSum / finished.length)
  };
}

/** "agora", "8 min", "1h 05min", "2d 3h". */
export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const minutes = Math.floor(value / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
