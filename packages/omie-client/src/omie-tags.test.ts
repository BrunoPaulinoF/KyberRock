import { describe, expect, it } from "vitest";

import { hasClienteTag, hasTransportadoraTag } from "./omie-tags.js";

describe("omie-tags", () => {
  it("classifies multiple tags without treating Fornecedor as Transportadora", () => {
    expect(hasClienteTag({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(true);
    expect(hasClienteTag({})).toBe(false);
    expect(hasClienteTag({ tags: [{ tag: "Fornecedor" }] })).toBe(false);
    expect(hasTransportadoraTag({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(
      false
    );
    expect(hasTransportadoraTag({ tags: [{ tag: "Transportadora" }, { tag: "Fornecedor" }] })).toBe(
      true
    );
  });

  it("matches tags regardless of accents and casing", () => {
    expect(hasTransportadoraTag({ tags: [{ tag: "TRANSPORTADORA" }] })).toBe(true);
    expect(hasClienteTag({ tags: ["cliente"] })).toBe(true);
    expect(hasClienteTag({ tags: { tags: ["Cliente"] } })).toBe(true);
  });
});
