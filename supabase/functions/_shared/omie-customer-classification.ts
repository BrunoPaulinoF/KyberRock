/**
 * Classificacao de um cadastro do OMIE para o KyberRock.
 *
 * O OMIE guarda cliente, transportadora e fornecedor na MESMA tabela de
 * clientes, separados por tag e pelo campo `cliente_fornecedor` ("C" cliente,
 * "F" fornecedor, "A" ambos, "T" transportadora). Ler so a tag "cliente"
 * descartava silenciosamente a maior parte do cadastro numa pedreira que nao
 * usa tags (900+ clientes no OMIE viravam 213 no KyberRock); ler tudo como
 * cliente resolvia isso mas enchia a balanca de fornecedor, que agora aparece
 * na troca de cliente da operacao e gera conflito de cadastro.
 *
 * Regra atual, usando as duas fontes:
 * - tag "transportadora" ou tipo "T" -> transportadora;
 * - tag "cliente" ou tipo "C"/"A" -> cliente, mesmo que tambem seja
 *   transportadora ou fornecedor (quem transporta/fornece tambem compra);
 * - tag "fornecedor" ou tipo "F", sem sinal de cliente -> NAO e cliente;
 * - cadastro sem nenhum papel declarado -> cliente. E o que faz o KyberRock
 *   enxergar o cadastro inteiro da pedreira, com ou sem tags no OMIE, sem
 *   trazer junto quem o OMIE ja diz que e fornecedor.
 */

const CUSTOMER_TAG = "cliente";
const CARRIER_TAG = "transportadora";
const SUPPLIER_TAG = "fornecedor";
/** `cliente_fornecedor` do OMIE: valores que significam "este cadastro compra". */
const CUSTOMER_TYPES = ["c", "a"];
const CARRIER_TYPES = ["t"];
/** `cliente_fornecedor` do OMIE: cadastro que vende para a pedreira ("A" = ambos). */
const SUPPLIER_TYPES = ["f", "a"];

export interface OmieCustomerClassification {
  isCustomer: boolean;
  isCarrier: boolean;
  /** Fornecedor declarado (tag "fornecedor" ou tipo "F"). */
  isSupplier: boolean;
}

export function classifyOmieCustomer(
  tagsJson: Record<string, unknown> | unknown[] | null | undefined,
  customerType?: string | null
): OmieCustomerClassification {
  const tags = getOmieTagValues(tagsJson ?? null)
    .map(normalizeTag)
    .filter(Boolean);
  const type = normalizeTag(customerType ?? "");

  const typedCustomer = CUSTOMER_TYPES.includes(type) || type.includes("cliente");
  const typedCarrier = CARRIER_TYPES.includes(type) || type.includes("transportadora");
  const typedSupplier = SUPPLIER_TYPES.includes(type) || type.includes("fornecedor");

  const isCarrier = tags.includes(CARRIER_TAG) || typedCarrier;
  const isSupplier = tags.includes(SUPPLIER_TAG) || typedSupplier;
  const declaredCustomer = tags.includes(CUSTOMER_TAG) || typedCustomer;

  // Fornecedor/transportadora declarado sem sinal de cliente fica fora da lista de
  // clientes; cadastro sem papel nenhum continua entrando (e cliente da pedreira).
  const isCustomer = declaredCustomer || (!isCarrier && !isSupplier);

  return { isCustomer, isCarrier, isSupplier };
}

export function getOmieTagValues(tagsJson: Record<string, unknown> | unknown[] | null): string[] {
  if (!tagsJson) return [];
  const tagValues: string[] = [];
  if (Array.isArray(tagsJson)) {
    tagValues.push(...tagsJson.map(readTagValue));
  } else {
    const tags = (tagsJson as { tags?: unknown }).tags;
    if (Array.isArray(tags)) tagValues.push(...tags.map(readTagValue));
  }
  return tagValues;
}

function readTagValue(tag: unknown): string {
  return typeof tag === "object" && tag !== null && "tag" in tag
    ? String((tag as { tag?: unknown }).tag ?? "")
    : String(tag ?? "");
}

export function normalizeTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
