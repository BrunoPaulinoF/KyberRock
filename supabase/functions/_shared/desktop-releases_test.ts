import { describe, expect, it } from "vitest";

import {
  compareDesktopVersions,
  summarizeDesktopReleases,
  type DesktopReleaseSummary
} from "./desktop-releases.ts";

/** Release como o GitHub devolve, na ordem dele (mais nova primeiro). */
function release(
  version: string,
  options: { assets: string[]; prerelease?: boolean; draft?: boolean } = { assets: [] }
) {
  return {
    tag_name: `v${version}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? true,
    published_at: `2026-08-19T10:00:00.000Z`,
    assets: options.assets.map((name, index) => ({ id: index + 1, name }))
  };
}

const exe = (v: string) => `KyberRock-Desktop-Setup-${v}.exe`;

function byVersion(rows: DesktopReleaseSummary[], version: string): DesktopReleaseSummary {
  const found = rows.find((row) => row.version === version);
  if (!found) throw new Error(`versao ${version} ausente no resumo`);
  return found;
}

describe("compareDesktopVersions", () => {
  it("compara numero a numero, nao como texto", () => {
    // O caso que um compare de texto erra: "0.8.9" > "0.8.10" alfabeticamente.
    expect(compareDesktopVersions("0.8.9", "0.8.10")).toBe(-1);
    expect(compareDesktopVersions("0.8.10", "0.8.9")).toBe(1);
    expect(compareDesktopVersions("0.8.150", "0.8.150")).toBe(0);
    expect(compareDesktopVersions("0.9.0", "0.10.0")).toBe(-1);
  });
});

describe("summarizeDesktopReleases", () => {
  it("classifica pelos assets: parado, em teste e producao", () => {
    const rows = summarizeDesktopReleases([
      release("0.8.152", { assets: ["build.yml", exe("0.8.152")] }),
      release("0.8.151", { assets: ["build.yml", "beta.yml", exe("0.8.151")] }),
      release("0.8.149", {
        assets: ["build.yml", "beta.yml", "latest.yml", exe("0.8.149")],
        prerelease: false
      })
    ]);

    expect(byVersion(rows, "0.8.152").state).toBe("parado");
    expect(byVersion(rows, "0.8.151").state).toBe("teste");
    expect(byVersion(rows, "0.8.149").state).toBe("producao");
    expect(byVersion(rows, "0.8.149").isCurrentProduction).toBe(true);
  });

  it("so oferece 'enviar para teste' no que esta parado", () => {
    const rows = summarizeDesktopReleases([
      release("0.8.152", { assets: ["build.yml", exe("0.8.152")] }),
      release("0.8.151", { assets: ["build.yml", "beta.yml", exe("0.8.151")] }),
      release("0.8.149", { assets: ["latest.yml", exe("0.8.149")], prerelease: false })
    ]);

    expect(byVersion(rows, "0.8.152").canSendToTest).toBe(true);
    expect(byVersion(rows, "0.8.151").canSendToTest).toBe(false);
    expect(byVersion(rows, "0.8.149").canSendToTest).toBe(false);
  });

  it("so oferece 'liberar para producao' no que ja passou pelo teste", () => {
    const rows = summarizeDesktopReleases([
      release("0.8.152", { assets: ["build.yml", exe("0.8.152")] }),
      release("0.8.151", { assets: ["build.yml", "beta.yml", exe("0.8.151")] }),
      release("0.8.149", { assets: ["latest.yml", exe("0.8.149")], prerelease: false })
    ]);

    // Parado nunca foi testado; producao ja esta na frota.
    expect(byVersion(rows, "0.8.152").canReleaseToProduction).toBe(false);
    expect(byVersion(rows, "0.8.151").canReleaseToProduction).toBe(true);
    expect(byVersion(rows, "0.8.149").canReleaseToProduction).toBe(false);
  });

  it("nao oferece liberar uma versao anterior a que esta em producao", () => {
    // Liberar isso deixaria a frota parada onde esta: o desktop nao faz
    // downgrade sozinho.
    const rows = summarizeDesktopReleases([
      release("0.8.150", { assets: ["latest.yml", exe("0.8.150")], prerelease: false }),
      release("0.8.140", { assets: ["build.yml", "beta.yml", exe("0.8.140")] })
    ]);

    const antiga = byVersion(rows, "0.8.140");
    expect(antiga.state).toBe("teste");
    expect(antiga.isOlderThanProduction).toBe(true);
    expect(antiga.canReleaseToProduction).toBe(false);
  });

  it("marca como incompleta a release sem instalador e nao deixa promover", () => {
    const rows = summarizeDesktopReleases([release("0.8.153", { assets: ["build.yml"] })]);

    expect(byVersion(rows, "0.8.153").state).toBe("incompleto");
    expect(byVersion(rows, "0.8.153").canSendToTest).toBe(false);
    expect(byVersion(rows, "0.8.153").canReleaseToProduction).toBe(false);
  });

  it("so a producao mais nova e a atual", () => {
    const rows = summarizeDesktopReleases([
      release("0.8.150", { assets: ["latest.yml", exe("0.8.150")], prerelease: false }),
      release("0.8.149", { assets: ["latest.yml", exe("0.8.149")], prerelease: false })
    ]);

    expect(byVersion(rows, "0.8.150").isCurrentProduction).toBe(true);
    expect(byVersion(rows, "0.8.149").isCurrentProduction).toBe(false);
    expect(byVersion(rows, "0.8.149").state).toBe("producao");
  });

  it("ignora draft", () => {
    const rows = summarizeDesktopReleases([
      release("0.8.154", { assets: ["build.yml", exe("0.8.154")], draft: true }),
      release("0.8.152", { assets: ["build.yml", exe("0.8.152")] })
    ]);

    expect(rows.map((row) => row.version)).toEqual(["0.8.152"]);
  });

  it("release marcada estavel mas sem latest.yml nao aparece como producao", () => {
    // Caso que ja quebrou o auto-update em silencio: se ela contasse como
    // producao, a tela diria que a frota esta nela — e a frota nao acha o
    // metadado que precisa.
    const rows = summarizeDesktopReleases([
      release("0.8.152", { assets: ["build.yml", exe("0.8.152")], prerelease: false })
    ]);

    expect(byVersion(rows, "0.8.152").state).toBe("parado");
    expect(byVersion(rows, "0.8.152").isCurrentProduction).toBe(false);
  });

  it("aguenta resposta inesperada da API sem estourar", () => {
    expect(summarizeDesktopReleases(null)).toEqual([]);
    expect(summarizeDesktopReleases({ message: "Bad credentials" })).toEqual([]);
    expect(summarizeDesktopReleases([null, {}, { tag_name: "" }])).toEqual([]);
  });
});
