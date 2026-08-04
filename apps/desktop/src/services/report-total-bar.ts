/**
 * Barra de totais que fecha todos os relatorios (vendas, Insights, controle de caminhoes,
 * relatorio por cliente, resumo de clientes e o e-mail de fechamento diario): uma faixa
 * unica na parte inferior do documento com os numeros do periodo, para quem le no celular
 * nao precisar somar as colunas nem voltar aos cartoes do topo.
 *
 * Duas escolhas de formato, ambas por compatibilidade:
 *
 * - Tabela de uma linha, nao `div` com flex: os mesmos HTMLs viram `.xls` no botao
 *   "Exportar Excel", e o Excel abre uma linha de tabela como celulas.
 * - Estilo inline, nao classe CSS: o e-mail de fechamento diario nao tem bloco `<style>`
 *   (e cliente de e-mail costuma descartar um). Pelo mesmo motivo o texto secundario usa
 *   cor propria em vez de `opacity`, que o Outlook ignora.
 *
 * Nao usamos `position:fixed` para repetir a barra em toda pagina: o Chrome do
 * `printToPDF` nao pinta o elemento fixo na primeira pagina e joga ele para o topo das
 * seguintes, cobrindo o cabecalho da tabela.
 */
export interface TotalBarItem {
  label: string;
  value: string;
  /** Destaca o numero principal do relatorio (normalmente o faturamento do periodo). */
  emphasis?: boolean;
}

export const TOTAL_BAR_TITLE = "Total do periodo";

const BAR_STYLE =
  "width:100%;border-collapse:collapse;margin-top:18px;background:#1d4ed8;color:#fff;" +
  "border-radius:10px;break-inside:avoid;page-break-inside:avoid";
const CELL_STYLE =
  "border:0;padding:9px 14px;background:#1d4ed8;color:#fff;font-family:Arial,Helvetica,sans-serif";
const TITLE_STYLE = `${CELL_STYLE};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap`;
const ITEM_STYLE = `${CELL_STYLE};text-align:right;white-space:nowrap`;
const LABEL_STYLE =
  "display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#c7d2fe";
const VALUE_STYLE = "display:block;margin-top:2px;line-height:1.2;font-size:15px";
const VALUE_EMPHASIS_STYLE = "display:block;margin-top:2px;line-height:1.2;font-size:19px";

/**
 * Faixa com os totais do periodo. Vai como ultimo elemento do documento — em relatorio de
 * varias paginas ela fecha a ultima, sem quebrar no meio.
 */
export function renderTotalBar(items: TotalBarItem[], title: string = TOTAL_BAR_TITLE): string {
  const cells = items
    .map(
      (item) =>
        `<td class="total-bar-item" style="${ITEM_STYLE}"><span style="${LABEL_STYLE}">${escapeHtml(
          item.label
        )}</span><strong style="${
          item.emphasis ? VALUE_EMPHASIS_STYLE : VALUE_STYLE
        }">${escapeHtml(item.value)}</strong></td>`
    )
    .join("");
  return `<table class="total-bar" cellspacing="0" cellpadding="0" style="${BAR_STYLE}"><tbody><tr><td class="total-bar-title" style="${TITLE_STYLE}">${escapeHtml(
    title
  )}</td>${cells}</tr></tbody></table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
