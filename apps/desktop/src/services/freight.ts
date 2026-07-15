export interface DistanceRange {
  maxKm: number;
  valueCents: number;
}

/**
 * Tipo (modalidade) de frete da operacao. Mapeia 1:1 para o codigo "modalidade" do
 * frete no pedido de venda do OMIE, que reusa os codigos modFrete da NF-e:
 * 0 CIF, 1 FOB, 2 terceiros, 3/4 transporte proprio, 9 sem frete.
 */
export type FreightModality =
  | "cif"
  | "fob"
  | "third_party"
  | "own_sender"
  | "own_recipient"
  | "none";

/** Responsavel padrao pelo valor de frete de cada modalidade (reusa o enum de payer). */
export type FreightModalityPayer = "customer" | "quarry" | "third_party";

export interface FreightModalityInfo {
  key: FreightModality;
  /** Rotulo curto para o chip/botao. */
  label: string;
  /** Descricao exibida no modal de selecao. */
  description: string;
  /** Codigo "modalidade" enviado ao OMIE (modFrete da NF-e). */
  omieCode: string;
  /**
   * A transportadora da Pedreira se aplica (placa/motorista vinculados). Falso apenas
   * quando o cliente traz o proprio caminhao (transporte proprio do destinatario).
   */
  usesCarrier: boolean;
  /** A modalidade comporta um valor de frete lancado pela Pedreira (campos de calculo). */
  supportsCharge: boolean;
  /** Responsavel padrao pelo frete quando ha valor lancado. */
  defaultPayer: FreightModalityPayer;
}

/**
 * Catalogo dos tipos de frete do OMIE. A ordem e a exibida no modal de selecao.
 * `own_recipient` substitui a antiga caixa "transportadora propria do cliente" e
 * `cif`/`fob` substituem a antiga caixa "operacao com frete" (parte CIF/FOB).
 */
export const FREIGHT_MODALITIES: readonly FreightModalityInfo[] = [
  {
    key: "cif",
    label: "CIF",
    description: "Frete por conta da Pedreira (remetente).",
    omieCode: "0",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "quarry"
  },
  {
    key: "fob",
    label: "FOB",
    description: "Frete por conta do cliente (destinatario).",
    omieCode: "1",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "customer"
  },
  {
    key: "third_party",
    label: "Terceiros",
    description: "Frete por conta de terceiros.",
    omieCode: "2",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "third_party"
  },
  {
    key: "own_sender",
    label: "Transp. proprio (Pedreira)",
    description: "Transporte proprio por conta do remetente (Pedreira).",
    omieCode: "3",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "quarry"
  },
  {
    key: "own_recipient",
    label: "Transp. proprio do cliente",
    description: "Transporte proprio por conta do destinatario: o cliente traz o proprio caminhao.",
    omieCode: "4",
    usesCarrier: false,
    supportsCharge: false,
    defaultPayer: "customer"
  },
  {
    key: "none",
    label: "Sem frete",
    description: "Sem ocorrencia de transporte / sem frete.",
    omieCode: "9",
    usesCarrier: true,
    supportsCharge: false,
    defaultPayer: "quarry"
  }
];

const DEFAULT_FREIGHT_MODALITY: FreightModalityInfo =
  FREIGHT_MODALITIES.find((modality) => modality.key === "none") ?? FREIGHT_MODALITIES[0];

/** Retorna os metadados da modalidade; cai em "sem frete" quando o valor e invalido. */
export function getFreightModalityInfo(
  key: FreightModality | string | null | undefined
): FreightModalityInfo {
  return FREIGHT_MODALITIES.find((modality) => modality.key === key) ?? DEFAULT_FREIGHT_MODALITY;
}

export function isFreightModality(value: unknown): value is FreightModality {
  return typeof value === "string" && FREIGHT_MODALITIES.some((modality) => modality.key === value);
}

/** Codigo "modalidade" do OMIE para a modalidade escolhida (default "9" = sem frete). */
export function freightModalityOmieCode(
  key: FreightModality | string | null | undefined
): string {
  return getFreightModalityInfo(key).omieCode;
}

export interface FreightRule {
  id: string;
  name: string;
  type: "per_ton" | "per_ton_km" | "fixed_plus_ton" | "distance_range";
  baseValueCents: number;
  minValueCents?: number;
  fixedValueCents?: number;
  distanceKm?: number;
  ranges?: DistanceRange[];
  unit: string;
}

export class FreightCalculator {
  calculate(netWeightKg: number, rule: FreightRule): number {
    if (netWeightKg <= 0) return 0;

    const tons = netWeightKg / 1000;
    let freightCents = 0;

    switch (rule.type) {
      case "per_ton": {
        freightCents = Math.round(tons * rule.baseValueCents);
        break;
      }

      case "per_ton_km": {
        if (!rule.distanceKm || rule.distanceKm <= 0) {
          throw new Error("Distance is required for per_ton_km freight calculation");
        }
        freightCents = Math.round(tons * rule.distanceKm * rule.baseValueCents);
        break;
      }

      case "fixed_plus_ton": {
        const fixed = rule.fixedValueCents ?? 0;
        const variable = Math.round(tons * rule.baseValueCents);
        freightCents = fixed + variable;
        break;
      }

      case "distance_range": {
        if (!rule.distanceKm || !rule.ranges || rule.ranges.length === 0) {
          throw new Error("Distance and ranges are required for distance_range freight calculation");
        }
        freightCents = this.findRangeValue(rule.distanceKm, rule.ranges);
        break;
      }

      default:
        freightCents = Math.round(tons * rule.baseValueCents);
    }

    // Aplica valor mínimo se definido
    if (rule.minValueCents && freightCents < rule.minValueCents) {
      return rule.minValueCents;
    }

    return freightCents;
  }

  recalculateAfterExit(
    netWeightKg: number,
    rule: FreightRule,
    newBaseValueCents: number
  ): number {
    const updatedRule: FreightRule = {
      ...rule,
      baseValueCents: newBaseValueCents
    };

    return this.calculate(netWeightKg, updatedRule);
  }

  private findRangeValue(distanceKm: number, ranges: DistanceRange[]): number {
    // Ordena por maxKm
    const sorted = [...ranges].sort((a, b) => a.maxKm - b.maxKm);

    for (const range of sorted) {
      if (distanceKm <= range.maxKm) {
        return range.valueCents;
      }
    }

    // Se ultrapassar todas as faixas, usa a última
    return sorted[sorted.length - 1]?.valueCents ?? 0;
  }
}
