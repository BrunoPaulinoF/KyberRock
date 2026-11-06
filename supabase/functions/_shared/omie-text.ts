/**
 * Conserta texto "embaralhado" que chega do OMIE ("RachÃ£o" no lugar de "Rachão",
 * "PÃ³ de Pedra" no lugar de "Pó de Pedra").
 *
 * O defeito e conhecido: o texto foi gravado em UTF-8 e, em algum ponto antes de
 * chegar aqui (importacao de planilha ou de XML de fornecedor no OMIE), foi lido
 * como Windows-1252 e salvo de novo. Cada letra acentuada vira DUAS: "ã" (bytes
 * C3 A3) aparece como "Ã" + "£". Em 06/11/2026 o Rachão e o Pó de Pedra da
 * Pedreira Ibiuna chegaram assim e foram para a tela de Nova entrada.
 *
 * O conserto desfaz so o trecho embaralhado: cada sequencia que forma um caractere
 * UTF-8 valido quando lida de volta como bytes Windows-1252. O resto do texto fica
 * como esta, entao um nome que mistura acento certo com acento quebrado tambem se
 * conserta, e um nome correto nunca muda.
 *
 * Este arquivo tem copia identica em `supabase/functions/_shared/omie-text.ts`
 * (sem import nenhum, para rodar no Deno): corrigiu aqui, copie la.
 */

// Windows-1252 nos bytes 0x80-0x9F: o caractere que aparece -> o byte original.
const CP1252_SPECIAL_TO_BYTE: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f
};

// Caractere que, lido como Windows-1252, vem de um byte de continuacao UTF-8 (0x80-0xBF).
const CONTINUATION =
  "[\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178]";

const MOJIBAKE_SEQUENCE = new RegExp(
  `[\\u00C2-\\u00DF]${CONTINUATION}|[\\u00E0-\\u00EF]${CONTINUATION}{2}|[\\u00F0-\\u00F4]${CONTINUATION}{3}`,
  "g"
);

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function toCp1252Byte(char: string): number | null {
  const code = char.charCodeAt(0);
  if (code <= 0xff) return code;
  return CP1252_SPECIAL_TO_BYTE[char] ?? null;
}

function decodeSequence(sequence: string): string {
  const bytes: number[] = [];
  for (const char of sequence) {
    const byte = toCp1252Byte(char);
    if (byte === null) return sequence;
    bytes.push(byte);
  }
  try {
    return utf8Decoder.decode(new Uint8Array(bytes));
  } catch {
    return sequence;
  }
}

export function repairMojibake(value: string): string;
export function repairMojibake(value: string | null): string | null;
export function repairMojibake(value: string | undefined): string | undefined;
export function repairMojibake(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  // Sem "Ã", "Â" e companhia nao ha o que consertar: o caso comum sai sem regex.
  if (!/[Â-ô]/.test(value)) return value;
  return value.replace(MOJIBAKE_SEQUENCE, decodeSequence);
}
