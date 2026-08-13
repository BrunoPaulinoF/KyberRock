import {
  DEFAULT_RECEIPT_STYLE,
  receiptBodyStartIndex,
  receiptEscPosLayout
} from "@kyberrock/print-templates";

import { encodeEscPos, type EscPosRasterImage } from "./escpos-encoder.js";
import { maxLogoWidthDots } from "./receipt-logo-raster.js";
import type { ReceiptLogoConfig, ReceiptPrintPayload } from "./printing.js";

/**
 * Converte a logo configurada (data URL) na imagem monocromatica que a impressora entende.
 * A decodificacao da imagem depende do Electron (`nativeImage`), entao entra por injecao para
 * manter estes servicos livres de dependencia do processo principal.
 */
export type ReceiptLogoRasterizer = (
  logo: ReceiptLogoConfig,
  maxWidthPx: number
) => EscPosRasterImage | null;

/**
 * Bytes do cupom para uma impressora ESC/POS — os MESMOS para a impressora de rede e para a
 * impressora do Windows em modo RAW. Estar num lugar so e o que garante que trocar o meio de
 * envio (TCP/IP ou fila do Windows) nao muda uma virgula do que sai no papel.
 */
export function buildReceiptEscPosData(
  payload: ReceiptPrintPayload,
  rasterizeLogo: ReceiptLogoRasterizer | null
): Buffer {
  // A aparencia escolhida na tela (fonte, corpo, entrelinha, negrito, alinhamento da logo)
  // vira comando da impressora aqui: `receiptEscPosLayout` faz a traducao, e a previa da tela
  // le a MESMA traducao. Sem isso a personalizacao existia so no caminho grafico.
  const layout = receiptEscPosLayout(
    payload.snapshot.style ?? DEFAULT_RECEIPT_STYLE,
    payload.paperWidthMm
  );

  return encodeEscPos(
    payload.lines,
    payload.paperWidthMm,
    buildReceiptEscPosLogo(payload, rasterizeLogo),
    layout,
    receiptBodyStartIndex(payload.snapshot)
  );
}

/** Uma logo invalida nunca pode impedir a impressao do cupom — no pior caso sai sem ela. */
export function buildReceiptEscPosLogo(
  payload: ReceiptPrintPayload,
  rasterizeLogo: ReceiptLogoRasterizer | null
): EscPosRasterImage | null {
  const logo = payload.snapshot.receiptLogo;

  // "Imprimir a logo" desligado na personalizacao vale para todas as impressoras.
  if (payload.snapshot.style?.showLogo === false) {
    return null;
  }

  if (!rasterizeLogo || !logo?.dataUrl) {
    return null;
  }

  try {
    return rasterizeLogo(logo, maxLogoWidthDots(payload.paperWidthMm));
  } catch {
    return null;
  }
}
