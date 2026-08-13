import { createConnection, type Socket } from "node:net";

import { receiptHighlightLines } from "@kyberrock/print-templates";

import { encodeEscPos, type EscPosRasterImage } from "./escpos-encoder.js";
import { maxLogoWidthDots } from "./receipt-logo-raster.js";
import type { ReceiptLogoConfig, ReceiptPrintPayload, ReceiptPrinter } from "./printing.js";

/**
 * Converte a logo configurada (data URL) na imagem monocromatica que a impressora entende.
 * A decodificacao da imagem depende do Electron (`nativeImage`), entao entra por injecao para
 * manter este servico livre de dependencia do processo principal.
 */
export type ReceiptLogoRasterizer = (
  logo: ReceiptLogoConfig,
  maxWidthPx: number
) => EscPosRasterImage | null;

export interface NetworkPrinterConfig {
  host: string;
  port: number;
  timeoutMs?: number;
  rasterizeLogo?: ReceiptLogoRasterizer;
}

export class NetworkEscPosPrinter implements ReceiptPrinter {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly rasterizeLogo: ReceiptLogoRasterizer | null;

  constructor(config: NetworkPrinterConfig) {
    this.host = config.host.trim();
    this.port = config.port;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.rasterizeLogo = config.rasterizeLogo ?? null;
  }

  async printReceipt(payload: ReceiptPrintPayload): Promise<void> {
    if (!this.host) {
      throw new Error("Host da impressora de rede nao configurado.");
    }

    const data = encodeEscPos(payload.lines, payload.paperWidthMm, this.buildLogo(payload), {
      // O codigo e o numero do cupom saem em corpo dobrado nas duas termicas (rede e USB):
      // o cupom impresso pelas duas maquinas tem que ser o mesmo papel.
      emphasizedLines: receiptHighlightLines(payload.snapshot.header)
    });

    await new Promise<void>((resolve, reject) => {
      const socket: Socket = createConnection({ host: this.host, port: this.port });

      // Um unico deadline cobre TODA a operacao (conectar + enviar + finalizar). Antes o timer
      // era limpo no evento "connect", entao uma impressora que aceitava o TCP mas travava sem
      // consumir/confirmar o write/end deixava a Promise pendente para sempre — o IPC de
      // impressao nunca resolvia e o botao ficava "imprimindo" indefinidamente.
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        finish(new Error(`Timeout ao comunicar com a impressora ${this.host}:${this.port}.`));
      }, this.timeoutMs);

      socket.on("error", (err: NodeJS.ErrnoException) => {
        finish(new Error(`Erro ao imprimir na rede (${this.host}:${this.port}): ${err.message}.`));
      });

      socket.on("connect", () => {
        socket.write(data, (writeErr) => {
          if (writeErr) {
            finish(new Error(`Erro ao enviar dados para a impressora: ${writeErr.message}.`));
            return;
          }
          socket.end(() => finish());
        });
      });
    });
  }

  /** Uma logo invalida nunca pode impedir a impressao do cupom — no pior caso sai sem ela. */
  private buildLogo(payload: ReceiptPrintPayload): EscPosRasterImage | null {
    const logo = payload.snapshot.receiptLogo;

    // "Imprimir a logo" desligado na personalizacao vale para as duas impressoras: antes
    // so o HTML (impressora do Windows) respeitava a escolha.
    if (payload.snapshot.style?.showLogo === false) {
      return null;
    }

    if (!this.rasterizeLogo || !logo?.dataUrl) {
      return null;
    }

    try {
      return this.rasterizeLogo(logo, maxLogoWidthDots(payload.paperWidthMm));
    } catch {
      return null;
    }
  }
}
