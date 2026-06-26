import { afterEach, describe, expect, it, vi } from "vitest";

import { OmieClient } from "./omie-client";

describe("OmieClient", () => {
  const client = new OmieClient({
    appKey: "test-key",
    appSecret: "test-secret"
  });

  it("creates authenticated request body with credentials", () => {
    const body = client.createAuthBody("ListarClientes", { pagina: 1 });
    expect(body).toEqual({
      call: "ListarClientes",
      app_key: "test-key",
      app_secret: "test-secret",
      param: [{ pagina: 1 }]
    });
  });

  it("throws when appKey is empty", () => {
    expect(() => new OmieClient({ appKey: "", appSecret: "secret" })).toThrow(
      "OMIE appKey and appSecret are required"
    );
  });

  it("throws when appSecret is empty", () => {
    expect(() => new OmieClient({ appKey: "key", appSecret: "" })).toThrow(
      "OMIE appKey and appSecret are required"
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries REDUNDANT errors using OMIE wait hint", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            faultstring:
              "ERROR: Consumo redundante detectado. Aguarde 56 segundos para tentar novamente (REDUNDANT)."
          }),
          { status: 500, statusText: "Internal Server Error" }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = client.call("/geral/produtos/", "ListarProdutos", { pagina: 1 });

    await vi.advanceTimersByTimeAsync(57_000);

    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws OMIE faultstring responses instead of returning them as success", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ faultstring: "Credenciais invalidas" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.call("/geral/produtos/", "ListarProdutos", { pagina: 1 })).rejects.toThrow(
      "OMIE faultstring em ListarProdutos (/geral/produtos/): Credenciais invalidas"
    );
  });
});
