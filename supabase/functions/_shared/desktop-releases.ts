/**
 * Leitura das versoes do desktop publicadas no GitHub Releases, do jeito que o
 * painel administrativo precisa ver.
 *
 * O `desktop-release.yml` deixa todo build PARADO: release marcada como
 * pre-release, com o instalador anexado e um metadado de nome neutro
 * (`build.yml`) que canal nenhum segue. O `desktop-promote.yml` copia esse
 * metadado para o anel escolhido. Entao o estado de uma versao esta inteiramente
 * nos NOMES DOS ASSETS:
 *
 *   so `build.yml`            -> parado (ninguem recebe)
 *   + `beta.yml`              -> em teste (so as balancas de teste)
 *   + `latest.yml`, estavel   -> producao (toda a frota)
 *
 * Modulo puro (sem globais do Deno, sem rede) para ter teste: e ele que decide
 * quais botoes a tela oferece, e oferecer "liberar para producao" na versao
 * errada e o tipo de erro que chega em todas as pedreiras de uma vez.
 */

export type DesktopReleaseState = "producao" | "teste" | "parado" | "incompleto";

export interface DesktopReleaseSummary {
  /** Versao sem o `v` inicial, como o workflow de promocao espera receber. */
  version: string;
  tag: string;
  state: DesktopReleaseState;
  /** A versao que a frota esta recebendo agora. */
  isCurrentProduction: boolean;
  publishedAt: string | null;
  installerName: string | null;
  /** Anterior a que esta em producao: liberar isso deixaria a frota parada onde esta. */
  isOlderThanProduction: boolean;
  canSendToTest: boolean;
  canReleaseToProduction: boolean;
}

interface RawAsset {
  name?: unknown;
}

interface RawRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  assets?: unknown;
}

/** Compara versoes numero a numero: 0.8.9 < 0.8.10, que um compare de texto erra. */
export function compareDesktopVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function assetNames(assets: unknown): string[] {
  if (!Array.isArray(assets)) return [];
  return (assets as RawAsset[])
    .map((asset) => (typeof asset?.name === "string" ? asset.name : ""))
    .filter((name) => name.length > 0);
}

/**
 * Transforma a resposta do GitHub no que a tela mostra.
 *
 * Espera a lista na ordem do GitHub (mais nova primeiro) e devolve na mesma
 * ordem. `draft` fica de fora: e release que nem existe para o updater.
 */
export function summarizeDesktopReleases(releases: unknown): DesktopReleaseSummary[] {
  if (!Array.isArray(releases)) return [];

  const rows = (releases as RawRelease[])
    .filter((release) => release && typeof release === "object" && release.draft !== true)
    .map((release) => {
      const tag = typeof release.tag_name === "string" ? release.tag_name : "";
      const names = assetNames(release.assets);
      const installerName = names.find((name) => name.toLowerCase().endsWith(".exe")) ?? null;
      const isPrerelease = release.prerelease === true;

      let state: DesktopReleaseState;
      if (!installerName || names.length === 0) {
        // Build que nao chegou a subir o instalador (upload interrompido, run
        // reprovado no meio). Nao da para promover o que nao existe.
        state = "incompleto";
      } else if (!isPrerelease && names.includes("latest.yml")) {
        state = "producao";
      } else if (names.includes("beta.yml")) {
        state = "teste";
      } else {
        state = "parado";
      }

      return {
        version: tag.replace(/^v/, ""),
        tag,
        state,
        isCurrentProduction: false,
        publishedAt:
          typeof release.published_at === "string"
            ? release.published_at
            : typeof release.created_at === "string"
              ? release.created_at
              : null,
        installerName,
        isOlderThanProduction: false,
        canSendToTest: false,
        canReleaseToProduction: false
      } satisfies DesktopReleaseSummary;
    })
    .filter((row) => row.version.length > 0);

  const currentProduction = rows.find((row) => row.state === "producao");
  if (currentProduction) currentProduction.isCurrentProduction = true;

  for (const row of rows) {
    row.isOlderThanProduction = currentProduction
      ? compareDesktopVersions(row.version, currentProduction.version) < 0
      : false;

    // Mandar para teste so faz sentido no que esta parado: o que ja esta em
    // teste nao mudaria de estado, e o que ja e producao a frota inteira tem.
    row.canSendToTest = row.state === "parado";

    // Producao so pelo caminho normal (passou pelo teste) e sem voltar no
    // tempo. As MESMAS regras vivem no `desktop-promote.yml`, que e a
    // autoridade — aqui elas so evitam oferecer um botao que o workflow vai
    // recusar depois, num run que a tela nao acompanha.
    row.canReleaseToProduction = row.state === "teste" && !row.isOlderThanProduction;
  }

  return rows;
}
