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
 * Familias de impressora TERMICA de cupom, reconhecidas pelo nome da fila do Windows.
 *
 * Reconhecer o modelo pelo nome e heuristica, e por isso ela so serve para AVISAR — nunca
 * para bloquear ou trocar a escolha do operador. Uma pedreira ficou parada exatamente aqui:
 * o perfil estava no modo grafico, a MP-4200 TH aceitava o cupom e nao imprimia NADA, e as
 * outras impressoras do mesmo Windows imprimiam normal (sao de pagina — desenhar pagina e o
 * que elas fazem). Sem erro em lugar nenhum, o operador reimprimiu ate queimar seis numeros
 * de cupom.
 *
 * O modo grafico e o PADRAO em todo lugar (schema, `normalizePrinterType` e o estado inicial
 * do formulario), entao um perfil recriado ou salvo sem escolher o tipo cai nele calado. Numa
 * termica esse e o caminho errado: quem desenha vira o driver, e o que ele nao souber
 * desenhar nao sai.
 */
const THERMAL_RECEIPT_PRINTER_PATTERNS = [
  // Sem `\b` no fim de proposito: a fila costuma vir colada ao sufixo do modelo
  // ("MP4200TH"), e exigir fronteira ali deixava justamente a impressora do caso real de fora.
  /\bmp-?\s?\d{4}/i, // Bematech MP-4200, MP-4000, MP-2800...
  /\bbematech\b/i,
  /\belgin\b/i,
  /\b(i9|i7)\b/i, // Elgin i9 / i7
  /\bepson\b.*\btm\b|\btm-?[tpu]\d/i, // Epson TM-T20, TM-T88...
  /\bdaruma\b|\bdr-?\s?\d{3}\b/i,
  /\btanca\b/i,
  /\bsweda\b/i,
  /\bcontrol\s?id\b/i,
  /\bpos-?\s?\d{2}\b/i, // POS-58 / POS-80 genericas
  /\btermica\b|\bthermal\b/i,
  /\bcupom\b|\breceipt\b/i
];

/**
 * O nome da fila parece ser de uma termica de cupom?
 *
 * Serve para a tela avisar quando o modo grafico foi escolhido para uma impressora que
 * quase certamente precisa de ESC/POS. Falso negativo e barato (o aviso nao aparece, como
 * hoje); falso positivo tambem (um aviso a mais numa impressora comum), e por isso a lista
 * fica no lado conservador em vez de tentar adivinhar todo modelo do mercado.
 */
export function looksLikeThermalReceiptPrinter(printerName: string | null | undefined): boolean {
  const name = (printerName ?? "").trim();
  if (!name) return false;
  return THERMAL_RECEIPT_PRINTER_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Aviso para o formulario de impressao; `null` quando nao ha o que avisar.
 *
 * So fala no caso que ja custou caro: termica no modo grafico. Termica em ESC/POS, impressora
 * comum em qualquer modo e nome que nao da para reconhecer ficam em silencio.
 */
export function describePrinterTypeMismatch(
  printerType: PrinterType,
  printerName: string | null | undefined
): string | null {
  if (printerType !== "windows") return null;
  if (!looksLikeThermalReceiptPrinter(printerName)) return null;

  return `"${(printerName ?? "").trim()}" parece uma impressora termica de cupom, e o modo grafico deixa o desenho por conta do driver — nessas impressoras o cupom costuma sair incompleto ou nao sair. Troque para "texto direto (ESC/POS)".`;
}
