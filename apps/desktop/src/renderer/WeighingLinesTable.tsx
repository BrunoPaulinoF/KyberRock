import { InvoiceNumberCell } from "./InvoiceNumberCell";
import { SituationPill } from "./SituationPill";
import { formatBRL, formatKg } from "./weighing-line-format";
import { formatDbDateTime } from "./format-datetime";
import type { WeighingBillingSituation } from "../services/weighing-billing-situation";

/**
 * A tabela "pesagem a pesagem" — a lista da operacao inteira, uma carga por linha.
 *
 * Ela aparece em DUAS telas: na Conferencia de faturamento, que existe para responder "o
 * que ainda nao virou nota?", e no fim do Fechamento de faturas, que responde "cade a carga
 * tal?" sem obrigar a abrir fatura por fatura. As duas mostravam a mesma tabela escrita
 * duas vezes, e a do Fechamento e a da Conferencia MAIS seis colunas: nenhuma coluna da
 * Conferencia deixava de existir la.
 *
 * Duplicada assim, cada coluna era duas correcoes. Nao e hipotese: a coluna "Nota fiscal"
 * precisou ser mexida nos dois arquivos, e as duas telas ainda hoje divergem em detalhes
 * que ninguem escolheu — o Fechamento mostra o produto com o codigo na frente, a
 * Conferencia sem. Divergencia assim continua possivel (cada tela monta o texto das
 * celulas que sao suas), mas agora ela e uma decisao visivel na chamada, e nao o resultado
 * de duas tabelas que foram andando cada uma para um lado.
 *
 * Aqui mora o DESENHO: a ordem das colunas, o alinhamento, a formatacao do dinheiro e do
 * peso, e o rodape. O que cada tela traz e o CONTEUDO de cada celula que e so dela
 * (`WeighingLineCells`), porque as duas leem tipos de linha diferentes e formatam a data
 * com modulos diferentes.
 *
 * Fica de fora, de proposito, o que de fato difere entre as telas:
 *
 *  - o contorno com rolagem, porque as duas telas tem altura maxima diferente;
 *  - o titulo do bloco, o texto de lista vazia e os avisos acima da tabela.
 */

/** As colunas que so uma das telas mostra. Ausente = a coluna nao existe naquela tela. */
export interface WeighingLineColumns {
  /** "Vale" — o codigo do cupom que saiu com o motorista. */
  coupon?: boolean;
  /** "CNPJ/CPF" do cliente. */
  document?: boolean;
  /** "Transportador" e "Motorista" — as duas andam juntas. */
  carrier?: boolean;
  /** "Fechamento" e "Vencimento" — em qual fatura a carga caiu. */
  closing?: boolean;
}

/**
 * O destino da carga nas colunas de fechamento.
 *
 * `warning` ocupa as DUAS colunas com um texto so, e e o caso da carga que nao entrou em
 * fatura nenhuma — por o cliente nao ter periodicidade, ou por ser um vale repetido.
 */
export type WeighingLineClosing =
  | { kind: "dates"; closingLabel: string; dueLabel: string }
  | { kind: "warning"; text: string; title: string };

/** O conteudo de UMA linha, ja no texto que a tela quer mostrar. */
export interface WeighingLineCells {
  /** Chave de React da linha. */
  key: string;
  /** Coluna "Op." — o numero pelo qual a tela chama a operacao. */
  operationLabel: string;
  /** Coluna "Vale". So lida quando `columns.coupon`. */
  couponLabel?: string;
  /** Data ja formatada: as duas telas usam formatadores de modulos diferentes. */
  dateLabel: string;
  /** Saida da balanca, para o tooltip da data. Null nas operacoes antigas. */
  closedAt: string | null;
  customerName: string;
  /** Coluna "CNPJ/CPF". So lida quando `columns.document`. */
  customerDocument?: string | null;
  /** O produto como a tela o escreve — com ou sem o codigo na frente. */
  productLabel: string;
  /** O texto inteiro do produto, para o tooltip quando a celula corta. */
  productTitle: string;
  plate: string;
  /** So lidos quando `columns.carrier`. */
  carrierName?: string;
  driverName?: string;
  netWeightKg: number;
  /** Preco unitario ja com a unidade (ver `unitPriceLabel`). */
  unitPriceLabel: string;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  operationTypeLabel: string;
  situation: WeighingBillingSituation;
  situationLabel: string;
  /** O motivo gravado pelo OMIE, quando ha — e o que explica uma pesagem parada. */
  situationDetail: string | null;
  invoiceNumber: string | null;
  operationType: "invoice" | "internal";
  /** Como a pesagem e procurada no OMIE (ver `omieReference`). */
  omieReference: string;
  /** So lido quando `columns.closing`. */
  closing?: WeighingLineClosing;
}

/** A soma do rodape. */
export interface WeighingLineTotals {
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

/**
 * Quantas colunas o rotulo do rodape atravessa, e quantas sobram sem total.
 *
 * Sao os dois numeros que a tabela duplicada mantinha escritos a mao — `colSpan={5}` numa
 * tela e `colSpan={9}` na outra —, e que quebrariam calados na primeira coluna nova:
 * a soma continuaria somando, so que embaixo da coluna errada.
 */
export function weighingLineFooterSpans(columns: WeighingLineColumns): {
  leading: number;
  trailing: number;
} {
  return {
    // Op., Data, Cliente, Produto e Placa, mais as opcionais que vem antes do "Peso".
    leading: 5 + (columns.coupon ? 1 : 0) + (columns.document ? 1 : 0) + (columns.carrier ? 2 : 0),
    // Tipo, Situacao, Nota fiscal e Pedido/OS, mais Fechamento e Vencimento.
    trailing: 4 + (columns.closing ? 2 : 0)
  };
}

export function WeighingLinesTable({
  lines,
  columns = {},
  totals,
  totalLabel
}: {
  lines: readonly WeighingLineCells[];
  columns?: WeighingLineColumns;
  totals: WeighingLineTotals;
  /** O rotulo do rodape: "TOTAL" na Conferencia, "TOTAL DO PERIODO" no Fechamento. */
  totalLabel: string;
}) {
  const spans = weighingLineFooterSpans(columns);

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.thLeft}>Op.</th>
          {columns.coupon ? <th style={styles.thLeft}>Vale</th> : null}
          <th style={styles.thLeft}>Data</th>
          <th style={styles.thLeft}>Cliente</th>
          {columns.document ? <th style={styles.thLeft}>CNPJ/CPF</th> : null}
          <th style={styles.thLeft}>Produto</th>
          <th style={styles.thLeft}>Placa</th>
          {columns.carrier ? <th style={styles.thLeft}>Transportador</th> : null}
          {columns.carrier ? <th style={styles.thLeft}>Motorista</th> : null}
          <th style={styles.th}>Peso</th>
          <th style={styles.th}>Preco unit.</th>
          <th style={styles.th}>Produto</th>
          <th style={styles.th}>Frete</th>
          <th style={styles.th}>Total</th>
          <th style={styles.thLeft}>Tipo</th>
          <th style={styles.thLeft}>Situacao</th>
          <th style={styles.thLeft}>Nota fiscal</th>
          <th style={styles.thLeft}>Pedido/OS OMIE</th>
          {columns.closing ? <th style={styles.thLeft}>Fechamento</th> : null}
          {columns.closing ? <th style={styles.thLeft}>Vencimento</th> : null}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <WeighingLineRow key={line.key} line={line} columns={columns} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td style={styles.tdTotalLeft} colSpan={spans.leading}>
            {totalLabel}
          </td>
          <td style={styles.tdTotal}>{formatKg(totals.netWeightKg)}</td>
          {/* Preco unitario nao soma: sao precos diferentes por carga. */}
          <td style={styles.tdTotal} />
          <td style={styles.tdTotal}>{formatBRL(totals.productCents)}</td>
          <td style={styles.tdTotal}>{formatBRL(totals.freightCents)}</td>
          <td style={styles.tdTotal}>{formatBRL(totals.totalCents)}</td>
          <td style={styles.tdTotal} colSpan={spans.trailing} />
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Uma pesagem na tabela.
 *
 * Separada em componente porque sao ate vinte celulas: embutidas no corpo da tabela, o
 * desenho dela sumiria no meio do JSX.
 */
function WeighingLineRow({
  line,
  columns
}: {
  line: WeighingLineCells;
  columns: WeighingLineColumns;
}) {
  return (
    <tr>
      <td style={styles.tdLeft}>{line.operationLabel}</td>
      {columns.coupon ? <td style={styles.tdLeft}>{line.couponLabel}</td> : null}
      <td
        style={styles.tdLeft}
        title={line.closedAt ? `Saida: ${formatDbDateTime(line.closedAt)}` : ""}
      >
        {line.dateLabel}
      </td>
      <td style={styles.tdLeft} title={line.customerName}>
        {line.customerName}
      </td>
      {columns.document ? <td style={styles.tdLeft}>{line.customerDocument ?? "-"}</td> : null}
      <td style={styles.tdLeft} title={line.productTitle}>
        {line.productLabel}
      </td>
      <td style={styles.tdLeft}>{line.plate}</td>
      {columns.carrier ? (
        <td style={styles.tdLeft} title={line.carrierName}>
          {line.carrierName}
        </td>
      ) : null}
      {columns.carrier ? <td style={styles.tdLeft}>{line.driverName}</td> : null}
      <td style={styles.td}>{formatKg(line.netWeightKg)}</td>
      <td style={styles.td}>{line.unitPriceLabel}</td>
      <td style={styles.td}>{formatBRL(line.productTotalCents)}</td>
      <td style={styles.td}>{formatBRL(line.freightTotalCents)}</td>
      <td style={styles.tdStrong}>{formatBRL(line.totalCents)}</td>
      <td style={styles.tdLeft}>{line.operationTypeLabel}</td>
      <td style={styles.tdLeft}>
        <SituationPill
          situation={line.situation}
          label={line.situationLabel}
          title={line.situationDetail ?? undefined}
        />
      </td>
      <td style={styles.tdLeft}>
        <InvoiceNumberCell invoiceNumber={line.invoiceNumber} operationType={line.operationType} />
      </td>
      <td style={styles.tdLeft}>{line.omieReference}</td>
      {columns.closing ? <ClosingCells closing={line.closing} /> : null}
    </tr>
  );
}

/**
 * As colunas "Fechamento" e "Vencimento" — ou o aviso que ocupa as duas.
 *
 * O aviso vem em amarelo e com o motivo no tooltip: sao duas razoes muito diferentes para
 * a mesma coluna vazia, e sem separa-las a carga repetida vinha explicada como "falta
 * cadastro do cliente" — a atendente ia mexer no cadastro certo por um problema que nao
 * era dele.
 */
function ClosingCells({ closing }: { closing: WeighingLineClosing | undefined }) {
  if (closing === undefined || closing.kind === "warning") {
    return (
      <td style={styles.tdWarning} colSpan={2} title={closing?.title}>
        {closing?.text ?? "-"}
      </td>
    );
  }
  return (
    <>
      <td style={styles.tdLeft}>{closing.closingLabel}</td>
      <td style={styles.tdLeft}>{closing.dueLabel}</td>
    </>
  );
}

const th: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "2px solid var(--kr-card-border)",
  color: "var(--kr-muted)",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  position: "sticky",
  top: 0,
  background: "var(--kr-card-bg)",
  whiteSpace: "nowrap",
  textAlign: "right",
  zIndex: 1
};

const td: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid var(--kr-card-border)",
  color: "var(--kr-text-strong)",
  whiteSpace: "nowrap",
  textAlign: "right",
  maxWidth: "260px",
  overflow: "hidden",
  textOverflow: "ellipsis"
};

const tdTotal: React.CSSProperties = {
  padding: "8px 10px",
  borderTop: "2px solid var(--kr-card-border)",
  color: "var(--kr-text-strong)",
  fontWeight: 800,
  whiteSpace: "nowrap",
  textAlign: "right",
  position: "sticky",
  bottom: 0,
  background: "var(--kr-card-bg)"
};

const styles: Record<string, React.CSSProperties> = {
  table: { width: "100%", borderCollapse: "collapse", fontSize: "12px" },
  th,
  thLeft: { ...th, textAlign: "left" },
  td,
  tdLeft: { ...td, textAlign: "left" },
  tdStrong: { ...td, fontWeight: 700 },
  tdWarning: { ...td, textAlign: "left", color: "var(--kr-warning)", fontWeight: 700 },
  tdTotal,
  tdTotalLeft: { ...tdTotal, textAlign: "left" }
};
