/**
 * Escolha do instalador que o link publico de download entrega.
 *
 * Modulo puro (sem globais do Deno) justamente para ter teste: desde que
 * compilar deixou de ser distribuir (ver "Desktop versioning" no AGENTS.md),
 * TODO build nasce como pre-release e so sai desse estado quando alguem o
 * libera para producao. Se este filtro cair, o link publico volta a entregar o
 * build ainda nao aprovado — e instalacao nova e o pior lugar para isso,
 * porque nao ha versao anterior para voltar.
 */

export interface ReleaseAssetLike {
  id: number;
  name?: string;
}

export interface ReleaseLike {
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAssetLike[];
}

/**
 * Devolve o instalador `.exe` da release **estavel** mais recente que tenha um.
 *
 * A lista chega do GitHub da mais nova para a mais antiga. Uma release parcial
 * ou quebrada (upload interrompido, sem `.exe`) nao derruba o link: caimos na
 * proxima valida. `draft` e `prerelease` nunca sao candidatas.
 */
export function pickPublicInstaller(releases: unknown): ReleaseAssetLike | undefined {
  if (!Array.isArray(releases)) return undefined;

  for (const release of releases as ReleaseLike[]) {
    if (!release || typeof release !== "object") continue;
    if (release.draft || release.prerelease) continue;

    const found = (release.assets ?? []).find(
      (asset) => typeof asset?.name === "string" && asset.name.toLowerCase().endsWith(".exe")
    );
    if (found) return found;
  }

  return undefined;
}
