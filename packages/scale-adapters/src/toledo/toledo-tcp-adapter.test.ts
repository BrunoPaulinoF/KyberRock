import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

import { createToledoTcpAdapter } from "./toledo-tcp-adapter";

describe("toledo-tcp-adapter readSampled", () => {
  let server: ReturnType<typeof createServer> | null = null;
  let port = 0;

  beforeEach(async () => {
    server = createServer((socket) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (Date.now() - start > 6000) {
          clearInterval(interval);
          socket.end();
          return;
        }
        socket.write("       000015200kg\r\n");
      }, 200);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    port = (server!.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  it("returns the mean of readings collected during the window", async () => {
    const adapter = createToledoTcpAdapter();
    await adapter.connect({ host: "127.0.0.1", port });

    const reading = await adapter.readSampled({ durationMs: 1000, sampleIntervalMs: 200 });

    expect(reading.weightKg).toBe(15_200);
    expect(reading.unit).toBe("kg");
    await adapter.disconnect();
  });
});
