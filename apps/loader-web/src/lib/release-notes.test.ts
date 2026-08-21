import { describe, expect, it } from "vitest";

import { parseReleaseNotes, parseSpans } from "./release-notes";

describe("parseSpans", () => {
  it("negrito, codigo e link viram pedacos separados", () => {
    expect(
      parseSpans("Ver o **fechamento** em `billing-cycle.ts` ou [no docs](https://x.dev)")
    ).toEqual([
      { kind: "text", text: "Ver o " },
      { kind: "strong", text: "fechamento" },
      { kind: "text", text: " em " },
      { kind: "code", text: "billing-cycle.ts" },
      { kind: "text", text: " ou " },
      { kind: "link", text: "no docs", href: "https://x.dev" }
    ]);
  });

  it("link que nao e http vira texto, nao clique", () => {
    // O corpo do PR vem do GitHub: um esquema estranho nao pode virar um clique
    // dentro do painel.
    expect(parseSpans("[clique](javascript:alert)")).toEqual([{ kind: "text", text: "clique" }]);
  });

  it("marcacao malformada sobrevive como texto", () => {
    expect(parseSpans("2 ** 3 e uma crase ` solta")).toEqual([
      { kind: "text", text: "2 ** 3 e uma crase ` solta" }
    ]);
  });

  it("linha sem marcacao nenhuma vira um pedaco so", () => {
    expect(parseSpans("texto simples")).toEqual([{ kind: "text", text: "texto simples" }]);
  });
});

describe("parseReleaseNotes", () => {
  it("titulo, paragrafo e lista", () => {
    const blocks = parseReleaseNotes(
      "## O que muda\n\nA fatura passa a fechar por periodo.\nA quinzena vai para o OMIE.\n\n- Fecha a fatura\n- Emite o boleto\n"
    );

    expect(blocks).toEqual([
      { kind: "heading", level: 2, spans: [{ kind: "text", text: "O que muda" }] },
      {
        kind: "paragraph",
        spans: [
          {
            kind: "text",
            text: "A fatura passa a fechar por periodo. A quinzena vai para o OMIE."
          }
        ]
      },
      {
        kind: "list",
        ordered: false,
        items: [
          { spans: [{ kind: "text", text: "Fecha a fatura" }], depth: 0 },
          { spans: [{ kind: "text", text: "Emite o boleto" }], depth: 0 }
        ]
      }
    ]);
  });

  it("lista numerada e item recuado", () => {
    const blocks = parseReleaseNotes("1. Primeiro\n2. Segundo\n   - detalhe do segundo");

    expect(blocks[0]).toEqual({
      kind: "list",
      ordered: true,
      items: [
        { spans: [{ kind: "text", text: "Primeiro" }], depth: 0 },
        { spans: [{ kind: "text", text: "Segundo" }], depth: 0 },
        { spans: [{ kind: "text", text: "detalhe do segundo" }], depth: 1 }
      ]
    });
  });

  it("bloco de codigo sai verbatim, sem interpretar marcacao", () => {
    const blocks = parseReleaseNotes("Antes\n\n```ts\nconst a = **1**;\n```\n\nDepois");

    expect(blocks[1]).toEqual({ kind: "code", text: "const a = **1**;" });
    expect(blocks[2]).toEqual({ kind: "paragraph", spans: [{ kind: "text", text: "Depois" }] });
  });

  it("cerca sem fechamento leva o resto do texto junto, sem travar", () => {
    expect(parseReleaseNotes("```\nsem fim")).toEqual([{ kind: "code", text: "sem fim" }]);
  });

  it("tabela separa cabecalho de corpo e descarta os tracinhos", () => {
    const blocks = parseReleaseNotes(
      "| Anel | Quem recebe |\n| --- | --- |\n| teste | so as de teste |"
    );

    expect(blocks[0]).toEqual({
      kind: "table",
      head: [[{ kind: "text", text: "Anel" }], [{ kind: "text", text: "Quem recebe" }]],
      rows: [[[{ kind: "text", text: "teste" }], [{ kind: "text", text: "so as de teste" }]]]
    });
  });

  it("citacao e separador", () => {
    const blocks = parseReleaseNotes(
      "> Atencao: nao desce sozinha.\n> A frota para onde esta.\n\n---"
    );

    expect(blocks).toEqual([
      {
        kind: "quote",
        spans: [{ kind: "text", text: "Atencao: nao desce sozinha. A frota para onde esta." }]
      },
      { kind: "rule" }
    ]);
  });

  it("texto vazio nao vira bloco nenhum", () => {
    expect(parseReleaseNotes("")).toEqual([]);
    expect(parseReleaseNotes("\n\n   \n")).toEqual([]);
  });
});
