import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeInternet, probeOmie, probeSupabase } from "./connectivity";

function createFetchMock(handler: (url: string) => { ok: boolean; status: number }): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const result = handler(url);
    return new Response(null, { status: result.status, statusText: result.ok ? "OK" : "ERR" });
  }) as unknown as typeof fetch;
}

describe("probeInternet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retorna online quando algum alvo responde", async () => {
    const fetchImpl = createFetchMock((url) =>
      url.includes("cloudflare") ? { ok: true, status: 200 } : { ok: false, status: 503 }
    );
    const result = await probeInternet({ fetchImpl });
    expect(result.online).toBe(true);
    expect(result.error).toBeNull();
  });

  it("retorna offline com mensagem quando nenhum alvo responde", async () => {
    const fetchImpl = createFetchMock(() => {
      throw new Error("ECONNREFUSED");
    });
    const result = await probeInternet({ fetchImpl });
    expect(result.online).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("marca offline quando alvo retorna >=500", async () => {
    const fetchImpl = createFetchMock(() => ({ ok: false, status: 502 }));
    const result = await probeInternet({ fetchImpl });
    expect(result.online).toBe(false);
    expect(result.error).toContain("502");
  });
});

describe("probeSupabase", () => {
  const originalUrl = process.env.SUPABASE_URL;
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
  });
  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }
    vi.restoreAllMocks();
  });

  it("retorna offline quando URL nao configurada", async () => {
    delete process.env.SUPABASE_URL;
    const result = await probeSupabase();
    expect(result.online).toBe(false);
    expect(result.error).toContain("SUPABASE_URL");
  });

  it("faz HEAD em /auth/v1/health e retorna online quando 2xx", async () => {
    const fetchImpl = createFetchMock(() => ({ ok: true, status: 200 }));
    const result = await probeSupabase({ fetchImpl });
    expect(result.online).toBe(true);
  });
});

describe("probeOmie", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retorna online quando app.omie.com.br responde", async () => {
    const fetchImpl = createFetchMock(() => ({ ok: true, status: 200 }));
    const result = await probeOmie({ fetchImpl });
    expect(result.online).toBe(true);
  });
});
