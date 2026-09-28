import { describe, expect, it } from "vitest";

import {
  dedupeByNameAndCode,
  dedupeDrivers,
  dedupePaymentMethods,
  dedupeVehicles,
  normalizePlateKey,
  representativeIds
} from "./dedupe";

describe("dedupePaymentMethods", () => {
  const method = (
    id: string,
    name: string,
    extra: Partial<{
      omie_code: string | null;
      is_active: boolean;
      created_at: string;
      is_wallet: boolean;
    }> = {}
  ) => ({
    id,
    name,
    omie_code: "01",
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
    ...extra
  });

  it("junta as copias de cada balanca numa linha so", () => {
    const groups = dedupePaymentMethods([
      method("b", "Dinheiro", { created_at: "2026-08-04T00:00:00Z" }),
      method("a", "Dinheiro", { created_at: "2026-07-28T00:00:00Z" }),
      method("c", "Pix", { omie_code: "17" }),
      method("d", "PIX", { omie_code: "17" })
    ]);
    expect(groups).toHaveLength(2);
    // Fica a mais antiga (a primeira balanca que cadastrou).
    expect(groups[0]).toEqual({ row: expect.objectContaining({ id: "a" }), ids: ["a", "b"] });
    expect(groups[1].ids).toHaveLength(2);
  });

  it("ativa representa o grupo mesmo sendo mais nova", () => {
    const [group] = dedupePaymentMethods([
      method("old", "Boleto", { is_active: false, created_at: "2026-07-01T00:00:00Z" }),
      method("new", "Boleto", { created_at: "2026-08-01T00:00:00Z" })
    ]);
    expect(group.row.id).toBe("new");
  });

  it("mesmo nome com codigo OMIE ou natureza diferente nao junta", () => {
    const groups = dedupePaymentMethods([
      method("a", "Em carteira", { omie_code: "99", is_wallet: true }),
      method("b", "Em carteira", { omie_code: "99" }),
      method("c", "Dinheiro", { omie_code: "02" }),
      method("d", "Dinheiro", { omie_code: "01" })
    ]);
    expect(groups).toHaveLength(4);
  });
});

describe("dedupeByNameAndCode", () => {
  it("condicoes com o mesmo nome viram uma", () => {
    const groups = dedupeByNameAndCode([
      { id: "1", name: "A Vista", omie_code: null },
      { id: "2", name: "A vista", omie_code: null },
      { id: "3", name: "2 Parcelas", omie_code: null }
    ]);
    expect(groups.map((group) => group.ids)).toEqual([["1", "2"], ["3"]]);
  });
});

describe("dedupeVehicles", () => {
  it("a mesma placa com e sem traco e o mesmo caminhao; fica a editada por ultimo", () => {
    expect(normalizePlateKey("abc-1d23")).toBe("ABC1D23");
    const [group] = dedupeVehicles([
      { id: "v1", plate: "ABC-1D23", updated_at: "2026-08-01T00:00:00Z" },
      { id: "v2", plate: "abc1d23", updated_at: "2026-09-01T00:00:00Z" }
    ]);
    expect(group.row.id).toBe("v2");
    expect(group.ids).toEqual(["v2", "v1"]);
  });
});

describe("dedupeDrivers", () => {
  it("homonimo com documento diferente e outra pessoa", () => {
    const groups = dedupeDrivers([
      { id: "1", name: "Jose Silva", document: "111" },
      { id: "2", name: "José  Silva", document: "222" },
      { id: "3", name: "jose silva", document: null }
    ]);
    // A copia sem documento vai para o primeiro documento do nome.
    expect(groups.map((group) => group.ids)).toEqual([["1", "3"], ["2"]]);
  });

  it("nome vazio nao junta com ninguem", () => {
    const groups = dedupeDrivers([
      { id: "1", name: "" },
      { id: "2", name: "" }
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("representativeIds", () => {
  it("leva qualquer copia ao representante", () => {
    const groups = dedupeByNameAndCode([
      { id: "a", name: "Caixinha", created_at: "2026-01-01" },
      { id: "b", name: "Caixinha", created_at: "2026-02-01" }
    ]);
    const map = representativeIds(groups);
    expect(map.get("b")).toBe("a");
    expect(map.get("a")).toBe("a");
  });
});
