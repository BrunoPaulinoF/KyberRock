import { describe, expect, it } from "vitest";

import {
  CUSTOMER_OPTION_LIMIT,
  customerOptionLabel,
  rankCustomerOptions
} from "./customer-option-search";
import type { CustomerReportOption } from "../services/customer-report";

function customer(id: string, name: string, document: string | null = null): CustomerReportOption {
  return { id, name, document };
}

describe("rankCustomerOptions", () => {
  it("poe no topo o cliente que mais se aproxima do que foi digitado", () => {
    const customers = [
      customer("c1", "Transportadora Levisa Norte"),
      customer("c2", "Levisa Transportes"),
      customer("c3", "Levisa"),
      customer("c4", "Pedreira Sul")
    ];

    const page = rankCustomerOptions(customers, "levisa", "");

    expect(page.options.map((option) => option.id)).toEqual(["c3", "c2", "c1"]);
    expect(page.total).toBe(3);
  });

  it("acha pelo documento, com ou sem pontuacao", () => {
    const customers = [customer("c1", "Levisa", "12.345.678/0001-90"), customer("c2", "Outro")];

    expect(rankCustomerOptions(customers, "12345678000190", "").options[0].id).toBe("c1");
    expect(rankCustomerOptions(customers, "12.345.678/0001-90", "").options[0].id).toBe("c1");
  });

  it("corta a lista e diz quantos casaram", () => {
    const customers = Array.from({ length: CUSTOMER_OPTION_LIMIT + 20 }, (_, index) =>
      customer(`c${index}`, `Pedreira ${String(index).padStart(3, "0")}`)
    );

    const page = rankCustomerOptions(customers, "pedreira", "");

    expect(page.options).toHaveLength(CUSTOMER_OPTION_LIMIT);
    // E por `total` que a tela avisa que ha mais — sem isso o corte fica invisivel.
    expect(page.total).toBe(CUSTOMER_OPTION_LIMIT + 20);
  });

  it("o cliente ja escolhido continua na lista mesmo fora da busca", () => {
    const customers = [customer("c1", "Levisa"), customer("c2", "Pedreira Sul")];

    // Sem esta regra o `<select>` ficava sem a opcao selecionada e o navegador mostrava o
    // campo em branco, como se ninguem tivesse sido escolhido.
    const page = rankCustomerOptions(customers, "levisa", "c2");

    expect(page.options.map((option) => option.id)).toEqual(["c2", "c1"]);
  });

  it("o escolhido nao e duplicado quando ele mesmo casa com a busca", () => {
    const customers = [customer("c1", "Levisa"), customer("c2", "Levisa Transportes")];

    const page = rankCustomerOptions(customers, "levisa", "c2");

    expect(page.options.map((option) => option.id)).toEqual(["c1", "c2"]);
  });

  it("sem busca devolve a lista em ordem alfabetica", () => {
    const customers = [customer("c1", "Zeta"), customer("c2", "Alfa")];

    // Sem termo nao ha pontuacao a aplicar; o desempate alfabetico e o que sobra, e e o que
    // o operador espera de uma lista em repouso.
    const page = rankCustomerOptions(customers, "", "");

    expect(page.options.map((option) => option.name)).toEqual(["Zeta", "Alfa"]);
    expect(page.total).toBe(2);
  });

  it("busca sem resultado nao inventa opcao — so mantem a escolhida", () => {
    const customers = [customer("c1", "Levisa"), customer("c2", "Pedreira Sul")];

    expect(rankCustomerOptions(customers, "inexistente", "").options).toEqual([]);
    expect(
      rankCustomerOptions(customers, "inexistente", "c1").options.map((option) => option.id)
    ).toEqual(["c1"]);
  });

  it("nao muta a lista que recebeu", () => {
    const customers = [customer("c1", "Zeta"), customer("c2", "Alfa")];

    rankCustomerOptions(customers, "alfa", "c1");

    expect(customers.map((option) => option.id)).toEqual(["c1", "c2"]);
  });
});

describe("customerOptionLabel", () => {
  it("mostra o documento ao lado do nome quando ele existe", () => {
    expect(customerOptionLabel(customer("c1", "Levisa", "12345678000190"))).toBe(
      "Levisa - 12345678000190"
    );
    expect(customerOptionLabel(customer("c1", "Levisa"))).toBe("Levisa");
  });
});
