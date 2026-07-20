import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { getCheckingAccountStatement } from "./checking-statement-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("getCheckingAccountStatement", () => {
  it("chama ListarExtrato com o codigo da conta e o periodo", async () => {
    const client = mockClient({ listaMovimento: [] });

    await getCheckingAccountStatement(client, {
      checkingAccountCode: 42,
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    });

    expect(client.call).toHaveBeenCalledWith(
      "/financas/extrato/",
      "ListarExtrato",
      expect.objectContaining({
        nCodCC: 42,
        dPeriodoInicial: "01/07/2026",
        dPeriodoFinal: "31/07/2026"
      })
    );
  });

  it("mapeia todos os lancamentos sem filtrar linhas (extrato nao tem tratamento)", async () => {
    const client = mockClient({
      nSaldoInicial: 1000,
      nSaldoFinal: 2500,
      listaMovimento: [
        {
          dData: "05/07/2026",
          cDescricao: "Deposito",
          cNatureza: "C",
          nValorMovimento: 1500,
          nSaldo: 2500,
          cConciliado: "S"
        },
        {
          dData: "06/07/2026",
          cDescricao: "Tarifa bancaria",
          cNatureza: "D",
          nValorMovimento: 0
        }
      ]
    });

    const result = await getCheckingAccountStatement(client, {
      checkingAccountCode: 42,
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    });

    expect(result.openingBalanceCents).toBe(100000);
    expect(result.closingBalanceCents).toBe(250000);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      date: "2026-07-05",
      description: "Deposito",
      nature: "C",
      amountCents: 150000,
      runningBalanceCents: 250000,
      reconciled: true
    });
    expect(result.entries[1]).toMatchObject({ nature: "D", reconciled: false });
  });
});
