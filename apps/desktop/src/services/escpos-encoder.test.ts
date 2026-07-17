import { describe, expect, it } from "vitest";

import { encodeEscPos } from "./escpos-encoder";

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
});
