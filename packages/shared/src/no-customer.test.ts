import { describe, expect, it } from "vitest";

import { isNoCustomerId, noCustomerIdFor } from "./no-customer";

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
