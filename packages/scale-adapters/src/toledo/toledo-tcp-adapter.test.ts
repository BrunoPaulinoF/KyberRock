import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";

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

describe("toledo-tcp-adapter reconexao sem desistir", () => {
  /** Espera uma condicao ficar verdadeira, com teto de tempo para nao travar a suite. */
  async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return check();
  }

  it("continua tentando e reconecta sozinha quando o indicador volta ao ar", async () => {
    // Caminho principal da operacao: balanca por IP. O indicador cai (queda de
    // energia, PC ligado antes da rede) e volta minutos depois. Com o limite antigo
    // de 10 tentativas o adaptador ja teria desistido em definitivo, e a balanca so
    // voltaria com o operador clicando em "Reconectar balanca".
    const idle = createServer();
    await new Promise<void>((resolve) => idle.listen(0, "127.0.0.1", resolve));
    const port = (idle.address() as AddressInfo).port;
    // Libera a porta: as proximas conexoes sao recusadas, como um indicador fora do ar.
    await new Promise<void>((resolve) => idle.close(() => resolve()));

    const adapter = createToledoTcpAdapter();
    await expect(
      adapter.connect({
        host: "127.0.0.1",
        port,
        timeoutMs: 200,
        reconnectIntervalMs: 30,
        reconnectBackoffMaxMs: 60,
        maxReconnectAttempts: Number.POSITIVE_INFINITY,
        autoPoll: false
      })
    ).rejects.toThrow();

    // Passa folgadamente do ponto em que o limite antigo (10) teria zerado o app.
    const passouDoLimiteAntigo = await waitFor(
      () => adapter.getStatus().reconnectAttempts > 12,
      4000
    );
    expect(passouDoLimiteAntigo).toBe(true);
    expect(adapter.getStatus().state).not.toBe("error");

    // O indicador volta ao ar, sem ninguem tocar no app.
    const scale = createServer((socket) => {
      const interval = setInterval(() => socket.write("       000015200kg\r\n"), 30);
      socket.on("close", () => clearInterval(interval));
      socket.on("error", () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => scale.listen(port, "127.0.0.1", resolve));

    const voltou = await waitFor(() => adapter.getStatus().state === "connected", 4000);
    expect(voltou).toBe(true);

    const leituraVoltou = await waitFor(() => adapter.getStatus().lastReading !== null, 2000);
    expect(leituraVoltou).toBe(true);

    adapter.disconnect();
    await new Promise<void>((resolve) => scale.close(() => resolve()));
  }, 20_000);
});

describe("toledo-tcp-adapter conexao derrubada por erro", () => {
  /** Servidor que transmite quadros e depois derruba a conexao com RST. */
  async function startResettingServer(): Promise<{
    port: number;
    reset: () => void;
    close: () => Promise<void>;
  }> {
    let live: Socket | null = null;
    const server = createServer((socket) => {
      live = socket;
      const interval = setInterval(() => socket.write("       000015200kg\r\n"), 50);
      socket.on("close", () => clearInterval(interval));
      socket.on("error", () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as AddressInfo).port,
      // RST em vez de FIN: e o caminho que cai no handler de erro do socket, onde a
      // sessao morta continuava viva entregando leituras.
      reset: () => live?.resetAndDestroy(),
      close: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
  }

  it("cala a sessao derrubada por RST em vez de deixa-la entregando leituras", async () => {
    // Contrato que a tela depende: enquanto o status disser "conectada" pode haver
    // peso ao vivo, mas depois de uma queda nenhum quadro novo pode escapar da
    // sessao morta — senao a tela mostra peso de uma conexao que ja nao existe.
    const scale = await startResettingServer();
    const adapter = createToledoTcpAdapter();
    await adapter.connect({
      host: "127.0.0.1",
      port: scale.port,
      staleReadingMs: 3000,
      // Reconexao longa: o teste observa a janela em que a sessao antiga ficava viva.
      reconnectIntervalMs: 60_000,
      maxReconnectAttempts: 1
    });

    const seen: number[] = [];
    adapter.onReading((reading) => seen.push(reading.weightKg));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(adapter.getStatus().state).toBe("connected");
    expect(seen.length).toBeGreaterThan(0);

    scale.reset();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(adapter.getStatus().state).not.toBe("connected");
    const readingsAtDrop = seen.length;

    await new Promise((resolve) => setTimeout(resolve, 300));
    // Nenhum quadro novo depois da queda: sem isto a tela mostrava peso ao vivo de
    // uma conexao que o proprio adaptador ja dava por perdida.
    expect(seen.length).toBe(readingsAtDrop);
    expect(adapter.getStatus().lastReading).toBeNull();

    adapter.disconnect();
    await scale.close();
  });
});
