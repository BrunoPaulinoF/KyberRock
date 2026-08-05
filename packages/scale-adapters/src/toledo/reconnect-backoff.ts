/**
 * Intervalo ate a proxima tentativa de reconexao.
 *
 * Sem `backoffMaxMs` o intervalo e constante — o comportamento historico dos
 * adaptadores. Com o teto definido, ele dobra a cada tentativa ate o limite:
 * uma balanca que voltou logo e recuperada em segundos, e uma que ficou fora do
 * ar a noite inteira nao gera uma tentativa a cada 5s ate de manha.
 *
 * @param attempt Numero da tentativa que esta sendo agendada (1 = a primeira).
 */
export function reconnectDelayMs(
  attempt: number,
  intervalMs: number,
  backoffMaxMs?: number
): number {
  const base = Math.max(0, intervalMs);
  if (backoffMaxMs === undefined) return base;

  const cap = Math.max(base, backoffMaxMs);
  const step = Math.max(1, Math.floor(attempt));
  // 2^(n-1) cresce rapido; o expoente e limitado antes da potencia para o
  // resultado nunca virar Infinity numa reconexao longa.
  const growth = 2 ** Math.min(step - 1, 30);
  return Math.min(cap, base * growth);
}
