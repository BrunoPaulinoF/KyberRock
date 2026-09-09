import { describe, expect, it } from "vitest";

import { isOutageFault } from "./outage-fault";

describe("isOutageFault", () => {
  it("reconhece a nuvem fora do ar pelo status anotado na mensagem", () => {
    // Foi o caso real: o Postgres parou e o gateway devolveu 522. Sem o status
    // na mensagem isso chegava na fila como "non-2xx status code", igualzinho a
    // um 400 de payload — e gastava as tentativas do job ate mata-lo.
    expect(isOutageFault("Cadastro indisponivel no momento (HTTP 503)")).toBe(true);
    expect(isOutageFault("Connection timed out (HTTP 522)")).toBe(true);
    expect(isOutageFault("Internal Server Error (HTTP 500)")).toBe(true);
    expect(isOutageFault("Too Many Requests (HTTP 429)")).toBe(true);
  });

  it("nao trata recusa do dado como indisponibilidade", () => {
    // 4xx e o servidor dizendo que o ENVIO esta errado: re-tentar para sempre
    // seria a tempestade de retry que os classificadores do OMIE evitam.
    expect(isOutageFault("Dispositivo nao autorizado (HTTP 401)")).toBe(false);
    expect(isOutageFault("deviceId e deviceToken sao obrigatorios (HTTP 400)")).toBe(false);
    expect(isOutageFault("Codigo de ativacao invalido (HTTP 403)")).toBe(false);
  });

  it("reconhece falha de rede antes de haver resposta", () => {
    expect(isOutageFault("TypeError: fetch failed")).toBe(true);
    expect(isOutageFault("Failed to send a request to the Edge Function")).toBe(true);
    expect(isOutageFault("connect ECONNREFUSED 127.0.0.1:443")).toBe(true);
    expect(isOutageFault("socket hang up")).toBe(true);
    expect(isOutageFault("The operation was aborted due to timeout")).toBe(true);
    expect(isOutageFault("Sem internet no momento")).toBe(true);
  });

  it("nao reconhece falha de cadastro, que espera o operador", () => {
    // Estas ja tem tratamento proprio (markSyncJobBlocked) e nao podem voltar
    // para a rotacao automatica: re-tentar repete a mesma recusa.
    expect(isOutageFault("Para emitir a NF-e falta preencher o endereco do cliente")).toBe(false);
    expect(isOutageFault("Cliente nao cadastrado para o Codigo [codigo_cliente]")).toBe(false);
    expect(isOutageFault("Operacao cancelada localmente antes do envio ao OMIE")).toBe(false);
    expect(isOutageFault("")).toBe(false);
    expect(isOutageFault(null)).toBe(false);
  });
});
