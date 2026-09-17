import { describe, expect, it } from "vitest";

import { receiptRowsWithoutLogoImage, snapshotWithoutLogoImage } from "./receipt-snapshot.ts";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

describe("snapshotWithoutLogoImage", () => {
  it("tira a imagem e mantem a geometria", () => {
    const snapshot = {
      lines: ["CUPOM"],
      receiptLogo: { dataUrl: LOGO, widthMm: 24, heightMm: 16, fit: "contain" }
    };
    expect(snapshotWithoutLogoImage(snapshot)).toEqual({
      lines: ["CUPOM"],
      // A geometria fica: e ela que diz como a via saiu do papel.
      receiptLogo: { dataUrl: null, widthMm: 24, heightMm: 16, fit: "contain" }
    });
  });

  it("sem imagem, devolve o MESMO objeto", () => {
    // Identidade, nao so igualdade: a linha nao precisa ser copiada quando nada muda, e e
    // esse o caso de toda balanca ja atualizada.
    const semLogo = { lines: [], receiptLogo: { dataUrl: null, widthMm: 24 } };
    expect(snapshotWithoutLogoImage(semLogo)).toBe(semLogo);
    const semBloco = { lines: [] };
    expect(snapshotWithoutLogoImage(semBloco)).toBe(semBloco);
  });

  it("nao inventa formato no que nao reconhece", () => {
    // Esta funcao tira UMA coisa; o resto do cupom muda com o modelo de impressao e nao e
    // da conta dela.
    expect(snapshotWithoutLogoImage(null)).toBeNull();
    expect(snapshotWithoutLogoImage("cupom")).toBe("cupom");
    expect(snapshotWithoutLogoImage([1, 2])).toEqual([1, 2]);
    const logoEstranha = { receiptLogo: "sem bloco" };
    expect(snapshotWithoutLogoImage(logoEstranha)).toBe(logoEstranha);
  });
});

describe("receiptRowsWithoutLogoImage", () => {
  it("peneira o lote inteiro e preserva as demais colunas", () => {
    const rows = [
      {
        id: "r1",
        printer_name: "TERMICA-80",
        content_snapshot_json: { receiptLogo: { dataUrl: LOGO, widthMm: 24 } }
      },
      {
        id: "r2",
        printer_name: "TERMICA-80",
        content_snapshot_json: { receiptLogo: { dataUrl: null, widthMm: 24 } }
      },
      { id: "r3", printer_name: "TERMICA-80" }
    ];
    const peneirado = receiptRowsWithoutLogoImage(rows);

    expect(peneirado[0].content_snapshot_json).toEqual({
      receiptLogo: { dataUrl: null, widthMm: 24 }
    });
    expect(peneirado[0].id).toBe("r1");
    expect(peneirado[0].printer_name).toBe("TERMICA-80");
    // Quem ja vem limpo (balanca atualizada) passa sem ser copiado.
    expect(peneirado[1]).toBe(rows[1]);
    // Cupom sem a coluna nao vira cupom com a coluna vazia.
    expect(peneirado[2]).toBe(rows[2]);
    expect("content_snapshot_json" in peneirado[2]).toBe(false);
  });

  it("lote vazio nao quebra", () => {
    expect(receiptRowsWithoutLogoImage([])).toEqual([]);
  });
});
