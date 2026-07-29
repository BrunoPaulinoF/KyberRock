/**
 * Classificacao de um cadastro do OMIE para o KyberRock.
 *
 * O OMIE guarda cliente, transportadora e fornecedor na MESMA tabela de
 * clientes, separados por tag. A regra anterior so importava quem tivesse
 * exatamente a tag "cliente": numa pedreira que nao usa tags, isso descartava
 * silenciosamente a maior parte do cadastro (900+ clientes no OMIE viravam 213
 * no KyberRock, sem nenhum erro na tela).
 *
 * Regra atual:
 * - tag "transportadora" -> transportadora;
 * - tag "cliente" -> cliente (mesmo que tambem seja transportadora: quem
 *   transporta tambem pode comprar);
 * - sem tag nenhuma -> cliente (o caso normal de quem nao usa tags no OMIE);
 * - so tag de fornecedor (sem "cliente") -> nao entra como cliente, porque nao
 *   compra da pedreira.
 */

const CUSTOMER_TAG = "cliente";
const CARRIER_TAG = "transportadora";
const SUPPLIER_ONLY_TAGS = ["fornecedor", "fornecedores"];

export interface OmieCustomerClassification {
  isCustomer: boolean;
  isCarrier: boolean;
}

export function classifyOmieCustomer(
  tagsJson: Record<string, unknown> | unknown[] | null | undefined
): OmieCustomerClassification {
  const tags = getOmieTagValues(tagsJson ?? null).map(normalizeTag).filter(Boolean);
  const isCarrier = tags.includes(CARRIER_TAG);
  const taggedCustomer = tags.includes(CUSTOMER_TAG);
  const supplierOnly =
    !taggedCustomer && tags.some((tag) => SUPPLIER_ONLY_TAGS.includes(tag));

  // Sem marcacao contraria, o cadastro vale como cliente: e assim que a pedreira
  // que nao usa tags no OMIE consegue enxergar o cadastro inteiro.
  const isCustomer = taggedCustomer || (!isCarrier && !supplierOnly);

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
