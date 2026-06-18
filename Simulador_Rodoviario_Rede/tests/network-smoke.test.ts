// Smoke test: sobe o servidor TCP do simulador, conecta, dispara comandos
// ARRIVE -> TARE -> GROSS -> EXIT, e valida que o frame Toledo sai no socket.
// Uso: tsx tests/network-smoke.test.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PORT = 4101;

const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "src/server.ts"], {
  cwd: REPO,
  env: {
    ...process.env,
    HTTP_PORT: "0",
    TCP_PORT: String(PORT),
    TCP_HOST: "127.0.0.1",
    FRAME_INTERVAL_MS: "200"
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.stdout.on("data", () => {});

const cleanup = () => {
  if (child.pid) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
};
process.on("exit", cleanup);
process.on("uncaughtException", (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const socket = createConnection({ host: "127.0.0.1", port: PORT });
      socket.setEncoding("utf8");
      await once(socket, "connect");
      const onData = (chunk) => {
        socket.off("data", onData);
        socket.end();
      };
      socket.on("data", onData);
      return;
    } catch {
      await wait(100);
    }
  }
  throw new Error(`Servidor TCP nao respondeu na porta ${PORT}.\n${stderr}`);
}

async function readLineFor(socket, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      socket.off("data", onData);
      reject(new Error(`Timeout aguardando ${predicate}`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      for (const line of lines) {
        if (predicate(line)) {
          clearTimeout(timer);
          socket.off("data", onData);
          resolve(line);
          return;
        }
      }
    };
    socket.on("data", onData);
  });
}

test(
  "smoke test do simulador (TCP/REDE) executa ARRIVE/TARE/GROSS/PING",
  { timeout: 60000 },
  async () => {
    await waitForServer();
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    socket.setEncoding("utf8");
    await once(socket, "connect");

    socket.on("data", () => {});

    await wait(200);

    socket.write("ARRIVE PLATE=NET1A23\n");
    const arriveLine = await readLineFor(socket, (line) => line.includes("OK arrive"), 5000);
    assert.ok(arriveLine.includes("OK arrive"), `ARRIVE falhou: ${arriveLine}`);

    socket.write("TARE\n");
    const tareLine = await readLineFor(socket, (line) => line.includes("OK tare sampling"), 2000);
    assert.ok(tareLine.includes("OK tare sampling"), `TARE falhou: ${tareLine}`);

    await wait(6000);

    socket.write("GROSS\n");
    const grossLine = await readLineFor(socket, (line) => line.includes("OK gross sampling"), 2000);
    assert.ok(grossLine.includes("OK gross sampling"), `GROSS falhou: ${grossLine}`);

    await wait(6000);

    socket.write("PING\n");
    const pong = await readLineFor(socket, (line) => line.includes("OK PONG"), 2000);
    assert.ok(pong.includes("OK PONG"), `PING falhou: ${pong}`);

    socket.on("error", () => {});
    socket.end();
    await wait(200);
    cleanup();
  }
);
