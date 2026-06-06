export function buildExternalId(parts: readonly string[]): string {
  if (parts.length === 0) {
    throw new Error("External id requires at least one part.");
  }

  return ["kyberrock", ...parts.map(normalizeExternalIdPart)].join(":");
}

function normalizeExternalIdPart(part: string): string {
  const normalized = part.trim();

  if (!normalized) {
    throw new Error("External id parts cannot be empty.");
  }

  return normalized.replaceAll(":", "_");
}
