import { describe, expect, it } from "vitest";

import { rowsHaveColumn, stripColumn, unknownColumnFromError } from "./unknown-column.ts";

describe("unknownColumnFromError", () => {
  it("extrai a coluna que a nuvem ainda nao tem", () => {
    // Mensagem real do PostgREST quando a migracao do campo ainda nao rodou.
    expect(
      unknownColumnFromError({
        code: "PGRST204",
        message:
          "Could not find the 'operation_code' column of 'weighing_operations' in the schema cache"
      })
    ).toBe("operation_code");
  });

  it("ignora erro de outra natureza, que precisa continuar falhando", () => {
    // Violacao de chave estrangeira nao pode virar "remove a coluna e segue":
    // o dado esta errado e o desktop precisa saber para re-tentar.
    expect(
      unknownColumnFromError({
        code: "23503",
        message: 'insert or update on table "loading_requests" violates foreign key constraint'
      })
    ).toBeNull();
  });

  it("ignora PGRST204 sem nome de coluna na mensagem", () => {
    expect(
      unknownColumnFromError({ code: "PGRST204", message: "schema cache desatualizado" })
    ).toBe(null);
  });

  it("aceita erro nulo", () => {
    expect(unknownColumnFromError(null)).toBeNull();
  });
});

describe("stripColumn", () => {
  it("remove a coluna de todas as linhas e preserva o resto", () => {
    expect(
      stripColumn(
        [
          { id: "op-1", status: "open", operation_code: 12 },
          { id: "op-2", status: "synced", operation_code: 13 }
        ],
        "operation_code"
      )
    ).toEqual([
      { id: "op-1", status: "open" },
      { id: "op-2", status: "synced" }
    ]);
  });

  it("nao altera linhas que nao tem a coluna", () => {
    expect(stripColumn([{ id: "op-1" }], "operation_code")).toEqual([{ id: "op-1" }]);
  });
});

describe("rowsHaveColumn", () => {
  it("reconhece a coluna presente em qualquer linha do lote", () => {
    expect(rowsHaveColumn([{ id: "a" }, { id: "b", operation_code: 1 }], "operation_code")).toBe(
      true
    );
  });

  it("recusa quando nenhuma linha tem a coluna: remove-la nao resolveria", () => {
    // Trava o laco de re-tentativa: se o PostgREST reclama de uma coluna que o
    // payload nao envia, insistir so repetiria a mesma chamada para sempre.
    expect(rowsHaveColumn([{ id: "a" }, { id: "b" }], "operation_code")).toBe(false);
  });

  it("enxerga a coluna com valor nulo, que tambem vai no upsert", () => {
    expect(rowsHaveColumn([{ id: "a", operation_code: null }], "operation_code")).toBe(true);
  });
});
