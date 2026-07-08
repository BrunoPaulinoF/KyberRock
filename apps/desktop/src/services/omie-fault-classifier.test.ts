import { describe, expect, it } from "vitest";

import { isCadastroIncompleteFault } from "./omie-fault-classifier.js";

describe("isCadastroIncompleteFault", () => {
  it("matches the reported OMIE NF-e cadastro fault (with accents/case)", () => {
    expect(
      isCadastroIncompleteFault(
        "Nao foi possivel realizar o faturamento desse Pedido de Venda de Produto! Para emitir a NF-e falta preencher o Numero do Endereco e o E-mail."
      )
    ).toBe(true);
    expect(
      isCadastroIncompleteFault(
        "Não foi possível realizar o faturamento desse Pedido de Venda de Produto! Para emitir a NF-e falta preencher o Número do Endereço e o E-mail."
      )
    ).toBe(true);
  });

  it("does not match transient / generic errors", () => {
    expect(isCadastroIncompleteFault("OMIE offline, tente novamente")).toBe(false);
    expect(isCadastroIncompleteFault("Request timeout")).toBe(false);
    expect(isCadastroIncompleteFault("HTTP 503 Service Unavailable")).toBe(false);
    expect(isCadastroIncompleteFault("OMIE nao retornou orderId")).toBe(false);
    expect(isCadastroIncompleteFault("Erro OMIE")).toBe(false);
    expect(isCadastroIncompleteFault("")).toBe(false);
  });

  it("requires both fiscal context and a missing-field cue", () => {
    // faturamento sem "falta" -> transitorio, nao bloqueia
    expect(isCadastroIncompleteFault("Erro ao realizar o faturamento no OMIE")).toBe(false);
    // "falta" sem contexto fiscal -> nao bloqueia
    expect(isCadastroIncompleteFault("falta preencher algum campo generico")).toBe(false);
  });
});
