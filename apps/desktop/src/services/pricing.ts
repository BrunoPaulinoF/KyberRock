import type { DesktopDatabase } from "../database/sqlite.js";
import type { ProductDefaultPriceRow, CustomerSpecialPriceRow } from "./product-prices.js";

export type PriceSource = "special" | "default" | null;

export interface PriceDetails {
  productId: string;
  baseUnitPriceCents: number | null;
  appliedUnitPriceCents: number | null;
  source: PriceSource;
  specialPriceId: string | null;
  defaultPriceId: string | null;
  priceUnit: "ton";
  savingsPercent: number | null;
}

export class PricingService {
  constructor(private readonly db: DesktopDatabase) {}

  getPriceForCustomerProduct(
    customerId: string,
    productId: string
  ): number | null {
    return this.getPriceDetailsForCustomerProduct(customerId, productId)
      ?.appliedUnitPriceCents ?? null;
  }

  getPriceDetailsForCustomerProduct(
    customerId: string,
    productId: string
  ): PriceDetails | null {
    const product = this.db
      .prepare(
        `SELECT id, unit_price_cents FROM products
         WHERE id = ? AND deleted_at IS NULL AND is_active = 1`
      )
      .get(productId) as { id: string; unit_price_cents: number | null } | undefined;

    if (!product) return null;

    const specialPrice = this.getCustomerSpecialPrice(customerId, productId);
    const defaultPrice = this.getProductDefaultPrice(productId);

    const baseUnitPriceCents = defaultPrice?.unit_price_cents ?? product.unit_price_cents ?? null;
    const appliedUnitPriceCents =
      specialPrice?.unit_price_cents ?? defaultPrice?.unit_price_cents ?? product.unit_price_cents ?? null;
    const source: PriceSource = specialPrice
      ? "special"
      : baseUnitPriceCents !== null
        ? "default"
        : null;

    return {
      productId,
      baseUnitPriceCents,
      appliedUnitPriceCents,
      source,
      specialPriceId: specialPrice?.id ?? null,
      defaultPriceId: defaultPrice?.id ?? null,
      priceUnit: "ton",
      savingsPercent: calculateSavingsPercent(
        baseUnitPriceCents,
        appliedUnitPriceCents
      )
    };
  }

  calculateTotal(netWeightKg: number, unitPriceCents: number): number {
    if (netWeightKg <= 0 || unitPriceCents <= 0) return 0;
    const tons = netWeightKg / 1000;
    return Math.round(tons * unitPriceCents);
  }

  private getCustomerSpecialPrice(
    customerId: string,
    productId: string
  ): CustomerSpecialPriceRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM customer_special_prices
         WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL AND is_active = 1
         LIMIT 1`
      )
      .get(customerId, productId) as CustomerSpecialPriceRow | undefined;
  }

  private getProductDefaultPrice(
    productId: string
  ): ProductDefaultPriceRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM product_default_prices
         WHERE product_id = ? AND deleted_at IS NULL AND is_active = 1
           AND (valid_from IS NULL OR valid_from <= date('now'))
           AND (valid_to IS NULL OR valid_to >= date('now'))
         LIMIT 1`
      )
      .get(productId) as ProductDefaultPriceRow | undefined;
  }
}

function calculateSavingsPercent(
  baseUnitPriceCents: number | null,
  appliedUnitPriceCents: number | null
): number | null {
  if (
    !baseUnitPriceCents ||
    appliedUnitPriceCents === null ||
    appliedUnitPriceCents >= baseUnitPriceCents
  ) {
    return null;
  }

  return (
    Math.round(
      ((baseUnitPriceCents - appliedUnitPriceCents) / baseUnitPriceCents) * 10_000
    ) / 100
  );
}
