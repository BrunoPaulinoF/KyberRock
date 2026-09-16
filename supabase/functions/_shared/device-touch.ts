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

/**
 * Quando o ping precisa de fato ESCREVER — os degraus acima dizem COMO gravar, este bloco diz
 * SE ha o que gravar.
 *
 * O `desktop-status` roda de poucos em poucos segundos em cada balanca, 24 h por dia, porque e
 * ele quem detecta bloqueio por inadimplencia quase em tempo real. So que ele nao apenas LIA:
 * todo ping regravava a linha do dispositivo para carimbar `last_seen_at`. Medido na producao
 * em 16/09/2026: 101.875 UPDATEs numa tabela de OITO linhas, ~22 mil por dia. E o Postgres nao
 * tem update barato — cada um cria uma nova versao da linha, mexe nos indices, gera WAL e
 * devolve a versao velha para o autovacuum limpar. Era a maior fonte de escrita do projeto, e
 * quase toda ela gravando exatamente o que ja estava la.
 *
 * A LEITURA nao muda: bloqueio, aviso de atualizacao e papel de principal de preco seguem
 * chegando na mesma velocidade de antes. O que passa a ser espacado e a escrita do relogio
 * quando NADA mudou.
 *
 * Duas regras:
 *
 * 1. Mudou alguma coisa que o painel le como FATO — versao instalada, aviso de atualizacao,
 *    fila pendente, fila travada, ultimo erro —, grava na hora. Espacar isso seria esconder
 *    justamente o que a coluna Saude existe para mostrar.
 * 2. Mudou so o RELOGIO, grava no maximo de 5 em 5 minutos. O painel considera a balanca
 *    offline depois de 15 min sem contato (`DEVICE_OFFLINE_THRESHOLD_MS`, no loader-web) e
 *    exibe o tempo em minutos arredondados: a folga cabe tres vezes dentro do limite, entao
 *    nenhuma balanca ligada passa a parecer desligada.
 */

/** Folga entre duas gravacoes do relogio quando nada mais mudou. */
export const DEVICE_TOUCH_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Colunas que sao so "quando", e nao "o que".
 *
 * Elas andam a cada ping por construcao (`checkedAt`, `collectedAt`), entao compara-las diria
 * "mudou" sempre e a regra nunca economizaria nada. O `health_collected_at` entra aqui pelo
 * mesmo motivo: ele diz QUANDO a balanca relatou, e os numeros do relato — esses sim — sao
 * comparados.
 */
const WHEN_ONLY_COLUMNS = new Set([
  "last_seen_at",
  "updated_at",
  "app_version_seen_at",
  "health_collected_at"
]);

/**
 * Colunas de data que sobram depois de tirar as de "quando".
 *
 * A lista e explicita porque a comparacao delas passa por `Date.parse`, e `Date.parse` aceita
 * coisa demais: uma versao como "1.2.3" vira uma data valida no V8. Comparar versao como data
 * seria uma fonte de erro silencioso — aqui so entra o que E data.
 */
const TIMESTAMP_COLUMNS = new Set([
  "update_notice_sent_at",
  "update_notice_seen_at",
  "health_oldest_pending_at"
]);

export function shouldWriteDeviceTouch(
  stored: Record<string, unknown> | null | undefined,
  touch: Record<string, unknown>,
  checkedAt: string,
  minIntervalMs: number = DEVICE_TOUCH_MIN_INTERVAL_MS
): boolean {
  // Sem a linha em maos nao ha o que comparar. Gravar e o lado seguro: no maximo se paga um
  // update que talvez fosse dispensavel.
  if (!stored) return true;

  for (const [column, value] of Object.entries(touch)) {
    if (WHEN_ONLY_COLUMNS.has(column)) continue;
    // Coluna que nao veio no SELECT (degrau mais pobre da escada, migracao pendente): nao da
    // para afirmar que esta igual, entao grava.
    if (!(column in stored)) return true;
    if (!sameValue(column, stored[column], value)) return true;
  }

  const lastSeen = parseTimestamp(stored.last_seen_at);
  const now = parseTimestamp(checkedAt);
  // Balanca que nunca pingou, ou relogio ilegivel: grava, e a proxima ja compara.
  if (lastSeen === null || now === null) return true;
  // Relogio da nuvem para tras (nunca deveria, mas nao pode virar silencio eterno).
  if (now < lastSeen) return true;
  return now - lastSeen >= minIntervalMs;
}

/**
 * Compara o que esta gravado com o que se pretende gravar.
 *
 * `null` e `undefined` sao a mesma ausencia. Datas passam por `Date.parse` antes porque o
 * Postgres devolve `2026-09-16T14:04:34.664793+00:00` e a funcao monta
 * `2026-09-16T14:04:34.664Z` — texto diferente, mesmo instante, e compara-los como texto
 * faria toda linha parecer mudada.
 */
function sameValue(column: string, stored: unknown, next: unknown): boolean {
  if (stored === null || stored === undefined) return next === null || next === undefined;
  if (next === null || next === undefined) return false;
  if (stored === next) return true;

  if (TIMESTAMP_COLUMNS.has(column)) {
    const a = parseTimestamp(stored);
    const b = parseTimestamp(next);
    return a !== null && b !== null && a === b;
  }

  if (typeof stored === "number" && typeof next === "number") return stored === next;
  return String(stored) === String(next);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}
