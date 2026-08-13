import { buildReceiptEscPosData, type ReceiptLogoRasterizer } from "./escpos-receipt.js";
import type { ReceiptPrintPayload, ReceiptPrinter } from "./printing.js";

/**
 * Envia bytes crus para uma fila de impressao do Windows (datatype RAW). O envio de verdade
 * mora no processo principal (depende do Windows); entra por injecao para este servico ficar
 * testavel e livre de dependencia de sistema operacional.
 */
export type RawSpoolSender = (
  printerName: string,
  data: Buffer,
  documentName: string
) => Promise<void>;

export interface WindowsRawPrinterConfig {
  sendRaw: RawSpoolSender;
  rasterizeLogo?: ReceiptLogoRasterizer;
}

/**
 * Impressora do Windows recebendo ESC/POS pronto, sem passar pelo desenho do driver.
 *
 * ## Por que este caminho existe
 *
 * A impressora termica de cupom (Bematech MP-4200 TH, Elgin, Epson TM...) e nativamente
 * ESC/POS: ela sabe imprimir texto em 48 colunas, centralizar uma linha e marcar uma imagem
 * de 1 bit. O caminho `windows` faz o oposto disso — monta o cupom em HTML, manda o Chromium
 * desenhar uma PAGINA e entrega essa pagina ao driver, que decide sozinho o tamanho do papel,
 * onde fica o que e centralizado e como transformar a logo em pontos. Cada uma dessas
 * decisoes e do driver, nao nossa, e e ai que o cabecalho do cupom (a logo, o `COD`, o
 * `COPIA NRO`, a data/hora) se perdia no papel enquanto aparecia perfeito na previa: o corpo,
 * alinhado a esquerda, sobrevivia; o cabecalho, nao.
 *
 * Aqui nao ha nada para o driver decidir. Sao os MESMOS bytes que a impressora de rede ja
 * recebia (`buildReceiptEscPosData`), entregues na fila do Windows em modo RAW: a impressora
 * imprime exatamente o cupom que montamos — cabecalho, numero, logo e telefone incluidos.
 */
export class WindowsRawEscPosPrinter implements ReceiptPrinter {
  private readonly sendRaw: RawSpoolSender;
  private readonly rasterizeLogo: ReceiptLogoRasterizer | null;

  constructor(config: WindowsRawPrinterConfig) {
    this.sendRaw = config.sendRaw;
    this.rasterizeLogo = config.rasterizeLogo ?? null;
  }

  async printReceipt(payload: ReceiptPrintPayload): Promise<void> {
    const printerName = payload.printerName.trim();

    if (!printerName) {
      throw new Error("Impressora do Windows nao configurada.");
    }

    const data = buildReceiptEscPosData(payload, this.rasterizeLogo);

    await this.sendRaw(printerName, data, receiptDocumentName(payload));
  }
}

/**
 * Nome que aparece na fila de impressao do Windows. Leva o numero do cupom para o operador
 * conseguir identificar (e cancelar) um trabalho especifico quando a impressora empaca.
 */
export function receiptDocumentName(payload: ReceiptPrintPayload): string {
  const receiptNumber = payload.snapshot.header?.receiptNumberLabel;
  return receiptNumber ? `KyberRock cupom ${receiptNumber}` : "KyberRock cupom";
}
