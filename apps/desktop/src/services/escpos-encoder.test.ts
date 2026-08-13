import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECEIPT_STYLE,
  receiptEscPosLayout,
  type ReceiptStyle
} from "@kyberrock/print-templates";

import {
  countRasterBlackDots,
  encodeEscPos,
  isRasterBlank,
  packRasterImage,
  rasterToBgraBitmap
} from "./escpos-encoder";

describe("encodeEscPos", () => {
  it("transliterates accented characters instead of corrupting them", () => {
    // Minuscula + ":" garantem que ambas as formas tomem o mesmo ramo (nao-centralizado),
    // isolando o teste na diferenca de codificacao dos acentos.
    const plain = encodeEscPos(["Razao social: Irmaos Acucar"], 80);
    const accented = encodeEscPos(["Razao social: Irmãos Açúcar"], 80);

    // O texto acentuado vira a mesma sequencia de bytes ASCII do texto ja sem acento
    // (antes, a codificacao "ascii" 7-bit corrompia ã/ç/ú em bytes invalidos).
    expect(accented.equals(plain)).toBe(true);
  });

  it("keeps every emitted byte within printable ASCII / control range", () => {
    const buffer = encodeEscPos(["SÃO PAULO", "CONSTRUÇÃO", "Endereço nº 1"], 80);
    // Nenhum byte de dado deve cair na faixa alta (>= 0x80), que apareceria como "?" / lixo
    // na impressora de rede. Bytes de controle ESC/POS (< 0x20) sao esperados e permitidos.
    const highBytes = [...buffer].filter((byte) => byte >= 0x80);
    expect(highBytes).toHaveLength(0);
  });

  it("prints the logo as an ESC/POS bit image before the first text line", () => {
    const logo = packRasterImage(bgraPixels(16, 8, [0, 0, 0, 255]), 16, 8);
    expect(logo).not.toBeNull();

    const buffer = encodeEscPos(["CUPOM"], 80, logo);
    const bytes = [...buffer];
    // GS v 0 m xL xH yL yH: 2 bytes por linha (16 pontos) e 8 linhas de altura.
    const rasterStart = findSequence(bytes, [0x1d, 0x76, 0x30, 0x00]);

    expect(rasterStart).toBeGreaterThanOrEqual(0);
    expect(bytes.slice(rasterStart + 4, rasterStart + 8)).toEqual([0x02, 0x00, 0x08, 0x00]);
    expect(rasterStart).toBeLessThan(findSequence(bytes, [...Buffer.from("CUPOM", "ascii")]));
  });

  it("keeps the receipt identical when there is no logo configured", () => {
    expect(encodeEscPos(["CUPOM"], 80, null).equals(encodeEscPos(["CUPOM"], 80))).toBe(true);
  });

  /**
   * Na previa o codigo da operacao e o numero do cupom saem grandes e em negrito. Impressos
   * como texto comum, eram duas linhas iguais a todas as outras no meio do papel — e sao
   * justamente as duas que o operador procura no cupom em maos.
   */
  describe("destaque do cabecalho", () => {
    it("dobra a altura e liga o negrito no codigo da operacao e no numero do cupom", () => {
      for (const line of ["COD 000123", "COPIA NRO 000000882-4"]) {
        const bytes = [...encodeEscPos([line], 80)];
        const text = findSequence(bytes, [...Buffer.from(line, "ascii")]);

        // GS ! 1 (altura dupla) e ESC E 1 (negrito) antes do texto...
        expect(findSequence(bytes, [0x1d, 0x21, 0x01])).toBeGreaterThanOrEqual(0);
        expect(findSequence(bytes, [0x1d, 0x21, 0x01])).toBeLessThan(text);
        expect(findSequence(bytes, [0x1b, 0x45, 0x01])).toBeLessThan(text);
        // ...e desligados depois, para o resto do cupom voltar ao normal.
        expect(findSequence(bytes.slice(text), [0x1d, 0x21, 0x00])).toBeGreaterThanOrEqual(0);
        expect(findSequence(bytes.slice(text), [0x1b, 0x45, 0x00])).toBeGreaterThanOrEqual(0);
      }
    });

    it("nao aumenta o resto do cupom", () => {
      const bytes = [...encodeEscPos(["PEDREIRA IBIUNA", "AGRADECEMOS PELA PREFERENCIA"], 80)];

      expect(findSequence(bytes, [0x1d, 0x21, 0x01])).toBe(-1);
    });

    // Largura dupla cortaria a linha para 24 colunas e o numero do cupom ja usa 21.
    it("nao dobra a largura, para o numero do cupom nao ser truncado", () => {
      const bytes = [...encodeEscPos(["COPIA NRO 000000882-4"], 80)];

      expect(findSequence(bytes, [0x1d, 0x21, 0x11])).toBe(-1);
      expect(findSequence(bytes, [0x1d, 0x21, 0x10])).toBe(-1);
    });
  });

  /**
   * A aparencia escolhida na tela de impressao existia so no caminho grafico: o codificador
   * ignorava o estilo e mandava tudo na fonte padrao. Agora cada controle vira comando.
   */
  describe("personalizacao", () => {
    const style = (overrides: Partial<ReceiptStyle>): ReceiptStyle => ({
      ...DEFAULT_RECEIPT_STYLE,
      ...overrides
    });
    const encode = (lines: string[], overrides: Partial<ReceiptStyle>, paperWidthMm = 80) =>
      encodeEscPos(lines, paperWidthMm, null, receiptEscPosLayout(style(overrides), paperWidthMm));

    it("troca a fonte embutida da impressora (ESC M)", () => {
      // ESC M 0 = fonte A (12x24), ESC M 1 = fonte B (9x17).
      expect(findSequence([...encode(["X"], {})], [0x1b, 0x4d, 0x00])).toBeGreaterThanOrEqual(0);
      expect(
        findSequence([...encode(["X"], { fontFamily: "condensed" })], [0x1b, 0x4d, 0x01])
      ).toBeGreaterThanOrEqual(0);
    });

    it("leva a entrelinha configurada (ESC 3 n, em pontos)", () => {
      // 2 x 24 pontos da fonte A.
      expect(
        findSequence([...encode(["X"], { lineHeight: 2 })], [0x1b, 0x33, 48])
      ).toBeGreaterThanOrEqual(0);
      // Padrao (1,28) arredonda para 31 pontos, junto do padrao da impressora.
      expect(findSequence([...encode(["X"], {})], [0x1b, 0x33, 31])).toBeGreaterThanOrEqual(0);
    });

    it("liga o negrito do corpo (ESC E)", () => {
      const semNegrito = [...encode(["Cliente: X"], {})];
      const comNegrito = [...encode(["Cliente: X"], { boldBody: true })];
      const texto = findSequence(comNegrito, [...Buffer.from("Cliente: X", "ascii")]);

      expect(findSequence(comNegrito, [0x1b, 0x45, 0x01])).toBeLessThan(texto);
      // Sem negrito, a linha do corpo continua saindo com ESC E 0 antes do texto.
      expect(
        findSequence(
          semNegrito.slice(0, findSequence(semNegrito, [...Buffer.from("Cliente: X", "ascii")])),
          [0x1b, 0x45, 0x01]
        )
      ).toBe(-1);
    });

    it("dobra a altura do corpo quando o operador pede corpo maior", () => {
      const bytes = [...encode(["Cliente: X"], { fontSizePx: 16 })];
      const texto = findSequence(bytes, [...Buffer.from("Cliente: X", "ascii")]);

      // GS ! 0x01: altura dupla, largura simples — a grade de colunas continua valendo.
      expect(findSequence(bytes, [0x1d, 0x21, 0x01])).toBeLessThan(texto);
      expect(findSequence(bytes, [0x1d, 0x21, 0x11])).toBe(-1);
    });

    it("estica o divisor ate a largura real da fonte", () => {
      const divisor = "-".repeat(48);
      const fonteB = encode([divisor], { fontFamily: "condensed" });

      expect(fonteB.includes(Buffer.from("-".repeat(64), "ascii"))).toBe(true);
      expect(encode([divisor], {}).includes(Buffer.from("-".repeat(64), "ascii"))).toBe(false);
    });

    it("aumenta so os numeros dentro da linha", () => {
      const bytes = [...encode(["LIQUIDO: 6,500 <TON>"], { fontSizePx: 10, numberFontSizePx: 16 })];
      const rotulo = findSequence(bytes, [...Buffer.from("LIQUIDO: ", "ascii")]);
      const numero = findSequence(bytes, [...Buffer.from("6,500", "ascii")]);
      const unidade = findSequence(bytes, [...Buffer.from(" <TON>", "ascii")]);

      expect(rotulo).toBeGreaterThanOrEqual(0);
      // O aumento entra antes do numero e sai antes do texto seguinte.
      const aumento = findSequence(bytes.slice(rotulo, numero), [0x1d, 0x21, 0x01]);
      expect(aumento).toBeGreaterThanOrEqual(0);
      expect(findSequence(bytes.slice(numero, unidade), [0x1d, 0x21, 0x00])).toBeGreaterThanOrEqual(
        0
      );
    });

    it("imprime a logo no alinhamento configurado", () => {
      const logo = packRasterImage(bgraPixels(16, 8, [0, 0, 0, 255]), 16, 8);
      const bytes = [
        ...encodeEscPos(
          ["CUPOM"],
          80,
          logo,
          receiptEscPosLayout(style({ logoAlignment: "left" }), 80)
        )
      ];
      const raster = findSequence(bytes, [0x1d, 0x76, 0x30, 0x00]);

      // ESC a 0 (esquerda) imediatamente antes do bit image.
      expect(bytes.slice(raster - 3, raster)).toEqual([0x1b, 0x61, 0x00]);
    });
  });

  /**
   * O cupom em texto puro ja centraliza com espacos (e a mesma linha que alimenta o HTML e a
   * previa). A impressora centraliza de novo pelo ESC a 1, entao os dois recuos se somavam e
   * empurravam a linha para a direita — o "COD 000123" saia encostado na borda do papel.
   */
  it("centraliza a linha pelo comando, sem somar o recuo que ela ja trazia", () => {
    const recuada = encodeEscPos(["                   COD 000123"], 80);
    const semRecuo = encodeEscPos(["COD 000123"], 80);

    expect(recuada.equals(semRecuo)).toBe(true);
    // ESC a 1 (centralizar) seguido do texto, sem espacos entre eles.
    expect([...recuada].includes(0x01)).toBe(true);
    expect(recuada.toString("ascii")).toContain("COD 000123");
    expect(recuada.toString("ascii")).not.toContain(" COD 000123");
  });

  it("preserva o recuo das linhas que nao sao centralizadas", () => {
    // Colunas Quantidade/Unitario/Total: o recuo E o alinhamento da coluna.
    const colunas = "    6,500 TN    120,0000      780,00";

    expect(encodeEscPos([colunas], 80).toString("ascii")).toContain(colunas);
  });

  it("turns transparent pixels into paper instead of a black block", () => {
    const transparent = packRasterImage(bgraPixels(8, 1, [0, 0, 0, 0]), 8, 1);
    const opaque = packRasterImage(bgraPixels(8, 1, [0, 0, 0, 255]), 8, 1);

    expect([...(transparent?.bits ?? [])]).toEqual([0x00]);
    expect([...(opaque?.bits ?? [])]).toEqual([0xff]);
  });

  it("rejects a pixel buffer that does not match the declared size", () => {
    expect(packRasterImage(new Uint8Array(8), 16, 8)).toBeNull();
  });
});

describe("rasterToBgraBitmap", () => {
  it("rebuilds the printed image so the Windows receipt shows the same dots as the network one", () => {
    // Metade preta / metade branca: 8 pixels em uma linha (1 byte de bits).
    const source = new Uint8Array(8 * 4);
    for (let index = 0; index < 4; index += 1) source.set([0, 0, 0, 255], index * 4);
    for (let index = 4; index < 8; index += 1) source.set([255, 255, 255, 255], index * 4);

    const raster = packRasterImage(source, 8, 1);
    expect(raster).not.toBeNull();
    expect([...(raster?.bits ?? [])]).toEqual([0xf0]);

    const bitmap = rasterToBgraBitmap(raster!);
    expect(bitmap).toHaveLength(8 * 4);
    // Primeiro pixel preto opaco, quinto pixel branco opaco.
    expect([...bitmap.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...bitmap.subarray(16, 20)]).toEqual([255, 255, 255, 255]);
  });

  it("ignores the padding bits of the last byte of each row", () => {
    const raster = packRasterImage(bgraPixels(4, 1, [0, 0, 0, 255]), 4, 1);
    const bitmap = rasterToBgraBitmap(raster!);

    expect(bitmap).toHaveLength(4 * 4);
    expect(countRasterBlackDots(raster!)).toBe(4);
  });
});

describe("isRasterBlank", () => {
  it("detects the logo that prints as an empty area", () => {
    const white = packRasterImage(bgraPixels(64, 64, [255, 255, 255, 255]), 64, 64);
    const transparent = packRasterImage(bgraPixels(64, 64, [0, 0, 0, 0]), 64, 64);
    const black = packRasterImage(bgraPixels(64, 64, [0, 0, 0, 255]), 64, 64);

    expect(isRasterBlank(white!)).toBe(true);
    expect(isRasterBlank(transparent!)).toBe(true);
    expect(isRasterBlank(black!)).toBe(false);
  });
});

function bgraPixels(
  width: number,
  height: number,
  pixel: [number, number, number, number]
): Uint8Array {
  const buffer = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    buffer.set(pixel, index * 4);
  }
  return buffer;
}

function findSequence(haystack: number[], needle: number[]): number {
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((byte, offset) => haystack[index + offset] === byte)) {
      return index;
    }
  }
  return -1;
}
