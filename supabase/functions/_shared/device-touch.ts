/**
 * Os degraus da gravacao do ping (`desktop-status` -> `device_registrations`).
 *
 * As Edge Functions sobem no push e as migracoes SQL sao aplicadas a parte.
 * Nessa janela a funcao ja escreve uma coluna que a tabela ainda nao tem — e um
 * update com coluna desconhecida falha INTEIRO, levando junto o `last_seen_at`,
 * que e o campo do qual a frota inteira depende para nao aparecer offline.
 *
 * A saida e tentar do mais completo para o mais pobre, UMA COLUNA NOVA POR
 * DEGRAU: com um degrau so, a migracao pendente da saude derrubaria tambem a
 * versao instalada, que ja funcionava.
 *
 * A regra vive aqui, pura e testada, e nao solta no handler, porque ela ja teve
 * um erro silencioso: a versao anterior so gravava quando havia algo a
 * enriquecer, entao o desktop antigo — que manda apenas `deviceId` e token —
 * nao chegava a update nenhum e ficava com o `last_seen_at` congelado. O painel
 * o mostrava eternamente offline, sem nada na tela explicando por que.
 */

/**
 * Ordena os degraus, descartando o que nao muda nada em relacao ao proximo.
 *
 * O ULTIMO degrau nunca e descartado: ele e o piso, o `last_seen_at` cru que
 * precisa ser gravado mesmo quando nao ha nenhum campo extra para acompanhar.
 */
export function orderedTouchAttempts(
  attempts: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return attempts.filter((attempt, index) => {
    const isLast = index === attempts.length - 1;
    if (isLast) return true;
    // Mesmo conjunto de colunas que o degrau seguinte = mesma gravacao: uma ida
    // ao banco a cada 5 s, por balanca, para escrever o que o proximo degrau ja
    // escreveria.
    return !sameColumns(attempt, attempts[index + 1]);
  });
}

function sameColumns(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => key in b);
}
