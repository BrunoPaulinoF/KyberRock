/**
 * Aviso de atualizacao: o que a nuvem faz com ele em cada ping da balanca.
 *
 * O painel marca `update_notice_version` na balanca; o `desktop-status` entrega
 * o recado no ping que ja existe. As tres saidas possiveis estao aqui porque as
 * duas menos obvias sao as que evitam trabalho manual depois:
 *
 *   entregar -> ha aviso pendente e a balanca ainda esta ATRAS da versao pedida
 *   limpar   -> a balanca ja alcancou (ou passou) a versao pedida: o aviso
 *               cumpriu o papel e some sozinho, senao o painel acumularia
 *               avisos vencidos que alguem teria de apagar a mao
 *   nada     -> nao ha aviso
 *
 * O "ou passou" nao e detalhe: um aviso disparado com a producao REGREDIDA pede
 * uma versao mais VELHA que a instalada, e a balanca de producao nao sabe
 * voltar atras (`allowDowngrade` fica desligado nela de proposito — ver
 * `services/update-channel.ts` no desktop). Comparando so por igualdade, esse
 * aviso nunca era cumprido nem apagado: o operador reabria o KyberRock e era
 * recebido, todo dia, por um pedido para instalar uma versao que aquele
 * computador jamais instalaria.
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

/** Compara versoes numero a numero: 0.8.9 < 0.8.10, que um compare de texto erra. */
function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
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
  // Alcancou OU passou: a balanca que ja esta a frente nao tem o que fazer com
  // o recado, e insistir nele e o aviso eterno que esta funcao existe para
  // evitar.
  if (reportedVersion && compareVersions(reportedVersion, version) >= 0) {
    return { kind: "clear" };
  }

  return {
    kind: "deliver",
    notice: { version, requestedAt: text(row.update_notice_sent_at) },
    markSeen: text(row.update_notice_seen_at) === null
  };
}
