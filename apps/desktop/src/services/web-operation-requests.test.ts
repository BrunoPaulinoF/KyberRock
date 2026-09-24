import { describe, expect, it } from "vitest";

import type { WeighingOperationSummary } from "./weighing-operations.js";
import {
  outcomeFromError,
  parseWebOperationClaims,
  printOutcome,
  runWebOperationRequests,
  type WebOperationClaim,
  type WebOperationOutcome
} from "./web-operation-requests.js";

function claim(id: string, kind: WebOperationClaim["kind"] = "entry"): WebOperationClaim {
  return { id, kind, operationId: `op-${id}`, payload: {}, requestedByName: "Operador" };
}

const operation = {
  id: "op-1",
  operationCode: 12345,
  status: "closed_local",
  operationType: "invoice",
  plate: "ABC1D23",
  customerName: "Construtora X",
  productDescription: "Brita 1",
  driverName: "Joao",
  carrierName: null,
  entryWeightKg: 15000,
  exitWeightKg: 40120,
  netWeightKg: 25120,
  unitPriceCents: 6500,
  productTotalCents: 163280,
  freightTotalCents: 0,
  totalCents: 163280
} as unknown as WeighingOperationSummary;

describe("pedidos de pesagem do site", () => {
  it("le so pedido valido do claim", () => {
    expect(
      parseWebOperationClaims([
        { id: "r1", kind: "exit", operationId: "op-1", payload: { exitWeightKg: 1 } },
        { id: "r2", kind: "apagar", operationId: "op-2" },
        { id: 3, kind: "entry", operationId: "op-3" },
        { id: "r4", kind: "reprint", operationId: "op-4", payload: [1, 2] }
      ])
    ).toEqual([
      {
        id: "r1",
        kind: "exit",
        operationId: "op-1",
        payload: { exitWeightKg: 1 },
        requestedByName: null
      },
      { id: "r4", kind: "reprint", operationId: "op-4", payload: {}, requestedByName: null }
    ]);
    expect(parseWebOperationClaims(null)).toEqual([]);
  });

  it("executa na ordem e devolve cada resultado assim que sai", async () => {
    const executed: string[] = [];
    const reported: WebOperationOutcome[][] = [];
    const result = await runWebOperationRequests({
      claim: async () => ({ executor: true, claims: [claim("r1"), claim("r2", "exit")] }),
      execute: async (item) => {
        executed.push(item.id);
        if (item.id === "r1")
          throw new Error("Ja existe uma operacao aberta para a placa ABC-1234.");
        return {
          message: "Pesagem 12345 fechada.",
          operation,
          print: { status: "failed", message: "Impressora sem papel" }
        };
      },
      report: async (outcomes) => {
        reported.push(outcomes);
      }
    });

    expect(executed).toEqual(["r1", "r2"]);
    expect(result).toEqual({ executor: true, claimed: 2, done: 1, failed: 1 });
    expect(reported).toHaveLength(2);
    expect(reported[0][0]).toMatchObject({
      id: "r1",
      status: "failed",
      message: "Ja existe uma operacao aberta para a placa ABC-1234."
    });
    expect(reported[1][0]).toMatchObject({
      id: "r2",
      status: "done",
      message: "Pesagem 12345 fechada.",
      printStatus: "failed",
      printMessage: "Impressora sem papel",
      result: expect.objectContaining({
        operationCode: 12345,
        netWeightKg: 25120,
        totalCents: 163280
      })
    });
  });

  it("balanca que nao e executora nao executa nada", async () => {
    const result = await runWebOperationRequests({
      claim: async () => ({ executor: false, claims: [] }),
      execute: async () => {
        throw new Error("nao devia executar");
      },
      report: async () => {
        throw new Error("nao devia reportar");
      }
    });
    expect(result).toEqual({ executor: false, claimed: 0, done: 0, failed: 0 });
  });

  it("cupom: impresso, ou falha com a mensagem da impressora", () => {
    expect(printOutcome({ status: "printed" })).toEqual({ status: "printed", message: null });
    expect(printOutcome({ status: "failed", errorMessage: "Sem papel" })).toEqual({
      status: "failed",
      message: "Sem papel"
    });
    expect(printOutcome({ status: "failed" }).message).toContain("nao confirmou");
  });

  it("erro que nao e Error vira texto", () => {
    expect(outcomeFromError(claim("r1"), "caiu").message).toBe("caiu");
  });
});
