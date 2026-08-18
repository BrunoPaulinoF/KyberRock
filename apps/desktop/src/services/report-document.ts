/**
 * Blocos comuns dos documentos gerados pelo desktop (PDF A4 e planilha `.xls`).
 *
 * Sairam de `customer-report-render.ts` quando o relatorio de conferencia de faturamento
 * passou a gerar os mesmos dois formatos: o estilo, a tabela, a faixa de KPIs e os
 * formatadores sao os mesmos, e mantê-los num lugar so e o que garante que dois
 * relatorios diferentes saiam com a mesma cara — e que arrumar o alinhamento de uma
 * coluna arrume nos dois.
 *
 * A planilha e HTML de tabelas gravado com extensao `.xls` (o mesmo truque de
 * `desktop:export-report-excel`), que o Excel abre nativamente sem dependencia nova.
 */

/**
 * Estilo dos documentos A4. `landscape` e para as listas largas (operacao a operacao);
 * `portrait` para os resumos.
 */
export function documentStyle(orientation: "portrait" | "landscape"): string {
  return `
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--brand:#1d4ed8}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);margin:0;font-size:12px}
.header{display:flex;justify-content:space-between;align-items:flex-end;border-left:6px solid var(--brand);padding:4px 0 14px 14px;margin-bottom:8px;border-bottom:2px solid var(--line)}
.header h1{margin:0;font-size:22px;letter-spacing:.2px}
.header .customer{margin:6px 0 0;font-size:15px;font-weight:700}
.header .period{margin:4px 0 0;color:var(--muted);font-size:13px}
.header .generated{color:var(--muted);font-size:11px;text-align:right;white-space:nowrap}
.badge{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;background:var(--brand);color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0 8px}
.kpi{border:1px solid var(--line);border-top:3px solid var(--brand);border-radius:10px;padding:10px 12px;background:var(--soft)}
.kpi span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.kpi strong{display:block;margin-top:4px;font-size:18px}
section{margin-top:18px;break-inside:avoid}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px;font-weight:800}
table{width:100%;border-collapse:collapse;font-size:12px}
table.detail{font-size:9px}
table.detail th,table.detail td{padding:4px 5px}
th,td{border:1px solid var(--line);padding:7px 9px;text-align:left}
th{background:var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
table.kv th{width:220px;background:var(--soft);font-size:11px}
tbody tr:nth-child(even){background:var(--soft)}
tr{break-inside:avoid}
.num{text-align:right;white-space:nowrap}
.empty{text-align:center;color:var(--muted);font-style:italic}
.note{margin:6px 0 0;font-size:10px;color:var(--muted);font-style:italic}
tfoot td{font-weight:bold;background:#eef2ff;border-top:2px solid var(--brand)}
@page{size:A4 ${orientation};margin:12mm}`;
}

export function kpiCards(kpis: Array<[string, string]>): string {
  return `<div class="kpis">${kpis
    .map(
      ([label, value]) =>
        `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join("")}</div>`;
}

export function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

/**
 * Tabela do PDF. A primeira coluna fica alinhada a esquerda e as demais a direita
 * quando o conteudo e numerico (todas as tabelas dos relatorios seguem esse formato).
 */
export function table(
  headers: string[],
  rows: string[][],
  footer: string[] | null,
  emptyMessage: string,
  className?: string
): string {
  const head = headers
    .map((header, index) => `<th${index === 0 ? "" : ' class="num"'}>${escapeHtml(header)}</th>`)
    .join("");
  const body = rows.length
    ? rows
        .map(
          (cells) =>
            `<tr>${cells
              .map(
                (cell, index) => `<td${index === 0 ? "" : ' class="num"'}>${escapeHtml(cell)}</td>`
              )
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td class="empty" colspan="${headers.length}">${escapeHtml(emptyMessage)}</td></tr>`;
  const foot =
    footer && rows.length
      ? `<tfoot><tr>${footer
          .map((cell, index) => `<td${index === 0 ? "" : ' class="num"'}>${escapeHtml(cell)}</td>`)
          .join("")}</tr></tfoot>`
      : "";
  return `<table${className ? ` class="${className}"` : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

/**
 * Estilo das planilhas. O arquivo e HTML de tabelas gravado com extensao `.xls`, entao
 * quem le este CSS e o importador do Excel: ele entende seletor de elemento e de CLASSE,
 * mas nao seletor estrutural — por isso a faixa zebrada e a linha de total vem marcadas
 * linha a linha, e nao com `:nth-child`.
 */
export const SPREADSHEET_STYLE = `
body{font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#0f172a;margin:14px}
h1{font-size:16pt;margin:0;color:#1d4ed8}
p.sub{margin:2px 0 0;font-size:10pt;color:#475569}
p.note{margin:10px 0 0;font-size:9pt;color:#64748b;font-style:italic}
h2{font-size:12pt;margin:20px 0 4px;color:#1d4ed8;border-bottom:2px solid #1d4ed8;padding-bottom:2px}
table{border-collapse:collapse;margin:0 0 4px}
th{background:#1d4ed8;color:#ffffff;font-weight:bold;border:1px solid #1e40af;padding:5px 8px;text-align:left}
td{border:1px solid #cbd5e1;padding:4px 8px;mso-number-format:"\\@";vertical-align:top}
tr.alt td{background:#f1f5f9}
th.num,td.num{text-align:right}
tr.total td{font-weight:bold;background:#dbeafe;border-top:2px solid #1d4ed8}
`;

/**
 * Celulas que valem como numero para efeito de ALINHAMENTO (o conteudo continua texto,
 * senao o Excel comeria o zero a esquerda de um codigo e transformaria CNPJ em notacao
 * cientifica): valor, peso, contagem, preco por tonelada, parcela "1/3", duracao, data
 * e mes. Um texto solto na coluna ja a desqualifica — meia coluna alinhada a direita e
 * pior que uma inteira a esquerda.
 */
const NUMERIC_SHEET_CELL = /^-?(r\$\s*)?[\d.,]+(\s*(kg|t|%|\/t|min|h)|\/\d+)?$/i;
const DURATION_SHEET_CELL = /^\d+h\s*\d{1,2}min$/i;
const DAY_SHEET_CELL = /^\d{2}\/\d{2}\/\d{4}$/;
const MONTH_SHEET_CELL = /^\d{2}\/\d{4}$/;

function isNumericSheetColumn(rows: string[][], index: number): boolean {
  let hasValue = false;
  for (const row of rows) {
    const cell = (row[index] ?? "").trim();
    if (!cell || cell === "-") continue;
    if (
      !NUMERIC_SHEET_CELL.test(cell) &&
      !DURATION_SHEET_CELL.test(cell) &&
      !DAY_SHEET_CELL.test(cell) &&
      !MONTH_SHEET_CELL.test(cell)
    ) {
      return false;
    }
    hasValue = true;
  }
  return hasValue;
}

/**
 * Largura da coluna estimada pelo conteudo mais longo. O Excel nao ajusta as colunas de
 * um HTML importado sozinho: sem isto a planilha abre com "#####" nos valores e nomes
 * cortados, que e exatamente o que se quer evitar.
 */
function sheetColumnWidth(header: string, rows: string[][], index: number): number {
  let longest = header.length;
  for (const row of rows) {
    longest = Math.max(longest, (row[index] ?? "").length);
  }
  return Math.min(Math.max(longest * 8 + 22, 72), 360);
}

export function sheetTable(
  title: string,
  headers: string[],
  rows: string[][],
  footer: string[] | null = null
): string {
  // A primeira coluna e sempre o rotulo da linha (mes, placa, produto, cliente) e fica a
  // esquerda mesmo quando so tem data ou numero — e por onde se le a tabela.
  const numeric = headers.map((_header, index) => index > 0 && isNumericSheetColumn(rows, index));
  const cellClass = (index: number) => (numeric[index] ? ' class="num"' : "");
  const head = headers
    .map(
      (header, index) =>
        `<th${cellClass(index)} style="width:${sheetColumnWidth(header, rows, index)}px">${escapeHtml(header)}</th>`
    )
    .join("");
  const body = rows.length
    ? rows
        .map(
          (cells, rowIndex) =>
            `<tr${rowIndex % 2 === 1 ? ' class="alt"' : ""}>${cells
              .map((cell, index) => `<td${cellClass(index)}>${escapeHtml(cell)}</td>`)
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${headers.length}">Sem dados no periodo.</td></tr>`;
  // O total fica dentro do `tbody`: `tfoot` importado do HTML nem sempre chega no fim da
  // planilha, e uma linha de total no meio da tabela seria pior que nao ter.
  const foot =
    footer && rows.length
      ? `<tr class="total">${footer
          .map((cell, index) => `<td${cellClass(index)}>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`
      : "";
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

export function num(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatTons(kg: number): string {
  return `${formatTonsNumber(kg)} t`;
}

export function formatTonsNumber(kg: number): string {
  return (kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

/** Duracao em minutos -> "42min" / "1h 05min". */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}min`;
}

export function formatKg(kg: number): string {
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

/** "2026-07-15" -> "15/07/2026"; devolve a entrada crua fora do formato ISO. */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** "2026-07" -> "07/2026". */
export function formatMonthLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 2) return iso;
  const [year, month] = parts;
  return `${month}/${year}`;
}

/** Nome de arquivo sem acento nem espaco. `fallback` cobre o texto que some inteiro. */
export function slug(value: string, fallback: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || fallback
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
