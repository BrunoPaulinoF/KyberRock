import { createConnection, type Socket } from "node:net";

import { encodeEscPos } from "./escpos-encoder.js";
import type { ReceiptPrintPayload, ReceiptPrinter } from "./printing.js";

export interface NetworkPrinterConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

export class NetworkEscPosPrinter implements ReceiptPrinter {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: NetworkPrinterConfig) {
    this.host = config.host.trim();
    this.port = config.port;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async printReceipt(payload: ReceiptPrintPayload): Promise<void> {
    if (!this.host) {
      throw new Error("Host da impressora de rede nao configurado.");
    }

    const data = encodeEscPos(payload.lines, payload.paperWidthMm);

    await new Promise<void>((resolve, reject) => {
      const socket: Socket = createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timeout ao conectar com a impressora ${this.host}:${this.port}.`));
      }, this.timeoutMs);

      socket.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Erro ao imprimir na rede (${this.host}:${this.port}): ${err.message}.`));
      });

      socket.on("connect", () => {
        clearTimeout(timer);
        socket.write(data, (writeErr) => {
          if (writeErr) {
            socket.destroy();
            reject(new Error(`Erro ao enviar dados para a impressora: ${writeErr.message}.`));
            return;
          }
          socket.end(() => resolve());
        });
      });
    });
  }
}
