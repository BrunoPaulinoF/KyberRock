/**
 * Leitura das versoes do desktop publicadas no GitHub Releases, do jeito que o
 * painel administrativo precisa ver.
 *
 * O estado de uma versao esta inteiramente em DOIS SINALIZADORES da release —
 * `draft` e `prerelease` — porque sao os unicos dois que o `electron-updater`
 * consegue enxergar num repositorio privado:
 *
 *   rascunho (draft)          -> parado: nao existe para updater nenhum
 *   publicado como prerelease -> teste: so as balancas com allowPrerelease
 *   publicado estavel         -> producao: `GET /releases/latest` responde ela
 *
 * Mais dois estados que nao vem das flags:
 *
 *   marcador `REPROVADA.txt`  -> reprovada: quebrou no teste, nunca vai subir
 *   build ainda rodando       -> compilando: os arquivos estao subindo agora
 *
 * ## Por que nao classificamos pelo nome do metadado
 *
 * A primeira versao usava tres nomes de arquivo (`build.yml` / `beta.yml` /
 * `latest.yml`) e nao funcionava: o `PrivateGitHubProvider` do
 * `electron-updater` resolve o metadado por `getDefaultChannelName()`, que e
 * fixo em `"latest"`. Ele NUNCA le `updater.channel`, entao `beta.yml` era um
 * arquivo que maquina nenhuma abria. O metadado agora se chama `latest.yml` em
 * todos os estados, e quem separa os aneis e o par draft/prerelease.
 *
 * Modulo puro (sem globais do Deno, sem rede) para ter teste: e ele que decide
 * quais botoes a tela oferece, e oferecer "liberar para producao" na versao
 * errada e o tipo de erro que chega em todas as pedreiras de uma vez.
 */

export type DesktopReleaseState =
  | "producao"
  | "teste"
  | "parado"
  | "compilando"
  | "reprovada"
  | "incompleto";

/**
 * Asset que marca uma versao como reprovada no teste.
 *
 * Mora na propria release, e nao numa tabela: assim a marca acompanha a versao
 * para sempre, sem depender de o banco estar de pe nem de quem esta olhando. O
 * `desktop-promote.yml` recusa publicar uma release marcada — inclusive com
 * `force`, porque "reprovada" quer dizer reprovada.
 */
export const REJECTED_MARKER_ASSET = "REPROVADA.txt";

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
  /**
   * Posterior a que esta em producao.
   *
   * Fora de uma regressao isso nao acontece com release estavel — producao E a
   * estavel mais nova. Depois de uma volta atras, porem, a versao de onde se
   * voltou continua publicada e mais nova que a producao: e ela que o painel
   * precisa oferecer para retomar, senao a regressao vira porta de uma via so.
   */
  isNewerThanProduction: boolean;
  canSendToTest: boolean;
  canReleaseToProduction: boolean;
  /** Da para reprovar: tirar do ar e travar a promocao para sempre. */
  canReject: boolean;
}

export interface SummarizeOptions {
  /**
   * `run_number` dos runs de `desktop-release` que ainda nao terminaram.
   *
   * A versao de um build e `MAJOR.MINOR.<github.run_number>` (ver
   * `desktop-release.yml`), entao o terceiro numero da versao E o numero do
   * run. E o que permite dizer "esta compilando" em vez de "esta quebrada"
   * enquanto os assets ainda estao subindo.
   *
   * Lista vazia (ou consulta que falhou) so faz a release incompleta aparecer
   * como incompleta — degrada para a leitura anterior, nunca para um erro.
   */
  buildingRunNumbers?: readonly string[];
  /**
   * `tag_name` do que o `GET /releases/latest` responde AGORA.
   *
   * Sem isto a producao atual seria adivinhada como "a estavel mais nova da
   * lista", que e verdade ate a primeira volta atras: ao regredir, a release de
   * onde se voltou continua estavel e continua no topo da listagem, e a tela
   * apontaria como producao justamente a versao que a frota deixou de receber.
   * `make_latest` nao aparece em campo nenhum da listagem — so `/releases/latest`
   * sabe, entao e de la que a verdade tem que vir.
   *
   * Ausente (consulta que falhou, funcao antiga) volta a heuristica anterior.
   */
  currentProductionTag?: string | null;
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

/** Terceiro numero da versao — que e o `run_number` do build que a produziu. */
function runNumberOf(version: string): string {
  return version.split(".")[2] ?? "";
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
export function summarizeDesktopReleases(
  releases: unknown,
  options: SummarizeOptions = {}
): DesktopReleaseSummary[] {
  if (!Array.isArray(releases)) return [];

  const building = new Set(options.buildingRunNumbers ?? []);

  const rows = (releases as RawRelease[])
    .filter((release) => release && typeof release === "object")
    // O tipo de retorno e anotado (em vez de `satisfies` no literal) porque os
    // campos booleanos abaixo nascem `false` e sao preenchidos no laco seguinte:
    // com `satisfies` o TypeScript os fixa no literal `false` e toda atribuicao
    // vira erro. O CI nao compila as Edge Functions, entao isso passava batido.
    .map((release): DesktopReleaseSummary => {
      const tag = typeof release.tag_name === "string" ? release.tag_name : "";
      const version = tag.replace(/^v/, "");
      const names = assetNames(release.assets);
      const installerName = names.find((name) => name.toLowerCase().endsWith(".exe")) ?? null;
      const isComplete = Boolean(installerName) && names.includes("latest.yml");

      let state: DesktopReleaseState;
      if (names.includes(REJECTED_MARKER_ASSET)) {
        // Reprovada vem antes de tudo: e o fato que importa sobre esta versao,
        // e ela costuma estar incompleta ou em rascunho tambem.
        state = "reprovada";
      } else if (!isComplete) {
        // Sem instalador ou sem metadado. Pode ser um build ainda subindo os
        // arquivos (normal, dura poucos minutos) ou um run que morreu no meio
        // (a release fica assim para sempre). Sao coisas MUITO diferentes para
        // quem olha a tela, entao separamos pelo run que ainda esta rodando.
        state = building.has(runNumberOf(version)) ? "compilando" : "incompleto";
      } else if (release.draft === true) {
        state = "parado";
      } else if (release.prerelease === true) {
        state = "teste";
      } else {
        state = "producao";
      }

      return {
        version,
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
        isNewerThanProduction: false,
        canSendToTest: false,
        canReleaseToProduction: false,
        canReject: false
      };
    })
    .filter((row) => row.version.length > 0);

  const currentTag = (options.currentProductionTag ?? "").replace(/^v/, "").trim();
  const currentProduction =
    (currentTag ? rows.find((row) => row.version === currentTag) : undefined) ??
    rows.find((row) => row.state === "producao");
  if (currentProduction) currentProduction.isCurrentProduction = true;

  for (const row of rows) {
    const distance = currentProduction
      ? compareDesktopVersions(row.version, currentProduction.version)
      : 0;
    row.isOlderThanProduction = distance < 0;
    row.isNewerThanProduction = distance > 0;

    // Mandar para teste so faz sentido no que esta parado: o que ja esta em
    // teste nao mudaria de estado, e o que ja e producao a frota inteira tem.
    row.canSendToTest = row.state === "parado";

    // Producao so pelo caminho normal (passou pelo teste) e sem voltar no
    // tempo. As MESMAS regras vivem no `desktop-promote.yml`, que e a
    // autoridade — aqui elas so evitam oferecer um botao que o workflow vai
    // recusar depois, num run que a tela nao acompanha.
    row.canReleaseToProduction = row.state === "teste" && !row.isOlderThanProduction;

    // Reprovar vale para o que ainda pode subir. Na producao atual nao: tirar
    // do ar a versao que a frota recebe deixaria as balancas sem canal.
    row.canReject = (row.state === "teste" || row.state === "parado") && !row.isCurrentProduction;
  }

  return rows;
}
