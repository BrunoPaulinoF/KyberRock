import { describe, expect, it } from "vitest";

import { isMissingRowError, isReadUnavailable, isUnknownColumnError } from "./db-read-error.ts";

describe("isMissingRowError", () => {
  it("reconhece o .single() sem nenhuma linha", () => {
    expect(
      isMissingRowError({
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: "The result contains 0 rows"
      })
    ).toBe(true);
  });

  it("reconhece a mesma situacao descrita so na mensagem", () => {
    expect(isMissingRowError({ message: "Results contain 0 rows" })).toBe(true);
  });

  it("nao confunde queda de conexao com cadastro ausente", () => {
    expect(isMissingRowError({ message: "Connection terminated due to connection timeout" })).toBe(
      false
    );
  });
});

describe("isUnknownColumnError", () => {
  it("reconhece a coluna que a migracao ainda nao criou", () => {
    expect(
      isUnknownColumnError({
        code: "42703",
        message: "column device_registrations.is_price_master does not exist"
      })
    ).toBe(true);
  });

  it("reconhece a coluna recusada na escrita", () => {
    expect(
      isUnknownColumnError({
        code: "PGRST204",
        message:
          "Could not find the 'app_version' column of 'device_registrations' in the schema cache"
      })
    ).toBe(true);
  });
});

describe("isUnknownColumnError nao engole incidente de infraestrutura", () => {
  // Um `/does not exist/` solto casava com estes tres e fazia isReadUnavailable
  // devolver false — a funcao respondia 200 "invalid_device" e a pedreira parava.
  it("tabela ausente e indisponibilidade, nao coluna pendente", () => {
    const erro = {
      code: "42P01",
      message: 'relation "public.device_registrations" does not exist'
    };
    expect(isUnknownColumnError(erro)).toBe(false);
    expect(isReadUnavailable(erro)).toBe(true);
  });

  it("banco ausente e indisponibilidade", () => {
    const erro = { code: "3D000", message: 'database "postgres" does not exist' };
    expect(isUnknownColumnError(erro)).toBe(false);
    expect(isReadUnavailable(erro)).toBe(true);
  });

  it("role ausente e indisponibilidade", () => {
    const erro = { message: 'role "authenticator" does not exist' };
    expect(isUnknownColumnError(erro)).toBe(false);
    expect(isReadUnavailable(erro)).toBe(true);
  });

  it("mas a coluna pendente de migracao continua reconhecida pela mensagem", () => {
    expect(
      isUnknownColumnError({
        message: "column device_registrations.is_price_master does not exist"
      })
    ).toBe(true);
  });
});

describe("isReadUnavailable", () => {
  it("sem erro nao ha indisponibilidade", () => {
    expect(isReadUnavailable(null)).toBe(false);
    expect(isReadUnavailable(undefined)).toBe(false);
  });

  it("queda do banco conta como indisponibilidade, e nao como bloqueio", () => {
    // O caso real: o PostgREST fora do ar devolve 522 ao runtime das Edge
    // Functions. Antes disso virar indisponibilidade, o `desktop-status`
    // respondia 200 `invalid_device` e a balanca gravava um bloqueio que
    // ninguem tinha decidido.
    expect(isReadUnavailable({ message: "Connection terminated due to connection timeout" })).toBe(
      true
    );
    expect(isReadUnavailable({ code: "57P01", message: "terminating connection" })).toBe(true);
    expect(isReadUnavailable({ message: "<html>522: Connection timed out</html>" })).toBe(true);
  });

  it("cadastro ausente continua sendo resposta legitima do banco", () => {
    expect(isReadUnavailable({ code: "PGRST116", details: "The result contains 0 rows" })).toBe(
      false
    );
  });

  it("coluna pendente de migracao segue com o tratamento proprio", () => {
    expect(isReadUnavailable({ code: "42703", message: "column x does not exist" })).toBe(false);
  });

  it("erro que nao sabemos classificar cai no lado seguro", () => {
    // Deixar uma balanca de fato bloqueada operar ate a nuvem voltar custa
    // menos do que parar a frota inteira por um soluco de infraestrutura.
    expect(isReadUnavailable({ message: "erro inesperado" })).toBe(true);
  });
});
