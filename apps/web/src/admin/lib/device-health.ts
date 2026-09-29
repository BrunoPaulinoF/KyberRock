/**
 * Saude de uma balanca, do jeito que o painel precisa mostrar: uma palavra na
 * coluna e a explicacao no title.
 *
 * A regra vive aqui, pura e testada, e nao solta no TSX, porque ela e uma
 * decisao de operacao e nao de layout: o que conta como "parada", quanto tempo
 * de silencio ainda e normal e o que merece vermelho sao coisas que vao mudar
 * conforme a frota cresce, e nao da para descobrir se mudaram lendo uma tabela
 * de 1800 linhas.
 *
 * A materia-prima vem do proprio desktop pelo `desktop-status`
 * (`_shared/device-health.ts`), com uma excecao: `lastSeenAt`, que e a nuvem
 * quem carimba. E de proposito — silencio nao pode depender de a balanca
 * conseguir contar que esta em silencio.
 */
export type DeviceHealthLevel = "unknown" | "ok" | "warn" | "down";

export interface DeviceHealthInput {
  isActive: boolean;
  /** Ultimo ping recebido. Carimbado pela nuvem. */
  lastSeenAt: string | null;
  /** Envios que ainda andam sozinhos. `null` = balanca nunca reportou. */
  queuePending: number | null;
  /** Envios que pararam e esperam gente. `null` = balanca nunca reportou. */
  queueBlocked: number | null;
  oldestPendingAt: string | null;
  lastError: string | null;
  /** Quando a balanca leu o proprio resumo. `null` = nunca reportou. */
  collectedAt: string | null;
}

export interface DeviceHealthVerdict {
  level: DeviceHealthLevel;
  /** Cabe na coluna: no maximo tres palavras. */
  label: string;
  /** O porque, para o `title` da celula. Sempre uma frase completa. */
  detail: string;
}

/**
 * Silencio a partir do qual a balanca conta como sem contato.
 *
 * O ping e de 5 s, entao 15 minutos nao e atraso: e queda de internet, maquina
 * desligada ou app fechado. O limite e generoso de proposito — reinicio do
 * Windows e oscilacao de link de pedreira sao rotina, e um painel que pisca
 * vermelho a cada um deles deixa de ser lido.
 */
export const DEVICE_OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * A partir de quanto tempo um envio pendente vira atraso.
 *
 * A varredura completa de sincronizacao roda a cada 30 minutos, entao ate ai
 * "na fila" e o funcionamento normal. Uma hora e o dobro disso: o que continua
 * ali depois desse tempo nao esta esperando a proxima passada, esta emperrado.
 */
export const QUEUE_STUCK_THRESHOLD_MS = 60 * 60 * 1000;

export function classifyDeviceHealth(
  input: DeviceHealthInput,
  now: Date = new Date()
): DeviceHealthVerdict {
  if (!input.isActive) {
    return {
      level: "unknown",
      label: "—",
      detail: "Balança bloqueada pelo administrador: ela não sincroniza nada."
    };
  }

  // "Nao sei" e uma resposta, e nao pode ser pintada de verde. Balanca em versao
  // anterior a este relatorio nunca vai preencher as colunas, e mostra-la em dia
  // seria o painel afirmando o que ninguem apurou.
  if (input.collectedAt === null || input.queuePending === null || input.queueBlocked === null) {
    return {
      level: "unknown",
      label: "Sem dados",
      detail: silenceSuffix(
        "Esta balança ainda não reportou a fila de envio (versão anterior a este relatório ou nunca ligada desde ele).",
        input.lastSeenAt,
        now
      )
    };
  }

  const stale = silenceSuffix("", input.lastSeenAt, now);
  const offline = isOffline(input.lastSeenAt, now);

  // Ordem por quem precisa de gente primeiro. Envio parado vem antes de silencio
  // de proposito: a balanca desligada volta sozinha quando alguem a liga, o
  // envio parado nao volta nunca sem um clique.
  if (input.queueBlocked > 0) {
    return {
      level: "down",
      label: `${input.queueBlocked} parado${input.queueBlocked > 1 ? "s" : ""}`,
      detail: joinSentences([
        input.queueBlocked === 1
          ? "1 envio parou e espera alguém: ou esgotou as tentativas, ou depende de um cadastro que falta."
          : `${input.queueBlocked} envios pararam e esperam alguém: ou esgotaram as tentativas, ou dependem de um cadastro que falta.`,
        errorSentence(input.lastError),
        oldestSentence(input.oldestPendingAt, now),
        stale
      ])
    };
  }

  if (offline) {
    return {
      level: "warn",
      label: "Sem contato",
      detail: joinSentences([
        silenceSuffix("A balança parou de responder.", input.lastSeenAt, now),
        pendingSentence(input.queuePending)
      ])
    };
  }

  if (input.queuePending > 0 && isStuck(input.oldestPendingAt, now)) {
    return {
      level: "warn",
      label: `${input.queuePending} atrasado${input.queuePending > 1 ? "s" : ""}`,
      detail: joinSentences([
        `${input.queuePending} ${input.queuePending === 1 ? "envio" : "envios"} na fila há mais tempo do que uma varredura normal levaria.`,
        oldestSentence(input.oldestPendingAt, now),
        errorSentence(input.lastError),
        stale
      ])
    };
  }

  if (input.queuePending > 0) {
    return {
      level: "ok",
      label: `${input.queuePending} na fila`,
      detail: joinSentences([
        `${input.queuePending} ${input.queuePending === 1 ? "envio" : "envios"} aguardando a próxima sincronização. Ritmo normal.`,
        stale
      ])
    };
  }

  return {
    level: "ok",
    label: "Em dia",
    detail: joinSentences(["Nada pendente na fila de envio desta balança.", stale])
  };
}

function isOffline(lastSeenAt: string | null, now: Date): boolean {
  const elapsed = elapsedMs(lastSeenAt, now);
  // Sem `last_seen_at` a balanca foi cadastrada e nunca pingou: silencio total,
  // que e o proprio caso que esta coluna existe para mostrar.
  return elapsed === null ? true : elapsed > DEVICE_OFFLINE_THRESHOLD_MS;
}

function isStuck(oldestPendingAt: string | null, now: Date): boolean {
  const elapsed = elapsedMs(oldestPendingAt, now);
  return elapsed !== null && elapsed > QUEUE_STUCK_THRESHOLD_MS;
}

function elapsedMs(value: string | null, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  // Relogio adiantado na balanca nao pode virar "atraso negativo".
  return Math.max(0, now.getTime() - parsed);
}

/**
 * "ha 3 h", "ha 2 dias". Aproximado de proposito: quem le a coluna quer saber a
 * ordem de grandeza, e a data exata ja esta na coluna do lado.
 */
export function formatElapsed(value: string | null, now: Date = new Date()): string | null {
  const elapsed = elapsedMs(value, now);
  if (elapsed === null) return null;

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

function silenceSuffix(prefix: string, lastSeenAt: string | null, now: Date): string {
  const elapsed = formatElapsed(lastSeenAt, now);
  const silence =
    elapsed === null
      ? "Nunca houve contato com esta balança."
      : isOffline(lastSeenAt, now)
        ? `Último contato ${elapsed}.`
        : "";
  return joinSentences([prefix, silence]);
}

function pendingSentence(queuePending: number): string {
  if (queuePending <= 0) return "Não havia nada pendente no último relato.";
  return `Havia ${queuePending} ${queuePending === 1 ? "envio pendente" : "envios pendentes"} no último relato.`;
}

function oldestSentence(oldestPendingAt: string | null, now: Date): string {
  const elapsed = formatElapsed(oldestPendingAt, now);
  return elapsed === null ? "" : `O mais antigo espera desde ${elapsed}.`;
}

function errorSentence(lastError: string | null): string {
  const trimmed = lastError?.trim();
  return trimmed ? `Última recusa: ${trimmed}` : "";
}

function joinSentences(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}
