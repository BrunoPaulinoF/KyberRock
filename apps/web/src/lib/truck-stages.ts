/**
 * Etapas do caminhao na pedreira, em tempo real: ENTRADA -> CARREGANDO -> SAIDA (tela Comercial,
 * perfis comercial e gestor).
 *
 * Cada etapa comeca num carimbo que ja existe na nuvem:
 *
 *   - ENTRADA    pesou a entrada          `weighing_operations.created_at`
 *   - CARREGANDO o carregador iniciou     `loading_requests.loader_started_at` (botao "Iniciar")
 *   - SAIDA      o carregador concluiu    `loading_requests.loader_completed_at`
 *   - (fim)      pesou a saida            `weighing_operations.closed_at`
 *
 * O carregador pode pular o "Iniciar" e ir direto ao "Concluir" (ou nao marcar nada): o tempo
 * que nao tem carimbo proprio fica na etapa anterior, e a etapa sem carimbo aparece como "—" em
 * vez de um numero inventado.
 */

export type TruckStage = "entrada" | "carregando" | "saida";

export const TRUCK_STAGES: readonly TruckStage[] = ["entrada", "carregando", "saida"];

export const STAGE_LABELS: Record<TruckStage, string> = {
  entrada: "Entrada",
  carregando: "Carregando",
  saida: "Saida"
};

/** O que cada etapa quer dizer, para quem esta olhando a tela. */
export const STAGE_HINTS: Record<TruckStage, string> = {
  entrada: "Pesou a entrada e espera o carregador comecar.",
  carregando: "O carregador marcou que comecou a carregar.",
  saida: "Carregado, a caminho da pesagem de saida."
};

export interface StageTruck {
  operationId: string;
  plate: string;
  customerName: string;
  productDescription: string;
  driverName: string;
  /** Pesagem de entrada. */
  entryAt: string;
  loadStartedAt: string | null;
  loadedAt: string | null;
  /** Pesagem de saida (so no caminhao que ja saiu). */
  exitAt: string | null;
}

export interface StageDurations {
  /** Em ms; `null` quando a etapa nao tem carimbo (o tempo dela ficou na anterior). */
  entrada: number | null;
  carregando: number | null;
  saida: number | null;
  total: number;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function span(from: number, to: number): number {
  return Math.max(0, to - from);
}

/** Etapa atual de quem ainda esta na pedreira. */
export function stageOf(truck: Pick<StageTruck, "loadStartedAt" | "loadedAt">): TruckStage {
  if (truck.loadedAt) return "saida";
  if (truck.loadStartedAt) return "carregando";
  return "entrada";
}

/** Tempo em cada etapa. Para quem ainda nao saiu, a etapa atual conta ate `nowMs`. */
export function stageDurations(truck: StageTruck, nowMs: number): StageDurations {
  const entry = ms(truck.entryAt) ?? nowMs;
  const end = Math.max(entry, ms(truck.exitAt) ?? nowMs);
  // Carimbo fora de ordem (relogio de outra maquina) nao pode dar tempo negativo.
  const started = clampBetween(ms(truck.loadStartedAt), entry, end);
  const loaded = clampBetween(ms(truck.loadedAt), started ?? entry, end);
  return {
    entrada: span(entry, started ?? loaded ?? end),
    carregando: started === null ? null : span(started, loaded ?? end),
    saida: loaded === null ? null : span(loaded, end),
    total: span(entry, end)
  };
}

function clampBetween(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  return Math.min(Math.max(value, min), max);
}

/** Ha quanto tempo o caminhao esta na etapa atual. */
export function timeInCurrentStage(truck: StageTruck, nowMs: number): number {
  const durations = stageDurations(truck, nowMs);
  return durations[stageOf(truck)] ?? durations.total;
}

/** Os caminhoes da pedreira por etapa, quem esta ha mais tempo na etapa primeiro. */
export function groupByStage(
  trucks: readonly StageTruck[],
  nowMs: number
): Record<TruckStage, StageTruck[]> {
  const groups: Record<TruckStage, StageTruck[]> = { entrada: [], carregando: [], saida: [] };
  for (const truck of trucks) groups[stageOf(truck)].push(truck);
  for (const stage of TRUCK_STAGES) {
    groups[stage].sort(
      (a, b) =>
        timeInCurrentStage(b, nowMs) - timeInCurrentStage(a, nowMs) ||
        a.operationId.localeCompare(b.operationId)
    );
  }
  return groups;
}

/**
 * Media (ms) de cada etapa entre os caminhoes que ja sairam, contando so quem tem o carimbo
 * daquela etapa — senao a media do "Carregando" cairia a zero por causa de quem nao marcou.
 */
export function averageStageDurations(
  finished: readonly StageTruck[],
  nowMs: number
): Record<TruckStage | "total", number | null> {
  const sums = { entrada: 0, carregando: 0, saida: 0, total: 0 };
  const counts = { entrada: 0, carregando: 0, saida: 0, total: 0 };
  for (const truck of finished) {
    const durations = stageDurations(truck, nowMs);
    for (const key of ["entrada", "carregando", "saida", "total"] as const) {
      const value = durations[key];
      if (value === null) continue;
      sums[key] += value;
      counts[key] += 1;
    }
  }
  const average = (key: keyof typeof sums) =>
    counts[key] === 0 ? null : Math.round(sums[key] / counts[key]);
  return {
    entrada: average("entrada"),
    carregando: average("carregando"),
    saida: average("saida"),
    total: average("total")
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
