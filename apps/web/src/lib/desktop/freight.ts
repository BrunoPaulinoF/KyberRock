export interface DistanceRange {
  maxKm: number;
  valueCents: number;
}

/**
 * Tipo de frete gravado na operacao (`weighing_operations.freight_type`).
 *
 * Sao QUATRO situacoes, em dois grupos (ver `docs/phase-1/sync-strategy.md`):
 *
 * | # | Grupo      | Situacao                                  | Valor | NF                          |
 * |---|------------|-------------------------------------------|-------|-----------------------------|
 * | 1 | Com frete  | valor de frete NA nota                    | sim   | valor + transportador, soma no total |
 * | 2 | Com frete  | valor de frete so no sistema              | sim   | so o transportador          |
 * | 3 | Sem frete  | sem valor, transportador na nota          | nao   | so o transportador          |
 * | 4 | Sem frete  | sem ocorrencia de transporte              | nao   | nada                        |
 *
 * As chaves gravadas sao as do catalogo antigo (`fob`, `cif`, `third_party`, `none`)
 * porque a coluna `freight_type` tem CHECK com essa lista — no SQLite local (migracao 32)
 * e no espelho da nuvem. Reusar valores ja aceitos evita reconstruir a tabela de
 * operacoes so para renomear um enum; o significado de cada chave e o desta tabela.
 * `own_sender`/`own_recipient` sao legado de leitura (operacoes gravadas antes disto).
 */
export type FreightModality =
  | "cif"
  | "fob"
  | "third_party"
  | "own_sender"
  | "own_recipient"
  | "none";

/** Grupo do tipo de frete, como o operador escolhe na tela. */
export type FreightGroup = "with_freight" | "without_freight";

/** Responsavel padrao pelo valor de frete de cada modalidade (reusa o enum de payer). */
export type FreightModalityPayer = "customer" | "quarry" | "third_party";

export interface FreightModalityInfo {
  key: FreightModality;
  /** Grupo exibido no seletor: com frete (situacoes 1 e 2) ou sem frete (3 e 4). */
  group: FreightGroup;
  /** Rotulo curto para o botao/chip. */
  label: string;
  /** Descricao exibida no seletor. */
  description: string;
  /** Codigo "modalidade" enviado ao OMIE (modFrete da NF-e). */
  omieCode: string;
  /**
   * A transportadora da Pedreira se aplica (placa/motorista vinculados). Falso apenas
   * quando o cliente traz o proprio caminhao (transporte proprio do destinatario, legado).
   */
  usesCarrier: boolean;
  /** A operacao comporta um valor de frete lancado pela Pedreira (campos de calculo). */
  supportsCharge: boolean;
  /** O valor do frete vai na nota/cupom e soma no total (so a situacao 1). */
  valueOnInvoice: boolean;
  /** O transportador consta na nota (situacoes 1, 2 e 3). */
  carrierOnInvoice: boolean;
  /** Responsavel padrao pelo frete quando ha valor lancado. */
  defaultPayer: FreightModalityPayer;
}

/** Situacao 1: com frete, valor na nota. */
export const FREIGHT_VALUE_ON_INVOICE: FreightModality = "fob";
/** Situacao 2: com frete, valor so no sistema. */
export const FREIGHT_VALUE_INTERNAL_ONLY: FreightModality = "cif";
/** Situacao 3: sem valor de frete, com transportador na nota. */
export const FREIGHT_CARRIER_ONLY: FreightModality = "third_party";
/** Situacao 4: sem ocorrencia de frete. */
export const FREIGHT_MODALITY_NONE: FreightModality = "none";

/** Compat: "com frete" grava a situacao 2 quando nada mais e informado. */
export const FREIGHT_MODALITY_WITH_FREIGHT: FreightModality = FREIGHT_VALUE_INTERNAL_ONLY;

/**
 * Situacao de uma operacao que nao informou tipo de frete: sem valor de frete, com o
 * transportador na nota (situacao 3). E o comportamento historico da balanca — o pedido
 * sempre levava a transportadora —, entao so quem escolhe "sem ocorrencia de frete" de
 * proposito (situacao 4) fica sem transportador na nota.
 */
export const FREIGHT_MODALITY_DEFAULT: FreightModality = FREIGHT_CARRIER_ONLY;

/**
 * As quatro situacoes que o operador escolhe, na ordem exibida (grupo "com frete"
 * primeiro). Todas usam o mesmo tipo de frete no OMIE — "1 - Contratacao do Frete por
 * conta do Destinatario (FOB)" —, menos a ultima, que e "9 - Sem Ocorrencia de Transporte".
 */
export const FREIGHT_MODALITIES: readonly FreightModalityInfo[] = [
  {
    key: FREIGHT_VALUE_ON_INVOICE,
    group: "with_freight",
    label: "Valor na nota",
    description: "O valor do frete e o transportador saem na nota e o frete soma no total (FOB).",
    omieCode: "1",
    usesCarrier: true,
    supportsCharge: true,
    valueOnInvoice: true,
    carrierOnInvoice: true,
    defaultPayer: "customer"
  },
  {
    key: FREIGHT_VALUE_INTERNAL_ONLY,
    group: "with_freight",
    label: "Valor so no sistema",
    description:
      "O valor fica no KyberRock para controle e NF de servico de transporte; na nota sai so o transportador.",
    omieCode: "1",
    usesCarrier: true,
    supportsCharge: true,
    valueOnInvoice: false,
    carrierOnInvoice: true,
    defaultPayer: "quarry"
  },
  {
    key: FREIGHT_CARRIER_ONLY,
    group: "without_freight",
    label: "So o transportador na nota",
    description: "Sem valor de frete; o transportador consta na nota (FOB).",
    omieCode: "1",
    usesCarrier: true,
    supportsCharge: false,
    valueOnInvoice: false,
    carrierOnInvoice: true,
    defaultPayer: "customer"
  },
  {
    key: FREIGHT_MODALITY_NONE,
    group: "without_freight",
    label: "Sem ocorrencia de frete",
    description: "Nao saem transportador nem valor de frete na nota.",
    omieCode: "9",
    usesCarrier: true,
    supportsCharge: false,
    valueOnInvoice: false,
    carrierOnInvoice: false,
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
    key: "own_sender",
    group: "with_freight",
    label: "Com frete (transp. proprio da Pedreira)",
    description: "Legado: transporte proprio por conta do remetente (Pedreira).",
    omieCode: "3",
    usesCarrier: true,
    supportsCharge: true,
    valueOnInvoice: true,
    carrierOnInvoice: true,
    defaultPayer: "quarry"
  },
  {
    key: "own_recipient",
    group: "without_freight",
    label: "Com frete (transp. proprio do cliente)",
    description: "Legado: o cliente traz o proprio caminhao.",
    omieCode: "4",
    usesCarrier: false,
    supportsCharge: false,
    valueOnInvoice: false,
    carrierOnInvoice: true,
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

/** Grupo "com frete": a operacao tem valor de frete (situacoes 1 e 2). */
export function isFreightModalityWithFreight(
  key: FreightModality | string | null | undefined
): boolean {
  return getFreightModalityInfo(key).group === "with_freight";
}

/** O valor do frete sai na nota/cupom e soma no total (situacao 1). */
export function freightValueGoesToInvoice(
  key: FreightModality | string | null | undefined
): boolean {
  return getFreightModalityInfo(key).valueOnInvoice;
}

/** O transportador consta na nota (situacoes 1, 2 e 3). */
export function freightCarrierGoesToInvoice(
  key: FreightModality | string | null | undefined
): boolean {
  return getFreightModalityInfo(key).carrierOnInvoice;
}

/**
 * Situacao a gravar a partir das duas escolhas da tela: o grupo (com/sem frete) e a
 * caixa que fica logo abaixo dele — "valor na nota" no grupo com frete, "transportador
 * na nota" no grupo sem frete.
 */
export function resolveFreightModality(input: {
  group: FreightGroup;
  valueOnInvoice?: boolean;
  carrierOnInvoice?: boolean;
}): FreightModality {
  if (input.group === "with_freight") {
    return input.valueOnInvoice ? FREIGHT_VALUE_ON_INVOICE : FREIGHT_VALUE_INTERNAL_ONLY;
  }
  return input.carrierOnInvoice ? FREIGHT_CARRIER_ONLY : FREIGHT_MODALITY_NONE;
}

/**
 * Normaliza uma modalidade legada para uma das quatro situacoes de hoje, preservando o
 * que a operacao antiga significava (grupo, valor na nota e transportador na nota).
 */
export function normalizeFreightModality(
  key: FreightModality | string | null | undefined
): FreightModality {
  const info = getFreightModalityInfo(key);
  return resolveFreightModality({
    group: info.group,
    valueOnInvoice: info.valueOnInvoice,
    carrierOnInvoice: info.carrierOnInvoice
  });
}

/**
 * Chave sob a qual a memoria de frete do cliente e GRAVADA. As duas situacoes com valor
 * (1 e 2) compartilham a mesma memoria: o valor do frete do cliente e um so — o que muda
 * entre elas e apenas se ele sai na nota, e isso vai gravado a parte (`showOnReceipt`).
 */
export function freightMemoryKey(
  key: FreightModality | string | null | undefined
): FreightModality {
  return isFreightModalityWithFreight(key) ? FREIGHT_MODALITY_WITH_FREIGHT : FREIGHT_MODALITY_NONE;
}

/**
 * Chaves a consultar na memoria de frete do cliente para um tipo de frete. As situacoes
 * com valor (1 e 2) compartilham a memoria — e o mesmo valor de frete do cliente, muda
 * so se ele sai na nota — e as modalidades antigas entram no fim, para o valor usado
 * antes da mudanca continuar sendo puxado.
 */
export function freightModalityLookupKeys(
  key: FreightModality | string | null | undefined
): FreightModality[] {
  if (!isFreightModalityWithFreight(key)) return [FREIGHT_MODALITY_NONE];
  const requested = getFreightModalityInfo(key).key;
  const withValue: FreightModality[] = [FREIGHT_VALUE_INTERNAL_ONLY, FREIGHT_VALUE_ON_INVOICE];
  return [
    requested,
    ...withValue.filter((modality) => modality !== requested),
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
