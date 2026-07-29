/**
 * Classificacao de um cadastro do OMIE para o KyberRock.
 *
 * O OMIE guarda cliente, transportadora e fornecedor na MESMA tabela de
 * clientes, separados por tag. A regra anterior so importava quem tivesse
 * exatamente a tag "cliente": numa pedreira que nao usa tags, isso descartava
 * silenciosamente a maior parte do cadastro (900+ clientes no OMIE viravam 213
 * no KyberRock, sem nenhum erro na tela).
 *
 * Alem das tags, o OMIE tem um campo proprio para isto: `cliente_fornecedor`
 * ("C" cliente, "F" fornecedor, "A" ambos, "T" transportadora). Ele e populado
 * mesmo em quem nao usa tags, e por isso vale mais que a tag quando diz que o
 * cadastro compra. Numa pedreira com 948 cadastros no OMIE, so 214 entravam:
 * o resto carregava tag de fornecedor e era descartado mesmo sendo cliente.
 *
 * A exclusao por tag de fornecedor era o que sobrava do problema: numa pedreira
 * com 948 cadastros no OMIE so 214 entravam, porque 701 carregavam tag de
 * fornecedor. Essa regra nunca foi pedida pela operacao — e o custo dos dois
 * lados nao e simetrico. Fornecedor sobrando na busca de cliente e ruido que o
 * operador resolve inativando; cliente faltando e caminhao parado na balanca.
 *
 * Regra atual:
 * - tag "transportadora" ou tipo "T" -> transportadora;
 * - tag "cliente" ou tipo "C"/"A" -> cliente, mesmo que tambem seja
 *   transportadora (quem transporta tambem pode comprar);
 * - todo o resto -> cliente. E o unico criterio que faz o KyberRock enxergar o
 *   cadastro inteiro da pedreira, com ou sem tags no OMIE.
 */

const CUSTOMER_TAG = "cliente";
const CARRIER_TAG = "transportadora";
/** `cliente_fornecedor` do OMIE: valores que significam "este cadastro compra". */
const CUSTOMER_TYPES = ["c", "a"];
const CARRIER_TYPES = ["t"];

export interface OmieCustomerClassification {
  isCustomer: boolean;
  isCarrier: boolean;
}

export function classifyOmieCustomer(
  tagsJson: Record<string, unknown> | unknown[] | null | undefined,
  customerType?: string | null
): OmieCustomerClassification {
  const tags = getOmieTagValues(tagsJson ?? null).map(normalizeTag).filter(Boolean);
  const type = normalizeTag(customerType ?? "");

  const typedCustomer = CUSTOMER_TYPES.includes(type) || type.includes("cliente");
  const typedCarrier = CARRIER_TYPES.includes(type) || type.includes("transportadora");

  const isCarrier = tags.includes(CARRIER_TAG) || typedCarrier;
  const declaredCustomer = tags.includes(CUSTOMER_TAG) || typedCustomer;

  // Só quem e exclusivamente transportadora fica fora da lista de clientes.
  const isCustomer = declaredCustomer || !isCarrier;

  return { isCustomer, isCarrier };
}

export function getOmieTagValues(
  tagsJson: Record<string, unknown> | unknown[] | null
): string[] {
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
