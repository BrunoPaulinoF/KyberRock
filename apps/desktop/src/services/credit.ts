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

export interface CustomerCreditSettings {
  creditMode: "normal" | "prepaid";
  /** Limite de credito concedido ao cliente (null = nenhum limite cadastrado). */
  creditLimitCents: number | null;
  /** Conta de credito (fiado) habilitada no cadastro. */
  creditAccountEnabled: boolean;
}

export interface CustomerCreditSummary extends CustomerCreditSettings {
  /**
   * Saldo do extrato. Positivo = credito a favor do cliente (pre-pago/pagamento
   * adiantado); negativo = quanto ele ja consumiu do limite e ainda deve.
   */
  balanceCents: number;
  /** Parte do limite ja consumida (0 quando o saldo esta positivo). */
  usedCents: number;
  /** Credito disponivel para novas vendas; `null` = sem teto cadastrado. */
  availableCents: number | null;
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
    return this.getSettings(customerId)?.creditMode === "prepaid";
  }

  getSettings(customerId: string): CustomerCreditSettings | null {
    const row = this.db
      .prepare(
        `SELECT credit_mode, credit_limit_cents, credit_account_enabled
         FROM customers WHERE id = ? AND deleted_at IS NULL`
      )
      .get(customerId) as
      | {
          credit_mode: string;
          credit_limit_cents: number | null;
          credit_account_enabled: number;
        }
      | undefined;
    if (!row) return null;
    return {
      creditMode: row.credit_mode === "prepaid" ? "prepaid" : "normal",
      creditLimitCents: row.credit_limit_cents,
      creditAccountEnabled: row.credit_account_enabled === 1
    };
  }

  /**
   * Extrato resumido do credito do cliente: limite concedido, quanto ja foi
   * consumido e quanto ainda da para vender. Alimenta a aba "Credito" do cadastro.
   */
  getSummary(customerId: string): CustomerCreditSummary {
    const settings = this.getSettings(customerId) ?? {
      creditMode: "normal" as const,
      creditLimitCents: null,
      creditAccountEnabled: false
    };
    const balanceCents = this.getBalance(customerId);
    return {
      ...settings,
      balanceCents,
      usedCents: balanceCents < 0 ? -balanceCents : 0,
      availableCents: availableCreditCents(settings, balanceCents)
    };
  }

  /**
   * Valida uma venda no credito do cliente.
   *
   * O disponivel e `saldo do extrato + limite de credito`: o limite cadastrado no
   * cliente e o que efetivamente banca a venda no fiado, e o saldo (que fica
   * NEGATIVO conforme as vendas consomem o limite) registra quanto ja foi usado.
   * Quando o cliente paga a fatura, um lancamento de credito devolve o saldo e
   * libera o limite de novo.
   *
   * Cliente sem limite cadastrado nao tem teto — exceto no modo pre-pago, em que o
   * teto e o proprio saldo depositado.
   */
  validateDebit(
    customerId: string,
    requiredCents: number
  ): CreditValidationResult {
    const settings = this.getSettings(customerId);
    const balance = this.getBalance(customerId);
    const available = availableCreditCents(settings, balance);

    if (available === null || available >= requiredCents) {
      return {
        allowed: true,
        availableBalanceCents: available ?? balance,
        requiredCents
      };
    }

    const limit = settings?.creditLimitCents ?? null;
    const limitDetail =
      limit === null
        ? ""
        : ` (limite R$ ${(limit / 100).toFixed(2)}, utilizado R$ ${((balance < 0 ? -balance : 0) / 100).toFixed(2)})`;
    return {
      allowed: false,
      message:
        `Crédito insuficiente. Disponível: R$ ${(available / 100).toFixed(2)}${limitDetail}, ` +
        `Necessário: R$ ${(requiredCents / 100).toFixed(2)}. ` +
        "Aumente o limite de credito do cliente ou registre o pagamento em Clientes > Credito.",
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
      if (productDebitCents > 0 && !this.hasMovementForOperation(operationId, "debit_product")) {
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
      if (freightDebitCents > 0 && !this.hasMovementForOperation(operationId, "debit_freight")) {
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
      if (productRefundCents > 0 && !this.hasMovementForOperation(operationId, "refund_product")) {
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
      if (freightRefundCents > 0 && !this.hasMovementForOperation(operationId, "refund_freight")) {
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

  /**
   * True quando ja existe um movimento do mesmo tipo para a operacao. Torna applyDebit/
   * applyRefund idempotentes por operacao: um segundo fechamento/cancelamento (duplo-clique,
   * retry) nao debita nem estorna o credito do cliente de novo. Defesa em profundidade — o
   * fluxo normal ja e barrado pela guarda de status em close/cancelWeighingOperation.
   */
  private hasMovementForOperation(
    operationId: string,
    movementType: CreditMovementType
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM customer_credit_movements
         WHERE operation_id = ? AND movement_type = ?
         LIMIT 1`
      )
      .get(operationId, movementType);
    return row !== undefined;
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

/**
 * Credito disponivel para novas vendas. `null` = sem teto.
 *
 * Limite nulo ou zero significa "nenhum limite cadastrado" (mesma convencao de
 * `FinancialBlockService`): o cliente vende no fiado sem bloqueio, como antes —
 * a maioria dos cadastros vindos do OMIE chega com zero. No pre-pago, sem limite
 * cadastrado o teto e o proprio saldo depositado.
 */
function availableCreditCents(
  settings: CustomerCreditSettings | null,
  balanceCents: number
): number | null {
  const limit = settings?.creditLimitCents ?? null;
  if (limit === null || limit === 0) {
    return settings?.creditMode === "prepaid" ? balanceCents : null;
  }
  return balanceCents + limit;
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
