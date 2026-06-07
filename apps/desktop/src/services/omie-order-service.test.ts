import { describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { OmieClient } from "@kyberrock/omie-client";
import { OmieOrderService } from "./omie-order-service";

function mockClient(): OmieClient {
  return {
    call: vi.fn().mockResolvedValue({
      codigoPedido: 9876,
      codigoPedidoIntegracao: "KR-001"
    })
  } as unknown as OmieClient;
}

function mockDb(): DesktopDatabase {
  return {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([])
    })
  } as unknown as DesktopDatabase;
}

describe("OmieOrderService", () => {
  it("sends invoice operation as sales order", async () => {
    const client = mockClient();
    const db = mockDb();
    const service = new OmieOrderService(client, db);

    const result = await service.sendOperation({
      operationId: "op-123",
      operationType: "invoice",
      customerOmieId: 123,
      productOmieId: 456,
      quantity: 10.5,
      unitPrice: 150,
      idempotencyKey: "kr:unit-1:op-123:sales_order",
      issueDate: "2026-06-07"
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe(9876);
    expect(result.queued).toBe(false);
  });

  it("queues operation when OMIE call fails", async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error("API timeout"))
    } as unknown as OmieClient;

    const db = mockDb();
    const service = new OmieOrderService(client, db);

    const result = await service.sendOperation({
      operationId: "op-123",
      operationType: "invoice",
      customerOmieId: 123,
      productOmieId: 456,
      quantity: 10.5,
      unitPrice: 150,
      idempotencyKey: "kr:unit-1:op-123:sales_order",
      issueDate: "2026-06-07"
    });

    expect(result.success).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.error).toContain("API timeout");
  });

  it("sends internal operation as service order", async () => {
    const client = {
      call: vi.fn().mockResolvedValue({
        codigoOS: 5678,
        codigoOSIntegracao: "KR-OS-001"
      })
    } as unknown as OmieClient;

    const db = mockDb();
    const service = new OmieOrderService(client, db);

    const result = await service.sendOperation({
      operationId: "op-456",
      operationType: "internal",
      customerOmieId: 123,
      serviceDescription: "Carregamento de brita",
      quantity: 10.5,
      unitPrice: 150,
      idempotencyKey: "kr:unit-1:op-456:service_order",
      issueDate: "2026-06-07"
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe(5678);
  });

  it("processes pending queue items", async () => {
    const client = {
      call: vi.fn().mockResolvedValue({
        codigoPedido: 9876,
        codigoPedidoIntegracao: "KR-001"
      })
    } as unknown as OmieClient;

    const db = mockDb();
    const service = new OmieOrderService(client, db);

    vi.spyOn(service, "sendOperation").mockResolvedValue({
      success: true,
      orderId: 9876,
      queued: false
    });

     
    vi.spyOn((service as unknown as Record<string, unknown>).queueService as unknown as { getPending: () => unknown[] }, "getPending").mockReturnValue([
      {
        id: "queue-1",
        entity_id: "op-123",
        idempotency_key: "kr:unit-1:op-123:sales_order",
        payload_json: JSON.stringify({
          operationType: "invoice",
          customerOmieId: 123,
          productOmieId: 456,
          quantity: 10.5,
          unitPrice: 150,
          issueDate: "2026-06-07"
        }),
        attempt_count: 0
      }
    ]);

    const result = await service.processPendingQueue();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
  });
});
