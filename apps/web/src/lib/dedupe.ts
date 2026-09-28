/**
 * Cadastro repetido na TELA do site.
 *
 * Cada balanca da pedreira nasceu com as suas formas de pagamento do sistema ("Dinheiro", "Pix",
 * ...) e com as suas contas e condicoes, cada uma com id SORTEADO na propria maquina — e todas
 * sobem para a nuvem. A Pedreira Ibiuna tinha 38 formas de pagamento para 8 formas de verdade,
 * 97 condicoes para 45 e 10 contas para 5. Placa e motorista repetem pelo mesmo caminho (a mesma
 * placa cadastrada em duas balancas antes do cadastro chegar de uma na outra).
 *
 * As copias NAO saem do banco: pesagem antiga, cliente e carteira apontam para cada uma delas, e
 * a balanca ja traduz o id da forma de pagamento pelo codigo (`resolvePaymentMethodId`). Apagar
 * na nuvem viraria lapide no pull e tiraria da balanca a forma que a pesagem dela usa. Aqui o
 * site so mostra UMA linha por cadastro, e lembra os ids das copias (`ids`) para quem precisa
 * deles — a exclusao, por exemplo, exclui o grupo inteiro.
 */

export interface DedupedGroup<T> {
  /** A linha que representa o grupo (ver `pickRepresentative`). */
  row: T;
  /** Todos os ids do grupo, o do representante primeiro. */
  ids: string[];
}

interface Identified {
  id: string;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Sem acento, sem caixa e sem espaco sobrando: "Cartão  de Crédito" = "cartao de credito". */
export function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** "ABC-1D23", "abc 1d23" e "ABC1D23" sao a mesma placa. */
export function normalizePlateKey(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Quem representa o grupo: a ativa antes da inativa, depois a mais antiga (a primeira balanca
 * que cadastrou), empate no menor id — deterministico, para a linha nao trocar a cada leitura.
 */
function compareRepresentative(a: Identified, b: Identified): number {
  const active = Number(b.is_active !== false) - Number(a.is_active !== false);
  if (active !== 0) return active;
  const created = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

/** Agrupa pela chave, na ordem em que cada grupo aparece pela primeira vez. */
export function dedupeBy<T extends Identified>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  compare: (a: T, b: T) => number = compareRepresentative
): DedupedGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    // Sem chave (nome vazio) nao ha com quem juntar: fica sozinho.
    const bucket = key ? key : `__id:${row.id}`;
    const list = groups.get(bucket);
    if (list) list.push(row);
    else groups.set(bucket, [row]);
  }
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort(compare);
    return { row: sorted[0], ids: sorted.map((row) => row.id) };
  });
}

interface PaymentMethodLike extends Identified {
  name: string;
  alias?: string | null;
  omie_code?: string | null;
  is_wallet?: boolean | null;
  is_customer_credit?: boolean | null;
}

/** Formas de pagamento: mesmo nome, mesmo codigo OMIE e mesma natureza (carteira, credito). */
export function dedupePaymentMethods<T extends PaymentMethodLike>(
  rows: readonly T[]
): DedupedGroup<T>[] {
  return dedupeBy(rows, (row) =>
    [
      normalizeLabel(row.alias || row.name),
      row.omie_code ?? "",
      row.is_wallet ? "wallet" : "",
      row.is_customer_credit ? "credit" : ""
    ].join("|")
  );
}

interface NamedWithCode extends Identified {
  name: string;
  omie_code?: string | null;
}

/** Contas e condicoes de pagamento: mesmo nome e mesmo codigo OMIE. */
export function dedupeByNameAndCode<T extends NamedWithCode>(
  rows: readonly T[]
): DedupedGroup<T>[] {
  return dedupeBy(rows, (row) => `${normalizeLabel(row.name)}|${row.omie_code ?? ""}`);
}

interface VehicleLike extends Identified {
  plate: string;
}

/** Placas: a mesma placa e o mesmo caminhao. Fica a copia editada por ultimo, que e a atual. */
export function dedupeVehicles<T extends VehicleLike>(rows: readonly T[]): DedupedGroup<T>[] {
  return dedupeBy(
    rows,
    (row) => normalizePlateKey(row.plate),
    (a, b) => {
      const active = Number(b.is_active !== false) - Number(a.is_active !== false);
      if (active !== 0) return active;
      const updated = String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
      if (updated !== 0) return updated;
      return a.id.localeCompare(b.id);
    }
  );
}

interface DriverLike extends Identified {
  name: string;
  document?: string | null;
}

/**
 * Motoristas: mesmo nome. Homonimo com DOCUMENTO diferente e outra pessoa e fica separado; a
 * copia sem documento se junta ao primeiro documento do nome (e a mesma pessoa cadastrada as
 * pressas numa das balancas).
 */
export function dedupeDrivers<T extends DriverLike>(rows: readonly T[]): DedupedGroup<T>[] {
  const documentOf = (row: T) => (row.document ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const firstDocumentByName = new Map<string, string>();
  for (const row of rows) {
    const name = normalizeLabel(row.name);
    const doc = documentOf(row);
    if (name && doc && !firstDocumentByName.has(name)) firstDocumentByName.set(name, doc);
  }
  return dedupeBy(rows, (row) => {
    const name = normalizeLabel(row.name);
    if (!name) return "";
    return `${name}|${documentOf(row) || firstDocumentByName.get(name) || ""}`;
  });
}

/** Qualquer id do grupo -> o id do representante (para o seletor mostrar a escolha atual). */
export function representativeIds<T extends Identified>(
  groups: readonly DedupedGroup<T>[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.ids) map.set(id, group.row.id);
  }
  return map;
}
