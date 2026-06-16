import type { DesktopDatabase } from "../database/sqlite.js";

export interface PriceDetails {
  productId: string;
  baseUnitPriceCents: number | null;
  appliedUnitPriceCents: number | null;
  priceTableId: string | null;
  priceTableName: string | null;
  priceTableItemId: string | null;
  priceUnit: "ton";
  savingsPercent: number | null;
}

export class PricingService {
  constructor(private readonly db: DesktopDatabase) {}

  getPriceForCustomerProduct(
    customerId: string,
    productId: string
  ): number | null {
    return this.getPriceDetailsForCustomerProduct(customerId, productId)?.appliedUnitPriceCents ?? null;
  }

  getPriceDetailsForCustomerProduct(customerId: string, productId: string): PriceDetails | null {
    const product = this.db
      .prepare(
        `SELECT unit_price_cents
         FROM products
         WHERE id = ?
           AND deleted_at IS NULL
           AND is_active = 1`
      )
      .get(productId) as { unit_price_cents: number | null } | undefined;

    if (!product) return null;

    const tablePrice = this.db
      .prepare(
        `SELECT
           pti.id AS price_table_item_id,
           pti.unit_price_cents,
           pt.id AS price_table_id,
           pt.name AS price_table_name
         FROM price_table_items pti
         INNER JOIN customer_price_tables cpt ON cpt.price_table_id = pti.price_table_id
         INNER JOIN price_tables pt ON pt.id = pti.price_table_id
         WHERE cpt.customer_id = ?
           AND pti.product_id = ?
           AND pt.is_active = 1
           AND cpt.is_active = 1
           AND pt.deleted_at IS NULL
           AND pti.deleted_at IS NULL
           AND cpt.deleted_at IS NULL
           AND (pt.valid_from IS NULL OR pt.valid_from <= date('now'))
           AND (pt.valid_to IS NULL OR pt.valid_to >= date('now'))
           AND (pti.valid_from IS NULL OR pti.valid_from <= date('now'))
           AND (pti.valid_to IS NULL OR pti.valid_to >= date('now'))
           AND (cpt.valid_from IS NULL OR cpt.valid_from <= date('now'))
           AND (cpt.valid_to IS NULL OR cpt.valid_to >= date('now'))
         ORDER BY cpt.created_at DESC
         LIMIT 1`
      )
      .get(customerId, productId) as
      | {
          price_table_item_id: string;
          unit_price_cents: number;
          price_table_id: string;
          price_table_name: string;
        }
      | undefined;

    const baseUnitPriceCents = product.unit_price_cents ?? null;
    const appliedUnitPriceCents = tablePrice?.unit_price_cents ?? baseUnitPriceCents;

    return {
      productId,
      baseUnitPriceCents,
      appliedUnitPriceCents,
      priceTableId: tablePrice?.price_table_id ?? null,
      priceTableName: tablePrice?.price_table_name ?? null,
      priceTableItemId: tablePrice?.price_table_item_id ?? null,
      priceUnit: "ton",
      savingsPercent: calculateSavingsPercent(baseUnitPriceCents, appliedUnitPriceCents)
    };
  }

  calculateTotal(netWeightKg: number, unitPriceCents: number): number {
    if (netWeightKg <= 0 || unitPriceCents <= 0) return 0;

    // Preço é por tonelada (1000 kg)
    // Ex: 6500 kg * (15000 cents / 1000 kg) = 6500 * 15 = 97500 cents
    const tons = netWeightKg / 1000;
    return Math.round(tons * unitPriceCents);
  }
}

function calculateSavingsPercent(
  baseUnitPriceCents: number | null,
  appliedUnitPriceCents: number | null
): number | null {
  if (!baseUnitPriceCents || appliedUnitPriceCents === null || appliedUnitPriceCents >= baseUnitPriceCents) {
    return null;
  }

  return Math.round(((baseUnitPriceCents - appliedUnitPriceCents) / baseUnitPriceCents) * 10_000) / 100;
}
