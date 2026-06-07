export interface DistanceRange {
  maxKm: number;
  valueCents: number;
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
