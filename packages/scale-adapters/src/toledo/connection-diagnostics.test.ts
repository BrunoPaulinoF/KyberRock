import { describe, expect, it } from "vitest";

import { describeTcpConnectFailure } from "./connection-diagnostics";

describe("describeTcpConnectFailure", () => {
  it("explica o que conferir quando ninguem responde no endereco", () => {
    const message = describeTcpConnectFailure({
      host: "192.168.5.190",
      port: 9001,
      timeoutMs: 10_000
    });

    // O texto antigo ("Timeout de conexao (3000ms)") dizia so que falhou.
    expect(message).toContain("192.168.5.190:9001");
    expect(message).toContain("10 segundos");
    expect(message).toContain("mesma rede");
    expect(message).not.toContain("Timeout de conexao");
  });

  it("separa porta errada de aparelho fora do ar", () => {
    const message = describeTcpConnectFailure({
      host: "192.168.5.190",
      port: 9001,
      code: "ECONNREFUSED",
      originalMessage: "connect ECONNREFUSED 192.168.5.190:9001"
    });

    // Recusa prova que o IP esta certo: mandar o operador conferir o cabo aqui
    // seria mandar mexer justamente no que esta funcionando.
    expect(message).toContain("recusou a conexao na porta 9001");
    expect(message).toContain("4001");
    expect(message).not.toContain("ECONNREFUSED");
  });

  it("aponta rede diferente quando nao ha caminho ate o aparelho", () => {
    const message = describeTcpConnectFailure({
      host: "10.0.0.20",
      port: 4001,
      code: "EHOSTUNREACH",
      originalMessage: "connect EHOSTUNREACH 10.0.0.20:4001"
    });

    expect(message).toContain("nao tem caminho ate 10.0.0.20");
    expect(message).toContain("mesma faixa");
  });

  it("aponta sessao ocupada quando o aparelho derruba a conexao", () => {
    const message = describeTcpConnectFailure({
      host: "192.168.5.190",
      port: 9001,
      code: "ECONNRESET",
      originalMessage: "read ECONNRESET"
    });

    expect(message).toContain("um de cada vez");
  });

  it("mostra o motivo original quando o codigo nao e conhecido", () => {
    const message = describeTcpConnectFailure({
      host: "192.168.5.190",
      port: 9001,
      code: "EWEIRD",
      originalMessage: "algo inesperado"
    });

    expect(message).toContain("algo inesperado");
    expect(message).toContain("192.168.5.190:9001");
  });

  it("nao inventa casa decimal na espera", () => {
    expect(describeTcpConnectFailure({ host: "h", port: 1, timeoutMs: 1500 })).toContain(
      "1,5 segundos"
    );
  });
});
