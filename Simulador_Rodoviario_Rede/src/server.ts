import express from "express";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { TcpServer } from "./net/tcp-server.js";
import { ScaleSimulator } from "./simulator.js";
import { buildToledoFrame, parseToledoLine } from "./protocol/toledo.js";
import { fileURLToPath } from "node:url";

const PORT_HTTP = numberEnv("HTTP_PORT", 8080);
const PORT_TCP = numberEnv("TCP_PORT", 4001);
const TCP_HOST = process.env.TCP_HOST ?? "0.0.0.0";
const TICK_MS = numberEnv("TICK_MS", 250);
const FRAME_MS = numberEnv("FRAME_INTERVAL_MS", 500);
const CAPACITY = numberEnv("CAPACITY_KG", 80000);
const SAMPLE_MS = numberEnv("SAMPLE_WINDOW_MS", 5000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const simulator = new ScaleSimulator(CAPACITY, SAMPLE_MS);
const tcp = new TcpServer(PORT_TCP, TCP_HOST);

const app = express();
app.use(express.json({ limit: "128kb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/state", (_req, res) => {
  res.json({ ...simulator.snapshot(), networkUrls: localUrls(PORT_HTTP) });
});

app.post("/api/action", (req, res) => {
  const type = typeof req.body?.type === "string" ? req.body.type : "";
  const data = (req.body?.data ?? {}) as Record<string, unknown>;
  try {
    const snapshot = handleUiAction(type, data);
    res.json(snapshot);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/frame", (_req, res) => {
  res.type("text/plain").send(buildToledoFrame(simulator.snapshot()));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: simulator.snapshot() }));
});

function broadcastState(): void {
  const message = JSON.stringify({ type: "state", payload: simulator.snapshot() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function handleUiAction(type: string, data: Record<string, unknown>) {
  switch (type) {
    case "arriveEmpty": {
      const tare = numberFromAny(data.tareKg ?? data.tare);
      simulator.arriveEmpty(tare);
      return simulator.snapshot();
    }
    case "startLoading": {
      const gross = numberFromAny(data.grossKg ?? data.gross);
      simulator.startLoading(gross);
      return simulator.snapshot();
    }
    case "startTareSample":
      simulator.startTareSample();
      return simulator.snapshot();
    case "startGrossSample":
      simulator.startGrossSample();
      return simulator.snapshot();
    case "leave":
      simulator.leave();
      return simulator.snapshot();
    case "zero":
      simulator.zero();
      return simulator.snapshot();
    case "setWeight": {
      const weight = numberFromAny(data.weightKg);
      if (weight === undefined) throw new Error("weightKg obrigatorio");
      simulator.setWeight(weight);
      return simulator.snapshot();
    }
    case "setSampleWindowMs": {
      const window = numberFromAny(data.windowMs);
      if (window === undefined) throw new Error("windowMs obrigatorio");
      simulator.setSampleWindowMs(window);
      return simulator.snapshot();
    }
    default:
      throw new Error(`acao desconhecida: ${type}`);
  }
}

tcp.on("connect", (socket) => {
  tcp.sendInitialFrame(socket, buildToledoFrame(simulator.snapshot()));
});

tcp.on("command", (socket, line) => {
  const cmd = line.trim().toUpperCase();
  switch (cmd) {
    case "PING":
      socket.write("OK PONG\r\n");
      return;
    case "READ":
    case "PESO":
    case "WEIGHT":
      socket.write(buildToledoFrame(simulator.snapshot()));
      return;
    case "ZERO":
    case "ZERAR":
      simulator.zero();
      socket.write("OK zero\r\n");
      return;
    case "ARRIVE":
    case "ENTRADA":
      simulator.arriveEmpty();
      socket.write("OK arrive\r\n");
      return;
    case "TARE":
    case "TARA":
      simulator.startTareSample();
      socket.write("OK tare sampling\r\n");
      return;
    case "LOAD":
    case "CARREGAR":
      simulator.startLoading();
      socket.write("OK loading\r\n");
      return;
    case "GROSS":
    case "BRUTO":
      simulator.startGrossSample();
      socket.write("OK gross sampling\r\n");
      return;
    case "EXIT":
    case "LEAVE":
    case "SAIR":
      simulator.leave();
      socket.write("OK leave\r\n");
      return;
    default:
      socket.write(`ERR comando desconhecido: ${line}\r\n`);
      return;
  }
});

simulator.on("change", () => {
  broadcastState();
});

setInterval(() => {
  simulator.tick();
}, TICK_MS);

setInterval(() => {
  tcp.broadcast(buildToledoFrame(simulator.snapshot()));
}, FRAME_MS);

async function main(): Promise<void> {
  await tcp.start();
  server.listen(PORT_HTTP, () => {
    console.log(`UI:     http://localhost:${PORT_HTTP}`);
    console.log(`TCP:    ${TCP_HOST}:${PORT_TCP} (frame Toledo a cada ${FRAME_MS}ms)`);
    for (const url of localUrls(PORT_HTTP)) console.log(`Rede:   ${url}`);
  });
}

main().catch((err) => {
  console.error("Falha ao iniciar simulador:", err);
  process.exit(1);
});

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberFromAny(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function localUrls(port: number): string[] {
  const urls = [`http://localhost:${port}`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

export { parseToledoLine };
