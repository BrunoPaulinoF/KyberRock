import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export type CreditMovementType =
  | "credit"
  | "debit_product"
  | "debit_freight"
  | "refund_product"
  | "refund_freight"
  | "manual_adjustment";

export interface CreditBalanceRow {
  customer_id: string;
  balance_cents: number;
  omie_source_json: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

export interface CreditMovementRow {
  id: string;
  company_id: string;
  customer_id: string;
  operation_id: string | null;
  movement_type: CreditMovementType;
  amount_cents: number;
  balance_after_cents: number;
  reason: string | null;
  created_at: string;
}

export interface CreditValidationResult {
  allowed: boolean;
  message?: string;
  availableBalanceCents: number;
  requiredCents: number;
}

export class CreditService {
  constructor(private readonly db: DesktopDatabase) {}

  getBalance(customerId: string): number {
    const row = this.db
      .prepare(
        `SELECT balance_cents FROM customer_credit_balances WHERE customer_id = ?`
      )
      .get(customerId) as { balance_cents: number } | undefined;
    return row?.balance_cents ?? 0;
  }

  isCustomerPrepaid(customerId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT credit_mode FROM customers WHERE id = ? AND deleted_at IS NULL`
      )
      .get(customerId) as { credit_mode: string } | undefined;
    return row?.credit_mode === "prepaid";
  }

  validateDebit(
    customerId: string,
    requiredCents: number
  ): CreditValidationResult {
    const available = this.getBalance(customerId);
    if (available >= requiredCents) {
      return { allowed: true, availableBalanceCents: available, requiredCents };
    }
    return {
      allowed: false,
      message: `Crédito insuficiente. Disponível: R$ ${(available / 100).toFixed(2)}, Necessário: R$ ${(requiredCents / 100).toFixed(2)}.`,
      availableBalanceCents: available,
      requiredCents
    };
  }

  applyDebit(
    customerId: string,
    operationId: string,
    productDebitCents: number,
    freightDebitCents: number,
    reason: string | null = null,
    now: Date = new Date()
  ): void {
    const totalDebit = productDebitCents + freightDebitCents;
    if (totalDebit <= 0) return;
    const companyId = this.getCustomerCompanyId(customerId);
    const timestamp = now.toISOString();

    const apply = this.db.transaction(() => {
      if (productDebitCents > 0) {
        this.recordMovement(
          companyId,
          customerId,
          operationId,
          "debit_product",
          productDebitCents,
          reason,
          timestamp
        );
      }
      if (freightDebitCents > 0) {
        this.recordMovement(
          companyId,
          customerId,
          operationId,
          "debit_freight",
          freightDebitCents,
          reason,
          timestamp
        );
      }
    });
    apply();
  }

  applyRefund(
    customerId: string,
    operationId: string,
    productRefundCents: number,
    freightRefundCents: number,
    reason: string,
    now: Date = new Date()
  ): void {
    const totalRefund = productRefundCents + freightRefundCents;
    if (totalRefund <= 0) return;
    const companyId = this.getCustomerCompanyId(customerId);
    const timestamp = now.toISOString();

    const apply = this.db.transaction(() => {
      if (productRefundCents > 0) {
        this.recordMovement(
          companyId,
          customerId,
          operationId,
          "refund_product",
          productRefundCents,
          reason,
          timestamp
        );
      }
      if (freightRefundCents > 0) {
        this.recordMovement(
          companyId,
          customerId,
          operationId,
          "refund_freight",
          freightRefundCents,
          reason,
          timestamp
        );
      }
    });
    apply();
  }

  applyCredit(
    customerId: string,
    amountCents: number,
    reason: string | null = null,
    now: Date = new Date()
  ): void {
    if (amountCents <= 0) return;
    const companyId = this.getCustomerCompanyId(customerId);
    const timestamp = now.toISOString();
    this.recordMovement(
      companyId,
      customerId,
      null,
      "credit",
      amountCents,
      reason,
      timestamp
    );
  }

  applyManualAdjustment(
    customerId: string,
    amountCents: number,
    reason: string,
    now: Date = new Date()
  ): void {
    if (amountCents === 0) return;
    const companyId = this.getCustomerCompanyId(customerId);
    const timestamp = now.toISOString();
    this.recordMovement(
      companyId,
      customerId,
      null,
      "manual_adjustment",
      amountCents,
      reason,
      timestamp
    );
  }

  listMovements(
    customerId: string,
    limit: number = 100
  ): CreditMovementRow[] {
    return this.db
      .prepare(
        `SELECT * FROM customer_credit_movements
         WHERE customer_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(customerId, limit) as CreditMovementRow[];
  }

  private recordMovement(
    companyId: string,
    customerId: string,
    operationId: string | null,
    movementType: CreditMovementType,
    amountCents: number,
    reason: string | null,
    timestamp: string
  ): void {
    const currentBalance = this.getBalance(customerId);
    const balanceDelta = getBalanceDelta(movementType, amountCents);
    const balanceAfter = currentBalance + balanceDelta;

    this.db
      .prepare(
        `INSERT INTO customer_credit_movements (
          id, company_id, customer_id, operation_id, movement_type, amount_cents, balance_after_cents, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        companyId,
        customerId,
        operationId,
        movementType,
        amountCents,
        balanceAfter,
        reason,
        timestamp
      );

    this.db
      .prepare(
        `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(customer_id) DO UPDATE SET
           balance_cents = excluded.balance_cents,
           updated_at = excluded.updated_at`
      )
      .run(customerId, balanceAfter, timestamp);
  }

  private getCustomerCompanyId(customerId: string): string {
    const row = this.db
      .prepare(`SELECT company_id FROM customers WHERE id = ?`)
      .get(customerId) as { company_id: string } | undefined;
    if (!row) throw new Error(`Customer ${customerId} not found.`);
    return row.company_id;
  }
}

function getBalanceDelta(movementType: CreditMovementType, amountCents: number): number {
  switch (movementType) {
    case "debit_product":
    case "debit_freight":
      return -amountCents;
    case "credit":
    case "refund_product":
    case "refund_freight":
    case "manual_adjustment":
      return amountCents;
  }
}
