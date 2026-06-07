import {
  cancelSalesOrder,
  cancelServiceOrder,
  createSalesOrder,
  createServiceOrder,
  type OmieClient
} from "@kyberrock/omie-client";

import type { DesktopDatabase } from "../database/sqlite.js";
import { OmieOrderQueueService } from "./omie-order-queue.js";

export interface SendOperationToOmieInput {
  operationId: string;
  operationType: "invoice" | "internal";
  customerOmieId: number;
  productOmieId?: number;
  serviceDescription?: string;
  quantity: number;
  unitPrice: number;
  idempotencyKey: string;
  issueDate: string;
}

export interface SendOperationResult {
  success: boolean;
  orderId?: number;
  error?: string;
  queued: boolean;
}

export class OmieOrderService {
  private readonly queueService: OmieOrderQueueService;

  constructor(
    private readonly client: OmieClient,
    private readonly db: DesktopDatabase
  ) {
    this.queueService = new OmieOrderQueueService(db);
  }

  async sendOperation(input: SendOperationToOmieInput): Promise<SendOperationResult> {
    try {
      if (input.operationType === "invoice") {
        if (!input.productOmieId) {
          throw new Error("productOmieId is required for invoice operations");
        }

        const result = await createSalesOrder(this.client, {
          integrationCode: input.idempotencyKey,
          customerOmieId: input.customerOmieId,
          productOmieId: input.productOmieId,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          issueDate: input.issueDate
        });

        this.queueService.markDone(input.operationId, { omieOrderId: result.orderId });

        return {
          success: true,
          orderId: result.orderId,
          queued: false
        };
      } else {
        if (!input.serviceDescription) {
          throw new Error("serviceDescription is required for internal operations");
        }

        const result = await createServiceOrder(this.client, {
          integrationCode: input.idempotencyKey,
          customerOmieId: input.customerOmieId,
          serviceDescription: input.serviceDescription,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          issueDate: input.issueDate
        });

        this.queueService.markDone(input.operationId, { omieOrderId: result.orderId });

        return {
          success: true,
          orderId: result.orderId,
          queued: false
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      this.queueService.enqueue({
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        operationType: input.operationType,
        payload: {
          customerOmieId: input.customerOmieId,
          productOmieId: input.productOmieId,
          serviceDescription: input.serviceDescription,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          issueDate: input.issueDate,
          error: errorMessage
        }
      });

      return {
        success: false,
        error: errorMessage,
        queued: true
      };
    }
  }

  async cancelOperation(
    operationId: string,
    omieOrderId: number,
    operationType: "invoice" | "internal"
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (operationType === "invoice") {
        await cancelSalesOrder(this.client, { omieOrderId });
      } else {
        await cancelServiceOrder(this.client, { omieOrderId });
      }

      // Update local operation status
      const updateOp = this.db.prepare(`
        UPDATE weighing_operations
        SET status = 'cancelled',
            cancel_reason = 'Cancelled in OMIE',
            updated_at = datetime('now')
        WHERE id = ?
      `);
      updateOp.run(operationId);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async processPendingQueue(): Promise<{
    processed: number;
    failed: number;
  }> {
    const pending = this.queueService.getPending();
    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      this.queueService.markRunning(item.id);

      try {
        const payload = JSON.parse(item.payload_json);

        const result = await this.sendOperation({
          operationId: item.entity_id,
          operationType: payload.operationType,
          customerOmieId: payload.customerOmieId,
          productOmieId: payload.productOmieId,
          serviceDescription: payload.serviceDescription,
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
          idempotencyKey: item.idempotency_key,
          issueDate: payload.issueDate
        });

        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        this.queueService.markFailed(item.id, (error as Error).message);
        failed++;
      }
    }

    return { processed, failed };
  }

  getFailedOperations(): ReturnType<OmieOrderQueueService["getFailed"]> {
    return this.queueService.getFailed();
  }
}
