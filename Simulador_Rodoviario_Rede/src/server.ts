import express from "express";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { parseTcpCommand } from "./protocol.js";
import { QuarryScaleSimulator } from "./simulator.js";

const httpPort = numberEnv("HTTP_PORT", 8080);
const tcpPort = numberEnv("TCP_PORT", 4001);
const tcpHost = process.env.TCP_HOST ?? "0.0.0.0";
const frameIntervalMs = numberEnv("FRAME_INTERVAL_MS", 1000);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const simulator = new QuarryScaleSimulator({ tcpHost, tcpPort, frameIntervalMs });
const tcpClients = new Set<net.Socket>();

const publicDir = path.resolve(process.cwd(), "public");

app.use(express.json({ limit: "128kb" }));
app.use(express.static(publicDir));

app.get("/api/state", (_req, res) => {
  res.json({ ...simulator.snapshot(), networkUrls: localUrls(httpPort) });
});

app.post("/api/action", (req, res) => {
  const type = typeof req.body?.type === "string" ? req.body.type : "";
  const data = isRecord(req.body?.data) ? req.body.data : {};
  res.json(simulator.action(type, data));
});

app.get("/api/frame", (_req, res) => {
  res.type("text/plain").send(simulator.snapshot().lastFrame);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, state: simulator.snapshot().status });
});

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: simulator.snapshot() }));
});

simulator.on("change", () => {
  broadcastWebState();
});

const tcpServer = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.setKeepAlive(true);
  tcpClients.add(socket);
  simulator.setClientCount(tcpClients.size);
  socket.write(simulator.snapshot().lastFrame);

  socket.on("data", (chunk) => {
    for (const commandText of String(chunk).split(/\r?\n/)) {
      if (!commandText.trim()) continue;
      handleTcpCommand(socket, commandText);
    }
  });

  socket.on("close", () => removeTcpClient(socket));
  socket.on("error", () => removeTcpClient(socket));
});

tcpServer.listen(tcpPort, tcpHost, () => {
  console.log(`UI web: http://localhost:${httpPort}`);
  console.log(`Servidor TCP: ${tcpHost}:${tcpPort}`);
  for (const url of localUrls(httpPort)) console.log(`Rede local: ${url}`);
});

httpServer.listen(httpPort);

setInterval(() => {
  simulator.tick();
}, 700);

setInterval(() => {
  const frame = simulator.snapshot().lastFrame;
  for (const client of tcpClients) {
    if (!client.destroyed) client.write(frame);
  }
}, frameIntervalMs);

function handleTcpCommand(socket: net.Socket, commandText: string): void {
  const command = parseTcpCommand(commandText);

  switch (command.type) {
    case "ping":
      socket.write("OK PONG\r\n");
      return;
    case "read":
      socket.write(simulator.snapshot().lastFrame);
      return;
    case "zero":
    case "newTruck":
    case "loadTruck":
    case "leaveScale":
    case "startAuto":
    case "stopAuto":
      simulator.action(command.type);
      socket.write(`OK ${command.type}\r\n`);
      return;
    case "tare":
      simulator.action("tare", command.data);
      socket.write("OK tare sampling\r\n");
      return;
    case "gross":
      simulator.action("gross", command.data);
      socket.write("OK gross sampling\r\n");
      return;
    case "arriveTruck":
      simulator.action("arriveTruck", command.data);
      socket.write("OK arrive\r\n");
      return;
    case "exitTruck":
      simulator.action("exitTruck", command.data);
      socket.write("OK exit\r\n");
      return;
    case "manualSet":
      simulator.action("manualSet", command.data);
      socket.write("OK SET\r\n");
      return;
    case "unknown":
      socket.write(`ERR comando desconhecido: ${command.raw}\r\n`);
      return;
  }
}

function broadcastWebState(): void {
  const message = JSON.stringify({ type: "state", payload: simulator.snapshot() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function removeTcpClient(socket: net.Socket): void {
  if (tcpClients.delete(socket)) {
    simulator.setClientCount(tcpClients.size);
  }
}

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
