/** Opcoes da janela de tentativas rapidas que antecede o backoff. */
export interface ReconnectBackoffOptions {
  /** Quantas primeiras tentativas usam `fastIntervalMs` em vez do backoff. */
  fastAttempts?: number | undefined;
  /** Intervalo constante dentro da janela rapida (ms). */
  fastIntervalMs?: number | undefined;
}

/**
 * Intervalo ate a proxima tentativa de reconexao.
 *
 * Sem `backoffMaxMs` o intervalo e constante — o comportamento historico dos
 * adaptadores. Com o teto definido, ele dobra a cada tentativa ate o limite:
 * uma balanca que voltou logo e recuperada em segundos, e uma que ficou fora do
 * ar a noite inteira nao gera uma tentativa a cada 5s ate de manha.
 *
 * O que faltava era o comeco dessa curva. Quem derruba a balanca no meio do
 * expediente quase sempre devolve a conexao em poucos segundos: o conversor
 * serial<->TCP aceita UMA sessao por vez e segura a antiga por alguns segundos
 * depois de a rede piscar, e ate liberar recusa o app. Com a curva comecando em
 * 5s e dobrando, a terceira recusa ja marcava a proxima tentativa para 20s
 * depois — e o app dormia essa soneca inteira mesmo com o conversor livre desde
 * o segundo 3. Medido num conversor simulado: porta liberada aos 23s, app so
 * reconectou aos 38s. Com o caminhao em cima da balanca, esses segundos sao a
 * pesagem indo para o papel.
 *
 * Por isso as primeiras `fastAttempts` tentativas ficam num intervalo curto e
 * constante: numa rede local uma tentativa de conexao nao custa nada, e cobrir a
 * janela em que o conversor esta liberando a sessao vale muito mais do que
 * economizar pacote. Passada essa janela — ai sim a queda e longa — a curva
 * exponencial de sempre assume e chega ao mesmo teto.
 *
 * @param attempt Numero da tentativa que esta sendo agendada (1 = a primeira).
 */
export function reconnectDelayMs(
  attempt: number,
  intervalMs: number,
  backoffMaxMs?: number,
  options: ReconnectBackoffOptions = {}
): number {
  const base = Math.max(0, intervalMs);
  const step = Math.max(1, Math.floor(attempt));

  const fastAttempts = Math.max(0, Math.floor(options.fastAttempts ?? 0));
  if (step <= fastAttempts) {
    // Nunca mais lento que a curva normal: se alguem configurar uma janela
    // "rapida" maior que o intervalo base, o menor dos dois vale.
    return Math.min(base, Math.max(0, options.fastIntervalMs ?? base));
  }

  if (backoffMaxMs === undefined) return base;

  const cap = Math.max(base, backoffMaxMs);
  // A curva recomeca do intervalo base assim que a janela rapida acaba: contar o
  // expoente desde a primeira tentativa faria a janela rapida ser cobrada em
  // dobro, saltando direto para o teto.
  const growth = 2 ** Math.min(step - fastAttempts - 1, 30);
  return Math.min(cap, base * growth);
}
