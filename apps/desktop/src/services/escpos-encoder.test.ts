import { describe, expect, it } from "vitest";

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

  it("imprime em corpo dobrado so as linhas destacadas", () => {
    const buffer = encodeEscPos(["                   COD 000123", "Cliente: Teste"], 80, null, {
      emphasizedLines: ["COD 000123"]
    });
    const bytes = [...buffer];
    const codigo = findSequence(bytes, [...Buffer.from("COD 000123", "ascii")]);
    const cliente = findSequence(bytes, [...Buffer.from("Cliente: Teste", "ascii")]);

    // GS ! 0x11 (dobro) antes do codigo e GS ! 0x00 (normal) depois dele.
    expect(bytes.slice(codigo - 3, codigo)).toEqual([0x1d, 0x21, 0x11]);
    expect(findSequence(bytes.slice(codigo), [0x1d, 0x21, 0x00])).toBeGreaterThan(0);
    // A linha comum nao ganha destaque nenhum.
    expect(bytes.slice(cliente - 3, cliente)).toEqual([0x1b, 0x61, 0x00]);
  });

  it("nao destaca nada quando o cupom nao pede destaque", () => {
    const semOpcoes = encodeEscPos(["COD 000123"], 80);
    const semDestaque = encodeEscPos(["COD 000123"], 80, null, { emphasizedLines: [] });

    expect(semDestaque.equals(semOpcoes)).toBe(true);
    expect(findSequence([...semOpcoes], [0x1d, 0x21])).toBe(-1);
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
