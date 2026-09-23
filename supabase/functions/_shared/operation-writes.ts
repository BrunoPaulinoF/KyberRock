/**
 * Quando a copia de uma pesagem que uma balanca envia NAO pode substituir a que ja esta na
 * nuvem.
 *
 * Com varias balancas na mesma pedreira, cada uma guarda a sua copia da pesagem e pode
 * reenvia-la. Duas regras ja existiam: nao voltar um status terminal (fechada/cancelada) para
 * aberto, e nao aceitar copia mais antiga que a da nuvem.
 *
 * Faltava a terceira: **cancelada e final**. O computador que nao ficou sabendo do cancelamento
 * ainda tem a carga como concluida e, se mexer nela depois (baixa na carteira, numero da nota),
 * a copia dele sai com `updated_at` mais novo — e passava pela regra do horario, fazendo a carga
 * cancelada voltar a valer na nuvem e, dali, em todas as balancas: de novo na fatura do cliente
 * e no frete do transportador. O cancelamento nao tem volta no sistema, entao nenhum reenvio de
 * outro status pode desfaze-lo.
 *
 * Recusar a copia velha nao basta: o computador que a mandou continua com a carga como
 * concluida, e com `updated_at` MAIS NOVO que o do cancelamento — o espelho dele descarta a
 * versao da nuvem por ser mais antiga, entao ele nunca se corrigiria sozinho. Por isso o
 * cancelamento e REANUNCIADO (`cancellationReannouncements`): a nuvem carimba a linha cancelada
 * com um `updated_at` posterior ao da copia recusada, e ela volta a todas as balancas como a
 * versao mais nova.
 */

/** Status de pesagem que nao pode voltar para aberto por um reenvio atrasado. */
export const TERMINAL_OPERATION_STATUSES: ReadonlySet<string> = new Set([
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error",
  "cancelled"
]);

export interface OperationVersion {
  status: string | null | undefined;
  updated_at: string | null | undefined;
}

/** True quando a copia recebida deve ser descartada em favor da que ja esta na nuvem. */
export function isStaleOperationWrite(
  current: OperationVersion,
  incoming: OperationVersion
): boolean {
  const currentStatus = String(current.status ?? "");
  const incomingStatus = String(incoming.status ?? "");

  if (currentStatus === "cancelled" && incomingStatus !== "cancelled") return true;

  if (
    TERMINAL_OPERATION_STATUSES.has(currentStatus) &&
    !TERMINAL_OPERATION_STATUSES.has(incomingStatus)
  ) {
    return true;
  }

  const incomingTs = Date.parse(String(incoming.updated_at ?? ""));
  const currentTs = Date.parse(String(current.updated_at ?? ""));
  return Number.isFinite(incomingTs) && Number.isFinite(currentTs) && incomingTs < currentTs;
}

/** Linha cancelada que precisa voltar as balancas como a versao mais nova. */
export interface CancellationReannouncement {
  id: string;
  updatedAt: string;
}

/**
 * As pesagens canceladas na nuvem que alguma balanca tentou sobrescrever com uma copia MAIS
 * NOVA de outro status — sinal de que aquela balanca nao sabe do cancelamento. O novo
 * `updated_at` fica depois da copia recusada (e nunca antes do relogio da nuvem), para vencer o
 * "mais novo ganha" do espelho de quem a mandou.
 */
export function cancellationReannouncements(
  currentById: ReadonlyMap<string, OperationVersion>,
  rows: ReadonlyArray<Record<string, unknown>>,
  now: Date = new Date()
): CancellationReannouncement[] {
  const latest = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.id ?? "");
    const current = currentById.get(id);
    if (!id || !current) continue;
    if (String(current.status ?? "") !== "cancelled") continue;
    if (String(row.status ?? "") === "cancelled") continue;
    const incomingTs = Date.parse(String(row.updated_at ?? ""));
    const currentTs = Date.parse(String(current.updated_at ?? ""));
    // Copia mais velha que o cancelamento: a balanca que a mandou ja vai aceitar a da nuvem.
    if (Number.isFinite(incomingTs) && Number.isFinite(currentTs) && incomingTs < currentTs) {
      continue;
    }
    const floor = Number.isFinite(incomingTs) ? incomingTs + 1 : 0;
    latest.set(id, Math.max(latest.get(id) ?? 0, floor, now.getTime()));
  }
  return [...latest].map(([id, ts]) => ({ id, updatedAt: new Date(ts).toISOString() }));
}
