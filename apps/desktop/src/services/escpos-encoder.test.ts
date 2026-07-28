import { describe, expect, it } from "vitest";

import { encodeEscPos, packRasterImage } from "./escpos-encoder";

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
