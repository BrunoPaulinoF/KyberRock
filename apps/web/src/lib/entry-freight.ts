/**
 * O frete e a condicao de pagamento da Nova entrada do site, com as MESMAS regras da Nova
 * entrada do desktop. As regras de base (`desktop/freight.ts`, `desktop/payment-condition-*.ts`)
 * sao copias fieis de `apps/desktop/src/services/` — o site nao importa outro workspace — e o
 * teste `desktop-copies.test.ts` avisa quando a copia ficar para tras.
 */

import {
  freightModalityLookupKeys,
  getFreightModalityInfo,
  isFreightModality,
  isFreightModalityWithFreight,
  resolveFreightModality,
  type FreightGroup,
  type FreightModality,
  type FreightRule
} from "./desktop/freight";
import { tryParsePaymentCondition } from "./desktop/payment-condition-parser";

export type FreightCalculationType = "per_ton" | "per_ton_km" | "fixed_plus_ton";

/** O bloco de frete do formulario (os mesmos campos do `WeighingFormState` do desktop). */
export interface EntryFreightForm {
  freightModality: FreightModality;
  freightCalculationType: FreightCalculationType;
  freightBaseValueCents: number | null;
  freightFixedValueCents: number | null;
  freightDistanceKm: string;
  freightDestination: string;
  deductFreightFromCredit: boolean;
}

/** Sem frete, com o transportador na nota (situacao 3): o caso mais comum da balanca. */
export const INITIAL_ENTRY_FREIGHT: EntryFreightForm = {
  freightModality: "third_party",
  freightCalculationType: "per_ton",
  freightBaseValueCents: null,
  freightFixedValueCents: null,
  freightDistanceKm: "",
  freightDestination: "",
  deductFreightFromCredit: false
};

export function hasFreightValue(form: Pick<EntryFreightForm, "freightModality">): boolean {
  return isFreightModalityWithFreight(form.freightModality);
}

/** Troca de grupo (Com frete / Sem frete), como o `applyFreightGroupToEntryForm` do desktop. */
export function applyFreightGroup(form: EntryFreightForm, group: FreightGroup): EntryFreightForm {
  const withFreight = group === "with_freight";
  return {
    ...form,
    freightModality: resolveFreightModality(
      withFreight ? { group, valueOnInvoice: true } : { group, carrierOnInvoice: true }
    ),
    deductFreightFromCredit: withFreight ? form.deductFreightFromCredit : false
  };
}

/** A caixa abaixo do tipo de frete: "valor na nota" (com frete) ou "transportador na nota". */
export function applyFreightInvoiceChoice(
  form: EntryFreightForm,
  checked: boolean
): EntryFreightForm {
  const withFreight = hasFreightValue(form);
  return {
    ...form,
    freightModality: resolveFreightModality(
      withFreight
        ? { group: "with_freight", valueOnInvoice: checked }
        : { group: "without_freight", carrierOnInvoice: checked }
    )
  };
}

export function freightInvoiceChoice(modality: FreightModality): {
  checked: boolean;
  label: string;
} {
  const info = getFreightModalityInfo(modality);
  return info.group === "with_freight"
    ? { checked: info.valueOnInvoice, label: "O valor do frete aparece na nota e no cupom" }
    : { checked: info.carrierOnInvoice, label: "Informar o transportador na nota" };
}

/** A transportadora so e obrigatoria quando vai constar na nota (`isCarrierRequiredForEntry`). */
export function isCarrierRequired(modality: FreightModality): boolean {
  const info = getFreightModalityInfo(modality);
  return info.usesCarrier && info.carrierOnInvoice;
}

/** O tipo de frete padrao do cadastro do cliente (`customerFreightModalityPatch`). */
export function customerDefaultModality(value: string | null | undefined): FreightModality | null {
  return isFreightModality(value) ? value : null;
}

/** Frete pago pela Pedreira + forma "credito do cliente": o frete entra na fatura sozinho. */
export function freightGoesToCustomerInvoice(
  form: Pick<EntryFreightForm, "freightModality">,
  paymentMethodIsCredit: boolean
): boolean {
  const info = getFreightModalityInfo(form.freightModality);
  return info.supportsCharge && info.defaultPayer === "quarry" && paymentMethodIsCredit;
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** As mesmas mensagens do `validateWeighingForm` do desktop para frete e condicao. */
export function validateEntryFreight(form: EntryFreightForm, conditionText: string): string | null {
  if (conditionText.trim() && !tryParsePaymentCondition(conditionText)) {
    return (
      'Condicao personalizada invalida. Use "30" (dias), "7 14 21", "7/14/21", "3 parcelas" ' +
      'ou periodo ("s+20" semana, "d+20" dezena, "q+20" quinzena, "m+20" mes).'
    );
  }
  if (hasFreightValue(form)) {
    if (form.freightBaseValueCents === null && form.freightFixedValueCents === null) {
      return "Informe o valor do frete.";
    }
    if (
      form.freightCalculationType === "per_ton_km" &&
      parsePositiveNumber(form.freightDistanceKm) === null
    ) {
      return "Informe a distancia do frete em km.";
    }
  }
  return null;
}

/** O que vai no pedido de entrada (`web-api` -> balanca executora). */
export function entryFreightPayload(form: EntryFreightForm): Record<string, unknown> {
  if (!hasFreightValue(form)) return { freightModality: form.freightModality };
  const freight: Record<string, unknown> = {
    calculationType: form.freightCalculationType,
    baseValueCents: form.freightBaseValueCents ?? 0
  };
  if (form.freightCalculationType === "fixed_plus_ton" && form.freightFixedValueCents !== null) {
    freight.fixedValueCents = form.freightFixedValueCents;
  }
  if (form.freightCalculationType === "per_ton_km") {
    freight.distanceKm = parsePositiveNumber(form.freightDistanceKm);
  }
  if (form.freightDestination.trim()) freight.destination = form.freightDestination.trim();
  return {
    freightModality: form.freightModality,
    freight,
    deductFreightFromCredit: form.deductFreightFromCredit
  };
}

// ---------------------------------------------------------------------------
// Memoria de frete do cliente (`customer_freight_rules`)
// ---------------------------------------------------------------------------

export interface CustomerFreightRuleRow {
  customer_id: string;
  product_id: string | null;
  rule_json: unknown;
  is_active: boolean;
  deleted_at: string | null;
}

export interface ResolvedCustomerFreight {
  calculationType: FreightCalculationType;
  baseValueCents: number;
  fixedValueCents: number | null;
  distanceKm: number | null;
  destination: string | null;
  /** Se o valor saiu no cupom da ultima vez (decide "valor na nota"). */
  showOnReceipt: boolean;
}

interface StoredModalityValue {
  type?: string;
  baseValueCents?: unknown;
  fixedValueCents?: unknown;
  distanceKm?: unknown;
  destination?: unknown;
  showOnReceipt?: unknown;
  source?: unknown;
}

function asPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return value !== undefined && value !== null && Number.isFinite(parsed) ? parsed : null;
}

function calculationOf(type: unknown): FreightCalculationType {
  return type === "per_ton_km" || type === "fixed_plus_ton" ? type : "per_ton";
}

/**
 * O valor de frete a puxar para (cliente, produto), com a precedencia do
 * `getCustomerFreightRuleForProduct` do desktop: o que esta no cadastro ("manual") vence a
 * memoria da ultima venda, o valor do produto vence o padrao do cliente, e sem valor por tipo de
 * frete cai na regra unica antiga — so quando ela tem valor.
 */
export function resolveCustomerFreight(
  rows: readonly CustomerFreightRuleRow[],
  customerId: string,
  productId: string,
  modality: FreightModality = "fob"
): ResolvedCustomerFreight | null {
  const live = rows.filter(
    (row) => row.customer_id === customerId && row.is_active && !row.deleted_at
  );
  const candidates = [
    live.find((row) => row.product_id === productId),
    live.find((row) => row.product_id === null)
  ].filter((row): row is CustomerFreightRuleRow => Boolean(row));
  if (candidates.length === 0) return null;
  const payloads = candidates.map((row) => asPayload(row.rule_json) ?? {});

  const lookupKeys = freightModalityLookupKeys(modality);
  for (const source of ["manual", "last_used"] as const) {
    for (const key of lookupKeys) {
      for (const payload of payloads) {
        const modalities = asPayload(payload.modalities) as Record<
          string,
          StoredModalityValue
        > | null;
        const value = modalities?.[key];
        if (!value || typeof value !== "object") continue;
        const valueSource = value.source === "manual" ? "manual" : "last_used";
        const base = numberOrNull(value.baseValueCents);
        if (valueSource !== source || base === null) continue;
        return {
          calculationType: calculationOf(value.type),
          baseValueCents: base,
          fixedValueCents: numberOrNull(value.fixedValueCents),
          distanceKm: numberOrNull(value.distanceKm),
          destination: typeof value.destination === "string" ? value.destination : null,
          showOnReceipt: typeof value.showOnReceipt === "boolean" ? value.showOnReceipt : true
        };
      }
    }
  }

  const legacy = payloads.find((payload) => (numberOrNull(payload.baseValueCents) ?? 0) > 0) as
    | (Partial<FreightRule> & Record<string, unknown>)
    | undefined;
  if (!legacy) return null;
  return {
    calculationType: calculationOf(legacy.type),
    baseValueCents: numberOrNull(legacy.baseValueCents) ?? 0,
    fixedValueCents: numberOrNull(legacy.fixedValueCents),
    distanceKm: numberOrNull(legacy.distanceKm),
    destination: null,
    showOnReceipt: true
  };
}

// ---------------------------------------------------------------------------
// Legenda da condicao de pagamento (`PaymentConditionLegend` do desktop)
// ---------------------------------------------------------------------------

export type PaymentConditionPreviewStatus = "empty" | "ok" | "invalid";

export const PAYMENT_CONDITION_FORMATS: ReadonlyArray<{ example: string; meaning: string }> = [
  { example: "30", meaning: "so o numero = 1 parcela 30 dias apos a venda" },
  { example: "7 14 21", meaning: "3 parcelas nesses prazos (igual a 7/14/21)" },
  { example: "3 parcelas", meaning: "3 parcelas mensais (30, 60 e 90 dias)" },
  { example: "s + 20", meaning: "semana (7) + 20 dias = 1 parcela em 27 dias" },
  { example: "d + 20", meaning: "dezena (10) + 20 dias = 1 parcela em 30 dias" },
  { example: "q + 20", meaning: "quinzena (15) + 20 dias = 1 parcela em 35 dias" },
  { example: "m + 20", meaning: "mes (30) + 20 dias = 1 parcela em 50 dias" },
  { example: "2s / 3m", meaning: "multiplo do periodo: 2 semanas (14) e 3 meses (90)" },
  { example: "s+20/d+20", meaning: "periodos na lista = 2 parcelas (27 e 30 dias)" },
  { example: "A Vista", meaning: "sem prazo; o campo vazio tambem vale a vista" }
];

const PREVIEW_MAX_DAYS = 6;

function formatDayLabel(days: number): string {
  return days === 0 ? "a vista" : String(days);
}

function formatDayList(days: number[]): string {
  const labels =
    days.length > PREVIEW_MAX_DAYS
      ? [...days.slice(0, 3).map(formatDayLabel), "...", formatDayLabel(days[days.length - 1])]
      : days.map(formatDayLabel);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

/** A previa embaixo do campo: o parcelamento que o texto digitado gera. */
export function describePaymentCondition(text: string): {
  status: PaymentConditionPreviewStatus;
  message: string;
} {
  const value = (text ?? "").trim();
  if (!value) return { status: "empty", message: "Vazio = a vista (vencimento no dia da venda)." };
  const parsed = tryParsePaymentCondition(value);
  if (!parsed) {
    return { status: "invalid", message: "Condicao nao reconhecida. Use um dos formatos abaixo." };
  }
  const days = parsed.installments.map((installment) => installment.dueDays);
  if (days.length === 1) {
    return {
      status: "ok",
      message:
        days[0] === 0
          ? "1 parcela a vista (vencimento no dia da venda)."
          : `1 parcela em ${days[0]} dias apos a venda.`
    };
  }
  return {
    status: "ok",
    message: `${days.length} parcelas: ${formatDayList(days)} dias apos a venda.`
  };
}

/** Texto da condicao guardada num cadastro (`rules_json.raw`), para preencher o campo livre. */
export function conditionTextOf(rulesJson: unknown, name: string): string {
  const payload = asPayload(rulesJson);
  const raw = payload && typeof payload.raw === "string" ? payload.raw : "";
  return raw || name;
}
