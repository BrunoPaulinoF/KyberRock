import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client.js";
import { hasClienteTag, hasTransportadoraTag, listSuppliers } from "./suppliers-service.js";

describe("suppliers-service", () => {
  it("maps supplier tags and contact address fields", async () => {
    const client = {
      call: vi.fn().mockResolvedValue({
        nTotPaginas: 1,
        nPagina: 1,
        fornecedoresCadastro: [
          {
            codigo_cliente_fornecedor: 123,
            codigo_cliente_integracao: "SUP-123",
            razao_social: "Cliente Rocha Ltda",
            nome_fantasia: "Rocha",
            cnpj_cpf: "12345678000195",
            email: "cliente@example.com",
            telefone1_ddd: "11",
            telefone1_numero: "999999999",
            endereco: "Rua A",
            endereco_numero: "10",
            complemento: "Sala 2",
            bairro: "Centro",
            cidade: "Sao Paulo",
            estado: "SP",
            cep: "01001000",
            tags: [{ tag: "Cliente" }],
            inativo: "N"
          }
        ]
      })
    } as unknown as OmieClient;

    const { items } = await listSuppliers(client, { pagina: 1, registrosPorPagina: 50 });

    expect(items[0]).toMatchObject({
      id: 123,
      integrationCode: "SUP-123",
      name: "Cliente Rocha Ltda",
      tradeName: "Rocha",
      email: "cliente@example.com",
      phone: "(11) 999999999",
      zipcode: "01001000",
      addressStreet: "Rua A",
      addressNumber: "10",
      addressComplement: "Sala 2",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP"
    });
    expect(hasClienteTag(items[0])).toBe(true);
    expect(hasTransportadoraTag(items[0])).toBe(false);
  });

  it("classifies multiple tags without treating Fornecedor as Transportadora", () => {
    expect(hasClienteTag({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(true);
    expect(hasTransportadoraTag({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(
      false
    );
    expect(hasTransportadoraTag({ tags: [{ tag: "Transportadora" }, { tag: "Fornecedor" }] })).toBe(
      true
    );
  });
});
