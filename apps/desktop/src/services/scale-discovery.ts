import { createToledoTcpAdapter } from "@kyberrock/scale-adapters";
import type { ScaleReading } from "@kyberrock/scale-adapters";

export interface DiscoveredScale {
  host: string;
  port: number;
  reading: ScaleReading;
}

export async function discoverScale(
  options: {
    subnet?: string;
    port?: number;
    timeoutMs?: number;
    batchSize?: number;
  } = {}
): Promise<DiscoveredScale | null> {
  const subnet = options.subnet ?? "192.168.1";
  const port = options.port ?? 4001;
  const timeoutMs = options.timeoutMs ?? 1200;
  const batchSize = options.batchSize ?? 20;

  const hosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);

  for (let i = 0; i < hosts.length; i += batchSize) {
    const batch = hosts.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((host) => probeHost(host, port, timeoutMs))
    );
    const found = results.find((r): r is DiscoveredScale => r !== null);
    if (found) return found;
  }

  return null;
}

async function probeHost(
  host: string,
  port: number,
  timeoutMs: number
): Promise<DiscoveredScale | null> {
  const adapter = createToledoTcpAdapter();
  try {
    await adapter.connect({
      host,
      port,
      timeoutMs,
      maxReconnectAttempts: 0,
      reconnectIntervalMs: 0
    });

    // Guarda o handle do timeout e o cancela quando adapter.read() vence a corrida. Sem isto,
    // o setTimeout do ramo perdedor continuava vivo por ate timeoutMs para cada host — numa
    // varredura de /24 (254 hosts) isso deixava muitos timers pendentes atrasando o encerramento.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reading = await Promise.race([
      adapter.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      })
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    adapter.disconnect();
    return { host, port, reading };
  } catch {
    adapter.disconnect();
    return null;
  }
}
