import { describe, expect, it } from "vitest";

import {
  invoicesWithNumber,
  matchInvoiceProduct,
  normalizeInvoiceNumber,
  parseOmieInvoice,
  quantityToKg
} from "./omie-invoice-items.ts";

function nota(overrides: Record<string, unknown> = {}) {
  return {
    ide: { nNF: "000029490", serie: "1", dEmi: "01/09/2026", dCan: "" },
    nfDestInt: { nCodCli: 777, cRazao: "CONSTRUTORA ALFA" },
    det: [
      {
        prod: { cProd: "BR1", xProd: "BRITA 1", qCom: 30, uCom: "TON" },
        nfProdInt: { nCodProd: 555 }
      }
    ],
    ...overrides
  };
}

describe("normalizeInvoiceNumber", () => {
  it("fica so com os digitos, sem os zeros a esquerda", () => {
    expect(normalizeInvoiceNumber("000029490")).toBe("29490");
    expect(normalizeInvoiceNumber(" 29.490 ")).toBe("29490");
    expect(normalizeInvoiceNumber(29490)).toBe("29490");
    expect(normalizeInvoiceNumber("000")).toBeNull();
    expect(normalizeInvoiceNumber("")).toBeNull();
  });
});

describe("quantityToKg", () => {
  it("tonelada vira quilo; quilo fica; m3 e unidade nao tem conversao", () => {
    expect(quantityToKg(30, "TON")).toBe(30_000);
    expect(quantityToKg(12.5, "t")).toBe(12_500);
    expect(quantityToKg(1.234, "Ton.")).toBe(1_234);
    expect(quantityToKg(800, "KG")).toBe(800);
    expect(quantityToKg(10, "M3")).toBeNull();
    expect(quantityToKg(10, "UN")).toBeNull();
    expect(quantityToKg(0, "TON")).toBeNull();
  });
});

describe("parseOmieInvoice", () => {
  it("le numero, serie, data, cliente e os itens da nota", () => {
    expect(parseOmieInvoice(nota())).toEqual({
      invoiceNumber: "29490",
      series: "1",
      issueDate: "2026-09-01",
      omieCustomerId: 777,
      customerName: "CONSTRUTORA ALFA",
      cancelled: false,
      items: [
        {
          omieProductId: 555,
          code: "BR1",
          description: "BRITA 1",
          quantity: 30,
          unit: "TON",
          weightKg: 30_000
        }
      ]
    });
  });

  it("quantidade com virgula e item sem descricao", () => {
    const parsed = parseOmieInvoice(
      nota({
        det: [
          { prod: { xProd: "PEDRISCO", qCom: "1.234,5", uCom: "KG" } },
          { prod: { qCom: 3, uCom: "TON" } }
        ]
      })
    );
    expect(parsed?.items).toEqual([
      {
        omieProductId: null,
        code: null,
        description: "PEDRISCO",
        quantity: 1234.5,
        unit: "KG",
        weightKg: 1234.5
      }
    ]);
  });

  it("nota cancelada e marcada; sem numero nao e nota", () => {
    expect(parseOmieInvoice(nota({ ide: { nNF: "10", dCan: "05/09/2026" } }))?.cancelled).toBe(
      true
    );
    expect(parseOmieInvoice(nota({ ide: { nNF: "10", dCan: "00/00/0000" } }))?.cancelled).toBe(
      false
    );
    expect(parseOmieInvoice(nota({ ide: { nNF: "" } }))).toBeNull();
  });
});

describe("invoicesWithNumber", () => {
  it("confere o numero de novo e tira a cancelada", () => {
    const response = {
      nfCadastro: [
        nota(),
        nota({ ide: { nNF: "29491", serie: "1" } }),
        nota({ ide: { nNF: "29490", serie: "2", dCan: "02/09/2026" } })
      ]
    };
    const found = invoicesWithNumber(response, "29490");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ invoiceNumber: "29490", series: "1" });
  });

  it("aceita a nota sem envelope e resposta vazia", () => {
    expect(invoicesWithNumber(nota(), "0029490")).toHaveLength(1);
    expect(invoicesWithNumber({}, "29490")).toEqual([]);
    expect(invoicesWithNumber(null, "29490")).toEqual([]);
    expect(invoicesWithNumber({ nfCadastro: [nota()] }, "")).toEqual([]);
  });
});

describe("matchInvoiceProduct", () => {
  const products = [
    { id: "p1", description: "BRITA 1", code: "BR1", omieProductId: 555 },
    { id: "p2", description: "PEDRISCO", code: "PED", omieProductId: null }
  ];

  it("casa pelo codigo do OMIE e, sem ele, pelo codigo do produto", () => {
    expect(matchInvoiceProduct({ omieProductId: 555, code: "X" }, products)?.id).toBe("p1");
    expect(matchInvoiceProduct({ omieProductId: 9, code: " ped " }, products)?.id).toBe("p2");
  });

  it("nao casa por nome nem por nada vazio", () => {
    expect(matchInvoiceProduct({ omieProductId: null, code: null }, products)).toBeNull();
    expect(matchInvoiceProduct({ omieProductId: 9, code: "BRITA 1" }, products)).toBeNull();
  });
});
