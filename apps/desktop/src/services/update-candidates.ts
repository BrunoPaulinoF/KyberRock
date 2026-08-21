/**
 * Quais versoes esta balanca pode instalar AGORA, anel por anel.
 *
 * ## O problema que este modulo resolve
 *
 * O anel de teste se apoia em `allowPrerelease` (ver `update-channel.ts`), e o
 * `PrivateGitHubProvider` do `electron-updater` resolve a versao assim:
 *
 *     const releases = await GET /releases            // so quando allowPrerelease
 *     return releases.find((it) => it.prerelease) || releases[0]
 *
 * Repare no `find`: com `allowPrerelease` ligado ele escolhe a **prerelease mais
 * nova**, e nao a release mais nova. Entao uma balanca de teste parada na 200
 * (prerelease) continuava vendo a 200 depois de a 201 ir para producao — presa
 * numa versao mais VELHA que a frota inteira, sem nada na tela explicando por
 * que. Era so a promocao seguinte para teste que a soltava.
 *
 * Por isso a balanca de teste passa a olhar os DOIS aneis antes de decidir:
 *
 * - a verificacao automatica mira o anel cuja versao e a mais nova (`autoRing`),
 *   entao teste nunca mais fica abaixo de producao;
 * - a verificacao manual, quando os dois aneis tem versao instalavel e elas
 *   divergem, devolve as duas opcoes (`options`) para o operador escolher na
 *   tela — o unico ponto do fluxo em que ele decide qual versao instalar.
 *
 * A balanca de producao nao escolhe nada: `options` volta vazio e o anel e
 * sempre `latest`. Oferecer versao em avaliacao para cliente seria justamente o
 * que os dois aneis existem para impedir.
 *
 * A parte pura (tudo, menos `fetchUpdateCandidates`) e testada porque ela imita
 * a escolha do `electron-updater`: se as duas divergirem, a tela oferece uma
 * versao e o updater instala outra.
 */
import type { DesktopUpdateChannel } from "./update-channel.js";

/** `beta` = anel de teste (prerelease); `latest` = producao (release estavel). */
export type UpdateRing = "beta" | "latest";

export interface UpdateRingOption {
  ring: UpdateRing;
  version: string;
}

export interface UpdateCandidates {
  /** A prerelease que o updater escolheria com `allowPrerelease` ligado. */
  test: string | null;
  /** A versao que a frota recebe — a resposta de `GET /releases/latest`. */
  production: string | null;
}

export interface UpdatePlan {
  /** Anel que a verificacao (automatica ou manual sem escolha) deve mirar. */
  autoRing: UpdateRing;
  /** As opcoes a oferecer ao operador. Vazio quando nao ha o que escolher. */
  options: UpdateRingOption[];
}

/** Compara versoes numero a numero: 0.8.9 < 0.8.10, que um compare de texto erra. */
export function compareUpdateVersions(left: string, right: string): number {
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

/** `v0.8.201` e `0.8.201` sao a mesma versao; qualquer outra coisa vira `null`. */
export function normalizeReleaseVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^v/i, "");
  return trimmed.length > 0 ? trimmed : null;
}

interface RawRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * A versao que o updater instalaria com `allowPrerelease` ligado.
 *
 * Imita `PrivateGitHubProvider.getLatestVersionInfo`: a **prerelease mais nova**
 * da lista e, se nao houver nenhuma, a primeira release dela. Rascunho e
 * descartado antes — o token embutido no app e so de leitura e o GitHub nem os
 * devolve, mas deixar a escolha depender disso seria contar com sorte.
 *
 * A lista chega do GitHub da mais nova para a mais antiga, como o updater
 * tambem assume.
 */
export function pickTestCandidateVersion(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null;

  const published = (releases as RawRelease[]).filter(
    (release) => release && typeof release === "object" && release.draft !== true
  );
  const chosen = published.find((release) => release.prerelease === true) ?? published[0];
  return chosen ? normalizeReleaseVersion(chosen.tag_name) : null;
}

/**
 * A versao que a frota recebe, lida de `GET /releases/latest`.
 *
 * Tem que ser essa chamada, e nao "a estavel mais nova da lista": `make_latest`
 * nao aparece na listagem, entao depois de uma regressao de producao as duas
 * respostas divergem — e quem manda no updater (`allowPrerelease` desligado) e
 * o `/releases/latest`.
 */
export function pickProductionCandidateVersion(release: unknown): string | null {
  if (!release || typeof release !== "object") return null;
  const raw = release as RawRelease;
  if (raw.draft === true) return null;
  return normalizeReleaseVersion(raw.tag_name);
}

/**
 * Decide o que a balanca mira sozinha e o que ela pergunta ao operador.
 *
 * No anel de teste uma versao e instalavel sempre que for DIFERENTE da
 * instalada — inclusive mais velha, porque la o `allowDowngrade` esta ligado de
 * proposito (e o que faz o "reprovar" do painel valer na balanca de teste).
 */
export function resolveUpdatePlan(input: {
  channel: DesktopUpdateChannel;
  installedVersion: string | null;
  candidates: UpdateCandidates;
}): UpdatePlan {
  const { channel, installedVersion, candidates } = input;

  if (channel !== "beta") {
    return { autoRing: "latest", options: [] };
  }

  const installed = normalizeReleaseVersion(installedVersion);
  const offerable: UpdateRingOption[] = [];
  const push = (ring: UpdateRing, version: string | null) => {
    const normalized = normalizeReleaseVersion(version);
    if (!normalized) return;
    if (installed && compareUpdateVersions(normalized, installed) === 0) return;
    if (offerable.some((option) => compareUpdateVersions(option.version, normalized) === 0)) return;
    offerable.push({ ring, version: normalized });
  };

  push("beta", candidates.test);
  push("latest", candidates.production);

  if (offerable.length === 0) {
    // Nada novo (ou consulta que falhou): segue o comportamento historico do
    // anel de teste, que e mirar a prerelease.
    return { autoRing: "beta", options: [] };
  }

  const newest = offerable.reduce((best, option) =>
    compareUpdateVersions(option.version, best.version) > 0 ? option : best
  );

  return { autoRing: newest.ring, options: offerable.length > 1 ? offerable : [] };
}

export interface FetchUpdateCandidatesOptions {
  owner: string;
  repo: string;
  token: string;
  /** Injetavel para teste; em producao e o `fetch` global do Electron. */
  fetchImpl?: typeof fetch;
}

/**
 * Le os dois aneis no GitHub.
 *
 * Best-effort de proposito: cada anel que falhar volta `null` e quem chama cai
 * no comportamento padrao. Uma consulta que nao respondeu nunca pode impedir a
 * balanca de se atualizar.
 */
export async function fetchUpdateCandidates(
  options: FetchUpdateCandidatesOptions
): Promise<UpdateCandidates> {
  const { owner, repo, token } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kyberrock-desktop-updater"
  };
  const base = `https://api.github.com/repos/${owner}/${repo}/releases`;

  const readJson = async (url: string): Promise<unknown> => {
    try {
      const response = await doFetch(url, { headers });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  };

  const [list, latest] = await Promise.all([
    readJson(`${base}?per_page=30`),
    readJson(`${base}/latest`)
  ]);

  return {
    test: pickTestCandidateVersion(list),
    production: pickProductionCandidateVersion(latest)
  };
}
