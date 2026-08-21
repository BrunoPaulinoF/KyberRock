import { describe, expect, it } from "vitest";

import {
  compareDesktopVersions,
  REJECTED_MARKER_ASSET,
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
/** Uma versao que quebrou no teste e foi reprovada. */
const reprovada = (version: string) =>
  release(version, { draft: true, assets: ["latest.yml", exe(version), REJECTED_MARKER_ASSET] });

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

  it("separa build que esta compilando de release que quebrou no meio", () => {
    // As duas chegam iguais do GitHub — release existe, assets ainda nao. A
    // diferenca e se o run que a produziu continua rodando. Sem essa distincao
    // todo merge pintava a tela de vermelho por alguns minutos.
    const incompleta = { assets: ["latest.yml"], draft: true };
    const rows = summarizeDesktopReleases(
      [release("0.8.198", incompleta), release("0.8.153", incompleta)],
      { buildingRunNumbers: ["198"] }
    );

    expect(byVersion(rows, "0.8.198").state).toBe("compilando");
    expect(byVersion(rows, "0.8.153").state).toBe("incompleto");
  });

  it("nao deixa promover o que esta compilando", () => {
    const rows = summarizeDesktopReleases(
      [release("0.8.198", { assets: ["latest.yml"], draft: true })],
      { buildingRunNumbers: ["198"] }
    );

    const linha = byVersion(rows, "0.8.198");
    expect(linha.canSendToTest).toBe(false);
    expect(linha.canReleaseToProduction).toBe(false);
  });

  it("sem a lista de runs, o compilando vira incompleto — nunca um erro", () => {
    // A consulta ao Actions pode falhar (token, rede, rate limit). Degradar
    // para a leitura anterior e aceitavel; derrubar a aba nao e.
    const rows = summarizeDesktopReleases([
      release("0.8.198", { assets: ["latest.yml"], draft: true })
    ]);

    expect(byVersion(rows, "0.8.198").state).toBe("incompleto");
  });

  it("versao reprovada nunca pode ser promovida", () => {
    const rows = summarizeDesktopReleases([reprovada("0.8.198"), release("0.8.193")]);

    const linha = byVersion(rows, "0.8.198");
    expect(linha.state).toBe("reprovada");
    expect(linha.canSendToTest).toBe(false);
    expect(linha.canReleaseToProduction).toBe(false);
    expect(linha.canReject).toBe(false);
  });

  it("o marcador de reprovada vence draft, prerelease e assets faltando", () => {
    // Reprovar deixa a release em rascunho, entao ela tambem se encaixaria em
    // "parado". O que o operador precisa ler ali e "essa quebrou", nao "essa
    // esta parada" — senao ele a manda para teste de novo semanas depois.
    const rows = summarizeDesktopReleases([
      release("0.8.198", {
        draft: true,
        prerelease: true,
        assets: [REJECTED_MARKER_ASSET]
      })
    ]);

    expect(byVersion(rows, "0.8.198").state).toBe("reprovada");
  });

  it("oferece reprovar no que esta em teste e no que esta parado", () => {
    const rows = summarizeDesktopReleases([
      parado("0.8.198"),
      emTeste("0.8.197"),
      release("0.8.193")
    ]);

    expect(byVersion(rows, "0.8.198").canReject).toBe(true);
    expect(byVersion(rows, "0.8.197").canReject).toBe(true);
  });

  it("nao oferece reprovar a producao atual", () => {
    // Tirar do ar a versao que a frota recebe deixaria as balancas sem canal
    // de atualizacao nenhum.
    const rows = summarizeDesktopReleases([release("0.8.193")]);

    const producao = byVersion(rows, "0.8.193");
    expect(producao.isCurrentProduction).toBe(true);
    expect(producao.canReject).toBe(false);
  });

  it("a producao atual e a que o /releases/latest aponta, nao a estavel mais nova", () => {
    // O caso da volta atras: 0.8.200 continua publicada como estavel, mas a
    // frota foi regredida para 0.8.193. Adivinhar pela ordem da lista apontaria
    // como producao exatamente a versao que ninguem mais recebe.
    const rows = summarizeDesktopReleases([release("0.8.200"), release("0.8.193")], {
      currentProductionTag: "v0.8.193"
    });

    expect(byVersion(rows, "0.8.193").isCurrentProduction).toBe(true);
    expect(byVersion(rows, "0.8.200").isCurrentProduction).toBe(false);
    expect(byVersion(rows, "0.8.200").isNewerThanProduction).toBe(true);
    expect(byVersion(rows, "0.8.200").isOlderThanProduction).toBe(false);
    expect(byVersion(rows, "0.8.193").isNewerThanProduction).toBe(false);
  });

  it("aceita a tag com ou sem o v inicial", () => {
    const rows = summarizeDesktopReleases([release("0.8.200"), release("0.8.193")], {
      currentProductionTag: "0.8.193"
    });

    expect(byVersion(rows, "0.8.193").isCurrentProduction).toBe(true);
  });

  it("sem a tag (consulta falhou ou funcao antiga) volta a heuristica da estavel mais nova", () => {
    const rows = summarizeDesktopReleases([release("0.8.200"), release("0.8.193")]);

    expect(byVersion(rows, "0.8.200").isCurrentProduction).toBe(true);
    expect(byVersion(rows, "0.8.193").isOlderThanProduction).toBe(true);
  });

  it("tag que nao esta na lista tambem cai na heuristica", () => {
    // Producao antiga demais para aparecer nas 30 ultimas releases: melhor a
    // leitura aproximada do que uma tela sem versao atual nenhuma.
    const rows = summarizeDesktopReleases([release("0.8.200"), release("0.8.193")], {
      currentProductionTag: "v0.7.10"
    });

    expect(byVersion(rows, "0.8.200").isCurrentProduction).toBe(true);
  });

  it("marca como mais nova que a producao so a que de fato esta a frente", () => {
    const rows = summarizeDesktopReleases(
      [parado("0.8.201"), release("0.8.200"), release("0.8.193")],
      {
        currentProductionTag: "v0.8.200"
      }
    );

    expect(byVersion(rows, "0.8.201").isNewerThanProduction).toBe(true);
    expect(byVersion(rows, "0.8.200").isNewerThanProduction).toBe(false);
    expect(byVersion(rows, "0.8.193").isNewerThanProduction).toBe(false);
    expect(byVersion(rows, "0.8.193").isOlderThanProduction).toBe(true);
  });

  it("aguenta resposta inesperada da API sem estourar", () => {
    expect(summarizeDesktopReleases(null)).toEqual([]);
    expect(summarizeDesktopReleases({ message: "Bad credentials" })).toEqual([]);
    expect(summarizeDesktopReleases([null, {}, { tag_name: "" }])).toEqual([]);
  });
});
