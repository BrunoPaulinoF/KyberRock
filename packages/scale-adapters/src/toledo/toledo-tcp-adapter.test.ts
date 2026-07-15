import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

import { createToledoTcpAdapter } from "./toledo-tcp-adapter";

describe("toledo-tcp-adapter readSampled", () => {
  let server: ReturnType<typeof createServer> | null = null;
  let port = 0;
  let readings: string[] = [];

  beforeEach(async () => {
    readings = ["       000015200kg"];
    server = createServer((socket) => {
      const start = Date.now();
      let index = 0;
      const interval = setInterval(() => {
        if (Date.now() - start > 6000) {
          clearInterval(interval);
          socket.end();
          return;
        }
        const line = readings[Math.min(index, readings.length - 1)] ?? readings[0] ?? "";
        index++;
        socket.write(`${line}\r\n`);
      }, 200);
      socket.on("close", () => clearInterval(interval));
      socket.on("error", () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    port = (server!.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  it("returns a stable protocol reading without calculating a mean", async () => {
    // Repete a primeira leitura: o servidor avanca a cada 200ms mesmo antes de o
    // adapter amostrar, e sob carga a primeira amostra observada pulava para a
    // segunda leitura (flake). Uma media com o 18400 na janela ainda falharia.
    readings = [
      "       000015200kg",
      "       000015200kg",
      "       000015200kg",
      "       000018400kg"
    ];
    const adapter = createToledoTcpAdapter();
    await adapter.connect({ host: "127.0.0.1", port });

    const reading = await adapter.readSampled({ durationMs: 1000, sampleIntervalMs: 200 });

    expect(reading.weightKg).toBe(15_200);
    expect(reading.unit).toBe("kg");
    expect(reading.status).toBe("stable");
    adapter.disconnect();
  });

  it("does not average the last stable window", async () => {
    readings = ["       000015000kg", "       000017000kg"];
    const adapter = createToledoTcpAdapter();
    await adapter.connect({ host: "127.0.0.1", port });

    const reading = await adapter.readSampled({
      durationMs: 3000,
      sampleIntervalMs: 200,
      minStableMs: 800,
      maxVariationKg: 100
    });

    expect(reading.weightKg).toBe(17_000);
    adapter.disconnect();
  });

  it("requires the trailing stable window when configured", async () => {
    readings = ["I      000015200kg"];
    const adapter = createToledoTcpAdapter();
    await adapter.connect({ host: "127.0.0.1", port });

    await expect(
      adapter.readSampled({ durationMs: 1000, sampleIntervalMs: 200, minStableMs: 500 })
    ).rejects.toThrow("Peso instavel");
    adapter.disconnect();
  });
});
