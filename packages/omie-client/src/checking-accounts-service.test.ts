import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listCheckingAccounts, OmieCheckingAccountsService } from "./checking-accounts-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listCheckingAccounts", () => {
  it("chama ListarContasCorrentes com paginacao", async () => {
    const client = mockClient({ ListarContasCorrentes: [] });

    await listCheckingAccounts(client, { pagina: 1, registros_por_pagina: 50 });

    expect(client.call).toHaveBeenCalledWith("/geral/contacorrente/", "ListarContasCorrentes", {
      pagina: 1,
      registros_por_pagina: 50
    });
  });

  it("mapeia nCodCC, descricao, tipo e flag de inativa", async () => {
    const client = mockClient({
      ListarContasCorrentes: [
        { nCodCC: 111, descricao: "Caixinha", tipo_conta_corrente: "CX", inativa: "N" },
        { nCodCC: 222, cCodCCInt: "HOME", descricao: "Home Cash", inativa: "S" }
      ]
    });

    const result = await listCheckingAccounts(client, { pagina: 1 });

    expect(result).toEqual([
      { code: 111, integrationCode: null, name: "Caixinha", type: "CX", isActive: true },
      { code: 222, integrationCode: "HOME", name: "Home Cash", type: null, isActive: false }
    ]);
  });

  it("aceita codigo_conta_corrente como chave alternativa e descarta linhas invalidas", async () => {
    const client = mockClient({
      conta_corrente_lista: [
        { codigo_conta_corrente: "333", descricao: "GetNet" },
        { descricao: "Sem codigo" },
        { nCodCC: 0, descricao: "Codigo zero" }
      ]
    });

    const result = await listCheckingAccounts(client, { pagina: 1 });

    expect(result).toEqual([
      { code: 333, integrationCode: null, name: "GetNet", type: null, isActive: true }
    ]);
  });
});

describe("OmieCheckingAccountsService.listAll", () => {
  it("pagina ate a resposta vir menor que o pageSize", async () => {
    const page1 = {
      ListarContasCorrentes: [
        { nCodCC: 1, descricao: "Conta 1" },
        { nCodCC: 2, descricao: "Conta 2" }
      ]
    };
    const page2 = { ListarContasCorrentes: [{ nCodCC: 3, descricao: "Conta 3" }] };
    const call = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const client = { call } as unknown as OmieClient;

    const service = new OmieCheckingAccountsService(client);
    const result = await service.listAll(2);

    expect(result.map((account) => account.code)).toEqual([1, 2, 3]);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
