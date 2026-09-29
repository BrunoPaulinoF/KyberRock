import { describe, expect, it } from "vitest";

import { maskCep, maskDocument, maskPhone, maskPlate } from "./masks";

describe("maskDocument", () => {
  it("formata CPF enquanto digita", () => {
    expect(maskDocument("123")).toBe("123");
    expect(maskDocument("1234")).toBe("123.4");
    expect(maskDocument("12345678909")).toBe("123.456.789-09");
  });

  it("passa para CNPJ depois de 11 digitos", () => {
    expect(maskDocument("112223330001")).toBe("11.222.333/0001");
    expect(maskDocument("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("CNPJ alfanumerico: letra nunca e jogada fora", () => {
    expect(maskDocument("12abc345")).toBe("12.ABC.345");
    expect(maskDocument("12.ABC.345/01DE-35")).toBe("12.ABC.345/01DE-35");
  });

  it("para no tamanho do CNPJ e tira pontuacao solta", () => {
    expect(maskDocument("11.222.333/0001-8199")).toBe("11.222.333/0001-81");
    expect(maskDocument("  ")).toBe("");
  });
});

describe("maskPhone", () => {
  it("fixo e celular", () => {
    expect(maskPhone("1134567890")).toBe("(11) 3456-7890");
    expect(maskPhone("11934567890")).toBe("(11) 93456-7890");
  });

  it("vai montando enquanto digita", () => {
    expect(maskPhone("1")).toBe("(1");
    expect(maskPhone("119")).toBe("(11) 9");
    expect(maskPhone("1193456")).toBe("(11) 9345-6");
  });

  it("numero internacional fica como digitado", () => {
    expect(maskPhone("+1 555 0100")).toBe("+1 555 0100");
    expect(maskPhone("")).toBe("");
  });
});

describe("maskCep", () => {
  it("poe o traco depois do quinto digito", () => {
    expect(maskCep("18150")).toBe("18150");
    expect(maskCep("18150000")).toBe("18150-000");
    expect(maskCep("18150-000999")).toBe("18150-000");
  });
});

describe("maskPlate", () => {
  it("maiuscula, antiga com traco e Mercosul sem", () => {
    expect(maskPlate("abc1234")).toBe("ABC-1234");
    expect(maskPlate("abc1d23")).toBe("ABC1D23");
    expect(maskPlate("ab c-1")).toBe("ABC1");
  });
});
