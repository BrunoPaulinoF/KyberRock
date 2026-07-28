import { networkInterfaces } from "node:os";

import { createToledoTcpAdapter } from "@kyberrock/scale-adapters";
import type { ScaleReading } from "@kyberrock/scale-adapters";

export interface DiscoveredScale {
  host: string;
  port: number;
  reading: ScaleReading;
}

/**
 * Portas usadas por indicadores e por conversores serial<->TCP. A porta 4001 e o
 * padrao dos conversores tipo Moxa NPort, mas instalacoes reais aparecem tambem
 * em 10001 (Lantronix), 2101 (Digi) e nas portas 2/3 do mesmo conversor.
 */
const DEFAULT_DISCOVERY_PORTS = [4001, 9001, 10001, 2101, 4002, 4003];

/**
 * Sub-redes /24 das interfaces IPv4 locais ativas.
 *
 * Antes havia um `/24` fixo ("192.168.1") como padrao: em qualquer instalacao com
 * outra faixa — a pedreira usa 192.168.0.x — a varredura percorria 254 enderecos
 * inexistentes e sempre devolvia "nenhuma balanca encontrada".
 */
export function localSubnets(): string[] {
  const subnets = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      subnets.add(address.address.split(".").slice(0, 3).join("."));
    }
  }
  return [...subnets];
}

export async function discoverScale(
  options: {
    subnet?: string;
    subnets?: string[];
    port?: number;
    ports?: number[];
    timeoutMs?: number;
    batchSize?: number;
  } = {}
): Promise<DiscoveredScale | null> {
  const subnets = options.subnet
    ? [options.subnet]
    : (options.subnets ?? localSubnets());
  const ports = options.port ? [options.port] : (options.ports ?? DEFAULT_DISCOVERY_PORTS);
  const timeoutMs = options.timeoutMs ?? 1200;
  const batchSize = options.batchSize ?? 20;

  if (subnets.length === 0) return null;

  const targets: Array<{ host: string; port: number }> = [];
  for (const subnet of subnets) {
    for (let octet = 1; octet <= 254; octet += 1) {
      for (const port of ports) {
        targets.push({ host: `${subnet}.${octet}`, port });
      }
    }
  }

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((target) => probeHost(target.host, target.port, timeoutMs))
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
      reconnectIntervalMs: 0,
      // A sonda so aceita host que esteja realmente transmitindo peso dentro da
      // janela; sem isto uma porta TCP qualquer aberta passaria por balanca.
      staleReadingMs: timeoutMs
    });

    // Guarda o handle do timeout e o cancela quando adapter.read() vence a corrida. Sem isto,
    // o setTimeout do ramo perdedor continuava vivo por ate timeoutMs para cada host — numa
    // varredura de /24 (254 hosts) isso deixava muitos timers pendentes atrasando o encerramento.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reading = await Promise.race([
      waitForReading(adapter, timeoutMs),
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

/**
 * `read()` devolve a ultima leitura recebida e falha enquanto nenhum quadro chegou.
 * Conectar e ler no mesmo instante quase sempre caia nesse caso, entao a sonda
 * espera o primeiro quadro chegar dentro da janela.
 */
async function waitForReading(
  adapter: ReturnType<typeof createToledoTcpAdapter>,
  timeoutMs: number
): Promise<ScaleReading> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await adapter.read();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
