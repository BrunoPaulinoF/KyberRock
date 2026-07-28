import { describe, expect, it } from "vitest";

import { parseToledoLine } from "./toledo-protocol-parser.js";

const STX = "\x02";
const CR = "\r";

/**
 * Monta um frame do protocolo continuo Toledo/Mettler (usado pelo 950i /
 * TLC-G2): STX + SWA + SWB + SWC + 6 digitos de peso + 6 digitos de tara + CR.
 *
 * SWA bits 0-2 = posicao decimal (2 = x1), bit 5 = sempre 1.
 * SWB bit 0 = liquido, bit 1 = negativo, bit 2 = sobrecarga, bit 3 = movimento,
 *     bit 4 = kg, bit 5 = sempre 1.
 */
function continuousFrame(options: {
  weight: string;
  tare?: string;
  swa?: number;
  swb?: number;
  swc?: number;
}): Buffer {
  const swa = options.swa ?? 0x22; // decimal x1, bit 5 ligado
  const swb = options.swb ?? 0x30; // bruto, positivo, estavel, kg
  const swc = options.swc ?? 0x20;
  const tare = options.tare ?? "000000";
  return Buffer.from(
    `${STX}${String.fromCharCode(swa)}${String.fromCharCode(swb)}${String.fromCharCode(swc)}${options.weight}${tare}${CR}`,
    "binary"
  );
}

describe("parseToledoLine - protocolo continuo Toledo (950i / TLC-G2)", () => {
  it("regressao pedreira: peso 11670 kg + tara 000000 NAO vira 11.670.000.000", () => {
    // Frame real do campo: o parser antigo colava peso+tara em um numero so
    const reading = parseToledoLine(continuousFrame({ weight: "011670" }));

    expect(reading).not.toBeNull();
    expect(reading?.weightKg).toBe(11_670);
    expect(reading?.unit).toBe("kg");
    expect(reading?.stable).toBe(true);
    expect(reading?.statusFlags.isGross).toBe(true);
  });

  it("nao amplifica o peso em divisoes de 10 kg (visor 14990 nao vira 149900)", () => {
    // Balanca com divisao de 10 kg transmite os 6 digitos do visor com o zero
    // final ("014990"), nao apenas os significativos. O codigo decimal x10 do
    // SWA nao pode multiplicar de novo, senao sai peso com um zero a mais.
    const reading = parseToledoLine(continuousFrame({ weight: "014990", swa: 0x21 }));
    expect(reading?.weightKg).toBe(14_990);
  });

  it("formatos inteiros do SWA (XXXX00/XXXXX0/XXXXXX) preservam os digitos do visor", () => {
    for (const swa of [0x20, 0x21, 0x22]) {
      const reading = parseToledoLine(continuousFrame({ weight: "011670", swa }));
      expect(reading?.weightKg).toBe(11_670);
    }
  });

  it("aplica a posicao decimal fracionaria do SWA (XXX.XXX)", () => {
    const reading = parseToledoLine(continuousFrame({ weight: "011670", swa: 0x25 }));
    expect(reading?.weightKg).toBeCloseTo(11.67, 3);
  });

  it("ignora bits de incremento do SWA sem afetar o peso", () => {
    // bits 3-4 codificam o incremento (1/2/5) e nao mudam o valor
    const reading = parseToledoLine(continuousFrame({ weight: "011670", swa: 0x2a }));
    expect(reading?.weightKg).toBe(11_670);
  });

  it("marca leitura em movimento como instavel (bit 3 do SWB)", () => {
    const reading = parseToledoLine(continuousFrame({ weight: "011670", swb: 0x38 }));
    expect(reading?.stable).toBe(false);
    expect(reading?.statusFlags.inMotion).toBe(true);
  });

  it("marca peso negativo (bit 1 do SWB)", () => {
    const reading = parseToledoLine(continuousFrame({ weight: "000120", swb: 0x32 }));
    expect(reading?.weightKg).toBe(-120);
    expect(reading?.statusFlags.negative).toBe(true);
  });

  it("marca sobrecarga (bit 2 do SWB)", () => {
    const reading = parseToledoLine(continuousFrame({ weight: "999999", swb: 0x34 }));
    expect(reading?.statusFlags.outOfRange).toBe(true);
  });

  it("reporta peso liquido e tara ativa", () => {
    const reading = parseToledoLine(
      continuousFrame({ weight: "010000", tare: "005000", swb: 0x31 })
    );
    expect(reading?.weightKg).toBe(10_000);
    expect(reading?.statusFlags.isNet).toBe(true);
    expect(reading?.statusFlags.tareActive).toBe(true);
  });

  it("converte libras para kg quando o bit 4 do SWB esta desligado", () => {
    const reading = parseToledoLine(continuousFrame({ weight: "010000", swb: 0x20 }));
    expect(reading?.unit).toBe("lb");
    expect(reading?.weightKg).toBeCloseTo(4_535.92, 1);
  });

  it("descarta lixo antes do STX (checksum do frame anterior)", () => {
    const frame = continuousFrame({ weight: "011670" });
    const withGarbage = Buffer.concat([Buffer.from("K", "binary"), frame]);
    const reading = parseToledoLine(withGarbage);
    expect(reading?.weightKg).toBe(11_670);
  });

  it("tolera bit de paridade ligado nos bytes de status", () => {
    const frame = continuousFrame({ weight: "011670", swa: 0x22 | 0x80 });
    const reading = parseToledoLine(frame);
    expect(reading?.weightKg).toBe(11_670);
  });

  it("balanca zerada reporta atZero", () => {
    const reading = parseToledoLine(continuousFrame({ weight: "000000" }));
    expect(reading?.weightKg).toBe(0);
    expect(reading?.statusFlags.atZero).toBe(true);
  });
});

describe("parseToledoLine - protecao contra numeros implausiveis", () => {
  it("nunca entrega peso e tara colados como um numero gigante", () => {
    // Linha de digitos colados sem assinatura de protocolo valida
    const reading = parseToledoLine(Buffer.from("011670000000\r", "binary"));
    expect(reading).toBeNull();
  });

  it("rejeita valores absurdos tambem no formato com unidade", () => {
    const reading = parseToledoLine(Buffer.from("0000000  011670000000kg\r", "binary"));
    expect(reading).toBeNull();
  });
});

describe("parseToledoLine - formatos de texto/impressao (compatibilidade)", () => {
  it("parseia o formato simples com espacos e unidade kg", () => {
    const reading = parseToledoLine(Buffer.from("       000015200kg", "binary"));
    expect(reading?.weightKg).toBe(15_200);
    expect(reading?.stable).toBe(true);
  });

  it("parseia o formato com status e unidade separada", () => {
    const reading = parseToledoLine(Buffer.from("0000000  00012340k g", "binary"));
    expect(reading?.weightKg).toBe(12_340);
  });

  it("marca movimento pelo status I no formato de texto", () => {
    const reading = parseToledoLine(Buffer.from("I      000015200kg", "binary"));
    expect(reading?.stable).toBe(false);
    expect(reading?.statusFlags.inMotion).toBe(true);
  });

  it("converte toneladas para kg", () => {
    const reading = parseToledoLine(Buffer.from("0000000  11,73 t", "binary"));
    expect(reading?.weightKg).toBeCloseTo(11_730, 0);
    expect(reading?.unit).toBe("t");
  });

  it("peso negativo no texto vira flag negative (nao cai no fallback positivo)", () => {
    const reading = parseToledoLine(Buffer.from("0000000  -00120kg", "binary"));
    expect(reading?.weightKg).toBe(-120);
    expect(reading?.statusFlags.negative).toBe(true);
  });
});

describe("captura real do indicador Toledo da pedreira (porta 9001)", () => {
  // Bytes exatos capturados no campo com a balanca vazia. O quadro tem 18 bytes:
  // STX + SWA + SWB + SWC + 6 digitos de peso + 6 de tara + CR + checksum.
  const FRAME_HEX = "022970603030303030303030303030300db8";

  it("interpreta o quadro capturado", () => {
    const frame = Buffer.from(FRAME_HEX, "hex");
    // O adaptador quebra o stream em CR/LF, entao o parser recebe a linha sem
    // o CR final e sem o checksum, que fica grudado na linha seguinte.
    const line = frame.subarray(0, frame.indexOf(0x0d));

    const reading = parseToledoLine(line);

    expect(reading).not.toBeNull();
    expect(reading?.weightKg).toBe(0);
    expect(reading?.unit).toBe("kg");
    expect(reading?.stable).toBe(true);
    expect(reading?.statusFlags.inMotion).toBe(false);
    expect(reading?.statusFlags.isGross).toBe(true);
    expect(reading?.statusFlags.outOfRange).toBe(false);
  });

  it("descarta o checksum que o split de linhas gruda no quadro seguinte", () => {
    // Dois quadros consecutivos, como chegam no socket: o byte de checksum do
    // primeiro (0xb8) antecede o STX do segundo.
    const stream = Buffer.from(FRAME_HEX + FRAME_HEX, "hex");
    const lines: Buffer[] = [];
    let start = 0;
    for (let i = 0; i < stream.length; i++) {
      if (stream[i] === 0x0d) {
        lines.push(stream.subarray(start, i));
        start = i + 1;
      }
    }

    expect(lines).toHaveLength(2);
    // A segunda linha comeca com o checksum do quadro anterior.
    expect(lines[1]?.[0]).toBe(0xb8);

    for (const line of lines) {
      const reading = parseToledoLine(line);
      expect(reading).not.toBeNull();
      expect(reading?.weightKg).toBe(0);
    }
  });

  it("interpreta peso real usando os mesmos status words do campo", () => {
    // Mesmos SWA/SWB/SWC capturados, com 15.200 kg no lugar dos zeros.
    const frame = Buffer.from([
      0x02, 0x29, 0x70, 0x60,
      ...Buffer.from("015200", "ascii"),
      ...Buffer.from("000000", "ascii")
    ]);

    const reading = parseToledoLine(frame);

    expect(reading?.weightKg).toBe(15_200);
    expect(reading?.unit).toBe("kg");
    expect(reading?.stable).toBe(true);
  });
});
