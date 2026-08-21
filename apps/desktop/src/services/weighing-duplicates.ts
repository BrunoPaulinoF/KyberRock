import type { DesktopDatabase } from "../database/sqlite.js";
import { buildCustomerIdentityIndex, identityKeyForOperation } from "./customer-identity.js";
import { CLOSED_OPERATION_STATUS_SQL_LIST } from "./weighing-operations.js";

/**
 * Pesagens REPETIDAS: a mesma carga registrada duas vezes na balanca.
 *
 * Uma pesagem fechada nao pode ser editada — o cupom ja saiu com o motorista e o pedido ja
 * foi para o OMIE. Quando o preco sai errado, ou a venda foi lancada como interna em vez de
 * com nota, a atendente faz a unica coisa que a tela permite: registra a carga DE NOVO, com
 * os mesmos pesos, agora certa. O que ninguem faz e voltar e cancelar a errada — ela fica
 * la, concluida, e o fechamento cobra a mesma carga duas vezes.
 *
 * E exatamente a diferenca que os clientes reclamam entre o fechamento do KyberRock e o do
 * OMIE: la dentro alguem exclui o pedido errado (ou ele nunca chegou a ser criado), aqui a
 * pesagem continua somando. O total do KyberRock fica maior, e ninguem consegue dizer por
 * que sem conferir carga a carga.
 *
 * A REGRA de "e a mesma carga" e proposital e estreita: mesmo cliente, mesma placa, mesmo
 * produto e os DOIS pesos — entrada e saida — iguais ao quilo. Duas viagens de verdade do
 * mesmo caminhao nunca dao a mesma tara E o mesmo peso bruto no mesmo grama; um relancamento
 * da, porque os pesos foram copiados do cupom anterior. Preferir o falso negativo e
 * deliberado: deixar uma repetida passar custa uma conferencia; tirar da fatura uma carga que
 * saiu de verdade e deixar de cobrar dinheiro que a pedreira ganhou.
 *
 * Quem fica e quem sai do fechamento:
 *
 *  - Se ALGUMA das repetidas ja tem NOTA FISCAL emitida no OMIE, ela FICA — o documento
 *    existe, o cliente vai receber a cobranca dele, e o fechamento tem de bater com o OMIE,
 *    nao com o que seria justo. Duas notas para a mesma carga viram um aviso: so o OMIE pode
 *    cancelar nota.
 *  - Sem nota nenhuma no grupo, fica a ULTIMA registrada — a correcao, que e a que o
 *    operador considerou certa — e as anteriores saem da fatura.
 */

/** Uma pesagem como a deteccao de repetidas a enxerga. */
export interface DuplicateWeighingCandidate {
  operationId: string;
  couponNumber: number | null;
  /** `created_at` da operacao, em ISO. Decide quem e a ultima do grupo. */
  createdAt: string;
  /** Data da pesagem (YYYY-MM-DD), so para a tela explicar de quando e a repetida. */
  date: string;
  /**
   * O cliente REAL da carga — a identidade, e nao o `customer_id`.
   *
   * O relancamento costuma escolher o cliente de novo na lista, e a base tem o mesmo
   * cliente cadastrado duas vezes (o do OMIE e o da balanca). Pelo `customer_id` cru, a
   * carga refeita cairia num grupo diferente da original e a repeticao passaria batido.
   */
  customerKey: string;
  customerName: string;
  plate: string;
  productKey: string;
  productDescription: string;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  totalCents: number;
  operationType: "invoice" | "internal";
  /** Numero da nota emitida no OMIE, quando ha — e o que decide quem fica. */
  invoiceNumber: string | null;
}

/** Um grupo de pesagens que sao a MESMA carga. */
export interface DuplicateWeighingGroup {
  key: string;
  customerName: string;
  plate: string;
  productDescription: string;
  entryWeightKg: number;
  exitWeightKg: number;
  /** As que continuam valendo no fechamento (ver o cabecalho do modulo). */
  keepers: DuplicateWeighingCandidate[];
  /** As repetidas — saem da fatura e sao candidatas ao cancelamento. */
  duplicates: DuplicateWeighingCandidate[];
  /**
   * True quando mais de uma das repetidas ja tem nota emitida no OMIE.
   *
   * Nesse caso o KyberRock nao tem o que corrigir sozinho: as duas notas existem, e so o
   * OMIE cancela nota fiscal. O grupo aparece na tela como aviso, sem tirar nada da fatura.
   */
  billedMoreThanOnce: boolean;
}

/**
 * Agrupa as pesagens repetidas. Puro de proposito: a regra de "e a mesma carga" e a parte
 * que precisa de teste, e ela nao depende do banco.
 */
export function groupDuplicateWeighings(
  candidates: readonly DuplicateWeighingCandidate[]
): DuplicateWeighingGroup[] {
  const groups = new Map<string, DuplicateWeighingCandidate[]>();

  for (const candidate of candidates) {
    const key = duplicateKey(candidate);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const result: DuplicateWeighingGroup[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(compareByRegistration);
    const billed = ordered.filter((candidate) => hasInvoice(candidate));
    // Com nota emitida, quem manda e o OMIE: o documento existe e o fechamento tem de
    // mostrar o que sera cobrado. Sem nota nenhuma, a correcao e a ultima registrada.
    const keepers = billed.length > 0 ? billed : [ordered[ordered.length - 1]!];
    const keeperIds = new Set(keepers.map((candidate) => candidate.operationId));
    const duplicates = ordered.filter((candidate) => !keeperIds.has(candidate.operationId));
    if (duplicates.length === 0 && billed.length < 2) continue;

    const reference = keepers[0]!;
    result.push({
      key,
      customerName: reference.customerName,
      plate: reference.plate,
      productDescription: reference.productDescription,
      entryWeightKg: reference.entryWeightKg ?? 0,
      exitWeightKg: reference.exitWeightKg ?? 0,
      keepers,
      duplicates,
      billedMoreThanOnce: billed.length > 1
    });
  }

  return result.sort(
    (a, b) =>
      (b.duplicates[0]?.createdAt ?? "").localeCompare(a.duplicates[0]?.createdAt ?? "") ||
      a.plate.localeCompare(b.plate, "pt-BR")
  );
}

/**
 * A chave da carga, ou null quando a pesagem nao tem como ser comparada.
 *
 * Sem placa ou sem os dois pesos nao ha evidencia nenhuma de repeticao — e sao justamente as
 * pesagens antigas e as importadas, em que agrupar por cliente e produto juntaria cargas
 * diferentes do mesmo dia.
 */
function duplicateKey(candidate: DuplicateWeighingCandidate): string | null {
  const plate = candidate.plate.trim().toUpperCase();
  if (!plate) return null;
  const entry = candidate.entryWeightKg;
  const exit = candidate.exitWeightKg;
  if (!entry || !exit || entry <= 0 || exit <= 0) return null;
  return [candidate.customerKey, plate, candidate.productKey, entry, exit].join("|");
}

function hasInvoice(candidate: DuplicateWeighingCandidate): boolean {
  return (candidate.invoiceNumber ?? "").trim().length > 0;
}

/** Da mais antiga para a mais nova, com o vale como desempate estavel. */
function compareByRegistration(
  a: DuplicateWeighingCandidate,
  b: DuplicateWeighingCandidate
): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    (a.couponNumber ?? 0) - (b.couponNumber ?? 0) ||
    a.operationId.localeCompare(b.operationId)
  );
}

/**
 * Quantos dias antes e depois do periodo a busca olha.
 *
 * A carga refeita nem sempre e do mesmo dia: a correcao de preco de uma quinzena inteira sai
 * dias depois, ja no fechamento. Olhar so o periodo escolhido deixaria a original dentro da
 * fatura e a correcao fora dela — e a fatura cobraria a errada. Sessenta dias cobre o
 * fechamento mensal e o mes seguinte inteiro sem varrer o acervo a cada tela aberta.
 */
export const DUPLICATE_WEIGHING_WINDOW_DAYS = 60;

interface DuplicateSourceRow {
  id: string;
  operation_code: number | null;
  created_at: string;
  operation_type: "invoice" | "internal";
  customer_id: string | null;
  customer_name: string | null;
  product_id: string | null;
  product_description: string | null;
  plate: string | null;
  entry_weight_kg: number | null;
  exit_weight_kg: number | null;
  total_cents: number | null;
  omie_invoice_number: string | null;
}

/**
 * As pesagens repetidas que TOCAM o periodo do fechamento.
 *
 * A janela e maior que o periodo (ver `DUPLICATE_WEIGHING_WINDOW_DAYS`), mas o grupo so
 * interessa quando alguma das pesagens dele esta na tela: uma repeticao inteira de dois meses
 * atras nao e assunto do fechamento desta quinzena.
 */
export function findDuplicateWeighings(
  database: DesktopDatabase,
  unitId: string,
  startDate: string,
  endDate: string
): DuplicateWeighingGroup[] {
  const identities = buildCustomerIdentityIndex(database);
  const rows = database
    .prepare(
      `SELECT
         o.id, o.operation_code, o.created_at, o.operation_type, o.customer_id,
         COALESCE(cust.trade_name, cust.legal_name, o.remote_customer_name) as customer_name,
         o.product_id,
         COALESCE(p.description, o.remote_product_description) as product_description,
         COALESCE(v.plate, o.remote_plate) as plate,
         o.entry_weight_kg, o.exit_weight_kg, o.total_cents, o.omie_invoice_number
       FROM weighing_operations o
       LEFT JOIN customers cust ON cust.id = o.customer_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       WHERE o.unit_id = ?
         AND o.deleted_at IS NULL
         AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
         AND date(o.created_at) >= date(?, ?)
         AND date(o.created_at) <= date(?, ?)
       ORDER BY o.created_at ASC`
    )
    .all(
      unitId,
      startDate,
      `-${DUPLICATE_WEIGHING_WINDOW_DAYS} days`,
      endDate,
      `+${DUPLICATE_WEIGHING_WINDOW_DAYS} days`
    ) as DuplicateSourceRow[];

  const candidates = rows.map<DuplicateWeighingCandidate>((row) => ({
    operationId: row.id,
    couponNumber: row.operation_code,
    createdAt: row.created_at,
    date: row.created_at.slice(0, 10),
    customerKey: identityKeyForOperation(identities, row.customer_id),
    customerName: (row.customer_name ?? "").trim() || "Sem cliente",
    plate: (row.plate ?? "").trim(),
    // O cadastro manda; sem produto vinculado, a descricao gravada na propria pesagem.
    productKey: row.product_id ?? `desc:${(row.product_description ?? "").trim().toUpperCase()}`,
    productDescription: (row.product_description ?? "").trim() || "N/A",
    entryWeightKg: row.entry_weight_kg,
    exitWeightKg: row.exit_weight_kg,
    totalCents: row.total_cents ?? 0,
    operationType: row.operation_type,
    invoiceNumber: (row.omie_invoice_number ?? "").trim() || null
  }));

  return groupDuplicateWeighings(candidates).filter((group) =>
    [...group.keepers, ...group.duplicates].some(
      (candidate) => candidate.date >= startDate && candidate.date <= endDate
    )
  );
}
