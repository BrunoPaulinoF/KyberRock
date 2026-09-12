import { createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { discoverScale } from "./scale-discovery";

/**
 * A varredura da rede so aceitava host que estivesse TRANSMITINDO peso, e era
 * exatamente por isso que ela falhava com quem mais precisa dela: quem clica em
 * "procurar balanca" e quem nao esta conseguindo conectar, e as duas causas mais
 * comuns disso (conversor com a sessao unica ocupada por outro computador, e
 * indicador fora do modo de transmissao continua) deixam a porta ABERTA e MUDA.
 */
describe("discoverScale", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
  });

  async function listen(handler?: (port: number) => (socket: Socket) => void) {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const onConnection = handler?.(port);
    server.on("connection", (socket) => {
      socket.on("error", () => undefined);
      onConnection?.(socket);
    });
    return port;
  }

  it("encontra a balanca que esta transmitindo peso", async () => {
    const port = await listen(() => (socket) => {
      const interval = setInterval(() => {
        if (!socket.destroyed) socket.write("       000015200kg\r\n");
      }, 20);
      socket.on("close", () => clearInterval(interval));
    });

    const found = await discoverScale({ subnet: "127.0.0", ports: [port], timeoutMs: 1500 });

    expect(found?.host).toBe("127.0.0.1");
    expect(found?.transmitting).toBe(true);
    expect(found?.reading?.weightKg).toBe(15_200);
  }, 20_000);

  it("devolve a porta aberta que nao transmitiu, em vez de dizer que nao achou nada", async () => {
    // Conversor respondendo no endereco certo, mas sem mandar peso: antes a tela
    // dizia "nenhuma balanca encontrada na rede local" e o operador ficava sem
    // nenhuma pista, com o aparelho ali.
    const port = await listen();

    const found = await discoverScale({ subnet: "127.0.0", ports: [port], timeoutMs: 800 });

    expect(found?.host).toBe("127.0.0.1");
    expect(found?.port).toBe(port);
    expect(found?.transmitting).toBe(false);
    expect(found?.reading).toBeNull();
  }, 20_000);

  it("prefere quem transmite, mesmo achando antes uma porta aberta e muda", async () => {
    const mudo = await listen();
    const falante = await listen(() => (socket) => {
      const interval = setInterval(() => {
        if (!socket.destroyed) socket.write("       000018200kg\r\n");
      }, 20);
      socket.on("close", () => clearInterval(interval));
    });

    const found = await discoverScale({
      subnet: "127.0.0",
      // O mudo vem primeiro na ordem da varredura de proposito.
      ports: [mudo, falante],
      timeoutMs: 800,
      batchSize: 1
    });

    expect(found?.port).toBe(falante);
    expect(found?.transmitting).toBe(true);
  }, 30_000);

  it("devolve null quando nada responde no endereco", async () => {
    const fechado = await listen();
    await new Promise<void>((resolve) => servers.splice(0)[0]?.close(() => resolve()));

    const found = await discoverScale({ subnet: "127.0.0", ports: [fechado], timeoutMs: 400 });

    expect(found).toBeNull();
  }, 20_000);
});
