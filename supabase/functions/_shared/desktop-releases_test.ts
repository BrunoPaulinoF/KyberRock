import { describe, expect, it } from "vitest";

import {
  compareDesktopVersions,
  summarizeDesktopReleases,
  type DesktopReleaseSummary
} from "./desktop-releases.ts";

const exe = (v: string) => `KyberRock-Desktop-Setup-${v}.exe`;

/**
 * Release como o GitHub devolve, na ordem dele (mais nova primeiro).
 *
 * O padrao e o de um build completo e publicado como estavel (producao); cada
 * teste liga so o sinalizador que lhe interessa.
 */
function release(
  version: string,
  options: { assets?: string[]; prerelease?: boolean; draft?: boolean } = {}
) {
  return {
    tag_name: `v${version}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    published_at: `2026-08-19T10:00:00.000Z`,
    assets: (options.assets ?? ["latest.yml", exe(version)]).map((name, index) => ({
      id: index + 1,
      name
    }))
  };
}

/** Um build recem-saido do `desktop-release.yml`: completo, porem rascunho. */
const parado = (version: string) => release(version, { draft: true });
/** Uma versao que o painel mandou para o anel de teste. */
const emTeste = (version: string) => release(version, { prerelease: true });

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
  it("classifica pelo par draft/prerelease: parado, em teste e producao", () => {
    const rows = summarizeDesktopReleases([
      parado("0.8.152"),
      emTeste("0.8.151"),
      release("0.8.149")
    ]);

    expect(byVersion(rows, "0.8.152").state).toBe("parado");
    expect(byVersion(rows, "0.8.151").state).toBe("teste");
    expect(byVersion(rows, "0.8.149").state).toBe("producao");
    expect(byVersion(rows, "0.8.149").isCurrentProduction).toBe(true);
  });

  it("mantem o rascunho na lista — e ele o build a promover", () => {
    // Regressao: a versao anterior deste modulo descartava `draft`, herdado de
    // quando rascunho nao fazia parte do fluxo. Descartar agora deixaria a tela
    // permanentemente vazia, sem nada para mandar para teste.
    const rows = summarizeDesktopReleases([parado("0.8.154"), release("0.8.149")]);

    expect(rows.map((row) => row.version)).toEqual(["0.8.154", "0.8.149"]);
    expect(byVersion(rows, "0.8.154").canSendToTest).toBe(true);
  });

  it("so oferece 'enviar para teste' no que esta parado", () => {
    const rows = summarizeDesktopReleases([
      parado("0.8.152"),
      emTeste("0.8.151"),
      release("0.8.149")
    ]);

    expect(byVersion(rows, "0.8.152").canSendToTest).toBe(true);
    expect(byVersion(rows, "0.8.151").canSendToTest).toBe(false);
    expect(byVersion(rows, "0.8.149").canSendToTest).toBe(false);
  });

  it("so oferece 'liberar para producao' no que ja passou pelo teste", () => {
    const rows = summarizeDesktopReleases([
      parado("0.8.152"),
      emTeste("0.8.151"),
      release("0.8.149")
    ]);

    // Parado nunca foi testado; producao ja esta na frota.
    expect(byVersion(rows, "0.8.152").canReleaseToProduction).toBe(false);
    expect(byVersion(rows, "0.8.151").canReleaseToProduction).toBe(true);
    expect(byVersion(rows, "0.8.149").canReleaseToProduction).toBe(false);
  });

  it("nao oferece liberar uma versao anterior a que esta em producao", () => {
    // Liberar isso deixaria a frota parada onde esta: o desktop nao faz
    // downgrade sozinho.
    const rows = summarizeDesktopReleases([release("0.8.150"), emTeste("0.8.140")]);

    const antiga = byVersion(rows, "0.8.140");
    expect(antiga.state).toBe("teste");
    expect(antiga.isOlderThanProduction).toBe(true);
    expect(antiga.canReleaseToProduction).toBe(false);
  });

  it("marca como incompleta a release sem instalador e nao deixa promover", () => {
    const rows = summarizeDesktopReleases([
      release("0.8.153", { assets: ["latest.yml"], draft: true })
    ]);

    expect(byVersion(rows, "0.8.153").state).toBe("incompleto");
    expect(byVersion(rows, "0.8.153").canSendToTest).toBe(false);
    expect(byVersion(rows, "0.8.153").canReleaseToProduction).toBe(false);
  });

  it("release sem latest.yml e incompleta, mesmo com o instalador anexado", () => {
    // Falha silenciosa classica do electron-updater: ele acha a release, nao
    // acha o metadado e para de atualizar sem dizer nada. Promover isso levaria
    // o sintoma para a frota inteira.
    const rows = summarizeDesktopReleases([
      release("0.8.152", { assets: [exe("0.8.152")], draft: true })
    ]);

    expect(byVersion(rows, "0.8.152").state).toBe("incompleto");
    expect(byVersion(rows, "0.8.152").canSendToTest).toBe(false);
  });

  it("so a producao mais nova e a atual", () => {
    const rows = summarizeDesktopReleases([release("0.8.150"), release("0.8.149")]);

    expect(byVersion(rows, "0.8.150").isCurrentProduction).toBe(true);
    expect(byVersion(rows, "0.8.149").isCurrentProduction).toBe(false);
    expect(byVersion(rows, "0.8.149").state).toBe("producao");
  });

  it("aguenta resposta inesperada da API sem estourar", () => {
    expect(summarizeDesktopReleases(null)).toEqual([]);
    expect(summarizeDesktopReleases({ message: "Bad credentials" })).toEqual([]);
    expect(summarizeDesktopReleases([null, {}, { tag_name: "" }])).toEqual([]);
  });
});
