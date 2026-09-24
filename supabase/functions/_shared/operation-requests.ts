/**
 * Regras do pedido de pesagem feito pelo site (`operation_requests`).
 *
 * O site nao pesa: ele pede, e a balanca executora da unidade executa pelas mesmas funcoes dos
 * botoes do desktop (ver migracao `202609250001_web_operation_requests`). O que vive aqui e a
 * parte PURA, usada pelos dois lados da nuvem:
 *
 *  - a `web-api`, que valida o pedido antes de grava-lo — o erro de digitacao volta na hora
 *    para quem esta no site, em vez de ir ate a balanca e voltar como falha;
 *  - a `desktop-operation-requests`, que decide pedido abandonado e executora conectada.
 *
 * A balanca confere tudo de novo ao executar (cadastro pronto para o OMIE, pesagem ainda
 * aberta, peso minimo): esta validacao e so a primeira peneira, nunca a unica.
 */

export const OPERATION_REQUEST_KINDS = ["entry", "exit", "update", "cancel", "reprint"] as const;
export type OperationRequestKind = (typeof OPERATION_REQUEST_KINDS)[number];

export const OPERATION_REQUEST_STATUSES = ["pending", "processing", "done", "failed"] as const;
export type OperationRequestStatus = (typeof OPERATION_REQUEST_STATUSES)[number];

/**
 * Depois de quanto tempo um pedido `processing` sem resposta volta para a fila. Maior que o do
 * faturamento: o fechamento imprime cupom, e reenviar cedo demais so faria a balanca repetir o
 * trabalho que ela ainda esta terminando. A repeticao em si e segura (ver `operation_id`).
 */
export const OPERATION_REQUEST_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Sem pergunta da executora ha mais que isto, o site mostra "balanca fora do ar". A executora
 * pergunta a cada 30 s (e na hora, quando chega aviso), entao 90 s sao tres tiques perdidos.
 */
export const OPERATION_EXECUTOR_ONLINE_WINDOW_MS = 90 * 1000;

/** Intervalo minimo entre dois carimbos de "executora conectada" (poupa escrita no banco). */
export const OPERATION_EXECUTOR_TOUCH_INTERVAL_MS = 20 * 1000;

/** Maior peso aceito, em kg. Carreta cheia passa pouco de 70 t: acima disso e erro de digito. */
export const MAX_WEIGHT_KG = 150_000;

export type OperationType = "invoice" | "internal";

/**
 * As quatro situacoes do tipo de frete da Nova entrada (`apps/desktop/src/services/freight.ts`):
 * `fob` = com frete, valor na nota; `cif` = com frete, valor so no sistema; `third_party` = sem
 * frete, transportador na nota; `none` = sem ocorrencia de frete. As chaves legadas nao entram
 * aqui: o seletor do desktop tambem nao as oferece mais.
 */
export const ENTRY_FREIGHT_MODALITIES = ["fob", "cif", "third_party", "none"] as const;
export type EntryFreightModality = (typeof ENTRY_FREIGHT_MODALITIES)[number];

export const FREIGHT_CALCULATION_TYPES = ["per_ton", "per_ton_km", "fixed_plus_ton"] as const;
export type FreightCalculationType = (typeof FREIGHT_CALCULATION_TYPES)[number];

/** O frete da entrada "com frete" — os mesmos campos do bloco de frete do desktop. */
export interface EntryFreightPayload {
  calculationType: FreightCalculationType;
  baseValueCents: number;
  fixedValueCents?: number;
  distanceKm?: number;
  destination?: string;
}

/**
 * Primeira versao do desktop que entende frete e condicao digitada no pedido de entrada. Uma
 * executora mais antiga registraria a entrada IGNORANDO esses campos (sem frete, condicao a
 * vista) — em silencio. Entao a `web-api` recusa o pedido com frete/condicao enquanto a
 * executora da unidade nao estiver nesta versao.
 */
export const ENTRY_FREIGHT_MIN_EXECUTOR_VERSION = "0.8.253";

/** Compara "0.8.253" com "0.8.60" pelos numeros (nao como texto). Nulo/invalido = mais antigo. */
export function isVersionAtLeast(version: unknown, minimum: string): boolean {
  if (typeof version !== "string") return false;
  const parse = (value: string) => value.trim().replace(/^v/, "").split(".").map(Number);
  const current = parse(version);
  const target = parse(minimum);
  if (current.some((part) => !Number.isInteger(part))) return false;
  for (let index = 0; index < Math.max(current.length, target.length); index++) {
    const a = current[index] ?? 0;
    const b = target[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** O pedido de entrada usa frete ou condicao digitada (campos que so a versao nova entende)? */
export function entryNeedsFreightSupport(payload: EntryRequestPayload): boolean {
  return (
    Boolean(payload.conditionText) ||
    (payload.freightModality !== undefined && payload.freightModality !== "third_party")
  );
}

/** Condicao digitada: o mesmo limite do campo livre do desktop, com folga. */
export const MAX_CONDITION_TEXT = 80;

export interface EntryRequestPayload {
  customerId: string;
  vehicleId: string;
  driverId: string;
  productId: string;
  carrierId?: string;
  paymentTermId?: string;
  paymentMethodId?: string;
  operationType: OperationType;
  entryWeightKg: number;
  /** Ausente = o padrao da balanca (sem frete, transportador na nota). */
  freightModality?: EntryFreightModality;
  /** So nas situacoes com frete (`fob`, `cif`). */
  freight?: EntryFreightPayload;
  deductFreightFromCredit?: boolean;
  /** Condicao digitada ("30", "7 14 21"); vence `paymentTermId`. A balanca interpreta. */
  conditionText?: string;
}

export interface ExitRequestPayload {
  exitWeightKg: number;
  operationType?: OperationType;
}

export interface UpdateRequestPayload {
  customerId?: string;
  productId?: string;
  vehicleId?: string;
  driverId?: string;
  carrierId?: string | null;
  paymentMethodId?: string | null;
  paymentTermId?: string | null;
  operationType?: OperationType;
  unitPriceCents?: number;
}

export interface CancelRequestPayload {
  reason: string;
}

export type OperationRequestPayload =
  | EntryRequestPayload
  | ExitRequestPayload
  | UpdateRequestPayload
  | CancelRequestPayload
  | Record<string, never>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Row = Record<string, unknown>;

export function isOperationRequestKind(value: unknown): value is OperationRequestKind {
  return (
    typeof value === "string" && (OPERATION_REQUEST_KINDS as readonly string[]).includes(value)
  );
}

function text(payload: Row, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** `undefined` = nao mexer; `null` = tirar; texto = trocar. */
function nullableText(payload: Row, key: string): string | null | undefined {
  if (!(key in payload)) return undefined;
  const value = payload[key];
  if (value === null) return null;
  return text(payload, key) ?? null;
}

function operationType(value: unknown): OperationType | undefined {
  return value === "invoice" || value === "internal" ? value : undefined;
}

/** Peso em kg inteiro e positivo. Aceita "12.340" e "12340"; recusa zero, negativo e absurdo. */
export function parseWeightKg(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(
            value
              .replace(/\s/g, "")
              .replace(/\.(?=\d{3}(\D|$))/g, "")
              .replace(",", ".")
          )
        : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  const kg = Math.round(raw);
  if (kg <= 0 || kg > MAX_WEIGHT_KG) return null;
  return kg;
}

function weightError(label: string): string {
  return `Informe o peso ${label} em kg (maior que zero e ate ${MAX_WEIGHT_KG.toLocaleString("pt-BR")} kg).`;
}

export function validateEntryPayload(payload: Row): ValidationResult<EntryRequestPayload> {
  const customerId = text(payload, "customerId");
  const vehicleId = text(payload, "vehicleId");
  const driverId = text(payload, "driverId");
  const productId = text(payload, "productId");
  if (!customerId) return { ok: false, error: "Escolha o cliente." };
  if (!vehicleId) return { ok: false, error: "Escolha o veiculo (placa)." };
  if (!driverId) return { ok: false, error: "Escolha o motorista." };
  if (!productId) return { ok: false, error: "Escolha o produto." };
  const entryWeightKg = parseWeightKg(payload.entryWeightKg);
  if (entryWeightKg === null) return { ok: false, error: weightError("de entrada") };
  const type =
    payload.operationType === undefined ? "invoice" : operationType(payload.operationType);
  if (!type) return { ok: false, error: "Tipo de operacao invalido (com nota ou sem nota)." };
  const value: EntryRequestPayload = {
    customerId,
    vehicleId,
    driverId,
    productId,
    operationType: type,
    entryWeightKg
  };
  const carrierId = text(payload, "carrierId");
  const paymentTermId = text(payload, "paymentTermId");
  const paymentMethodId = text(payload, "paymentMethodId");
  if (carrierId) value.carrierId = carrierId;
  if (paymentTermId) value.paymentTermId = paymentTermId;
  if (paymentMethodId) value.paymentMethodId = paymentMethodId;
  const conditionText = text(payload, "conditionText");
  if (conditionText) {
    if (conditionText.length > MAX_CONDITION_TEXT) {
      return { ok: false, error: "Condicao de pagamento muito longa." };
    }
    value.conditionText = conditionText;
    delete value.paymentTermId;
  }
  if (payload.freightModality !== undefined) {
    const modality = payload.freightModality;
    if (!(ENTRY_FREIGHT_MODALITIES as readonly unknown[]).includes(modality)) {
      return { ok: false, error: "Tipo de frete invalido." };
    }
    value.freightModality = modality as EntryFreightModality;
  }
  if (value.freightModality === "fob" || value.freightModality === "cif") {
    const freight = validateEntryFreight(payload.freight);
    if (!freight.ok) return freight;
    value.freight = freight.value;
    if (payload.deductFreightFromCredit === true) value.deductFreightFromCredit = true;
  }
  return { ok: true, value };
}

function centsOrUndefined(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const cents = Number(value);
  return Number.isInteger(cents) && cents >= 0 ? cents : null;
}

/** As mesmas exigencias do `validateWeighingForm` do desktop para o frete com valor. */
function validateEntryFreight(raw: unknown): ValidationResult<EntryFreightPayload> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Informe o valor do frete." };
  const freight = raw as Row;
  const calculationType = freight.calculationType ?? "per_ton";
  if (!(FREIGHT_CALCULATION_TYPES as readonly unknown[]).includes(calculationType)) {
    return { ok: false, error: "Calculo do frete invalido." };
  }
  const base = centsOrUndefined(freight.baseValueCents);
  const fixed = centsOrUndefined(freight.fixedValueCents);
  if (base === null || fixed === null) return { ok: false, error: "Valor do frete invalido." };
  if (base === undefined && fixed === undefined) {
    return { ok: false, error: "Informe o valor do frete." };
  }
  const value: EntryFreightPayload = {
    calculationType: calculationType as FreightCalculationType,
    baseValueCents: base ?? 0
  };
  if (fixed !== undefined) value.fixedValueCents = fixed;
  if (calculationType === "per_ton_km") {
    const distance = Number(String(freight.distanceKm ?? "").replace(",", "."));
    if (!Number.isFinite(distance) || distance <= 0) {
      return { ok: false, error: "Informe a distancia do frete em km." };
    }
    value.distanceKm = distance;
  }
  const destination = text(freight, "destination");
  if (destination) value.destination = destination.slice(0, 200);
  return { ok: true, value };
}

export function validateExitPayload(payload: Row): ValidationResult<ExitRequestPayload> {
  const exitWeightKg = parseWeightKg(payload.exitWeightKg);
  if (exitWeightKg === null) return { ok: false, error: weightError("de saida") };
  const value: ExitRequestPayload = { exitWeightKg };
  if (payload.operationType !== undefined) {
    const type = operationType(payload.operationType);
    if (!type) return { ok: false, error: "Tipo de operacao invalido (com nota ou sem nota)." };
    value.operationType = type;
  }
  return { ok: true, value };
}

export function validateUpdatePayload(payload: Row): ValidationResult<UpdateRequestPayload> {
  const value: UpdateRequestPayload = {};
  for (const key of ["customerId", "productId", "vehicleId", "driverId"] as const) {
    if (key in payload) {
      const id = text(payload, key);
      if (!id)
        return {
          ok: false,
          error: "Cliente, produto, veiculo e motorista nao podem ficar vazios."
        };
      value[key] = id;
    }
  }
  for (const key of ["carrierId", "paymentMethodId", "paymentTermId"] as const) {
    const id = nullableText(payload, key);
    if (id !== undefined) value[key] = id;
  }
  if (payload.operationType !== undefined) {
    const type = operationType(payload.operationType);
    if (!type) return { ok: false, error: "Tipo de operacao invalido (com nota ou sem nota)." };
    value.operationType = type;
  }
  if (payload.unitPriceCents !== undefined) {
    const cents = Number(payload.unitPriceCents);
    if (!Number.isInteger(cents) || cents <= 0) {
      return { ok: false, error: "Informe o preco por tonelada maior que zero." };
    }
    value.unitPriceCents = cents;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "Nada para alterar nesta pesagem." };
  }
  return { ok: true, value };
}

export function validateCancelPayload(payload: Row): ValidationResult<CancelRequestPayload> {
  const reason = text(payload, "reason");
  if (!reason || reason.length < 3) {
    return { ok: false, error: "Informe o motivo do cancelamento." };
  }
  return { ok: true, value: { reason: reason.slice(0, 500) } };
}

/** Valida o payload do tipo pedido. `reprint` nao leva nada alem da pesagem. */
export function validateOperationRequest(
  kind: OperationRequestKind,
  payload: Row
): ValidationResult<OperationRequestPayload> {
  switch (kind) {
    case "entry":
      return validateEntryPayload(payload);
    case "exit":
      return validateExitPayload(payload);
    case "update":
      return validateUpdatePayload(payload);
    case "cancel":
      return validateCancelPayload(payload);
    case "reprint":
      return { ok: true, value: {} };
  }
}

/** O pedido muda o preco da pesagem? (e o que faz a `web-api` pedir a senha de preco). */
export function changesPrice(
  kind: OperationRequestKind,
  payload: OperationRequestPayload
): boolean {
  return kind === "update" && (payload as UpdateRequestPayload).unitPriceCents !== undefined;
}

/** Um pedido `processing` ha mais tempo que o limite foi abandonado (balanca caiu no meio). */
export function isStaleOperationClaim(claimedAt: string | null | undefined, now: Date): boolean {
  if (!claimedAt) return true;
  const parsed = Date.parse(claimedAt);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed > OPERATION_REQUEST_CLAIM_TIMEOUT_MS;
}

/** A executora perguntou por pedidos ha pouco? */
export function isExecutorOnline(seenAt: string | null | undefined, now: Date): boolean {
  if (!seenAt) return false;
  const parsed = Date.parse(seenAt);
  if (Number.isNaN(parsed)) return false;
  return now.getTime() - parsed <= OPERATION_EXECUTOR_ONLINE_WINDOW_MS;
}

/** Vale gravar o carimbo de "conectada" agora, ou o ultimo ainda e recente? */
export function shouldTouchExecutor(seenAt: string | null | undefined, now: Date): boolean {
  if (!seenAt) return true;
  const parsed = Date.parse(seenAt);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed >= OPERATION_EXECUTOR_TOUCH_INTERVAL_MS;
}
