import { describe, expect, it } from "vitest";

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
});
