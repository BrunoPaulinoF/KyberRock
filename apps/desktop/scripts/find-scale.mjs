#!/usr/bin/env node
/**
 * Varredura de rede para localizar o indicador da balanca.
 *
 * Rode ESTE script no notebook que esta na mesma rede da balanca:
 *
 *   node apps/desktop/scripts/find-scale.mjs
 *   node apps/desktop/scripts/find-scale.mjs --subnet 192.168.0 --ports 4001,10001
 *
 * Nao instala nada e nao depende do build do workspace: usa somente `node:net`,
 * `node:os` e a tabela ARP do sistema. As sub-redes sao detectadas a partir das
 * interfaces locais, entao nao ha palpite de /24 fixo.
 *
 * A sonda abre a conexao, escuta por um instante e fecha com FIN limpo
 * (`socket.end()`), nunca com RST. Conversores serial<->TCP costumam aceitar uma
 * unica sessao por vez e ficam presos quando o cliente anterior morre sujo.
 */

import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Portas usadas por indicadores e por conversores serial<->TCP. */
const DEFAULT_PORTS = [
  4001, // Moxa NPort / conversores genericos, porta serial 1
  4002,
  4003,
  10001, // Lantronix
  2101, // Digi
  9761,
  8899,
  5000,
  4000,
  23 // telnet cru
];

/** Prefixos MAC de fabricantes que aparecem em conversores e indicadores. */
const OUI_HINTS = [
  ["00:90:e8", "Moxa"],
  ["00:20:4a", "Lantronix"],
  ["00:80:a3", "Lantronix"],
  ["00:40:9d", "Digi"],
  ["00:04:f3", "Digi/Sena"],
  ["00:0e:8e", "SparkLAN"],
  ["00:60:35", "Dallas/Toledo"],
  ["00:11:22", "Toledo (variavel)"],
  ["00:1e:c0", "Microchip/embarcado"],
  ["8c:1f:64", "IEEE registro pequeno (OEM embarcado)"]
];

function parseArgs(argv) {
  const args = { subnets: [], ports: DEFAULT_PORTS, timeoutMs: 700, concurrency: 128 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--subnet") args.subnets.push(argv[(i += 1)]);
    else if (arg === "--ports")
      args.ports = argv[(i += 1)]
        .split(",")
        .map((p) => Number(p.trim()))
        .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
    else if (arg === "--timeout") args.timeoutMs = Number(argv[(i += 1)]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[(i += 1)]);
  }
  return args;
}

/** Sub-redes /24 derivadas das interfaces IPv4 locais ativas. */
function localSubnets() {
  const found = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const subnet = addr.address.split(".").slice(0, 3).join(".");
      found.push({ name, address: addr.address, subnet });
    }
  }
  return found;
}

/** Tabela ARP do sistema — mostra vizinhos vistos recentemente, inclusive a balanca. */
async function arpTable() {
  const attempts =
    process.platform === "win32"
      ? [["arp", ["-a"]]]
      : [
          ["ip", ["neigh"]],
          ["arp", ["-an"]]
        ];
  for (const [cmd, cmdArgs] of attempts) {
    try {
      const { stdout } = await execFileAsync(cmd, cmdArgs, { timeout: 8000 });
      if (stdout.trim()) return stdout;
    } catch {
      // tenta o proximo comando
    }
  }
  return "";
}

function ouiHintFor(mac) {
  const normalized = mac.toLowerCase().replace(/-/g, ":");
  for (const [prefix, vendor] of OUI_HINTS) {
    if (normalized.startsWith(prefix)) return vendor;
  }
  return null;
}

/**
 * Conecta, escuta brevemente e encerra com FIN limpo.
 * Retorna o que o dispositivo enviou espontaneamente — indicadores em modo de
 * transmissao continua mandam quadros sem receber nenhum comando.
 */
function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let banner = "";
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.end(); // FIN limpo: nao deixa o gateway com sessao presa
      socket.destroy();
      resolve(result);
    };

    socket.on("connect", () => {
      // Conectou. Da um tempo extra para capturar quadros de transmissao continua.
      setTimeout(() => finish({ host, port, open: true, banner }), Math.min(timeoutMs, 1200));
    });
    socket.on("data", (chunk) => {
      banner += chunk.toString("binary");
      if (banner.length > 512) finish({ host, port, open: true, banner });
    });
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
  });
}

/** Executa as sondas com limite de paralelismo. */
async function runPool(tasks, concurrency) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const result = await tasks[index]();
      if (result) results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

function describeBanner(banner) {
  if (!banner) return "conectou, mas nao transmitiu nada (indicador pode estar em modo sob demanda)";
  const printable = banner.replace(/[^\x20-\x7e]/g, ".").slice(0, 80);
  const looksLikeToledo = /[0-9]{2,}[.,]?[0-9]*\s*(kg|KG)?/.test(banner);
  return `${printable}${looksLikeToledo ? "  <-- parece leitura de peso" : ""}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("=== Busca do indicador da balanca ===\n");

  const interfaces = localSubnets();
  if (interfaces.length === 0) {
    console.error("Nenhuma interface IPv4 ativa encontrada. Conecte o notebook na rede da balanca.");
    process.exitCode = 1;
    return;
  }

  console.log("Interfaces locais:");
  for (const iface of interfaces) {
    console.log(`  ${iface.name.padEnd(24)} ${iface.address}  ->  ${iface.subnet}.0/24`);
  }
  console.log();

  // ARP primeiro: se a balanca respondeu ha pouco, ela ainda esta no cache.
  const arp = await arpTable();
  if (arp) {
    console.log("Tabela ARP (vizinhos vistos recentemente):");
    for (const line of arp.split("\n")) {
      const mac = line.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
      if (!mac) continue;
      const hint = ouiHintFor(mac[0]);
      console.log(`  ${line.trim()}${hint ? `   <-- ${hint}` : ""}`);
    }
    console.log();
  }

  const subnets = args.subnets.length > 0 ? args.subnets : [...new Set(interfaces.map((i) => i.subnet))];
  console.log(`Varrendo ${subnets.join(", ")} nas portas ${args.ports.join(", ")}`);
  console.log(`(${subnets.length * 254 * args.ports.length} sondas, timeout ${args.timeoutMs}ms)\n`);

  const tasks = [];
  for (const subnet of subnets) {
    for (let host = 1; host <= 254; host += 1) {
      for (const port of args.ports) {
        tasks.push(() => probe(`${subnet}.${host}`, port, args.timeoutMs));
      }
    }
  }

  const started = Date.now();
  const open = await runPool(tasks, args.concurrency);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Varredura concluida em ${elapsed}s.\n`);

  if (open.length === 0) {
    console.log("Nenhuma porta aberta encontrada.");
    console.log("Proximos passos:");
    console.log("  1. Confira na tabela ARP acima se ha algum dispositivo desconhecido.");
    console.log("  2. Desligue e religue o indicador/conversor (sessao TCP presa nao aceita novo cliente).");
    console.log("  3. Se a balanca estiver noutra faixa, rode com --subnet 192.168.0");
    return;
  }

  console.log("Dispositivos que aceitaram conexao:");
  open.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
  for (const result of open) {
    console.log(`  ${result.host}:${result.port}`);
    console.log(`      ${describeBanner(result.banner)}`);
  }
  console.log("\nUse em Configuracoes > Balanca o host:porta que mostrou leitura de peso.");
}

main().catch((error) => {
  console.error("Falha na varredura:", error);
  process.exitCode = 1;
});
