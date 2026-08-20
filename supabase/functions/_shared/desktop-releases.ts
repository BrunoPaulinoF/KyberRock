/**
 * Leitura das versoes do desktop publicadas no GitHub Releases, do jeito que o
 * painel administrativo precisa ver.
 *
 * O estado de uma versao esta inteiramente em DOIS SINALIZADORES da release —
 * `draft` e `prerelease` — porque sao os unicos dois que o `electron-updater`
 * consegue enxergar num repositorio privado:
 *
 *   rascunho (draft)         -> parado: nao existe para updater nenhum
 *   publicado como prerelease-> teste: so as balancas com allowPrerelease
 *   publicado estavel        -> producao: `GET /releases/latest` responde ela
 *
 * ## Por que nao classificamos mais pelo nome do metadado
 *
 * A primeira versao usava tres nomes de arquivo (`build.yml` / `beta.yml` /
 * `latest.yml`) e nao funcionava: o `PrivateGitHubProvider` do
 * `electron-updater` resolve o metadado por `getDefaultChannelName()`, que e
 * fixo em `"latest"`. Ele NUNCA le `updater.channel`, entao `beta.yml` era um
 * arquivo que maquina nenhuma abria. O metadado agora se chama `latest.yml` nos
 * tres estados, e quem separa os aneis e o par draft/prerelease.
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
 * ordem.
 *
 * ATENCAO: os rascunhos precisam estar nessa lista — sao eles os builds
 * "parados", a materia-prima da tela. `GET /releases` so devolve rascunho para
 * quem tem acesso de escrita no repositorio, entao o token usado para listar
 * precisa de `Contents: read and write`. Com um token so de leitura a tela
 * carrega, mas sem nenhuma versao para promover.
 */
export function summarizeDesktopReleases(releases: unknown): DesktopReleaseSummary[] {
  if (!Array.isArray(releases)) return [];

  const rows = (releases as RawRelease[])
    .filter((release) => release && typeof release === "object")
    .map((release) => {
      const tag = typeof release.tag_name === "string" ? release.tag_name : "";
      const names = assetNames(release.assets);
      const installerName = names.find((name) => name.toLowerCase().endsWith(".exe")) ?? null;

      let state: DesktopReleaseState;
      if (!installerName || !names.includes("latest.yml")) {
        // Build que nao chegou a subir o trio completo (upload interrompido, run
        // reprovado no meio). Sem instalador nao ha o que distribuir; sem
        // `latest.yml` o updater acha a release e nao acha o metadado, que e a
        // falha silenciosa classica do electron-updater.
        state = "incompleto";
      } else if (release.draft === true) {
        state = "parado";
      } else if (release.prerelease === true) {
        state = "teste";
      } else {
        state = "producao";
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
