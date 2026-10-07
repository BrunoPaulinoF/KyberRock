/**
 * Tipo de impressora do cupom, isolado de `printing.ts` porque a TELA tambem precisa dele:
 * `printing.ts` importa `node:crypto` e o banco, coisas que nao existem no renderer. Aqui so
 * mora a classificacao — sem dependencia de sistema, sem banco.
 *
 * - `windows`: a impressora do Windows recebe o cupom em HTML e QUEM DESENHA e o driver.
 *   Serve para impressora comum (laser/jato), mas deixa na mao do driver o tamanho de pagina,
 *   a posicao do que e centralizado e a conversao da logo em pontos.
 * - `windows_escpos`: a MESMA impressora do Windows, recebendo os bytes ESC/POS prontos pela
 *   fila em modo RAW. E o formato nativo da termica de cupom (Bematech MP-4200, Elgin,
 *   Epson TM...), o mesmo que a impressora de rede ja recebia.
 * - `network`: os mesmos bytes ESC/POS, por TCP/IP (porta 9100).
 */
export type PrinterType = "windows" | "windows_escpos" | "network";

/** A impressora recebe ESC/POS pronto, sem depender do desenho do driver do Windows. */
export function printerTypeUsesEscPos(printerType: PrinterType): boolean {
  return printerType === "network" || printerType === "windows_escpos";
}

/** A impressora e uma fila do Windows (pelo driver grafico ou por RAW). */
export function printerTypeUsesWindowsQueue(printerType: PrinterType): boolean {
  return printerType === "windows" || printerType === "windows_escpos";
}

export function normalizePrinterType(value: unknown): PrinterType {
  return value === "network" || value === "windows_escpos" ? value : "windows";
}

/**
 * Marcas e modelos de termica de cupom que falam ESC/POS, reconhecidos pelo NOME da fila do
 * Windows (o que o operador ve na lista). De proposito estreito: "EPSON" sozinho tambem e a
 * jato de tinta (L3150), entao da Epson so a linha TM; Daruma fica de fora porque o comando
 * padrao dela nao e ESC/POS.
 */
const RECEIPT_THERMAL_PRINTER_NAME_PATTERNS: readonly RegExp[] = [
  /bematech/,
  /\bmp-?\s?\d{3,4}/, // Bematech MP-4200 TH/HS, MP-2800, MP-100S
  /\belgin\b/,
  /\btm-?\s?[a-z]?\d{2}/, // Epson TM-T20, TM-T88, TM-m30
  /\btanca\b/,
  /\b(control\s?id|print\s?id)\b/,
  /\b(pos|xp)-?\s?(58|80)/, // genericas: POS-80, XP-58
  /termica|thermal|receipt|cupom/
];

/**
 * A fila do Windows e de uma termica de cupom. Serve para a tela de impressao nao deixar uma
 * termica no modo grafico: ali o driver desenha o cupom como PAGINA, em faixas, e ha termica
 * que avanca o papel um pouco a mais entre uma faixa e outra — a linha de texto que cai nessa
 * emenda sai partida ao meio (07/10/2026, Bematech MP-4200 HS: uma faixa branca a cada ~12 mm
 * atravessando o cupom). Isso nao tem conserto no HTML; no texto direto a impressora escreve
 * com a fonte dela e a emenda nunca corta letra.
 */
export function looksLikeReceiptThermalPrinter(printerName: string | null | undefined): boolean {
  const name = (printerName ?? "").trim().toLowerCase();
  if (!name) return false;
  return RECEIPT_THERMAL_PRINTER_NAME_PATTERNS.some((pattern) => pattern.test(name));
}
