import { createServer, type AddressInfo, type Server } from "node:net";
import { describe, expect, it } from "vitest";

import { NetworkEscPosPrinter } from "./network-printer";
import type { EscPosRasterImage } from "./escpos-encoder";
import type { ReceiptPrintPayload } from "./printing";

/** GS v 0: comando de bit image que carrega a logo no cupom ESC/POS. */
const RASTER_COMMAND = Buffer.from([0x1d, 0x76, 0x30, 0x00]);

function startCapturingPrinter(): Promise<{
  port: number;
  received: Promise<Buffer>;
  close: () => void;
}> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let resolveReceived: (data: Buffer) => void;
    const received = new Promise<Buffer>((done) => {
      resolveReceived = done;
    });

    const server: Server = createServer((socket) => {
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolveReceived(Buffer.concat(chunks)));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        received,
        close: () => server.close()
      });
    });
  });
}

function buildPayload(showLogo: boolean, port: number): ReceiptPrintPayload {
  return {
    printerName: `127.0.0.1:${port}`,
    printerType: "network",
    networkHost: "127.0.0.1",
    networkPort: port,
    paperWidthMm: 80,
    lines: ["CUPOM"],
    contentText: "CUPOM",
    snapshot: {
      receiptLogo: {
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        widthMm: 24,
        heightMm: 16,
        fit: "contain"
      },
      style: { showLogo }
    } as unknown as ReceiptPrintPayload["snapshot"]
  };
}

const logo: EscPosRasterImage = {
  widthPx: 16,
  heightPx: 8,
  bits: Buffer.alloc(2 * 8, 0xff)
};

describe("NetworkEscPosPrinter", () => {
  it("sends the logo as a bit image before the receipt text", async () => {
    const printer = await startCapturingPrinter();

    try {
      await new NetworkEscPosPrinter({
        host: "127.0.0.1",
        port: printer.port,
        rasterizeLogo: () => logo
      }).printReceipt(buildPayload(true, printer.port));

      const data = await printer.received;
      expect(data.includes(RASTER_COMMAND)).toBe(true);
      expect(data.indexOf(RASTER_COMMAND)).toBeLessThan(data.indexOf(Buffer.from("CUPOM")));
    } finally {
      printer.close();
    }
  });

  it("respects the 'imprimir a logo' switch, like the Windows receipt does", async () => {
    // O interruptor da personalizacao so valia para o HTML: a impressora de rede
    // imprimia a logo mesmo com a opcao desligada.
    const printer = await startCapturingPrinter();

    try {
      await new NetworkEscPosPrinter({
        host: "127.0.0.1",
        port: printer.port,
        rasterizeLogo: () => logo
      }).printReceipt(buildPayload(false, printer.port));

      const data = await printer.received;
      expect(data.includes(RASTER_COMMAND)).toBe(false);
      expect(data.includes(Buffer.from("CUPOM"))).toBe(true);
    } finally {
      printer.close();
    }
  });
});
