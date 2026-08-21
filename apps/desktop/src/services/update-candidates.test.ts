import { describe, expect, it, vi } from "vitest";

import {
  compareUpdateVersions,
  fetchUpdateCandidates,
  normalizeReleaseVersion,
  pickProductionCandidateVersion,
  pickTestCandidateVersion,
  resolveUpdatePlan
} from "./update-candidates";

function release(tag: string, flags: { draft?: boolean; prerelease?: boolean } = {}) {
  return { tag_name: tag, draft: flags.draft ?? false, prerelease: flags.prerelease ?? false };
}

describe("compareUpdateVersions", () => {
  it("compara numero a numero, nao como texto", () => {
    expect(compareUpdateVersions("0.8.9", "0.8.10")).toBe(-1);
    expect(compareUpdateVersions("0.8.201", "0.8.200")).toBe(1);
    expect(compareUpdateVersions("0.8.200", "0.8.200")).toBe(0);
  });
});

describe("normalizeReleaseVersion", () => {
  it("aceita a tag com e sem o v", () => {
    expect(normalizeReleaseVersion("v0.8.201")).toBe("0.8.201");
    expect(normalizeReleaseVersion(" 0.8.201 ")).toBe("0.8.201");
  });

  it("recusa o que nao e versao", () => {
    expect(normalizeReleaseVersion("")).toBeNull();
    expect(normalizeReleaseVersion(null)).toBeNull();
    expect(normalizeReleaseVersion(42)).toBeNull();
  });
});

describe("pickTestCandidateVersion", () => {
  it("escolhe a prerelease mais nova, como o electron-updater faz", () => {
    const list = [release("v0.8.201"), release("v0.8.200", { prerelease: true })];
    expect(pickTestCandidateVersion(list)).toBe("0.8.200");
  });

  it("cai na release mais nova quando nao ha prerelease publicada", () => {
    expect(pickTestCandidateVersion([release("v0.8.201"), release("v0.8.199")])).toBe("0.8.201");
  });

  it("ignora rascunho", () => {
    const list = [
      release("v0.8.202", { draft: true, prerelease: true }),
      release("v0.8.200", { prerelease: true })
    ];
    expect(pickTestCandidateVersion(list)).toBe("0.8.200");
  });

  it("aguenta resposta que nao e lista", () => {
    expect(pickTestCandidateVersion(null)).toBeNull();
    expect(pickTestCandidateVersion({ message: "Not Found" })).toBeNull();
  });
});

describe("pickProductionCandidateVersion", () => {
  it("le a tag de /releases/latest", () => {
    expect(pickProductionCandidateVersion(release("v0.8.201"))).toBe("0.8.201");
  });

  it("aguenta resposta vazia ou de erro", () => {
    expect(pickProductionCandidateVersion(null)).toBeNull();
    expect(pickProductionCandidateVersion(release("v0.8.201", { draft: true }))).toBeNull();
  });
});

describe("resolveUpdatePlan", () => {
  it("balanca de producao nunca escolhe nada", () => {
    const plan = resolveUpdatePlan({
      channel: "latest",
      installedVersion: "0.8.200",
      candidates: { test: "0.8.202", production: "0.8.201" }
    });
    expect(plan).toEqual({ autoRing: "latest", options: [] });
  });

  it("solta a balanca de teste presa numa versao abaixo da producao", () => {
    // O caso que originou este modulo: teste na 200, producao ja na 201.
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.200",
      candidates: { test: "0.8.200", production: "0.8.201" }
    });
    expect(plan.autoRing).toBe("latest");
    // A 200 e a instalada, entao nao ha escolha: so a producao sobrou.
    expect(plan.options).toEqual([]);
  });

  it("oferece os dois aneis quando ha versao nova nos dois", () => {
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.200",
      candidates: { test: "0.8.202", production: "0.8.201" }
    });
    expect(plan.autoRing).toBe("beta");
    expect(plan.options).toEqual([
      { ring: "beta", version: "0.8.202" },
      { ring: "latest", version: "0.8.201" }
    ]);
  });

  it("mira producao quando ela e a mais nova das duas ofertas", () => {
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.199",
      candidates: { test: "0.8.200", production: "0.8.201" }
    });
    expect(plan.autoRing).toBe("latest");
    expect(plan.options).toHaveLength(2);
  });

  it("oferece a volta para uma versao mais velha no anel de teste", () => {
    // Prerelease reprovada: a balanca de teste roda com allowDowngrade ligado.
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.202",
      candidates: { test: "0.8.200", production: "0.8.201" }
    });
    expect(plan.autoRing).toBe("latest");
    expect(plan.options).toEqual([
      { ring: "beta", version: "0.8.200" },
      { ring: "latest", version: "0.8.201" }
    ]);
  });

  it("nao oferece escolha quando os dois aneis apontam para a mesma versao", () => {
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.200",
      candidates: { test: "0.8.201", production: "0.8.201" }
    });
    expect(plan.autoRing).toBe("beta");
    expect(plan.options).toEqual([]);
  });

  it("sem candidato nenhum segue mirando o anel de teste", () => {
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.200",
      candidates: { test: null, production: null }
    });
    expect(plan).toEqual({ autoRing: "beta", options: [] });
  });

  it("consulta que falhou de um lado nao tira o outro do ar", () => {
    const plan = resolveUpdatePlan({
      channel: "beta",
      installedVersion: "0.8.200",
      candidates: { test: null, production: "0.8.201" }
    });
    expect(plan.autoRing).toBe("latest");
    expect(plan.options).toEqual([]);
  });
});

describe("fetchUpdateCandidates", () => {
  it("le os dois aneis do GitHub", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      const body = href.endsWith("/latest")
        ? release("v0.8.201")
        : [release("v0.8.201"), release("v0.8.200", { prerelease: true })];
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const candidates = await fetchUpdateCandidates({
      owner: "acme",
      repo: "app",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(candidates).toEqual({ test: "0.8.200", production: "0.8.201" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("devolve null no anel que falhou, sem estourar", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/latest")) throw new Error("offline");
      return new Response(JSON.stringify([release("v0.8.200", { prerelease: true })]), {
        status: 200
      });
    });

    await expect(
      fetchUpdateCandidates({
        owner: "acme",
        repo: "app",
        token: "t",
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).resolves.toEqual({ test: "0.8.200", production: null });
  });

  it("resposta de erro do GitHub tambem vira null", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));

    await expect(
      fetchUpdateCandidates({
        owner: "acme",
        repo: "app",
        token: "t",
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).resolves.toEqual({ test: null, production: null });
  });
});
