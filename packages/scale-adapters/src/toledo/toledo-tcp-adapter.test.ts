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

describe("toledo-tcp-adapter leitura vencida", () => {
  let server: ReturnType<typeof createServer> | null = null;
  let port = 0;
  /** Quantos quadros o servidor envia antes de silenciar mantendo o socket aberto. */
  let framesBeforeSilence = 2;

  beforeEach(async () => {
    server = createServer((socket) => {
      let sent = 0;
      const interval = setInterval(() => {
        if (sent >= framesBeforeSilence) {
          // Silencia sem fechar: reproduz o indicador que para de transmitir com o
          // socket ainda aberto — foi assim que o peso ficou congelado na tela.
          clearInterval(interval);
          return;
        }
        sent++;
        socket.write("       000015200kg\r\n");
      }, 50);
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

  it("nao devolve o peso antigo quando o indicador para de transmitir", async () => {
    framesBeforeSilence = 2;
    const adapter = createToledoTcpAdapter();
    await adapter.connect({ host: "127.0.0.1", port, staleReadingMs: 300 });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await adapter.read()).weightKg).toBe(15_200);

    await new Promise((resolve) => setTimeout(resolve, 400));

    await expect(adapter.read()).rejects.toThrow(
      /sem leitura recente|nao esta conectada|nenhuma leitura disponivel/i
    );
    expect(adapter.getStatus().lastReading).toBeNull();
    adapter.disconnect();
  });

  it("marca o status como vencido em vez de manter o peso na tela", async () => {
    framesBeforeSilence = 1;
    const adapter = createToledoTcpAdapter();
    await adapter.connect({
      host: "127.0.0.1",
      port,
      staleReadingMs: 250,
      maxReconnectAttempts: 0
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const status = adapter.getStatus();
    expect(status.stale).toBe(true);
    expect(status.lastReading).toBeNull();
    adapter.disconnect();
  });

  it("distingue lixo no protocolo de indicador mudo", async () => {
    framesBeforeSilence = 0;
    const garbage = createServer((socket) => {
      // Bytes contínuos que o parser Toledo rejeita — sintoma de baud rate divergente
      // no conversor. Antes isso era indistinguivel de um indicador que nao envia nada.
      const interval = setInterval(() => socket.write("\xff\xfe\x01lixo"), 50);
      socket.on("close", () => clearInterval(interval));
      socket.on("error", () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => garbage.listen(0, "127.0.0.1", resolve));
    const garbagePort = (garbage.address() as AddressInfo).port;

    const adapter = createToledoTcpAdapter();
    await adapter.connect({
      host: "127.0.0.1",
      port: garbagePort,
      staleReadingMs: 300,
      autoPoll: false
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const status = adapter.getStatus();
    expect(status.receivingRawData).toBe(true);
    expect(status.stale).toBe(true);
    expect(status.lastReading).toBeNull();
    expect(status.errorMessage).toMatch(/baud/i);
    expect(status.lastRawSample).toBeTruthy();

    adapter.disconnect();
    await new Promise<void>((resolve) => garbage.close(() => resolve()));
  });

  it("sonda o indicador que so responde sob demanda", async () => {
    framesBeforeSilence = 0;
    // Servidor mudo até receber um comando: reproduz indicador em modo sob demanda,
    // que do lado do cliente e identico a um indicador desligado.
    const onDemand = createServer((socket) => {
      socket.on("data", () => socket.write("       000012500kg\r\n"));
    });
    await new Promise<void>((resolve) => onDemand.listen(0, "127.0.0.1", resolve));
    const onDemandPort = (onDemand.address() as AddressInfo).port;

    const adapter = createToledoTcpAdapter();
    await adapter.connect({
      host: "127.0.0.1",
      port: onDemandPort,
      staleReadingMs: 3000,
      pollIntervalMs: 100
    });

    await new Promise((resolve) => setTimeout(resolve, 600));

    const reading = await adapter.read();
    expect(reading.weightKg).toBe(12_500);

    adapter.disconnect();
    await new Promise<void>((resolve) => onDemand.close(() => resolve()));
  });

  it("descarta a leitura da sessao anterior ao desconectar", async () => {
    framesBeforeSilence = 5;
    const adapter = createToledoTcpAdapter();
    await adapter.connect({ host: "127.0.0.1", port });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(adapter.getStatus().lastReading).not.toBeNull();

    adapter.disconnect();

    expect(adapter.getStatus().lastReading).toBeNull();
    expect(adapter.getStatus().stale).toBe(true);
  });
});
