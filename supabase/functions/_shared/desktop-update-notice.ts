/**
 * Aviso de atualizacao: o que a nuvem faz com ele em cada ping da balanca.
 *
 * O painel marca `update_notice_version` na balanca; o `desktop-status` entrega
 * o recado no ping que ja existe. As tres saidas possiveis estao aqui porque as
 * duas menos obvias sao as que evitam trabalho manual depois:
 *
 *   entregar -> ha aviso pendente e a balanca ainda nao esta na versao pedida
 *   limpar   -> a balanca JA esta na versao pedida: o aviso cumpriu o papel e
 *               some sozinho, senao o painel acumularia avisos vencidos que
 *               alguem teria de apagar a mao
 *   nada     -> nao ha aviso
 *
 * `markSeen` distingue "a maquina esta desligada" de "ela recebeu o recado e
 * ninguem clicou" — sem isso o painel nao teria como dizer se o silencio e da
 * balanca ou do operador.
 *
 * Modulo puro (sem Deno, sem rede) para ter teste: e ele que decide quando um
 * aviso some, e um aviso que some cedo demais e um pedido que ninguem viu.
 */

export interface UpdateNoticeColumns {
  update_notice_version?: unknown;
  update_notice_sent_at?: unknown;
  update_notice_seen_at?: unknown;
}

export interface DeliveredUpdateNotice {
  version: string;
  /** Quando o painel disparou. `null` na linha antiga, sem a data gravada. */
  requestedAt: string | null;
}

export type UpdateNoticeOutcome =
  | { kind: "none" }
  | { kind: "deliver"; notice: DeliveredUpdateNotice; markSeen: boolean }
  | { kind: "clear" };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * O que fazer com o aviso desta balanca neste ping.
 *
 * `reportedVersion` e a versao que o proprio desktop acabou de dizer que esta
 * rodando (`app_version`). Ausente — desktop antigo, que ainda nao reporta —
 * mantem o aviso de pe: sem saber onde a balanca esta, apagar o pedido seria
 * dar por cumprido o que ninguem confirmou.
 */
export function resolveUpdateNotice(
  row: UpdateNoticeColumns,
  reportedVersion: string | null
): UpdateNoticeOutcome {
  const version = text(row.update_notice_version);
  if (!version) return { kind: "none" };
  if (reportedVersion && reportedVersion === version) return { kind: "clear" };

  return {
    kind: "deliver",
    notice: { version, requestedAt: text(row.update_notice_sent_at) },
    markSeen: text(row.update_notice_seen_at) === null
  };
}
