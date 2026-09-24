import { describe, expect, it } from "vitest";

import {
  bearerToken,
  canEditCustomers,
  canEditFleet,
  canManagePrices,
  resolveWebSession,
  type WebSessionClient
} from "./web-session";

function clientWith(input: {
  user?: { id: string; email?: string } | null;
  authError?: { message: string } | null;
  profile?: Record<string, unknown> | null;
  profileError?: { message: string; code?: string } | null;
}): WebSessionClient {
  return {
    auth: {
      getUser: async () => ({
        data: { user: input.user === undefined ? { id: "user-1" } : input.user },
        error: input.authError ?? null
      })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: input.profile === undefined ? null : input.profile,
            error: input.profileError ?? null
          })
        })
      })
    })
  };
}

const PERFIL_COMERCIAL = {
  id: "user-1",
  email: "comercial@pedreira.com",
  name: "Rafaela",
  role: "comercial",
  company_id: "company-1",
  unit_id: "unit-1",
  is_active: true
};

describe("bearerToken", () => {
  it("le o token do cabecalho, ignorando caixa e espacos", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer   abc.def  ")).toBe("abc.def");
  });

  it("sem token nao ha sessao", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
  });
});

describe("resolveWebSession", () => {
  it("devolve a sessao do comercial com a empresa do perfil", async () => {
    const result = await resolveWebSession(
      clientWith({ profile: PERFIL_COMERCIAL }),
      "Bearer token"
    );

    expect(result).toEqual({
      ok: true,
      session: {
        userId: "user-1",
        email: "comercial@pedreira.com",
        name: "Rafaela",
        role: "comercial",
        companyId: "company-1",
        unitId: "unit-1"
      }
    });
  });

  it("sem cabecalho e 401 (o site manda para o login)", async () => {
    const result = await resolveWebSession(clientWith({ profile: PERFIL_COMERCIAL }), null);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("token recusado pelo Auth e 401", async () => {
    const result = await resolveWebSession(
      clientWith({ user: null, authError: { message: "invalid JWT" } }),
      "Bearer velho"
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  /**
   * O carregador tem login valido, mas nao tem o que fazer aqui. 403 e nao 401 de proposito:
   * 401 faria o site deslogar e pedir login de novo — e o login estaria certo.
   */
  it("carregador e 403, nao 401", async () => {
    const result = await resolveWebSession(
      clientWith({ profile: { ...PERFIL_COMERCIAL, role: "loader" } }),
      "Bearer token"
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("monitoramento e operacao entram no site", async () => {
    for (const role of ["monitoramento", "operacao"]) {
      const result = await resolveWebSession(
        clientWith({ profile: { ...PERFIL_COMERCIAL, role } }),
        "Bearer token"
      );
      expect(result, role).toMatchObject({ ok: true, session: { role } });
    }
  });

  it("perfil inativo ou ausente e 403", async () => {
    expect(
      await resolveWebSession(
        clientWith({ profile: { ...PERFIL_COMERCIAL, is_active: false } }),
        "Bearer token"
      )
    ).toMatchObject({ ok: false, status: 403 });
    expect(await resolveWebSession(clientWith({ profile: null }), "Bearer token")).toMatchObject({
      ok: false,
      status: 403
    });
  });

  /** Banco fora do ar nao e "usuario sem acesso" — ver `_shared/db-read-error.ts`. */
  it("leitura indisponivel e 503, nao 403", async () => {
    const result = await resolveWebSession(
      clientWith({
        profileError: { message: "connection refused", code: "08006" }
      }),
      "Bearer token"
    );
    expect(result).toMatchObject({ ok: false, status: 503 });
  });
});

describe("canManagePrices", () => {
  it("so o gestor mexe em preco", () => {
    expect(canManagePrices("gestor")).toBe(true);
    expect(canManagePrices("comercial")).toBe(false);
  });
});

describe("o que cada perfil edita", () => {
  it("cliente: comercial e gestor", () => {
    expect(canEditCustomers("gestor")).toBe(true);
    expect(canEditCustomers("comercial")).toBe(true);
    expect(canEditCustomers("operacao")).toBe(false);
    expect(canEditCustomers("monitoramento")).toBe(false);
  });

  it("frota: todos menos o monitoramento", () => {
    expect(canEditFleet("gestor")).toBe(true);
    expect(canEditFleet("comercial")).toBe(true);
    expect(canEditFleet("operacao")).toBe(true);
    expect(canEditFleet("monitoramento")).toBe(false);
  });
});
