import type { DesktopDatabase } from "../database/sqlite.js";
import type { ProductDefaultPriceRow, CustomerSpecialPriceRow } from "./product-prices.js";

/**
 * De onde veio o preco aplicado. A ordem e: o preco da ULTIMA operacao do mesmo cliente com
 * o mesmo produto (`last_used`) e, sem ela, o cadastro — preco especial do cliente e depois
 * o preco padrao do produto.
 */
export type PriceSource = "last_used" | "special" | "default" | null;

export interface PriceLookupOptions {
  /**
   * Operacao que esta sendo corrigida: fica de fora da busca pela ultima operacao, senao a
   * troca de produto ou de cliente de uma pesagem acharia o preco dela mesma.
   */
  excludeOperationId?: string;
}

export interface PriceDetails {
  productId: string;
  baseUnitPriceCents: number | null;
  appliedUnitPriceCents: number | null;
  source: PriceSource;
  specialPriceId: string | null;
  defaultPriceId: string | null;
  /** Operacao de onde saiu o preco quando `source` e `last_used`. */
  lastOperationId: string | null;
  priceUnit: "ton";
  savingsPercent: number | null;
}

export class PricingService {
  constructor(private readonly db: DesktopDatabase) {}

  getPriceForCustomerProduct(customerId: string, productId: string): number | null {
    return (
      this.getPriceDetailsForCustomerProduct(customerId, productId)?.appliedUnitPriceCents ?? null
    );
  }

  /**
   * Preco do cliente para o produto. Primeiro vale o que ele pagou na ULTIMA operacao desse
   * mesmo produto (o preco negociado continua de uma carga para a outra); sem operacao
   * anterior, vale o cadastro: preco especial do cliente e, sem ele, o preco padrao. A base
   * (e o desconto) continua sendo o preco padrao do produto.
   */
  getPriceDetailsForCustomerProduct(
    customerId: string,
    productId: string,
    options: PriceLookupOptions = {}
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

    const lastOperation = this.getLastOperationPrice(
      customerId,
      productId,
      options.excludeOperationId
    );

    const baseUnitPriceCents = defaultPrice?.unit_price_cents ?? product.unit_price_cents ?? null;
    const appliedUnitPriceCents =
      lastOperation?.unit_price_cents ??
      specialPrice?.unit_price_cents ??
      defaultPrice?.unit_price_cents ??
      product.unit_price_cents ??
      null;
    const source: PriceSource = lastOperation
      ? "last_used"
      : specialPrice
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
      lastOperationId: lastOperation?.id ?? null,
      priceUnit: "ton",
      savingsPercent: calculateSavingsPercent(baseUnitPriceCents, appliedUnitPriceCents)
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

  /**
   * A operacao mais recente do cliente com o produto que tem preco gravado. Aberta tambem
   * vale (e a ultima negociacao); cancelada e apagada nao.
   */
  private getLastOperationPrice(
    customerId: string,
    productId: string,
    excludeOperationId?: string
  ): { id: string; unit_price_cents: number } | undefined {
    return this.db
      .prepare(
        `SELECT id, unit_price_cents FROM weighing_operations
         WHERE customer_id = ? AND product_id = ? AND id <> ?
           AND deleted_at IS NULL AND status <> 'cancelled'
           AND unit_price_cents IS NOT NULL AND unit_price_cents > 0
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(customerId, productId, excludeOperationId ?? "") as
      | { id: string; unit_price_cents: number }
      | undefined;
  }

  private getProductDefaultPrice(productId: string): ProductDefaultPriceRow | undefined {
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

/**
 * Desconto (%) do preco aplicado em relacao ao preco base (tabela/produto). Null quando
 * nao ha base ou quando o preco aplicado nao e menor que ela. Exportada porque a edicao
 * da operacao tambem recalcula o desconto ao gravar um preco digitado a mao.
 */
export function calculateSavingsPercent(
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
    Math.round(((baseUnitPriceCents - appliedUnitPriceCents) / baseUnitPriceCents) * 10_000) / 100
  );
}
