/**
 * O texto do PR, do jeito que da para mostrar dentro do painel.
 *
 * O corpo de um PR e markdown escrito para o GitHub: titulos, listas, tabelas,
 * trechos de codigo e links. Jogar isso na tela como texto corrido devolveria
 * uma parede de `##` e `-` que ninguem le — e e justamente essa tela que
 * responde "o que tem nesta versao" antes de alguem liberar para a frota
 * inteira.
 *
 * Por que um parser proprio, e nao uma biblioteca: o loader-web nao tem
 * nenhuma dependencia de renderizacao (ele e React + Vite e mais nada), e o
 * subconjunto que os PRs deste repositorio usam de verdade cabe em duzentas
 * linhas testadas. Puxar um markdown completo traria tambem HTML embutido —
 * que e conteudo vindo do GitHub e teria que ser sanitizado. Aqui NADA vira
 * HTML: o parser devolve dados, e a tela monta elementos React a partir deles.
 * Texto perdido no meio do caminho aparece como texto, nunca como marcacao
 * executavel.
 *
 * O que este modulo entende (o resto continua legivel como texto):
 *
 *   # ate ###        -> titulo
 *   - / * / 1.       -> lista, com um nivel de recuo
 *   | a | b |        -> tabela
 *   ```              -> bloco de codigo, verbatim
 *   >                -> citacao
 *   ---              -> separador
 *   **negrito**, `codigo`, [texto](url)
 */

export type NoteSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export interface NoteListItem {
  spans: NoteSpan[];
  /** 0 = primeiro nivel, 1 = recuado. Mais fundo que isso vira 1 mesmo. */
  depth: 0 | 1;
}

export type NoteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; spans: NoteSpan[] }
  | { kind: "paragraph"; spans: NoteSpan[] }
  | { kind: "list"; ordered: boolean; items: NoteListItem[] }
  | { kind: "quote"; spans: NoteSpan[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: NoteSpan[][]; rows: NoteSpan[][][] }
  | { kind: "rule" };

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const ORDERED_MARKER = /^\d+[.)]$/;

/**
 * Marcacao dentro de uma linha.
 *
 * Uma varredura so, na ordem em que aparece: o que fica entre um achado e o
 * proximo e texto puro. Marcacao malformada (uma crase sozinha, um `**` sem
 * par) simplesmente nao casa e sobrevive como texto — que e o comportamento
 * certo aqui: perder um pedaco do que o PR dizia seria pior do que mostrar um
 * asterisco.
 */
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseSpans(text: string): NoteSpan[] {
  const spans: NoteSpan[] = [];
  let cursor = 0;

  INLINE.lastIndex = 0;
  let match = INLINE.exec(text);
  while (match) {
    if (match.index > cursor) {
      spans.push({ kind: "text", text: text.slice(cursor, match.index) });
    }

    if (match[1] !== undefined) {
      spans.push({ kind: "code", text: match[1] });
    } else if (match[2] !== undefined) {
      spans.push({ kind: "strong", text: match[2] });
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      // So http(s) vira link de verdade. O conteudo vem do GitHub, e um
      // `javascript:` num corpo de PR nao pode virar um clique dentro do
      // painel; sem esquema conhecido, o rotulo aparece como texto.
      spans.push(
        /^https?:\/\//i.test(href)
          ? { kind: "link", text: match[3], href }
          : { kind: "text", text: match[3] }
      );
    }

    cursor = match.index + match[0].length;
    match = INLINE.exec(text);
  }

  if (cursor < text.length) spans.push({ kind: "text", text: text.slice(cursor) });
  return spans;
}

function cells(row: string): NoteSpan[][] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseSpans(cell.trim()));
}

/**
 * Quebra o corpo do PR em blocos.
 *
 * Linha a linha, sem estado escondido: cada bloco termina quando aparece uma
 * linha que nao pertence mais a ele. Texto vazio (PR sem descricao, ou com a
 * descricao inteira num rodape que foi podado) devolve lista vazia — a tela
 * trata isso dizendo que o PR nao tem texto, e nao com um modal em branco.
 */
export function parseReleaseNotes(markdown: string): NoteBlock[] {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    // Linhas seguidas de um paragrafo se juntam com espaco, como no markdown:
    // a quebra dentro de um paragrafo e do editor, nao do autor.
    blocks.push({ kind: "paragraph", spans: parseSpans(paragraph.join(" ")) });
    paragraph = [];
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (FENCE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // fecha a cerca (ou termina o texto sem ela)
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flushParagraph();
      // Um `####` de PR e um subtitulo como qualquer outro para quem le a tela:
      // tres niveis bastam, e o quarto so ficaria menor que o corpo do texto.
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, spans: parseSpans(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push((QUOTE.exec(lines[index]) as RegExpExecArray)[1].trim());
        index += 1;
      }
      blocks.push({ kind: "quote", spans: parseSpans(quoted.join(" ")) });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = ORDERED_MARKER.test(item[2]);
      const items: NoteListItem[] = [];
      while (index < lines.length) {
        const next = LIST_ITEM.exec(lines[index]);
        if (!next) break;
        items.push({
          spans: parseSpans(next[3].trim()),
          depth: next[1].length >= 2 ? 1 : 0
        });
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flushParagraph();
      const rows: string[] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        // A linha de tracinhos so separa cabecalho de corpo: nao e dado.
        if (!TABLE_DIVIDER.test(lines[index])) rows.push(lines[index]);
        index += 1;
      }
      const [head, ...body] = rows;
      blocks.push({
        kind: "table",
        head: head ? cells(head) : [],
        rows: body.map(cells)
      });
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return blocks;
}
