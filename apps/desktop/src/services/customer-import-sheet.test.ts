import { describe, expect, it } from "vitest";

import {
  customerRecordsToCsv,
  detectCustomerColumns,
  mergeCustomerSheets,
  nameSimilarity,
  normalizeMatchKey,
  parseCustomerSheet,
  parseDocumentSheet
} from "./customer-import-sheet";
import { parseDelimitedText, toSheetTable } from "./spreadsheet-read";

describe("customer-import-sheet", () => {
  function sheet(matrix: string[][]) {
    return toSheetTable("Plan1", matrix);
  }

  describe("detectCustomerColumns", () => {
    it("reconhece campos do cadastro e trata coluna de dinheiro desconhecida como produto", () => {
      const columns = detectCustomerColumns(
        sheet([
          ["Cliente", "Telefone", "E-mail", "Cidade", "BRITA 1", "PO DE PEDRA", "Codigo"],
          ["Pedreira Sul", "(11) 91234-5678", "nf@sul.com", "Sorocaba", "45,90", "38,00", "A-12"]
        ])
      );

      expect(columns.fields.tradeName).toBe("Cliente");
      expect(columns.fields.phone).toBe("Telefone");
      expect(columns.fields.email).toBe("E-mail");
      expect(columns.fields.city).toBe("Cidade");
      expect(columns.priceColumns.map((column) => column.product)).toEqual([
        "BRITA 1",
        "PO DE PEDRA"
      ]);
      expect(columns.ignored).toContain("Codigo");
    });

    it("tira o prefixo Preco/Valor do nome do produto", () => {
      const columns = detectCustomerColumns(
        sheet([
          ["Nome", "Preço Brita 1", "Valor do Pó"],
          ["Pedreira Sul", "45,90", "38,00"]
        ])
      );

      expect(columns.priceColumns.map((column) => column.product)).toEqual(["Brita 1", "Pó"]);
    });

    it("nao inventa produto a partir de coluna com texto", () => {
      const columns = detectCustomerColumns(
        sheet([
          ["Nome", "Condicao"],
          ["Pedreira Sul", "30 dias"]
        ])
      );

      expect(columns.priceColumns).toHaveLength(0);
      expect(columns.ignored).toContain("Condicao");
    });

    it("reconhece o formato de uma linha por produto", () => {
      const columns = detectCustomerColumns(
        sheet([
          ["Cliente", "Produto", "Preco"],
          ["Pedreira Sul", "Brita 1", "45,90"]
        ])
      );

      expect(columns.longFormat).toEqual({ productHeader: "Produto", priceHeader: "Preco" });
    });
  });

  describe("parseCustomerSheet", () => {
    it("normaliza contato, endereco e precos", () => {
      const { records } = parseCustomerSheet(
        sheet([
          [
            "Cliente",
            "Telefone",
            "E-mail",
            "CNPJ",
            "CEP",
            "UF",
            "Limite de credito",
            "Preco Brita 1"
          ],
          [
            "Pedreira Sul",
            "(11) 91234-5678",
            "NF@Sul.com",
            "19.131.243/0001-97",
            "13100-000",
            "sp",
            "R$ 10.000,00",
            "45,90"
          ]
        ])
      );

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        tradeName: "Pedreira Sul",
        phone: "11912345678",
        email: "nf@sul.com",
        document: "19131243000197",
        zipcode: "13100000",
        state: "SP",
        creditLimitCents: 1_000_000
      });
      expect(records[0].prices).toEqual([{ product: "Brita 1", unitPriceCents: 4590 }]);
    });

    it("junta as linhas do formato longo em um cliente com varios precos", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "Telefone", "Produto", "Preco"],
          ["Pedreira Sul", "1191234-5678", "Brita 1", "45,90"],
          ["Pedreira Sul", "", "Po de pedra", "38,00"],
          ["Transportes ABC", "", "Brita 0", "50,00"]
        ])
      );

      expect(records).toHaveLength(2);
      expect(records[0].prices).toEqual([
        { product: "Brita 1", unitPriceCents: 4590 },
        { product: "Po de pedra", unitPriceCents: 3800 }
      ]);
      expect(records[1].prices).toEqual([{ product: "Brita 0", unitPriceCents: 5000 }]);
    });

    it("mantem separados dois clientes de mesmo nome com CNPJ/CPF diferentes", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "CNPJ", "Preco Brita 1"],
          ["Vespa Casa e Construcao", "37323776000152", "45,90"],
          ["Vespa Casa e Construcao", "34606275000195", "48,00"]
        ])
      );

      expect(records).toHaveLength(2);
      expect(records.map((record) => record.document)).toEqual([
        "37323776000152",
        "34606275000195"
      ]);
      expect(records[0].prices).toEqual([{ product: "Brita 1", unitPriceCents: 4590 }]);
      expect(records[1].prices).toEqual([{ product: "Brita 1", unitPriceCents: 4800 }]);
    });

    it("junta as linhas do mesmo cliente pelo CNPJ mesmo com o nome escrito diferente", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "CNPJ", "Produto", "Preco"],
          ["Pedreira Sul", "19131243000197", "Brita 1", "45,90"],
          ["PEDREIRA SUL LTDA", "19.131.243/0001-97", "Po de pedra", "38,00"]
        ])
      );

      expect(records).toHaveLength(1);
      expect(records[0].prices).toEqual([
        { product: "Brita 1", unitPriceCents: 4590 },
        { product: "Po de pedra", unitPriceCents: 3800 }
      ]);
    });

    it("avisa em vez de descartar em silencio quando o preco nao e um numero", () => {
      const { records, warnings } = parseCustomerSheet(
        sheet([
          ["Cliente", "Preco Brita 1"],
          ["Pedreira Sul", "a combinar"]
        ]),
        { priceColumns: ["Preco Brita 1"] }
      );

      expect(records[0].prices).toHaveLength(0);
      expect(warnings.join(" ")).toMatch(/a combinar/);
    });

    it("recusa planilha sem coluna de nome", () => {
      expect(() => parseCustomerSheet(sheet([["Telefone"], ["1191234"]]))).toThrow(
        /nome do cliente/i
      );
    });
  });

  describe("normalizeMatchKey / nameSimilarity", () => {
    it("ignora acento, pontuacao e sufixo societario", () => {
      expect(normalizeMatchKey("Pedreira São João LTDA")).toBe("pedreira sao joao");
      expect(normalizeMatchKey("PEDREIRA SAO JOAO")).toBe("pedreira sao joao");
      expect(normalizeMatchKey("Transportes A & B ME")).toBe("transportes a b");
    });

    it("aproxima nomes parecidos e separa nomes diferentes", () => {
      expect(nameSimilarity("Pedreira Sao Joao", "Pedreira São João LTDA")).toBe(1);
      expect(nameSimilarity("Transportes Silva", "Transportes Silva e Filhos")).toBeGreaterThan(
        0.9
      );
      expect(nameSimilarity("Pedreira Sul", "Mineradora Norte")).toBeLessThan(0.5);
    });
  });

  describe("mergeCustomerSheets", () => {
    const priceSheet = sheet([
      ["Cliente", "Telefone", "Preco Brita 1"],
      ["Pedreira Sao Joao", "1191234-5678", "45,90"],
      ["Transportes ABC", "1198888-7777", "52,00"],
      ["Cliente Sem Documento", "", "60,00"]
    ]);

    const documentSheet = sheet([
      ["Nome", "CNPJ"],
      ["Pedreira São João LTDA", "19.131.243/0001-97"],
      ["TRANSPORTES ABC ME", "45997418000153"],
      ["Empresa Que Nao Vende", "11222333000181"]
    ]);

    it("casa por nome exato e por semelhanca, e sobra fica no relatorio", () => {
      const { records } = parseCustomerSheet(priceSheet);
      const { entries } = parseDocumentSheet(documentSheet);
      const merged = mergeCustomerSheets(records, entries);

      expect(merged.records[0].document).toBe("19131243000197");
      expect(merged.records[0].legalName).toBe("Pedreira São João LTDA");
      expect(merged.records[1].document).toBe("45997418000153");
      expect(merged.records[2].document).toBeNull();

      expect(merged.withoutDocument).toHaveLength(1);
      expect(merged.withoutDocument[0].customer).toBe("Cliente Sem Documento");
      expect(merged.unusedDocuments.map((entry) => entry.name)).toEqual(["Empresa Que Nao Vende"]);
    });

    it("nao chuta CNPJ quando dois nomes disputam o mesmo cliente", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "Preco Brita 1"],
          ["Transportadora Sul", "45,90"]
        ])
      );
      const { entries } = parseDocumentSheet(
        sheet([
          ["Nome", "CNPJ"],
          ["Transportadora Sul Norte", "19131243000197"],
          ["Transportadora Sul Leste", "45997418000153"]
        ])
      );

      const merged = mergeCustomerSheets(records, entries);

      expect(merged.records[0].document).toBeNull();
      expect(merged.withoutDocument[0].bestCandidate).toBeTruthy();
    });

    it("mantem o documento que ja veio na planilha comercial", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "CNPJ", "Preco Brita 1"],
          ["Pedreira Sao Joao", "45997418000153", "45,90"]
        ])
      );
      const { entries } = parseDocumentSheet(documentSheet);
      const merged = mergeCustomerSheets(records, entries);

      expect(merged.records[0].document).toBe("45997418000153");
    });

    it("avisa quando o mesmo nome aparece com dois CNPJ diferentes", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "Preco Brita 1"],
          ["Pedreira Sul", "45,90"]
        ])
      );
      const { entries } = parseDocumentSheet(
        sheet([
          ["Nome", "CNPJ"],
          ["Pedreira Sul", "19131243000197"],
          ["Pedreira Sul", "45997418000153"]
        ])
      );

      const merged = mergeCustomerSheets(records, entries);

      expect(merged.records[0].document).toBeNull();
      expect(merged.warnings.join(" ")).toMatch(/2 CNPJ\/CPF diferentes/);
    });
  });

  describe("customerRecordsToCsv", () => {
    it("gera uma planilha que o proprio importador consegue reler", () => {
      const { records } = parseCustomerSheet(
        sheet([
          ["Cliente", "Razao social", "CNPJ", "Telefone", "E-mail", "Preco Brita 1", "Preco Po"],
          [
            "Pedreira Sul",
            "Pedreira Sul LTDA",
            "19131243000197",
            "1191234-5678",
            "nf@sul.com",
            "45,90",
            "38,00"
          ],
          ["Transportes ABC", "", "45997418000153", "", "", "52,00", ""]
        ])
      );

      const csv = customerRecordsToCsv(records);
      const reparsed = parseCustomerSheet(toSheetTable("consolidado", parseDelimitedText(csv)));

      expect(reparsed.records).toHaveLength(2);
      expect(reparsed.records[0]).toMatchObject({
        tradeName: "Pedreira Sul",
        legalName: "Pedreira Sul LTDA",
        document: "19131243000197",
        phone: "11912345678",
        email: "nf@sul.com"
      });
      expect(reparsed.records[0].prices).toEqual([
        { product: "Brita 1", unitPriceCents: 4590 },
        { product: "Po", unitPriceCents: 3800 }
      ]);
      expect(reparsed.records[1].prices).toEqual([{ product: "Brita 1", unitPriceCents: 5200 }]);
    });
  });
});
