/**
 * Valor de frete do cadastro do cliente (`customer_freight_rules.rule_json`) gravado pelo site,
 * no MESMO formato que a balanca grava (`apps/desktop/src/services/customer-freight-rules.ts`).
 *
 * A linha e uma por (cliente, produto) — produto nulo e o "frete fixo", que vale para qualquer
 * produto — e carrega duas coisas de donos diferentes num mapa por tipo de frete (`modalities`):
 * o valor combinado com o cliente (`source: "manual"`, o cadastro) e a memoria da ultima venda de
 * cada balanca (`source: "last_used"`). O site so escreve o primeiro, e sempre preservando o resto
 * do mapa: apagar a memoria seria fazer a proxima entrada do cliente vir em branco.
 *
 * O site grava na chave "cif" (`FREIGHT_MODALITY_WITH_FREIGHT` do desktop): as duas situacoes
 * com valor de frete ("valor na nota" e "valor so no sistema") compartilham essa memoria, e o
 * valor "manual" nela vence a memoria da ultima venda na hora de preencher a entrada — o que a
 * regra unica antiga ("qualquer tipo") nao garante, porque ela so e lida quando nao ha nada por
 * tipo de frete.
 */

export const FREIGHT_WITH_VALUE_KEY = "cif";

export type FreightRulePayload = Record<string, unknown>;

/** O `rule_json` como objeto: vem como jsonb (objeto) ou, em linha antiga, como texto. */
export function readFreightRulePayload(value: unknown): FreightRulePayload | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as FreightRulePayload)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as FreightRulePayload)
    : null;
}

function modalitiesOf(payload: FreightRulePayload | null): Record<string, unknown> {
  const raw = payload?.modalities;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

function withoutModalities(payload: FreightRulePayload): FreightRulePayload {
  const rule = { ...payload };
  delete rule.modalities;
  return rule;
}

function legacyBaseValue(payload: FreightRulePayload | null): number {
  const value = Number(payload?.baseValueCents);
  return Number.isFinite(value) ? value : 0;
}

/**
 * O `rule_json` com o valor combinado (por tonelada) gravado como cadastro. Mantem a regra unica
 * antiga, a memoria da ultima venda dos outros tipos de frete e o destino/cupom que a ultima
 * venda deixou neste tipo — o cadastro nao diz nada sobre eles.
 */
export function withManualFreightValue(
  current: unknown,
  baseValueCents: number,
  nowIso: string
): FreightRulePayload {
  const payload = readFreightRulePayload(current);
  const modalities = modalitiesOf(payload);
  const previous = modalities[FREIGHT_WITH_VALUE_KEY] as Record<string, unknown> | undefined;
  const base: FreightRulePayload = payload
    ? withoutModalities(payload)
    : { id: "default", name: "Frete do cliente", type: "per_ton", baseValueCents: 0, unit: "ton" };

  const value: Record<string, unknown> = {
    type: "per_ton",
    baseValueCents,
    destination: typeof previous?.destination === "string" ? previous.destination : null,
    source: "manual",
    updatedAt: nowIso
  };
  if (typeof previous?.showOnReceipt === "boolean") value.showOnReceipt = previous.showOnReceipt;
  modalities[FREIGHT_WITH_VALUE_KEY] = value;
  return { ...base, modalities };
}

/**
 * Tira um valor da regra, como o "Remover" da balanca: com `modality`, so aquele tipo de frete;
 * sem ela (`null`), a regra unica antiga — e a balanca exclui a linha inteira nesse caso.
 * Devolve `null` quando a linha deve ser excluida (sobrou vazia).
 */
export function withoutFreightValue(
  current: unknown,
  modality: string | null
): FreightRulePayload | null {
  if (!modality) return null;
  const payload = readFreightRulePayload(current);
  const modalities = modalitiesOf(payload);
  delete modalities[modality];
  if (Object.keys(modalities).length === 0 && legacyBaseValue(payload) <= 0) return null;
  return { ...(payload ? withoutModalities(payload) : {}), modalities };
}
