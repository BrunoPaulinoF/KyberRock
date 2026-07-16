import { describe, expect, it, vi } from "vitest";

import { createToledoSerialAdapter } from "./toledo-serial-adapter.js";
import type { SerialTransport, SerialTransportFactory } from "./toledo-serial-adapter.js";

interface FakeTransport extends SerialTransport {
  emitData(text: string): void;
  emitError(error: Error): void;
  emitClose(): void;
  closeCount: number;
}

function createFakeTransport(openError: Error | null): FakeTransport {
  let dataCallback: ((chunk: Uint8Array) => void) | null = null;
  let errorCallback: ((error: Error) => void) | null = null;
  let closeCallback: (() => void) | null = null;

  const transport: FakeTransport = {
    closeCount: 0,
    async open() {
      if (openError) throw openError;
    },
    close() {
      transport.closeCount += 1;
    },
    onData(callback) {
      dataCallback = callback;
    },
    onError(callback) {
      errorCallback = callback;
    },
    onClose(callback) {
      closeCallback = callback;
    },
    emitData(text: string) {
      dataCallback?.(Buffer.from(text, "binary"));
    },
    emitError(error: Error) {
      errorCallback?.(error);
    },
    emitClose() {
      closeCallback?.();
    }
  };

  return transport;
}

function createAdapterWithTransports(): {
  adapter: ReturnType<typeof createToledoSerialAdapter>;
  transports: FakeTransport[];
  /** Erros consumidos em ordem: cada novo transporte falha o open com o proximo da fila. */
  openFailures: Error[];
} {
  const transports: FakeTransport[] = [];
  const openFailures: Error[] = [];
  const factory: SerialTransportFactory = () => {
    const transport = createFakeTransport(openFailures.shift() ?? null);
    transports.push(transport);
    return transport;
  };
  return { adapter: createToledoSerialAdapter(factory), transports, openFailures };
}

describe("createToledoSerialAdapter", () => {
  it("connects, parses complete lines and exposes the latest reading", async () => {
    const { adapter, transports } = createAdapterWithTransports();

    await adapter.connect({ path: "COM3", baudRate: 9600 });
    expect(adapter.getStatus().state).toBe("connected");

    const seen: number[] = [];
    adapter.onReading((reading) => seen.push(reading.weightKg));

    transports[0]?.emitData("0000000  00012340k g\r\n");

    const reading = await adapter.read();
    expect(reading.weightKg).toBe(12_340);
    expect(reading.status).toBe("stable");
    expect(reading.adapterName).toBe("toledo-serial");
    expect(reading.deviceId).toBe("COM3");
    expect(seen).toEqual([12_340]);
  });

  it("buffers partial chunks until a line terminator arrives", async () => {
    const { adapter, transports } = createAdapterWithTransports();
    await adapter.connect({ path: "COM3", baudRate: 9600 });

    transports[0]?.emitData("0000000  000");
    await expect(adapter.read()).rejects.toThrow("Nenhuma leitura disponivel");

    transports[0]?.emitData("12340k g\r");
    const reading = await adapter.read();
    expect(reading.weightKg).toBe(12_340);
  });

  it("flags readings in motion as unstable", async () => {
    const { adapter, transports } = createAdapterWithTransports();
    await adapter.connect({ path: "COM3", baudRate: 9600 });

    transports[0]?.emitData("I0000000  00012340k g\r\n");
    const reading = await adapter.read();
    expect(reading.status).toBe("unstable");
    expect(reading.stable).toBe(false);
  });

  it("rejects read when disconnected", async () => {
    const { adapter } = createAdapterWithTransports();
    await expect(adapter.read()).rejects.toThrow("nao esta conectada");
  });

  it("propagates open failures and recovers on the scheduled reconnect", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, transports, openFailures } = createAdapterWithTransports();
      openFailures.push(new Error("Porta COM9 nao encontrada."));

      await expect(
        adapter.connect({
          path: "COM9",
          baudRate: 9600,
          reconnectIntervalMs: 100,
          maxReconnectAttempts: 2
        })
      ).rejects.toThrow("Porta COM9 nao encontrada.");
      // Ainda ha reconexao agendada, entao o estado fica "connecting"
      expect(adapter.getStatus().state).toBe("connecting");
      expect(adapter.getStatus().errorMessage).toContain("COM9");

      // A reconexao agendada cria um novo transporte, que abre com sucesso
      await vi.advanceTimersByTimeAsync(150);
      expect(transports.length).toBe(2);
      expect(adapter.getStatus().state).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects automatically when the port closes unexpectedly", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, transports } = createAdapterWithTransports();
      await adapter.connect({
        path: "COM3",
        baudRate: 9600,
        reconnectIntervalMs: 100,
        maxReconnectAttempts: 3
      });

      transports[0]?.emitClose();
      expect(adapter.getStatus().state).toBe("connecting");

      await vi.advanceTimersByTimeAsync(150);
      expect(transports.length).toBe(2);
      expect(adapter.getStatus().state).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reconnecting after the configured attempts and reports error", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, transports, openFailures } = createAdapterWithTransports();
      await adapter.connect({
        path: "COM3",
        baudRate: 9600,
        reconnectIntervalMs: 50,
        maxReconnectAttempts: 2
      });

      // Erro na porta aberta -> derruba e agenda reconexoes, que falham ate o limite
      openFailures.push(new Error("acesso negado"), new Error("acesso negado"));
      transports[0]?.emitError(new Error("acesso negado"));
      expect(adapter.getStatus().state).toBe("connecting");

      await vi.advanceTimersByTimeAsync(500);

      const status = adapter.getStatus();
      expect(status.state).toBe("error");
      expect(status.errorMessage).toContain("2 tentativas");
      expect(transports.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disconnect closes the transport and clears state", async () => {
    const { adapter, transports } = createAdapterWithTransports();
    await adapter.connect({ path: "COM3", baudRate: 9600 });

    adapter.disconnect();
    expect(transports[0]?.closeCount).toBe(1);
    expect(adapter.getStatus().state).toBe("disconnected");
  });
});
