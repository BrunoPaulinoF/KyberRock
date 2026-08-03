import { describe, expect, it } from "vitest";

import {
  filterClosedOperationsBySearch,
  matchesClosedOperationSearch
} from "./closed-operations-search";

type SearchableOperation = Parameters<typeof matchesClosedOperationSearch>[0];

function operation(overrides: Partial<SearchableOperation> = {}): SearchableOperation {
  return {
    customerName: "Construtora Sao Joao",
    customerDocument: "26.463.463/0001-83",
    productDescription: "Brita 1",
    plate: "ABC1D23",
    driverName: "Jose da Silva",
    ...overrides
  };
}

describe("busca da tela de operacoes concluidas", () => {
  it("acha pelo nome do cliente sem diferenciar acento ou caixa", () => {
    expect(
      matchesClosedOperationSearch(operation({ customerName: "Construtora São João" }), "sao joao")
    ).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "CONSTRUTORA")).toBe(true);
  });

  it("acha pelo produto", () => {
    expect(matchesClosedOperationSearch(operation(), "brita")).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "areia")).toBe(false);
  });

  // O operador digita o CNPJ do jeito que esta no cupom (com pontuacao) ou solto do
  // teclado numerico; os dois precisam achar o mesmo cadastro.
  it("acha pelo CNPJ/CPF com ou sem pontuacao", () => {
    expect(matchesClosedOperationSearch(operation(), "26463463000183")).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "26.463.463/0001-83")).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "4634630001")).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "99999999")).toBe(false);
  });

  it("nao quebra quando o cliente nao tem documento cadastrado", () => {
    expect(
      matchesClosedOperationSearch(operation({ customerDocument: null }), "26463463000183")
    ).toBe(false);
    expect(matchesClosedOperationSearch(operation({ customerDocument: null }), "construtora")).toBe(
      true
    );
  });

  it("combina termos por conjuncao", () => {
    expect(matchesClosedOperationSearch(operation(), "construtora brita")).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "construtora areia")).toBe(false);
  });

  it("tambem casa placa e motorista, que estao na mesma linha da tabela", () => {
    expect(matchesClosedOperationSearch(operation(), "abc1d23")).toBe(true);
    expect(matchesClosedOperationSearch(operation(), "jose")).toBe(true);
  });

  it("devolve a lista inteira quando a busca esta vazia", () => {
    const operations = [operation(), operation({ customerName: "Outro Cliente" })];

    expect(filterClosedOperationsBySearch(operations, "   ")).toBe(operations);
    expect(filterClosedOperationsBySearch(operations, "outro")).toHaveLength(1);
  });
});
