import { describe, expect, it } from "vitest";

import {
  buildOmieCarrierPayload,
  buildOmieCustomerPayload,
  normalizePlate,
  optionalText,
  parseCommercialInput,
  parseCustomerInput,
  parseDocument,
  parseIsoDate,
  parsePriceInput,
  parseVehicleInput,
  splitPhoneForOmie
} from "./web-cadastro";

// CNPJ valido de exemplo (digitos verificadores conferem).
const CNPJ = "11.222.333/0001-81";
// CNPJ alfanumerico valido (IN RFB 2.229/2024): as 12 primeiras posicoes aceitam letra.
const CNPJ_ALFA = "12.ABC.345/01DE-35";
const CPF = "529.982.247-25";

describe("optionalText", () => {
  it("distingue nao veio, veio vazio e veio com valor", () => {
    expect(optionalText({}, "x")).toBeUndefined();
    expect(optionalText({ x: null }, "x")).toBeNull();
    expect(optionalText({ x: "   " }, "x")).toBeNull();
    expect(optionalText({ x: "  abc " }, "x")).toBe("abc");
  });
});

describe("parseDocument", () => {
  it("tira a mascara e mantem a letra do CNPJ alfanumerico", () => {
    expect(parseDocument({ document: CNPJ_ALFA }, "document", "CNPJ")).toEqual({
      ok: true,
      value: "12ABC34501DE35"
    });
  });

  it("recusa documento com digito verificador errado", () => {
    const result = parseDocument({ document: "11.222.333/0001-82" }, "document", "CNPJ/CPF");
    expect(result.ok).toBe(false);
  });

  it("vazio limpa; ausente nao mexe", () => {
    expect(parseDocument({ document: "" }, "document", "CNPJ")).toEqual({ ok: true, value: null });
    expect(parseDocument({}, "document", "CNPJ")).toEqual({ ok: true, value: undefined });
  });
});

describe("parseIsoDate", () => {
  it("aceita AAAA-MM-DD real e recusa data que nao existe", () => {
    expect(parseIsoDate({ d: "2026-09-22" }, "d")).toEqual({ ok: true, value: "2026-09-22" });
    expect(parseIsoDate({ d: "2026-02-30" }, "d")).toEqual({ ok: false });
    expect(parseIsoDate({ d: "22/09/2026" }, "d")).toEqual({ ok: false });
  });
});

describe("parseCustomerInput", () => {
  it("na criacao exige razao social e usa-a como nome fantasia quando falta", () => {
    expect(parseCustomerInput({}, "create").ok).toBe(false);

    const result = parseCustomerInput({ legalName: " Polymix Ltda ", document: CNPJ }, "create");
    expect(result).toEqual({
      ok: true,
      value: {
        legal_name: "Polymix Ltda",
        trade_name: "Polymix Ltda",
        document: "11222333000181",
        is_individual: false
      }
    });
  });

  it("pessoa fisica e decidida pela FORMA do documento", () => {
    const result = parseCustomerInput({ legalName: "Joao", document: CPF }, "create");
    expect(result.ok && result.value.is_individual).toBe(true);
  });

  it("na edicao so entra o que veio, e vazio limpa", () => {
    const result = parseCustomerInput({ phone: null, city: "Ibiuna", state: "sp" }, "update");
    expect(result).toEqual({
      ok: true,
      value: { phone: null, city: "Ibiuna", state: "SP" }
    });
  });

  it("edicao sem nenhum campo e recusada, e razao social nao pode ser esvaziada", () => {
    expect(parseCustomerInput({}, "update").ok).toBe(false);
    expect(parseCustomerInput({ legalName: "" }, "update").ok).toBe(false);
  });

  it("UF precisa ser sigla de duas letras", () => {
    expect(parseCustomerInput({ legalName: "X", state: "Sao Paulo" }, "create").ok).toBe(false);
  });
});

describe("parseCommercialInput", () => {
  it("monta o bloco comercial com validacao de enum e faixa", () => {
    const result = parseCommercialInput({
      defaultCarrierId: "carrier-1",
      nfRequired: true,
      creditAccountEnabled: "true",
      creditMode: "prepaid",
      creditPeriodicity: "monthly",
      creditClosingDay: 30,
      creditBoletoDays: "10",
      creditClosingWeekday: null
    });

    expect(result).toEqual({
      ok: true,
      value: {
        default_carrier_id: "carrier-1",
        nf_required: true,
        credit_account_enabled: true,
        credit_mode: "prepaid",
        credit_periodicity: "monthly",
        credit_closing_day: 30,
        credit_boleto_days: 10,
        credit_closing_weekday: null
      }
    });
  });

  it("recusa dia de fechamento fora de 1..31 e modo de credito desconhecido", () => {
    expect(parseCommercialInput({ creditClosingDay: 32 }).ok).toBe(false);
    expect(parseCommercialInput({ creditMode: "fiado" }).ok).toBe(false);
    expect(parseCommercialInput({}).ok).toBe(false);
  });
});

describe("parseVehicleInput", () => {
  it("normaliza a placa como a balanca compara", () => {
    expect(normalizePlate(" abc-1d23 ")).toBe("ABC1D23");
    const result = parseVehicleInput({ plate: "abc 1d23", description: "Truck" }, "create");
    expect(result).toEqual({ ok: true, value: { plate: "ABC1D23", description: "Truck" } });
  });

  it("recusa placa com caracteres estranhos", () => {
    expect(parseVehicleInput({ plate: "AB*12" }, "create").ok).toBe(false);
  });
});

describe("parsePriceInput", () => {
  it("exige centavos inteiros e usa 'ton' quando a unidade nao vem", () => {
    expect(parsePriceInput({ unitPriceCents: 12345 })).toEqual({
      ok: true,
      value: { unitPriceCents: 12345, unit: "ton", validFrom: null, validTo: null }
    });
    expect(
      parsePriceInput({ unitPriceCents: "12345", unit: "TON", validFrom: "2026-10-01" })
    ).toEqual({
      ok: true,
      value: { unitPriceCents: 12345, unit: "ton", validFrom: "2026-10-01", validTo: null }
    });
  });

  it("recusa reais com virgula, negativo e data invalida", () => {
    expect(parsePriceInput({ unitPriceCents: "123,45" }).ok).toBe(false);
    expect(parsePriceInput({ unitPriceCents: 123.45 }).ok).toBe(false);
    expect(parsePriceInput({ unitPriceCents: -1 }).ok).toBe(false);
    expect(parsePriceInput({ unitPriceCents: 1, validTo: "01/10/2026" }).ok).toBe(false);
  });
});

describe("payloads do OMIE", () => {
  it("separa DDD e numero do telefone como a balanca", () => {
    expect(splitPhoneForOmie("(11) 99999-1234")).toEqual({ ddd: "11", number: "99999" });
    expect(splitPhoneForOmie(null)).toEqual({});
  });

  it("monta o push_customer com o mesmo id local da nuvem", () => {
    const payload = buildOmieCustomerPayload({
      id: "cust-1",
      legal_name: "Polymix Ltda",
      trade_name: "",
      document: "11222333000181",
      phone: "(15) 3333-4444",
      observations: null,
      omie_customer_id: null
    });

    expect(payload).toMatchObject({
      localCustomerId: "cust-1",
      omieCustomerId: undefined,
      razaoSocial: "Polymix Ltda",
      nomeFantasia: "Polymix Ltda",
      cnpjCpf: "11222333000181",
      telefone1Ddd: "15",
      telefone1Numero: "3333",
      observations: ""
    });
  });

  it("transportadora vai com o prefixo carrier: que a balanca usa", () => {
    expect(buildOmieCarrierPayload({ id: "car-1", name: "Trans X", document: null })).toEqual({
      localCustomerId: "carrier:car-1",
      omieCustomerId: undefined,
      name: "Trans X",
      cnpjCpf: undefined
    });
  });
});
