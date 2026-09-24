/**
 * Regras da fila de carregamento — a tela do carregador. Vieram da tela que existia no
 * KyberRock Portal (`apps/loader-web`), que deixou de receber o carregador: a fila agora mora
 * so aqui.
 */

export interface LoadingItem {
  id: string;
  plate: string;
  customerName: string;
  driverName: string;
  productDescription: string;
  createdAt: string;
  loaderCompletedAt: string | null;
}

/** Fuso da pedreira (unidade), nao o do celular do carregador. */
export const DEFAULT_UNIT_TIMEZONE = "America/Sao_Paulo";

/** Janela do historico de conclusoes que ainda podem ser desfeitas pelo carregador. */
export const RECENT_COMPLETION_WINDOW_MS = 30 * 60_000;

/**
 * Horario no formato mais curto: `HH:mm` quando e do mesmo dia da unidade, `dd/MM HH:mm`
 * quando a fila atravessou a virada do dia.
 */
export function formatArrival(
  value: string | null | undefined,
  timeZone?: string | null,
  now: number = Date.now()
): string {
  if (!value) return "-";
  const arrived = new Date(value);
  if (Number.isNaN(arrived.getTime())) return "-";
  const zone = timeZone || DEFAULT_UNIT_TIMEZONE;
  const time = arrived.toLocaleString("pt-BR", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit"
  });
  const dayFormat: Intl.DateTimeFormatOptions = {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit"
  };
  const arrivedDay = arrived.toLocaleDateString("pt-BR", dayFormat);
  const today = new Date(now).toLocaleDateString("pt-BR", dayFormat);
  return arrivedDay === today ? time : `${arrivedDay} ${time}`;
}

/** Cargas ainda esperando o carregador. */
export function inProgress(items: LoadingItem[]): LoadingItem[] {
  return items.filter((item) => !item.loaderCompletedAt);
}

export interface ProductQueueCount {
  label: string;
  count: number;
}

/**
 * Quantas cargas de cada produto estao esperando, da maior fila para a menor (empate em ordem
 * alfabetica, para a faixa nao dancar a cada atualizacao).
 */
export function countByProduct(items: LoadingItem[]): ProductQueueCount[] {
  const counts = new Map<string, ProductQueueCount>();
  for (const item of items) {
    const label = item.productDescription?.trim() || "Sem produto";
    const key = label.toLowerCase();
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")
  );
}

/** Minutos desde a chegada do caminhao. */
export function minutesSinceArrival(createdAt: string, now: number): number {
  const arrived = new Date(createdAt).getTime();
  if (Number.isNaN(arrived)) return 0;
  return Math.max(0, (now - arrived) / 60_000);
}

/** Cargas em andamento acima do tempo medio dentro da pedreira. Vazio sem media. */
export function overtime(
  items: LoadingItem[],
  avgMinutes: number | null,
  now: number
): LoadingItem[] {
  if (!avgMinutes || avgMinutes <= 0) return [];
  return items.filter(
    (item) => !item.loaderCompletedAt && minutesSinceArrival(item.createdAt, now) > avgMinutes
  );
}

/** Concluidas nos ultimos 30 minutos, mais recente primeiro — as que ainda podem ser desfeitas. */
export function recentlyCompleted(
  items: LoadingItem[],
  now: number,
  windowMs: number = RECENT_COMPLETION_WINDOW_MS
): LoadingItem[] {
  return items
    .filter((item) => {
      if (!item.loaderCompletedAt) return false;
      const completed = new Date(item.loaderCompletedAt).getTime();
      return !Number.isNaN(completed) && now - completed <= windowMs;
    })
    .sort(
      (a, b) =>
        new Date(b.loaderCompletedAt ?? 0).getTime() - new Date(a.loaderCompletedAt ?? 0).getTime()
    );
}
