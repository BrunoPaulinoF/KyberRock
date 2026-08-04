export interface DistanceRange {
  maxKm: number;
  valueCents: number;
}

/**
 * Tipo (modalidade) de frete gravado na operacao (`weighing_operations.freight_type`).
 *
 * O operador escolhe apenas entre DOIS tipos: "sem frete" e "com frete" (e, dentro de
 * "com frete", se lanca ou nao um valor). Os demais valores da uniao sao legado: ficaram
 * gravados nas operacoes e no cadastro antes da simplificacao e continuam sendo lidos
 * (rotulos, relatorios, memoria de frete do cliente), mas nao aparecem mais para escolha.
 *
 * O codigo "modalidade" do frete no pedido de venda do OMIE (modFrete da NF-e:
 * 0 CIF, 1 FOB, 2 terceiros, 3/4 transporte proprio, 9 sem frete) sai de `omieCode`.
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
  /** Descricao exibida no seletor. */
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
 * Modalidade gravada para "com frete". Continua sendo `cif` (e nao um valor novo) porque
 * a coluna `freight_type` tem CHECK com o catalogo antigo — no SQLite local (migracao 32)
 * e no espelho da nuvem. Reusar um valor ja aceito evita reconstruir a tabela de operacoes
 * so para renomear um enum.
 */
export const FREIGHT_MODALITY_WITH_FREIGHT: FreightModality = "cif";
export const FREIGHT_MODALITY_NONE: FreightModality = "none";

/**
 * Os dois unicos tipos de frete que o operador escolhe hoje. A ordem e a exibida no
 * seletor da entrada e da edicao da operacao.
 */
export const FREIGHT_MODALITIES: readonly FreightModalityInfo[] = [
  {
    key: FREIGHT_MODALITY_NONE,
    label: "Sem frete",
    description: "Operacao sem frete.",
    omieCode: "9",
    usesCarrier: true,
    supportsCharge: false,
    defaultPayer: "quarry"
  },
  {
    key: FREIGHT_MODALITY_WITH_FREIGHT,
    label: "Com frete",
    description: "Operacao com frete; marque abaixo se o frete tem valor lancado.",
    omieCode: "0",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "quarry"
  }
];

/**
 * Modalidades antigas: nao aparecem mais no seletor, mas continuam gravadas em operacoes
 * fechadas e na memoria de frete dos clientes. Ficam aqui so para leitura (rotulo do
 * detalhe da operacao, relatorios e `getFreightModalityInfo`).
 */
export const LEGACY_FREIGHT_MODALITIES: readonly FreightModalityInfo[] = [
  {
    key: "fob",
    label: "Com frete (FOB)",
    description: "Legado: frete por conta do cliente (destinatario).",
    omieCode: "1",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "customer"
  },
  {
    key: "third_party",
    label: "Com frete (terceiros)",
    description: "Legado: frete por conta de terceiros.",
    omieCode: "2",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "third_party"
  },
  {
    key: "own_sender",
    label: "Com frete (transp. proprio da Pedreira)",
    description: "Legado: transporte proprio por conta do remetente (Pedreira).",
    omieCode: "3",
    usesCarrier: true,
    supportsCharge: true,
    defaultPayer: "quarry"
  },
  {
    key: "own_recipient",
    label: "Com frete (transp. proprio do cliente)",
    description: "Legado: o cliente traz o proprio caminhao.",
    omieCode: "4",
    usesCarrier: false,
    supportsCharge: false,
    defaultPayer: "customer"
  }
];

const ALL_FREIGHT_MODALITIES: readonly FreightModalityInfo[] = [
  ...FREIGHT_MODALITIES,
  ...LEGACY_FREIGHT_MODALITIES
];

const DEFAULT_FREIGHT_MODALITY: FreightModalityInfo =
  FREIGHT_MODALITIES.find((modality) => modality.key === FREIGHT_MODALITY_NONE) ??
  FREIGHT_MODALITIES[0];

/** Retorna os metadados da modalidade (inclusive as legadas); cai em "sem frete". */
export function getFreightModalityInfo(
  key: FreightModality | string | null | undefined
): FreightModalityInfo {
  return (
    ALL_FREIGHT_MODALITIES.find((modality) => modality.key === key) ?? DEFAULT_FREIGHT_MODALITY
  );
}

export function isFreightModality(value: unknown): value is FreightModality {
  return (
    typeof value === "string" && ALL_FREIGHT_MODALITIES.some((modality) => modality.key === value)
  );
}

/**
 * Tipo de frete "de verdade" da operacao: com ou sem frete. Toda modalidade legada
 * diferente de "sem frete" e uma operacao COM frete — inclusive o transporte proprio do
 * cliente, que tem transporte mas nunca teve valor lancado pela Pedreira.
 */
export function isFreightModalityWithFreight(
  key: FreightModality | string | null | undefined
): boolean {
  return getFreightModalityInfo(key).key !== FREIGHT_MODALITY_NONE;
}

/**
 * Modalidade a gravar para o tipo escolhido no seletor. Normaliza as legadas: uma
 * operacao antiga reaberta e salva volta gravada como "com frete" (`cif`).
 */
export function normalizeFreightModality(
  key: FreightModality | string | null | undefined
): FreightModality {
  return isFreightModalityWithFreight(key) ? FREIGHT_MODALITY_WITH_FREIGHT : FREIGHT_MODALITY_NONE;
}

/**
 * Chaves a consultar na memoria de frete do cliente para um tipo de frete. "Com frete"
 * tambem procura pelas modalidades antigas (FOB, terceiros, transporte proprio): o valor
 * usado na ultima venda do cliente nao pode sumir por causa da simplificacao.
 */
export function freightModalityLookupKeys(
  key: FreightModality | string | null | undefined
): FreightModality[] {
  if (!isFreightModalityWithFreight(key)) return [FREIGHT_MODALITY_NONE];
  return [
    FREIGHT_MODALITY_WITH_FREIGHT,
    ...LEGACY_FREIGHT_MODALITIES.map((modality) => modality.key)
  ];
}

/** Codigo "modalidade" do OMIE para a modalidade escolhida (default "9" = sem frete). */
export function freightModalityOmieCode(key: FreightModality | string | null | undefined): string {
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
          throw new Error(
            "Distance and ranges are required for distance_range freight calculation"
          );
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

  recalculateAfterExit(netWeightKg: number, rule: FreightRule, newBaseValueCents: number): number {
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
