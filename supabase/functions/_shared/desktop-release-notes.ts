/**
 * O que entrou em cada versao do desktop — o texto dos PRs, do jeito que a aba
 * "Atualizacoes" precisa mostrar.
 *
 * A pergunta que este modulo responde e a que a tela nao respondia: a lista
 * mostra "0.8.207" e a situacao dela, mas nao o que ESSA versao mudou. Quem
 * decide liberar para a frota precisa saber o que esta liberando, e ate agora a
 * unica saida era abrir o GitHub e cruzar tag com PR na mao.
 *
 * ## De onde sai o texto
 *
 * A release nao guarda nada: o `desktop-release.yml` cria o rascunho so com
 * nome e tag. O que existe e o COMMIT que gerou o build (`target_commitish` do
 * rascunho, a tag depois de publicada), e dele o GitHub sabe chegar no PR.
 *
 *   versao -> commit -> commits desde a versao anterior -> PRs -> texto
 *
 * Comparar com a VERSAO ANTERIOR (e nao olhar so o commit da versao) importa
 * porque nem todo merge gera build: o `desktop-release.yml` tem filtro de
 * paths, entao um merge que so toca `supabase/` ou `apps/loader-web` nao produz
 * versao nenhuma — mas entra no proximo build assim mesmo, porque o build e um
 * checkout da main inteira. Mostrar so o ultimo PR esconderia esses.
 *
 * ## Por que a CADEIA DO PRIMEIRO PAI, e nao a lista crua
 *
 * O `GET /compare` devolve TODOS os commits do intervalo — inclusive os commits
 * de dentro de cada branch mesclada. Uma versao com dois PRs de tres commits
 * cada viraria oito linhas quase iguais na tela. A main deste repositorio e
 * mesclada com merge commit, entao a cadeia do primeiro pai (de `head` para
 * tras, sempre por `parents[0]`) e exatamente a lista de PRs mesclados, um por
 * linha, sem precisar perguntar nada a mais para o GitHub.
 *
 * ## Permissao: o numero do PR e de graca, o texto nao
 *
 * O numero e o titulo do PR estao na MENSAGEM do merge commit, que vem junto do
 * `compare` — ou seja, saem com o `Contents: read` que o token do painel ja
 * tem. O corpo do PR so existe em `GET /pulls/{n}`, que exige
 * `Pull requests: read` no PAT. Por isso a leitura do corpo e best-effort e o
 * resto da tela funciona sem ela: sem a permissao o administrador ainda ve
 * QUAIS PRs entraram na versao, com link para abrir cada um no GitHub.
 *
 * Modulo puro (sem globais do Deno, sem rede) para ter teste: e ele que decide
 * o que a tela chama de "o que mudou nesta versao", e uma lista errada aqui
 * leva alguem a liberar para a frota inteira acreditando ter lido outra coisa.
 */

import { compareDesktopVersions } from "./desktop-releases.ts";

/** Um PR (ou um commit direto na main) que entrou na versao. */
export interface ReleaseNoteEntry {
  sha: string;
  /** Numero do PR, ou `null` quando o commit foi direto na main. */
  pullNumber: number | null;
  title: string;
  /** Texto do PR, ja limpo. Vazio quando nao deu para ler (ver o cabecalho). */
  body: string;
  author: string | null;
  /** ISO do merge (ou do commit, quando nao ha PR). */
  date: string | null;
  url: string;
}

/**
 * Onde comecar e onde terminar a leitura de uma versao.
 *
 * `base` e `null` na versao mais antiga da janela consultada: nao ha com o que
 * comparar, e a tela cai na leitura do proprio commit da versao — que ainda
 * responde a pergunta principal, "qual PR gerou este build".
 */
export interface ReleaseNoteRefs {
  tag: string;
  /** Ref da versao pedida: o sha do build, ou a tag depois de publicada. */
  head: string;
  base: string | null;
  baseVersion: string | null;
  /** `html_url` da release. Em rascunho so abre para quem administra o repo. */
  releaseUrl: string | null;
}

/** Quantos PRs a tela mostra por versao. Acima disso vira "e mais N". */
export const MAX_NOTE_ENTRIES = 20;

/** Quantos corpos de PR buscamos por abertura — cada um e uma chamada na API. */
export const MAX_NOTE_BODIES = 10;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MERGE_PATTERN = /^Merge pull request #(\d+) from /;
const SQUASH_PATTERN = /\(#(\d+)\)\s*$/;
const SEPARATOR_PATTERN = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * Rodape de ferramenta no fim do corpo do PR.
 *
 * Sai do texto porque a tela e lida por quem toca a pedreira, nao por quem
 * revisa codigo: assinatura de agente e id de sessao nao dizem nada sobre o que
 * a versao mudou, e ocupam a primeira dobra do modal.
 */
const BODY_NOISE_PATTERNS: readonly RegExp[] = [
  /^\s*🤖\s*generated with/i,
  /^\s*_?generated (by|with) \[?claude code\]?/i,
  /^\s*co-authored-by:/i,
  /^\s*claude-session:/i,
  /^\s*https:\/\/claude\.ai\/code\//i
];

interface RawRelease {
  tag_name?: unknown;
  target_commitish?: unknown;
  draft?: unknown;
  html_url?: unknown;
}

interface RawCommit {
  sha?: unknown;
  html_url?: unknown;
  parents?: unknown;
  author?: unknown;
  commit?: unknown;
}

/** Como a listagem do GitHub identifica o codigo de uma release. */
function refOf(release: RawRelease): string {
  const target = typeof release.target_commitish === "string" ? release.target_commitish : "";
  if (SHA_PATTERN.test(target)) return target;
  // Rascunho nao tem tag no git (o GitHub so cria ao publicar), entao um
  // `target_commitish` que seja o nome de um branch nao serve de ancora: naquele
  // caso a versao simplesmente nao tem por onde ser comparada.
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  return release.draft === true ? "" : tag;
}

function versionOf(release: RawRelease): string {
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  return tag.replace(/^v/, "");
}

/**
 * Descobre o intervalo de commits de uma versao.
 *
 * Recebe a listagem crua do GitHub (a mesma ja usada pela aba) e devolve o ref
 * da versao pedida mais o da versao imediatamente ANTERIOR que tenha ancora —
 * "anterior" por numero de versao, e nao pela posicao na lista: a ordem do
 * GitHub e por data de criacao da release, e uma volta atras publica de novo uma
 * versao antiga, que sobe na lista sem ter voltado no tempo.
 */
export function pickReleaseNoteRefs(releases: unknown, version: string): ReleaseNoteRefs | null {
  if (!Array.isArray(releases)) return null;
  const rows = (releases as RawRelease[]).filter((row) => row && typeof row === "object");

  const target = rows.find((row) => versionOf(row) === version);
  if (!target) return null;

  const head = refOf(target);
  if (!head) return null;

  let base: RawRelease | null = null;
  for (const row of rows) {
    const candidate = versionOf(row);
    if (!candidate || compareDesktopVersions(candidate, version) >= 0) continue;
    if (!refOf(row)) continue;
    if (!base || compareDesktopVersions(candidate, versionOf(base)) > 0) base = row;
  }

  return {
    tag: typeof target.tag_name === "string" ? target.tag_name : `v${version}`,
    head,
    base: base ? refOf(base) : null,
    baseVersion: base ? versionOf(base) : null,
    releaseUrl: typeof target.html_url === "string" ? target.html_url : null
  };
}

/** Numero e titulo do PR a partir da mensagem do commit que o mesclou. */
export function pullInfoFromMessage(message: string): {
  pullNumber: number | null;
  title: string;
} {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();

  const merge = MERGE_PATTERN.exec(first);
  if (merge) {
    // Merge commit do GitHub: a primeira linha e "Merge pull request #N from
    // branch" e o titulo do PR vem no corpo. Sem corpo (merge feito na mao)
    // sobra a propria primeira linha, que ao menos identifica o PR.
    const title = lines.slice(1).find((line) => line.trim().length > 0);
    return { pullNumber: Number.parseInt(merge[1], 10), title: (title ?? first).trim() };
  }

  const squash = SQUASH_PATTERN.exec(first);
  if (squash) {
    return {
      pullNumber: Number.parseInt(squash[1], 10),
      title: first.replace(SQUASH_PATTERN, "").trim()
    };
  }

  return { pullNumber: null, title: first };
}

/**
 * Tira do corpo do PR o que nao ajuda quem le a tela.
 *
 * Comentario de template (`<!-- ... -->`) nunca foi para ser lido, e o rodape de
 * ferramenta no fim (assinatura, `Co-Authored-By`, link de sessao) fala sobre
 * como o PR foi escrito, nao sobre o que a versao mudou.
 */
export function cleanPullRequestBody(body: unknown): string {
  if (typeof body !== "string") return "";

  const lines = body
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n");

  // Poda pelo FIM: o rodape mora la, e cortar na primeira ocorrencia de um
  // padrao arriscaria comer texto de verdade que so cita a ferramenta.
  while (lines.length > 0) {
    const last = (lines[lines.length - 1] ?? "").trim();
    const isNoise =
      last.length === 0 ||
      SEPARATOR_PATTERN.test(last) ||
      BODY_NOISE_PATTERNS.some((pattern) => pattern.test(last));
    if (!isNoise) break;
    lines.pop();
  }

  while (lines.length > 0 && (lines[0] ?? "").trim().length === 0) lines.shift();

  return lines.join("\n");
}

/**
 * Transforma a resposta de `GET /compare` (ou um commit avulso) na lista de PRs
 * da versao.
 *
 * Espera os commits na ordem do GitHub (mais antigo primeiro) e devolve na
 * ordem inversa — a mesma da tela, do mais novo para o mais antigo. Percorre a
 * CADEIA DO PRIMEIRO PAI a partir do topo: e ela que contem um item por merge, e
 * nao os commits de dentro de cada branch (ver o cabecalho).
 */
export function entriesFromCommits(
  commits: unknown,
  options: { limit?: number } = {}
): { entries: ReleaseNoteEntry[]; omitted: number } {
  if (!Array.isArray(commits) || commits.length === 0) return { entries: [], omitted: 0 };

  const rows = (commits as RawCommit[]).filter((row) => row && typeof row === "object");
  const bySha = new Map<string, RawCommit>();
  for (const row of rows) {
    if (typeof row.sha === "string") bySha.set(row.sha, row);
  }

  const head = rows[rows.length - 1];
  const chain: RawCommit[] = [];
  let cursor: RawCommit | undefined = head;
  const visited = new Set<string>();
  while (cursor && typeof cursor.sha === "string" && !visited.has(cursor.sha)) {
    visited.add(cursor.sha);
    chain.push(cursor);
    const parents = Array.isArray(cursor.parents)
      ? (cursor.parents as Array<{ sha?: unknown }>)
      : [];
    const firstParent = typeof parents[0]?.sha === "string" ? parents[0].sha : "";
    // O primeiro pai fora da janela e o fim do intervalo: e o commit da versao
    // anterior (a base do compare), que nao entrou nesta versao.
    cursor = firstParent ? bySha.get(firstParent) : undefined;
  }

  const limit = options.limit ?? MAX_NOTE_ENTRIES;
  const entries = chain.slice(0, limit).map((row): ReleaseNoteEntry => {
    const commit = (row.commit ?? {}) as {
      message?: unknown;
      author?: { name?: unknown; date?: unknown };
    };
    const message = typeof commit.message === "string" ? commit.message : "";
    const { pullNumber, title } = pullInfoFromMessage(message);
    const author = (row.author ?? {}) as { login?: unknown };

    return {
      sha: typeof row.sha === "string" ? row.sha : "",
      pullNumber,
      title,
      body: "",
      author:
        typeof author.login === "string"
          ? author.login
          : typeof commit.author?.name === "string"
            ? commit.author.name
            : null,
      date: typeof commit.author?.date === "string" ? commit.author.date : null,
      url: typeof row.html_url === "string" ? row.html_url : ""
    };
  });

  return { entries, omitted: Math.max(0, chain.length - entries.length) };
}

/** Numeros de PR que valem uma consulta de texto, na ordem da tela. */
export function pullNumbersToFetch(
  entries: readonly ReleaseNoteEntry[],
  limit = MAX_NOTE_BODIES
): number[] {
  const numbers: number[] = [];
  for (const entry of entries) {
    if (entry.pullNumber === null || numbers.includes(entry.pullNumber)) continue;
    if (numbers.length >= limit) break;
    numbers.push(entry.pullNumber);
  }
  return numbers;
}

/**
 * Junta o texto lido em `GET /pulls/{n}` a lista vinda dos commits.
 *
 * O PR manda no que der para ler dele (titulo, autor, data, link): a mensagem do
 * merge commit e uma copia do titulo no momento do merge, e o PR pode ter sido
 * renomeado depois. O que ele nao trouxer fica como estava — a entrada nunca
 * piora por causa de uma consulta que falhou pela metade.
 */
export function applyPullRequests(
  entries: readonly ReleaseNoteEntry[],
  pulls: readonly unknown[]
): ReleaseNoteEntry[] {
  const byNumber = new Map<number, Record<string, unknown>>();
  for (const pull of pulls) {
    if (!pull || typeof pull !== "object") continue;
    const raw = pull as Record<string, unknown>;
    if (typeof raw.number === "number") byNumber.set(raw.number, raw);
  }

  return entries.map((entry) => {
    const pull = entry.pullNumber === null ? undefined : byNumber.get(entry.pullNumber);
    if (!pull) return { ...entry };

    const user = (pull.user ?? {}) as { login?: unknown };
    return {
      ...entry,
      title: typeof pull.title === "string" && pull.title.trim() ? pull.title.trim() : entry.title,
      body: cleanPullRequestBody(pull.body),
      author: typeof user.login === "string" ? user.login : entry.author,
      date: typeof pull.merged_at === "string" ? pull.merged_at : entry.date,
      url: typeof pull.html_url === "string" ? pull.html_url : entry.url
    };
  });
}

/**
 * Nenhum texto chegou, apesar de haver PR para ler?
 *
 * E o sinal de que o PAT nao tem `Pull requests: read` — a tela usa isso para
 * dizer o que falta em vez de deixar o administrador achar que os PRs vieram
 * todos vazios.
 */
export function bodiesUnavailable(entries: readonly ReleaseNoteEntry[]): boolean {
  const withPull = entries.filter((entry) => entry.pullNumber !== null);
  return withPull.length > 0 && withPull.every((entry) => entry.body.length === 0);
}
