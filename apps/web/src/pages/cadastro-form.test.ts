import { describe, expect, it } from "vitest";

import { maskCep, maskDocument, maskPhone } from "../lib/masks";
import {
  cepToSave,
  documentToSave,
  fieldOfError,
  fillEmptyAddress,
  maskPhoneInput,
  maskStored,
  phoneToSave,
  whatsappForInput
} from "./cadastro-form";

describe("maskStored", () => {
  it("mascara o valor gravado quando nao perde nada", () => {
    expect(maskStored("15999998888", maskPhone)).toBe("(15) 99999-8888");
    expect(maskStored("(15) 999998888", maskPhone)).toBe("(15) 99999-8888");
    expect(maskStored("18150000", maskCep)).toBe("18150-000");
    expect(maskStored("12ABC34501DE35", maskDocument)).toBe("12.ABC.345/01DE-35");
  });

  it("deixa como esta o que a mascara cortaria", () => {
    expect(maskStored("(15) 3333-4444 ramal 22", maskPhone)).toBe("(15) 3333-4444 ramal 22");
    expect(maskStored("5515999998888", maskPhone)).toBe("5515999998888");
    expect(maskStored("+1 415 555 1234", maskPhone)).toBe("+1 415 555 1234");
    expect(maskStored(null, maskPhone)).toBe("");
  });
});

describe("maskPhoneInput", () => {
  it("mascara enquanto cabe num telefone do Brasil", () => {
    expect(maskPhoneInput("159999")).toBe("(15) 9999");
    expect(maskPhoneInput("15999998888")).toBe("(15) 99999-8888");
  });

  it("nao joga digito fora", () => {
    expect(maskPhoneInput("5515999998888")).toBe("5515999998888");
  });
});

describe("phoneToSave", () => {
  it("campo sem mexer sobe o valor gravado, como estava", () => {
    const stored = "(15) 999998888";
    const initial = maskStored(stored, maskPhone);
    expect(phoneToSave(initial, initial, stored)).toBe(stored);
    expect(phoneToSave("", "", null)).toBeNull();
  });

  it("o digitado com a mascara sobe so com os digitos (o OMIE nao corta o numero)", () => {
    expect(phoneToSave("(15) 99999-8888", "", null)).toBe("15999998888");
    expect(phoneToSave("(15) 3333-4444", "(15) 3333-0000", "1533330000")).toBe("1533334444");
  });

  it("fora do formato da mascara sobe como foi digitado", () => {
    expect(phoneToSave("+55 15 99999-8888", "", null)).toBe("+55 15 99999-8888");
    expect(phoneToSave("5515999998888", "", null)).toBe("5515999998888");
  });

  it("apagar o campo limpa", () => {
    expect(phoneToSave("", "(15) 99999-8888", "15999998888")).toBeNull();
  });
});

describe("cepToSave e documentToSave", () => {
  it("CEP sobe so com os digitos, como a balanca grava", () => {
    expect(cepToSave("18150-000", "", null)).toBe("18150000");
    expect(cepToSave("18150-000", "18150-000", "18.150-000")).toBe("18.150-000");
  });

  it("documento perde a pontuacao, nunca a letra", () => {
    expect(documentToSave("12.ABC.345/01DE-35", "", null)).toBe("12ABC34501DE35");
    expect(documentToSave("529.982.247-25", "", null)).toBe("52998224725");
  });
});

describe("fillEmptyAddress", () => {
  const address = { street: "Rua Um", district: "Centro", city: "Ibiúna", state: "sp" };

  it("preenche so os campos vazios", () => {
    const form = { addressStreet: "", neighborhood: "Jardim", city: "", state: "", other: "x" };
    expect(fillEmptyAddress(form, address)).toEqual({
      addressStreet: "Rua Um",
      neighborhood: "Jardim",
      city: "Ibiúna",
      state: "SP",
      other: "x"
    });
  });

  it("nada vazio: nada a preencher", () => {
    const form = { addressStreet: "A", neighborhood: "B", city: "C", state: "MG" };
    expect(fillEmptyAddress(form, address)).toBeNull();
  });
});

describe("whatsappForInput", () => {
  it("mostra o numero gravado sem o 55, como se digita", () => {
    expect(whatsappForInput("5511999998888")).toBe("(11) 99999-8888");
    expect(whatsappForInput("551133334444")).toBe("(11) 3333-4444");
  });

  it("numero de outro pais vem com +", () => {
    expect(whatsappForInput("14155551234567")).toBe("+14155551234567");
    expect(whatsappForInput(null)).toBe("");
  });
});

describe("fieldOfError", () => {
  const rules = [
    ["document", /CNPJ\/CPF/],
    ["state", /UF/]
  ] as const;

  it("acha o campo pela mensagem da web-api", () => {
    expect(fieldOfError("Ja existe um cliente com este CNPJ/CPF: X.", rules)).toBe("document");
    expect(fieldOfError("UF invalida: use a sigla com duas letras (ex.: SP).", rules)).toBe(
      "state"
    );
  });

  it("mensagem sem campo fica no alto", () => {
    expect(fieldOfError("Sem conexao.", rules)).toBeNull();
  });
});
