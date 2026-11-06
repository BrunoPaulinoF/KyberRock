import { describe, expect, it } from "vitest";

import {
  assertProductAllowedForCustomer,
  isNoCustomerId,
  isNoCustomerOnlyProductId,
  noCustomerExplosiveProductIdFor,
  noCustomerIdFor,
  weighingNetWeightKg
} from "./no-customer";

describe("cadastro SEM CLIENTE", () => {
  it("gera o mesmo id para a mesma empresa em qualquer balanca", () => {
    expect(noCustomerIdFor("company-1")).toBe("sem-cliente-company-1");
    expect(noCustomerIdFor(" company-1 ")).toBe(noCustomerIdFor("company-1"));
  });

  it("reconhece o cadastro pelo id, nunca pelo nome", () => {
    expect(isNoCustomerId(noCustomerIdFor("company-1"))).toBe(true);
    expect(isNoCustomerId("omie_11488403507")).toBe(false);
    expect(isNoCustomerId("SEM CLIENTE")).toBe(false);
    expect(isNoCustomerId(null)).toBe(false);
    expect(isNoCustomerId(undefined)).toBe(false);
  });

  it("recusa empresa vazia", () => {
    expect(() => noCustomerIdFor(" ")).toThrow("Empresa nao identificada");
  });
});

describe("produto EXPLOSIVO (so com SEM CLIENTE)", () => {
  it("gera o mesmo id para a mesma empresa e reconhece pelo id", () => {
    expect(noCustomerExplosiveProductIdFor(" company-1 ")).toBe("explosivo-company-1");
    expect(isNoCustomerOnlyProductId("explosivo-company-1")).toBe(true);
    expect(isNoCustomerOnlyProductId("omie_11455901041")).toBe(false);
    expect(isNoCustomerOnlyProductId("EXPLOSIVO")).toBe(false);
    expect(isNoCustomerOnlyProductId(null)).toBe(false);
  });

  it("so aceita o EXPLOSIVO com o cliente SEM CLIENTE", () => {
    const explosive = noCustomerExplosiveProductIdFor("company-1");
    expect(() =>
      assertProductAllowedForCustomer(explosive, noCustomerIdFor("company-1"))
    ).not.toThrow();
    expect(() => assertProductAllowedForCustomer(explosive, "omie_11488403507")).toThrow(
      "so para registro"
    );
    // Produto de venda continua valendo com qualquer cliente, inclusive o SEM CLIENTE.
    expect(() =>
      assertProductAllowedForCustomer("omie_11455901041", noCustomerIdFor("company-1"))
    ).not.toThrow();
    expect(() => assertProductAllowedForCustomer("omie_11455901041", "cliente-1")).not.toThrow();
  });
});

describe("peso liquido", () => {
  it("venda: so aceita saida maior que a entrada", () => {
    expect(weighingNetWeightKg(12_000, 30_000, "cliente-1")).toBe(18_000);
    expect(weighingNetWeightKg(30_000, 12_000, "cliente-1")).toBeNull();
    expect(weighingNetWeightKg(12_000, 12_000, "cliente-1")).toBeNull();
  });

  it("SEM CLIENTE aceita o caminhao que chega cheio e sai vazio", () => {
    const id = noCustomerIdFor("company-1");
    expect(weighingNetWeightKg(9_000, 6_500, id)).toBe(2_500);
    expect(weighingNetWeightKg(6_500, 9_000, id)).toBe(2_500);
    expect(weighingNetWeightKg(9_000, 9_000, id)).toBeNull();
  });
});
