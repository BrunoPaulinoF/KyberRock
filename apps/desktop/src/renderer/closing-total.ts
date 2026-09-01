import {
  FreightCalculator,
  isFreightModalityWithFreight,
  type FreightModality,
  type FreightRule
} from "../services/freight";

/**
 * Previa do valor a cobrar, mostrada no modal de fechamento logo abaixo do peso liquido.
 *
 * E so uma PREVIA: quem grava o valor continua sendo `closeWeighingOperation`. Por isso a
 * conta aqui e o espelho exato da de la (`calculateProductTotalCents` +
 * `calculateFreightTotalCents`) — mesmo arredondamento e mesmo `FreightCalculator` —, senao a
 * tela prometeria ao cliente um numero diferente do que sai no cupom. O modulo e puro de
 * proposito: `weighing-operations` importa `node:crypto` e nao pode ser carregado no renderer.
 */
export interface ClosingTotalPreview {
  /** Peso liquido x preco por tonelada. `null` quando a operacao nao tem preco lancado. */
  productTotalCents: number | null;
  freightTotalCents: number;
  /** Produto + frete. `null` quando nao ha preco — o operador nao tem valor a confirmar. */
  totalCents: number | null;
  /**
   * A operacao e "com frete" mas a regra nao esta gravada nela: o fechamento vai resgatar a
   * regra da memoria do cliente (ver `resolveFreightRuleForClose`), o que o renderer nao
   * consegue fazer. O total mostrado fica sem esse frete, e a tela avisa em vez de mentir.
   */
  freightPending: boolean;
  /** Regra de frete gravada invalida — o fechamento tambem falharia com ela. */
  freightError: string | null;
}

export interface ClosingTotalPreviewInput {
  netWeightKg: number;
  unitPriceCents: number | null;
  freightJson: string | null;
  freightModality: FreightModality | null;
}

export function buildClosingTotalPreview(input: ClosingTotalPreviewInput): ClosingTotalPreview {
  const productTotalCents =
    input.unitPriceCents === null || input.unitPriceCents === undefined
      ? null
      : Math.round((input.netWeightKg / 1000) * input.unitPriceCents);

  let freightTotalCents = 0;
  let freightError: string | null = null;

  if (input.freightJson) {
    try {
      const parsed = JSON.parse(input.freightJson) as { rule?: FreightRule };
      if (parsed.rule) {
        freightTotalCents = new FreightCalculator().calculate(input.netWeightKg, parsed.rule);
      }
    } catch (error) {
      freightError = error instanceof Error ? error.message : "Regra de frete invalida.";
      freightTotalCents = 0;
    }
  }

  const freightPending = !input.freightJson && isFreightModalityWithFreight(input.freightModality);

  return {
    productTotalCents,
    freightTotalCents,
    totalCents: productTotalCents === null ? null : productTotalCents + freightTotalCents,
    freightPending,
    freightError
  };
}
