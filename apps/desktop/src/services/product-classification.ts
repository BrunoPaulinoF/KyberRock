export interface ProductClassificationInput {
  omieProductId?: number | null;
  itemType?: string | null;
  fiscalRecommendations?: unknown;
  fiscalRecommendationsJson?: string | null;
  isActive?: boolean;
  blocked?: boolean;
}

export function isSellableProduct(product: ProductClassificationInput): boolean {
  if (product.isActive === false || product.blocked === true) return false;

  const isOmieProduct = product.omieProductId !== undefined && product.omieProductId !== null;
  if (!isOmieProduct && !product.itemType && !product.fiscalRecommendationsJson) return true;

  const candidates = [
    product.itemType ?? null,
    ...extractFiscalRecommendationValues(product.fiscalRecommendations ?? null),
    ...extractFiscalRecommendationValuesFromJson(product.fiscalRecommendationsJson ?? null)
  ];
  return candidates.some((value) => matchesSellableType(value));
}

function extractFiscalRecommendationValuesFromJson(value: string | null): string[] {
  if (!value) return [];
  try {
    return extractFiscalRecommendationValues(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function extractFiscalRecommendationValues(value: unknown): string[] {
  const values: string[] = [];
  collectFiscalRecommendationValues(value, values);
  return values;
}

function collectFiscalRecommendationValues(value: unknown, output: string[]): void {
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiscalRecommendationValues(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeFiscalTypeText(key);
      if (
        normalizedKey.includes("tipo") &&
        (normalizedKey.includes("produto") || normalizedKey.includes("item"))
      ) {
        collectFiscalRecommendationValues(nested, output);
      }
      if (normalizedKey === "codigo" || normalizedKey === "cod" || normalizedKey === "code") {
        collectFiscalRecommendationValues(nested, output);
      }
    }
  }
}

function matchesSellableType(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeFiscalTypeText(value);
  return (
    normalized === "04" ||
    normalized.startsWith("04 ") ||
    normalized.includes("produtos acabados") ||
    normalized.includes("produto acabado")
  );
}

function normalizeFiscalTypeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_/.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
