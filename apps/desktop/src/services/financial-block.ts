import type { DesktopDatabase } from "../database/sqlite.js";

export interface BlockResult {
  allowed: boolean;
  message?: string;
  availableBalanceCents?: number;
}

export class FinancialBlockService {
  constructor(private readonly db: DesktopDatabase) {}

  canLoad(customerId: string, operationValueCents: number): BlockResult {
    const customer = this.getCustomerFinancials(customerId);

    if (!customer || customer.credit_limit_cents === null) {
      return { allowed: true };
    }

    if (customer.credit_limit_cents === 0) {
      return { allowed: true };
    }

    const available = this.getAvailableBalance(customerId);

    if (available < operationValueCents) {
      return {
        allowed: false,
        message: `Bloqueado: limite disponivel insuficiente. Disponivel: R$ ${(available / 100).toFixed(2)}, Operacao: R$ ${(operationValueCents / 100).toFixed(2)}.`,
        availableBalanceCents: available
      };
    }

    return {
      allowed: true,
      availableBalanceCents: available
    };
  }

  getAvailableBalance(customerId: string): number {
    const customer = this.getCustomerFinancials(customerId);

    if (!customer || customer.credit_limit_cents === null) {
      return Infinity;
    }

    const pendingOperations = this.getPendingOperationsTotal(customerId);

    return (
      customer.credit_limit_cents -
      customer.open_receivables_cents -
      pendingOperations
    );
  }

  private getCustomerFinancials(customerId: string): {
    credit_limit_cents: number | null;
    open_receivables_cents: number;
  } | null {
    const stmt = this.db.prepare(`
      SELECT credit_limit_cents, open_receivables_cents
      FROM customers
      WHERE id = ?
    `);

    const row = stmt.get(customerId) as
      | {
          credit_limit_cents: number | null;
          open_receivables_cents: number;
        }
      | undefined;

    return row ?? null;
  }

  private getPendingOperationsTotal(customerId: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(product_total_cents), 0) as total
      FROM weighing_operations
      WHERE customer_id = ?
        AND status IN ('draft', 'entry_registered', 'loading_requested', 'awaiting_exit', 'closed_local')
    `);

    const row = stmt.get(customerId) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}
