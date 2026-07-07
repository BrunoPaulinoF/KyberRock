interface TaggedOmieEntity {
  tags?: Record<string, unknown> | unknown[];
}

export function hasTransportadoraTag(entity: TaggedOmieEntity): boolean {
  return hasTag(entity, "transportadora");
}

export function hasClienteTag(entity: TaggedOmieEntity): boolean {
  return hasTag(entity, "cliente");
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
