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

/**
 * Cliente e produto da pesagem, com o nome que a projecao leva junto de cada um.
 *
 * Ausente e diferente de nulo: coluna que o payload nao traz o upsert ja preserva.
 */
export interface OperationLinks {
  customer_id?: string | null;
  customer_name?: string | null;
  product_id?: string | null;
  product_description?: string | null;
}

const OPERATION_LINKS = [
  { id: "customer_id", label: "customer_name" },
  { id: "product_id", label: "product_description" }
] as const;

function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * A copia recebida com o cliente (ou o produto) da nuvem no lugar do VAZIO que ela trouxe.
 *
 * Nao existe pesagem sem cliente nem sem produto — o espelho do desktop ja segue essa regra
 * (`customer_id = COALESCE(excluded.customer_id, ...)` em `upsertCloudOperations`) —, entao um
 * vazio chegando aqui nunca e "o operador tirou": e a balanca que nao sabe quem e o cliente.
 *
 * E isso acontecia. Cliente com dois cadastros na nuvem (mesmo CNPJ, ids diferentes) fica com
 * um so em cada balanca: o pull descarta o gemeo (`findLocalCadastroWithDocument`). A pesagem
 * fechada na balanca que usa um id chega na outra apontando para o id que ela nao tem, e la
 * vira pesagem sem cliente. Quando essa outra balanca confere a nota no OMIE ela reenvia a
 * pesagem com o MESMO `updated_at` — e o vazio apagava o cliente da nuvem. Na Pedreira Ibiuna
 * foram 95 pesagens, 57 da Levisa: a Conferencia de faturamento do site mostrava 0 pesagens da
 * Levisa de 08 a 19/09, contra 15 (R$ 24.250,68) no computador da expedicao.
 *
 * O nome so e trocado junto com o vinculo, ou quando o vinculo e o mesmo e o nome chegou
 * vazio: com outro cliente no payload (a troca feita na operacao aberta), vale o payload.
 */
export function keepOperationLinks(
  current: OperationLinks,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  let row = incoming;
  for (const link of OPERATION_LINKS) {
    if (!(link.id in incoming)) continue;
    const currentId = current[link.id];
    const currentLabel = current[link.label];
    if (!filled(currentId)) continue;
    const incomingId = incoming[link.id];
    if (!filled(incomingId)) {
      row = { ...row, [link.id]: currentId };
      if (!filled(incoming[link.label]) && filled(currentLabel)) {
        row = { ...row, [link.label]: currentLabel };
      }
    } else if (
      incomingId === currentId &&
      link.label in incoming &&
      !filled(incoming[link.label]) &&
      filled(currentLabel)
    ) {
      row = { ...row, [link.label]: currentLabel };
    }
  }
  return row;
}
