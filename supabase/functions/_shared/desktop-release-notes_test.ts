import { describe, expect, it } from "vitest";

import {
  applyPullRequests,
  bodiesUnavailable,
  cleanPullRequestBody,
  entriesFromCommits,
  pickReleaseNoteRefs,
  pullInfoFromMessage,
  pullNumbersToFetch
} from "./desktop-release-notes.ts";

const SHA = (seed: string) => seed.padEnd(40, "0");

/** Release como a listagem do GitHub devolve. Rascunho = build ainda parado. */
function release(
  version: string,
  options: { draft?: boolean; target?: string } = {}
): Record<string, unknown> {
  const draft = options.draft ?? false;
  return {
    tag_name: `v${version}`,
    draft,
    // Rascunho guarda o sha do build; depois de publicada a release passa a ser
    // alcancavel pela tag, e o GitHub devolve o branch neste campo.
    target_commitish: options.target ?? (draft ? SHA(version.replaceAll(".", "")) : "main"),
    html_url: `https://github.com/BrunoPaulinoF/KyberRock/releases/tag/v${version}`
  };
}

/** Commit como `GET /compare` devolve (mais antigo primeiro). */
function commit(
  sha: string,
  message: string,
  parents: string[],
  options: { login?: string; date?: string } = {}
): Record<string, unknown> {
  return {
    sha,
    html_url: `https://github.com/BrunoPaulinoF/KyberRock/commit/${sha}`,
    parents: parents.map((parent) => ({ sha: parent })),
    author: options.login ? { login: options.login } : null,
    commit: {
      message,
      author: { name: "Bruno", date: options.date ?? "2026-08-20T10:00:00Z" }
    }
  };
}

describe("pickReleaseNoteRefs", () => {
  it("usa o sha do rascunho e compara com a versao anterior", () => {
    const refs = pickReleaseNoteRefs(
      [release("0.8.207", { draft: true }), release("0.8.206"), release("0.8.205")],
      "0.8.207"
    );

    expect(refs?.head).toBe(SHA("08207"));
    expect(refs?.base).toBe("v0.8.206");
    expect(refs?.baseVersion).toBe("0.8.206");
    expect(refs?.tag).toBe("v0.8.207");
  });

  it("versao publicada e alcancada pela tag, nao pelo branch do target_commitish", () => {
    const refs = pickReleaseNoteRefs([release("0.8.206"), release("0.8.205")], "0.8.206");

    expect(refs?.head).toBe("v0.8.206");
  });

  it("a anterior e a de menor numero de versao, nao a de cima na lista", () => {
    // Depois de uma volta atras a 0.8.205 e republicada e sobe na listagem do
    // GitHub (ordenada por data). Comparar com ela mostraria os PRs ao
    // contrario: o que entrou entre 205 e 206 apareceria como novidade da 207.
    const refs = pickReleaseNoteRefs(
      [release("0.8.205"), release("0.8.207", { draft: true }), release("0.8.206")],
      "0.8.207"
    );

    expect(refs?.baseVersion).toBe("0.8.206");
  });

  it("a versao mais antiga da janela fica sem base", () => {
    const refs = pickReleaseNoteRefs([release("0.8.207", { draft: true })], "0.8.207");

    expect(refs?.base).toBeNull();
    expect(refs?.baseVersion).toBeNull();
  });

  it("rascunho sem sha nao tem por onde ser comparado", () => {
    const refs = pickReleaseNoteRefs(
      [release("0.8.207", { draft: true, target: "main" })],
      "0.8.207"
    );

    expect(refs).toBeNull();
  });

  it("versao ausente da listagem devolve null", () => {
    expect(pickReleaseNoteRefs([release("0.8.206")], "0.8.999")).toBeNull();
    expect(pickReleaseNoteRefs(null, "0.8.206")).toBeNull();
  });
});

describe("pullInfoFromMessage", () => {
  it("merge commit do GitHub: numero na primeira linha, titulo no corpo", () => {
    expect(
      pullInfoFromMessage(
        "Merge pull request #243 from BrunoPaulinoF/claude/remove-weight-unit\n\nPesos nas tabelas: so o numero"
      )
    ).toEqual({ pullNumber: 243, title: "Pesos nas tabelas: so o numero" });
  });

  it("merge sem corpo cai na propria primeira linha", () => {
    expect(pullInfoFromMessage("Merge pull request #243 from BrunoPaulinoF/branch")).toEqual({
      pullNumber: 243,
      title: "Merge pull request #243 from BrunoPaulinoF/branch"
    });
  });

  it("squash merge: o numero vem no fim do titulo", () => {
    expect(pullInfoFromMessage("Corrige o rateio da primeira fatura (#218)\n\ndetalhes")).toEqual({
      pullNumber: 218,
      title: "Corrige o rateio da primeira fatura"
    });
  });

  it("commit direto na main nao tem PR", () => {
    expect(pullInfoFromMessage("Ajusta o texto do coupon")).toEqual({
      pullNumber: null,
      title: "Ajusta o texto do coupon"
    });
  });
});

describe("entriesFromCommits", () => {
  /**
   * Intervalo tipico: dois PRs mesclados, cada um com seus proprios commits de
   * branch no meio da lista.
   */
  const compare = [
    commit(SHA("c1"), "Primeiro commit do PR 240", [SHA("base")]),
    commit(SHA("c2"), "Segundo commit do PR 240", [SHA("c1")]),
    commit(
      SHA("m240"),
      "Merge pull request #240 from BrunoPaulinoF/a\n\nFecha faturas por periodo",
      [SHA("base"), SHA("c2")]
    ),
    commit(SHA("c3"), "Unico commit do PR 243", [SHA("m240")]),
    commit(SHA("m243"), "Merge pull request #243 from BrunoPaulinoF/b\n\nPesos so com o numero", [
      SHA("m240"),
      SHA("c3")
    ])
  ];

  it("uma linha por PR mesclado, do mais novo para o mais antigo", () => {
    const { entries, omitted } = entriesFromCommits(compare);

    expect(entries.map((entry) => entry.pullNumber)).toEqual([243, 240]);
    expect(entries.map((entry) => entry.title)).toEqual([
      "Pesos so com o numero",
      "Fecha faturas por periodo"
    ]);
    expect(omitted).toBe(0);
  });

  it("commit direto na main entra na lista sem numero de PR", () => {
    const { entries } = entriesFromCommits([
      commit(SHA("m240"), "Merge pull request #240 from BrunoPaulinoF/a\n\nAlgo", [
        SHA("base"),
        SHA("x")
      ]),
      commit(SHA("d1"), "Corrige typo direto na main", [SHA("m240")], { login: "brunopaulinof" })
    ]);

    expect(entries[0]).toMatchObject({
      pullNumber: null,
      title: "Corrige typo direto na main",
      author: "brunopaulinof"
    });
    expect(entries[1]?.pullNumber).toBe(240);
  });

  it("o limite corta e diz quantos ficaram de fora", () => {
    const { entries, omitted } = entriesFromCommits(compare, { limit: 1 });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.pullNumber).toBe(243);
    expect(omitted).toBe(1);
  });

  it("um commit avulso (versao sem anterior) vira uma entrada", () => {
    const { entries } = entriesFromCommits([
      commit(SHA("m243"), "Merge pull request #243 from BrunoPaulinoF/b\n\nPesos", [
        SHA("m240"),
        SHA("c3")
      ])
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.pullNumber).toBe(243);
  });

  it("intervalo vazio ou resposta invalida nao quebra", () => {
    expect(entriesFromCommits([])).toEqual({ entries: [], omitted: 0 });
    expect(entriesFromCommits(null)).toEqual({ entries: [], omitted: 0 });
  });
});

describe("cleanPullRequestBody", () => {
  it("tira o rodape da ferramenta e os trailers do fim", () => {
    const cleaned = cleanPullRequestBody(
      "## O que muda\n\n- Fecha a fatura por periodo\n\n---\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"
    );

    expect(cleaned).toBe("## O que muda\n\n- Fecha a fatura por periodo");
  });

  it("tira comentario de template, que nunca foi para ser lido", () => {
    expect(cleanPullRequestBody("<!-- descreva aqui -->\nTexto de verdade")).toBe(
      "Texto de verdade"
    );
  });

  it("nao come um tracinho no meio do texto", () => {
    const body = "Antes\n\n---\n\nDepois";
    expect(cleanPullRequestBody(body)).toBe(body);
  });

  it("corpo ausente vira texto vazio", () => {
    expect(cleanPullRequestBody(null)).toBe("");
    expect(cleanPullRequestBody(undefined)).toBe("");
  });
});

describe("pullNumbersToFetch", () => {
  it("so os PRs, sem repetir e respeitando o limite", () => {
    const entries = entriesFromCommits([
      commit(SHA("m1"), "Merge pull request #1 from x/a\n\nA", [SHA("base"), SHA("y")]),
      commit(SHA("d1"), "Commit direto", [SHA("m1")]),
      commit(SHA("m2"), "Merge pull request #2 from x/b\n\nB", [SHA("d1"), SHA("z")])
    ]).entries;

    expect(pullNumbersToFetch(entries)).toEqual([2, 1]);
    expect(pullNumbersToFetch(entries, 1)).toEqual([2]);
  });
});

describe("applyPullRequests", () => {
  const entries = entriesFromCommits([
    commit(SHA("m243"), "Merge pull request #243 from BrunoPaulinoF/b\n\nTitulo do merge", [
      SHA("m240"),
      SHA("c3")
    ])
  ]).entries;

  it("o texto do PR manda no que ele souber dizer", () => {
    const [entry] = applyPullRequests(entries, [
      {
        number: 243,
        title: "Titulo renomeado depois do merge",
        body: "Corpo do PR\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
        user: { login: "brunopaulinof" },
        merged_at: "2026-08-21T12:00:00Z",
        html_url: "https://github.com/BrunoPaulinoF/KyberRock/pull/243"
      }
    ]);

    expect(entry).toMatchObject({
      title: "Titulo renomeado depois do merge",
      body: "Corpo do PR",
      author: "brunopaulinof",
      date: "2026-08-21T12:00:00Z",
      url: "https://github.com/BrunoPaulinoF/KyberRock/pull/243"
    });
  });

  it("consulta que nao veio deixa a entrada como estava", () => {
    const [entry] = applyPullRequests(entries, [null, { number: 999 }]);

    expect(entry?.title).toBe("Titulo do merge");
    expect(entry?.body).toBe("");
  });
});

describe("bodiesUnavailable", () => {
  const entry = (pullNumber: number | null, body: string) => ({
    sha: SHA("a"),
    pullNumber,
    title: "t",
    body,
    author: null,
    date: null,
    url: ""
  });

  it("tem PR e nenhum texto: o PAT nao le pull requests", () => {
    expect(bodiesUnavailable([entry(243, ""), entry(240, "")])).toBe(true);
  });

  it("um texto que veio ja e prova de que a permissao existe", () => {
    expect(bodiesUnavailable([entry(243, "texto"), entry(240, "")])).toBe(false);
  });

  it("versao so com commit direto nao tem o que ler", () => {
    expect(bodiesUnavailable([entry(null, "")])).toBe(false);
    expect(bodiesUnavailable([])).toBe(false);
  });
});
