import type { DesktopDatabase } from "../database/sqlite.js";

export class PricingService {
  constructor(private readonly db: DesktopDatabase) {}

  getPriceForCustomerProduct(
    customerId: string,
    productId: string
  ): number | null {
    const stmt = this.db.prepare(`
      SELECT pti.unit_price_cents
      FROM price_table_items pti
      INNER JOIN customer_price_tables cpt ON cpt.price_table_id = pti.price_table_id
      INNER JOIN price_tables pt ON pt.id = pti.price_table_id
      WHERE cpt.customer_id = ?
        AND pti.product_id = ?
        AND pt.is_active = 1
        AND cpt.is_active = 1
        AND (pt.valid_from IS NULL OR pt.valid_from <= date('now'))
        AND (pt.valid_to IS NULL OR pt.valid_to >= date('now'))
      LIMIT 1
    `);

    const row = stmt.get(customerId, productId) as
      | { unit_price_cents: number }
      | undefined;

    return row?.unit_price_cents ?? null;
  }

  calculateTotal(netWeightKg: number, unitPriceCents: number): number {
    if (netWeightKg <= 0 || unitPriceCents <= 0) return 0;

    // Preço é por tonelada (1000 kg)
    // Ex: 6500 kg * (15000 cents / 1000 kg) = 6500 * 15 = 97500 cents
    const tons = netWeightKg / 1000;
    return Math.round(tons * unitPriceCents);
  }
}
