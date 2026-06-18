import net from "node:net";
import { EventEmitter } from "node:events";

/**
 * Conexao TCP da balanca. Aceita multiplos clientes.
 * Emite:
 *  - "command": (socket, linha) - recebe uma linha de comando (sem CRLF)
 *  - "connect": (socket) - novo cliente conectou
 *  - "disconnect": (socket) - cliente desconectou
 *
 * O servidor envia o frame atual para cada cliente assim que conecta.
 * Periodicamente o "tick" externo chama broadcast() para enviar a todos.
 */
export class TcpServer extends EventEmitter {
  private server: net.Server;
  private clients = new Set<net.Socket>();

  constructor(
    private readonly port: number,
    private readonly host: string
  ) {
    super();
    this.server = net.createServer((socket) => this.onConnection(socket));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.server.once("error", onError);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", onError);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  clientCount(): number {
    return this.clients.size;
  }

  sendInitialFrame(socket: net.Socket, frame: string): void {
    if (!socket.destroyed) socket.write(frame);
  }

  broadcast(frame: string): void {
    for (const client of this.clients) {
      if (!client.destroyed) client.write(frame);
    }
  }

  private onConnection(socket: net.Socket): void {
    socket.setKeepAlive(true);
    socket.setEncoding("utf8");
    this.clients.add(socket);
    this.emit("connect", socket);

    socket.on("data", (chunk) => {
      const lines = String(chunk).split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        this.emit("command", socket, line);
      }
    });

    socket.on("close", () => this.removeClient(socket));
    socket.on("error", () => this.removeClient(socket));
  }

  private removeClient(socket: net.Socket): void {
    if (this.clients.delete(socket)) {
      this.emit("disconnect", socket);
    }
  }
}
