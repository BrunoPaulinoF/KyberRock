/**
 * Os formatos que a Conferencia de faturamento e o Fechamento de faturas mostram do MESMO
 * jeito.
 *
 * As duas telas leem a mesma pesagem e escreviam estes seis formatos cada uma por conta
 * propria, palavra por palavra iguais. Duplicado assim, "arredondar o peso" ou "mostrar a
 * unidade do preco" viravam duas correcoes — e bastava esquecer uma para a mesma carga
 * aparecer de dois jeitos em duas telas que a atendente compara lado a lado.
 *
 * As duas ultimas funcoes tipam pelo que USAM, e nao pela linha inteira: a linha da
 * Conferencia (`WeighingBillingRow`) e a do Fechamento (`InvoiceClosingLine`) sao tipos
 * diferentes, mas as duas carregam estes campos com estes nomes.
 */

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

// Peso em quilos, so o numero: a coluna ja diz "Peso" e repetir "kg" em cada linha
// so atrapalhava a leitura das tabelas.
export function formatKg(kg: number): string {
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

/** O minimo que uma pesagem precisa expor para o preco unitario se explicar. */
export interface PricedWeighingLine {
  unitPriceCents: number | null;
  /** Unidade em que o preco foi aplicado ("ton" / "kg"). */
  priceUnit: string | null;
}

/**
 * O preco unitario com a unidade em que ele foi aplicado. Sem o "/t" ou "/kg" o numero
 * sozinho nao da para conferir: R$ 42,00 por tonelada e por quilo sao contas mil vezes
 * diferentes.
 */
export function unitPriceLabel(line: PricedWeighingLine): string {
  if (line.unitPriceCents === null) return "-";
  return `${formatBRL(line.unitPriceCents)}/${line.priceUnit === "kg" ? "kg" : "t"}`;
}

/** O minimo que uma pesagem precisa expor para ser reencontrada no OMIE. */
export interface OmieReferencedLine {
  /** Numero VISIVEL do pedido/OS — o que se digita na busca do OMIE. */
  omieOrderNumber: string | null;
  /** Codigos INTERNOS do documento, os da API. */
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
}

/**
 * Numero pelo qual a pesagem e procurada no OMIE — o elo entre os dois sistemas. O numero
 * VISIVEL do documento vem entre parenteses quando ja e conhecido: o codigo grande e o da
 * integracao, e digitar ele na busca do OMIE nao acha nada.
 */
export function omieReference(line: OmieReferencedLine): string {
  const visible = line.omieOrderNumber ? ` (nº ${line.omieOrderNumber})` : "";
  if (line.omieSalesOrderId) return `Pedido ${line.omieSalesOrderId}${visible}`;
  if (line.omieServiceOrderId) return `OS ${line.omieServiceOrderId}${visible}`;
  return "-";
}
