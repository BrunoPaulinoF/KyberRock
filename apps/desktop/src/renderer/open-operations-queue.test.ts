import { describe, expect, it } from "vitest";

import {
  filterOpenOperationsByPlate,
  matchesOpenOperationPlate,
  normalizePlateSearch,
  sortOpenOperationsByLoaderQueue
} from "./open-operations-queue";

function operation(plate: string, loaderCompletedAt: string | null = null) {
  return { plate, loaderCompletedAt };
}

describe("normalizePlateSearch", () => {
  it("reduz a placa a letras e numeros em caixa alta", () => {
    expect(normalizePlateSearch(" abc-1d23 ")).toBe("ABC1D23");
    expect(normalizePlateSearch("abc 1d23")).toBe("ABC1D23");
  });

  it("devolve vazio quando o operador so digitou pontuacao", () => {
    expect(normalizePlateSearch("  - ")).toBe("");
  });
});

describe("matchesOpenOperationPlate", () => {
  it("acha a placa digitada com ou sem hifen e em qualquer caixa", () => {
    const op = operation("ABC-1D23");

    expect(matchesOpenOperationPlate(op, "abc1d23")).toBe(true);
    expect(matchesOpenOperationPlate(op, "ABC-1D23")).toBe(true);
    expect(matchesOpenOperationPlate(op, "abc 1d23")).toBe(true);
  });

  it("aceita trecho da placa, que e como o operador digita com pressa", () => {
    expect(matchesOpenOperationPlate(operation("ABC-1D23"), "1d2")).toBe(true);
    expect(matchesOpenOperationPlate(operation("ABC-1D23"), "xyz")).toBe(false);
  });

  it("mostra tudo quando a busca esta vazia", () => {
    expect(matchesOpenOperationPlate(operation("ABC-1D23"), "   ")).toBe(true);
  });

  it("nao quebra em operacao sem placa", () => {
    expect(matchesOpenOperationPlate(operation(""), "abc")).toBe(false);
  });
});

describe("filterOpenOperationsByPlate", () => {
  it("mantem apenas as operacoes da placa procurada", () => {
    const operations = [operation("ABC-1D23"), operation("XYZ-4E56"), operation("ABC-9F87")];

    expect(filterOpenOperationsByPlate(operations, "abc").map((op) => op.plate)).toEqual([
      "ABC-1D23",
      "ABC-9F87"
    ]);
  });

  it("devolve a lista original quando nao ha o que buscar", () => {
    const operations = [operation("ABC-1D23")];

    expect(filterOpenOperationsByPlate(operations, "")).toBe(operations);
    expect(filterOpenOperationsByPlate(operations, " - ")).toBe(operations);
  });
});

describe("sortOpenOperationsByLoaderQueue", () => {
  // O caminhao carregado e o proximo a subir na balanca: ele precisa estar na
  // primeira linha, sem o operador cacar a luz verde no meio da fila.
  it("sobe as cargas concluidas pelo carregador para o topo", () => {
    const sorted = sortOpenOperationsByLoaderQueue([
      operation("AAA-1111"),
      operation("BBB-2222", "2026-08-04 12:10:00"),
      operation("CCC-3333")
    ]);

    expect(sorted.map((op) => op.plate)).toEqual(["BBB-2222", "AAA-1111", "CCC-3333"]);
  });

  it("enfileira as concluidas na ordem em que o carregador concluiu", () => {
    const sorted = sortOpenOperationsByLoaderQueue([
      operation("CCC-3333", "2026-08-04 12:30:00"),
      operation("AAA-1111", "2026-08-04 12:10:00"),
      operation("DDD-4444"),
      operation("BBB-2222", "2026-08-04 12:20:00")
    ]);

    expect(sorted.map((op) => op.plate)).toEqual(["AAA-1111", "BBB-2222", "CCC-3333", "DDD-4444"]);
  });

  it("preserva a ordem original entre as que seguem em andamento", () => {
    const sorted = sortOpenOperationsByLoaderQueue([
      operation("AAA-1111"),
      operation("BBB-2222"),
      operation("CCC-3333")
    ]);

    expect(sorted.map((op) => op.plate)).toEqual(["AAA-1111", "BBB-2222", "CCC-3333"]);
  });

  it("empata pela ordem original quando a conclusao tem o mesmo horario", () => {
    const sorted = sortOpenOperationsByLoaderQueue([
      operation("AAA-1111", "2026-08-04 12:10:00"),
      operation("BBB-2222", "2026-08-04 12:10:00")
    ]);

    expect(sorted.map((op) => op.plate)).toEqual(["AAA-1111", "BBB-2222"]);
  });

  // A luz verde da linha so olha se o campo esta preenchido; a ordenacao nao pode
  // largar a operacao no meio das em andamento so porque a data veio estranha.
  it("mantem no bloco das concluidas, no fim, a que tem data invalida", () => {
    const sorted = sortOpenOperationsByLoaderQueue([
      operation("AAA-1111", "carregada"),
      operation("BBB-2222"),
      operation("CCC-3333", "2026-08-04 12:10:00")
    ]);

    expect(sorted.map((op) => op.plate)).toEqual(["CCC-3333", "AAA-1111", "BBB-2222"]);
  });

  it("nao altera o array recebido", () => {
    const operations = [operation("AAA-1111"), operation("BBB-2222", "2026-08-04 12:10:00")];
    sortOpenOperationsByLoaderQueue(operations);

    expect(operations.map((op) => op.plate)).toEqual(["AAA-1111", "BBB-2222"]);
  });

  it("aceita lista vazia", () => {
    expect(sortOpenOperationsByLoaderQueue([])).toEqual([]);
  });
});
