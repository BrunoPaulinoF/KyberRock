import { describe, expect, it } from "vitest";

import { customerSearchFilter, documentPattern, sanitizeSearchTerm } from "./customer-search";

describe("customerSearchFilter", () => {
  it("sem busca nao filtra", () => {
    expect(customerSearchFilter("")).toBeNull();
    expect(customerSearchFilter("   ")).toBeNull();
    expect(customerSearchFilter("(,)")).toBeNull();
  });

  it("nome procura na fantasia e na razao social", () => {
    expect(customerSearchFilter("polimix")).toBe(
      "trade_name.ilike.*polimix*,legal_name.ilike.*polimix*"
    );
  });

  it("virgula e parenteses nao quebram o filtro", () => {
    expect(sanitizeSearchTerm("Silva, Jose (filial)")).toBe("Silva* Jose *filial*");
    expect(customerSearchFilter("Silva, Jose")).not.toContain(", ");
  });

  it("documento acha com e sem pontuacao", () => {
    const filter = customerSearchFilter("29.346.488");
    expect(filter).toContain("document.ilike.*2*9*3*4*6*4*8*8*");
    expect(documentPattern("29346488")).toBe("*2*9*3*4*6*4*8*8*");
  });

  it("documento curto ou sem numero nao entra", () => {
    expect(documentPattern("12")).toBeNull();
    expect(documentPattern("abc")).toBeNull();
    // CNPJ alfanumerico: a letra fica.
    expect(documentPattern("12AB34")).toBe("*1*2*A*B*3*4*");
  });
});
