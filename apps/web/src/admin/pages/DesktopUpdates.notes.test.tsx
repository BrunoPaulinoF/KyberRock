import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReleaseNotesModal, type ReleaseNoteEntry, type ReleaseNotes } from "./DesktopUpdates";

function entry(overrides: Partial<ReleaseNoteEntry> = {}): ReleaseNoteEntry {
  return {
    sha: "a".repeat(40),
    pullNumber: 243,
    title: "Fechamento de faturas por periodo",
    body: "## O que muda\n\n- Fecha a fatura por **periodo**\n- Emite o boleto em `mercado-pago.ts`",
    author: "brunopaulinof",
    date: "2026-08-20T13:00:00.000Z",
    url: "https://github.com/BrunoPaulinoF/KyberRock/pull/243",
    ...overrides
  };
}

function notes(overrides: Partial<ReleaseNotes> = {}): ReleaseNotes {
  return {
    version: "0.8.207",
    tag: "v0.8.207",
    baseVersion: "0.8.206",
    entries: [entry()],
    omitted: 0,
    releaseUrl: "https://github.com/BrunoPaulinoF/KyberRock/releases/tag/v0.8.207",
    compareUrl: "https://github.com/BrunoPaulinoF/KyberRock/compare/v0.8.206...v0.8.207",
    bodiesUnavailable: false,
    ...overrides
  };
}

function render(props: Partial<Parameters<typeof ReleaseNotesModal>[0]> = {}): string {
  return renderToStaticMarkup(
    <ReleaseNotesModal
      version="0.8.207"
      notes={notes()}
      isLoading={false}
      error={null}
      onClose={() => {}}
      {...props}
    />
  );
}

describe("ReleaseNotesModal", () => {
  it("mostra o PR e o texto dele com a marcacao renderizada", () => {
    const html = render();

    expect(html).toContain("Fechamento de faturas por periodo");
    expect(html).toContain("PR #243");
    expect(html).toContain("brunopaulinof");
    expect(html).toContain('<h5 class="adm-note-heading"><span>O que muda</span></h5>');
    expect(html).toContain("<strong>periodo</strong>");
    expect(html).toContain('<code class="adm-note-code">mercado-pago.ts</code>');
    // O `##` e o `-` do markdown viraram estrutura, e nao texto na tela.
    expect(html).not.toContain("## O que muda");
  });

  it("o texto do PR nunca vira marcacao executavel", () => {
    // O corpo vem do GitHub: o que ele traz e conteudo, nao HTML do painel.
    const html = render({
      notes: notes({
        entries: [
          entry({ body: "<img src=x onerror=alert(1)> e um [link](javascript:alert) suspeito" })
        ]
      })
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("link");
  });

  it("sem permissao de leitura dos PRs, diz o que falta em vez de fingir PR vazio", () => {
    const html = render({
      notes: notes({ entries: [entry({ body: "" })], bodiesUnavailable: true })
    });

    expect(html).toContain("Pull requests: read");
    expect(html).not.toContain("Mesclado sem texto de descricao");
    // O link para abrir o PR no GitHub continua ali: e a saida enquanto o PAT
    // nao ganha a permissao.
    expect(html).toContain("https://github.com/BrunoPaulinoF/KyberRock/pull/243");
  });

  it("PR mesclado sem descricao diz isso, sem deixar um vazio sem explicacao", () => {
    const html = render({ notes: notes({ entries: [entry({ body: "" })] }) });

    expect(html).toContain("Mesclado sem texto de descricao");
  });

  it("versao sem PR nenhum explica o caso em vez de abrir um modal em branco", () => {
    const html = render({ notes: notes({ entries: [] }) });

    expect(html).toContain("Nenhum PR entre esta versao e a anterior");
  });

  it("erro e carregamento aparecem dentro do modal", () => {
    expect(render({ notes: null, isLoading: true })).toContain("Lendo os PRs desta versao");
    expect(render({ notes: null, error: "Falha ao consultar o GitHub (502)." })).toContain(
      "Falha ao consultar o GitHub (502)."
    );
  });

  it("PRs alem do limite viram um aviso com a saida para o GitHub", () => {
    const html = render({ notes: notes({ omitted: 3 }) });

    expect(html).toContain("E mais 3 PRs");
    expect(html).toContain("compare/v0.8.206...v0.8.207");
  });
});
