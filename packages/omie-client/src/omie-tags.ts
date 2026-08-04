interface TaggedOmieEntity {
  tags?: Record<string, unknown> | unknown[];
  /**
   * Campo `cliente_fornecedor` do cadastro do OMIE: "C" cliente, "F" fornecedor,
   * "A" ambos, "T" transportadora, vazio quando o cadastro nao foi classificado.
   */
  customerType?: string;
}

/** Papeis que um cadastro do OMIE pode ter. Um mesmo cadastro pode acumular varios. */
export interface OmieCadastroRoles {
  isCustomer: boolean;
  isSupplier: boolean;
  isCarrier: boolean;
  /** Nenhum papel declarado: sem tag e sem `cliente_fornecedor` preenchido. */
  isUnclassified: boolean;
}

export function hasTransportadoraTag(entity: TaggedOmieEntity): boolean {
  return hasTag(entity, "transportadora");
}

export function hasClienteTag(entity: TaggedOmieEntity): boolean {
  return hasTag(entity, "cliente");
}

export function hasFornecedorTag(entity: TaggedOmieEntity): boolean {
  return hasTag(entity, "fornecedor");
}

/**
 * Papeis do cadastro somando as DUAS fontes do OMIE: as tags (usadas pela pedreira para
 * marcar "Cliente"/"Fornecedor"/"Transportadora") e o campo `cliente_fornecedor`.
 *
 * Ler as duas e o que faz o cadastro real aparecer inteiro: havia cliente de verdade sem
 * a tag "Cliente" (so com `cliente_fornecedor = C`) que ficava fora da lista da balanca.
 */
export function readOmieCadastroRoles(entity: TaggedOmieEntity): OmieCadastroRoles {
  const type = (entity.customerType ?? "").trim().toUpperCase();
  const isCustomer = hasClienteTag(entity) || type === "C" || type === "A";
  const isSupplier = hasFornecedorTag(entity) || type === "F" || type === "A";
  const isCarrier = hasTransportadoraTag(entity) || type === "T";
  return {
    isCustomer,
    isSupplier,
    isCarrier,
    isUnclassified: !isCustomer && !isSupplier && !isCarrier
  };
}

/**
 * O cadastro entra na lista de CLIENTES da balanca.
 *
 * Vale como cliente quem esta marcado como cliente e tambem quem nao tem nenhum papel
 * declarado no OMIE — cadastro sem classificacao e, na pratica, cliente da pedreira, e
 * some-lo da lista tirava clientes reais da troca de cliente da operacao. Fica de fora
 * apenas quem e SOMENTE fornecedor e/ou transportadora: esses nao sao clientes.
 */
export function isOmieCustomerCadastro(entity: TaggedOmieEntity): boolean {
  const roles = readOmieCadastroRoles(entity);
  return roles.isCustomer || roles.isUnclassified;
}

/** Cadastro que a balanca usa como transportadora (tag "Transportadora" ou tipo "T"). */
export function isOmieCarrierCadastro(entity: TaggedOmieEntity): boolean {
  return readOmieCadastroRoles(entity).isCarrier;
}

/** Fornecedor/transportadora que NAO e cliente: precisa sair do cadastro de clientes. */
export function isOmieNonCustomerCadastro(entity: TaggedOmieEntity): boolean {
  return !isOmieCustomerCadastro(entity);
}

/** Valores de tag de um cadastro do OMIE, aceitando os tres formatos que a API devolve. */
export function readOmieTagValues(
  tags: Record<string, unknown> | unknown[] | null | undefined
): string[] {
  return getTagValues({ tags: tags ?? undefined });
}

/** Tag comparavel: sem acento, sem espaco nas pontas e em minusculas. */
export function normalizeOmieTagValue(value: string): string {
  return normalizeTag(value);
}

function hasTag(entity: TaggedOmieEntity, expectedTag: string): boolean {
  const tagValues = getTagValues(entity);
  const normalizedExpected = normalizeTag(expectedTag);
  return tagValues.some((tag) => normalizeTag(tag) === normalizedExpected);
}

function getTagValues(entity: TaggedOmieEntity): string[] {
  if (!entity.tags) return [];
  const tagValues: string[] = [];
  if (Array.isArray(entity.tags)) {
    tagValues.push(...entity.tags.map(readTagValue));
  } else if (typeof entity.tags === "object") {
    const tagsArray = entity.tags.tags;
    if (Array.isArray(tagsArray)) {
      tagValues.push(...tagsArray.map(readTagValue));
    }
  }
  return tagValues;
}

function readTagValue(tag: unknown): string {
  return typeof tag === "object" && tag !== null && "tag" in tag
    ? String((tag as { tag?: unknown }).tag ?? "")
    : String(tag ?? "");
}

function normalizeTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
