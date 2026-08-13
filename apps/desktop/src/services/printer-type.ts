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
