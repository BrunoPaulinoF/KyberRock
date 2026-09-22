/**
 * Validacao e normalizacao do cadastro que chega pelo site (`web-api`).
 *
 * E a parte PURA: nada aqui toca banco. O que entra e o payload solto do navegador; o que sai
 * e ou um erro em portugues para a tela mostrar, ou as colunas prontas para gravar — com as
 * mesmas regras que a balanca ja aplica (`packages/shared/src/format.ts`, espelhado em
 * `_shared/document.ts`): documento com CNPJ alfanumerico nunca perde letra, UF em maiusculas,
 * preco em centavos inteiros.
 *
 * `undefined` e "o site nao mandou esse campo" (na edicao, nao mexe); `null` e "o site mandou
 * vazio" (limpa a coluna). A distincao importa porque a tela salva o formulario inteiro, e
 * uma edicao que so trocou o telefone nao pode apagar o endereco.
 */

import { documentKind, isValidDocument, normalizeDocument } from "./document.ts";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseFailure<T = never>(error: string): ParseResult<T> {
  return { ok: false, error };
}

type Payload = Record<string, unknown>;

/** Texto opcional: `undefined` nao veio; `null` veio vazio; string veio com valor (aparada). */
export function optionalText(payload: Payload, key: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return undefined;
  const value = payload[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function optionalBoolean(payload: Payload, key: string): boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return undefined;
  const value = payload[key];
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return undefined;
}

function optionalInteger(
  payload: Payload,
  key: string,
  range: { min: number; max: number }
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return { ok: true, value: undefined };
  const value = payload[key];
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) return { ok: false };
  return { ok: true, value: parsed };
}

/** `YYYY-MM-DD` ou nulo. Qualquer outra coisa e recusada em vez de virar uma data errada. */
export function parseIsoDate(
  payload: Payload,
  key: string
): { ok: true; value: string | null | undefined } | { ok: false } {
  const text = optionalText(payload, key);
  if (text === undefined || text === null) return { ok: true, value: text };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false };
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return { ok: false };
  }
  return { ok: true, value: text };
}

/**
 * Documento (CNPJ/CPF) do jeito que a nuvem guarda: sem mascara, letras em maiusculas. Nunca
 * `replace(/\D/g, "")` — o CNPJ alfanumerico tem letra, e jogar a letra fora grava OUTRO
 * documento (ver CLAUDE.md, "CNPJ alfanumerico").
 */
export function parseDocument(
  payload: Payload,
  key: string,
  label: string
): ParseResult<string | null | undefined> {
  const text = optionalText(payload, key);
  if (text === undefined || text === null) return { ok: true, value: text };
  const normalized = normalizeDocument(text);
  if (!isValidDocument(normalized)) {
    return parseFailure(`${label} invalido. Confira os digitos e tente de novo.`);
  }
  return { ok: true, value: normalized };
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** Campos de texto do cliente, do nome no payload (camelCase) para a coluna. */
const CUSTOMER_TEXT_FIELDS: ReadonlyArray<[input: string, column: string]> = [
  ["email", "email"],
  ["phone", "phone"],
  ["phoneSecondary", "phone_secondary"],
  ["contactName", "contact_name"],
  ["zipcode", "zipcode"],
  ["addressStreet", "address_street"],
  ["addressNumber", "address_number"],
  ["addressComplement", "address_complement"],
  ["neighborhood", "neighborhood"],
  ["city", "city"],
  ["stateRegistration", "state_registration"],
  ["observations", "observations"],
  ["defaultPaymentTermId", "default_payment_term_id"]
];

/**
 * Colunas de `customers` que o site pode gravar num cadastro/edicao.
 *
 * Na criacao `legal_name` e obrigatorio e `trade_name` cai nele quando vazio. Na edicao so
 * entra o que veio. `is_individual` acompanha a FORMA do documento (`documentKind`), nunca o
 * tamanho — CNPJ alfanumerico tem 14 posicoes com letra.
 */
export function parseCustomerInput(
  payload: Payload,
  mode: "create" | "update"
): ParseResult<Record<string, unknown>> {
  const columns: Record<string, unknown> = {};

  const legalName = optionalText(payload, "legalName");
  if (mode === "create" && !legalName) return parseFailure("Informe a razao social do cliente.");
  if (legalName === null) return parseFailure("A razao social nao pode ficar vazia.");
  if (legalName) columns.legal_name = legalName;

  const tradeName = optionalText(payload, "tradeName");
  if (tradeName) columns.trade_name = tradeName;
  else if (mode === "create") columns.trade_name = legalName;
  else if (tradeName === null) return parseFailure("O nome fantasia nao pode ficar vazio.");

  const document = parseDocument(payload, "document", "CNPJ/CPF");
  if (!document.ok) return document;
  if (document.value !== undefined) {
    columns.document = document.value;
    columns.is_individual = documentKind(document.value) === "cpf";
  }

  for (const [input, column] of CUSTOMER_TEXT_FIELDS) {
    const value = optionalText(payload, input);
    if (value !== undefined) columns[column] = value;
  }

  const state = optionalText(payload, "state");
  if (state !== undefined) {
    if (state !== null && !/^[A-Za-z]{2}$/.test(state)) {
      return parseFailure("UF invalida: use a sigla com duas letras (ex.: SP).");
    }
    columns.state = state ? state.toUpperCase() : null;
  }

  if (mode === "update" && Object.keys(columns).length === 0) {
    return parseFailure("Nada para salvar: nenhum campo foi informado.");
  }
  return { ok: true, value: columns };
}

export const CREDIT_MODES = ["normal", "prepaid"] as const;
export const CREDIT_PERIODICITIES = ["monthly", "biweekly", "weekly"] as const;

/**
 * Bloco comercial/credito do cliente — os campos com dono (`MASTERED_CUSTOMER_FIELDS` no
 * desktop). So o gestor grava, e a gravacao carimba `commercial_published_at`: e essa marca
 * que faz a balanca adotar o bloco (`isCommercialBlockPublished`).
 */
export function parseCommercialInput(payload: Payload): ParseResult<Record<string, unknown>> {
  const columns: Record<string, unknown> = {};

  for (const [input, column] of [
    ["defaultPaymentMethodId", "default_payment_method_id"],
    ["defaultCarrierId", "default_carrier_id"],
    ["defaultFreightModality", "default_freight_modality"]
  ] as const) {
    const value = optionalText(payload, input);
    if (value !== undefined) columns[column] = value;
  }

  for (const [input, column] of [
    ["nfRequired", "nf_required"],
    ["creditAccountEnabled", "credit_account_enabled"]
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(payload, input)) continue;
    const value = optionalBoolean(payload, input);
    if (value === undefined) return parseFailure(`Valor invalido em ${input}: use true ou false.`);
    columns[column] = value;
  }

  const creditMode = optionalText(payload, "creditMode");
  if (creditMode !== undefined) {
    if (!creditMode || !(CREDIT_MODES as readonly string[]).includes(creditMode)) {
      return parseFailure("Modo de credito invalido: use normal ou prepaid.");
    }
    columns.credit_mode = creditMode;
  }

  const periodicity = optionalText(payload, "creditPeriodicity");
  if (periodicity !== undefined) {
    if (
      periodicity !== null &&
      !(CREDIT_PERIODICITIES as readonly string[]).includes(periodicity)
    ) {
      return parseFailure("Periodicidade invalida: use monthly, biweekly ou weekly.");
    }
    columns.credit_periodicity = periodicity;
  }

  for (const [input, column, range] of [
    ["creditClosingDay", "credit_closing_day", { min: 1, max: 31 }],
    ["creditSecondClosingDay", "credit_second_closing_day", { min: 1, max: 31 }],
    ["creditBoletoDays", "credit_boleto_days", { min: 0, max: 365 }],
    ["creditSecondBoletoDays", "credit_second_boleto_days", { min: 0, max: 365 }],
    ["creditClosingWeekday", "credit_closing_weekday", { min: 0, max: 6 }]
  ] as const) {
    const parsed = optionalInteger(payload, input, range);
    if (!parsed.ok) {
      return parseFailure(
        `Valor invalido em ${input}: use um numero entre ${range.min} e ${range.max}.`
      );
    }
    if (parsed.value !== undefined) columns[column] = parsed.value;
  }

  if (Object.keys(columns).length === 0) {
    return parseFailure("Nada para salvar: nenhum campo do bloco comercial foi informado.");
  }
  return { ok: true, value: columns };
}

// ---------------------------------------------------------------------------
// Transportadora, motorista, veiculo
// ---------------------------------------------------------------------------

export function parseCarrierInput(
  payload: Payload,
  mode: "create" | "update"
): ParseResult<Record<string, unknown>> {
  const columns: Record<string, unknown> = {};
  const name = optionalText(payload, "name");
  if (mode === "create" && !name) return parseFailure("Informe o nome da transportadora.");
  if (name === null) return parseFailure("O nome da transportadora nao pode ficar vazio.");
  if (name) columns.name = name;

  const document = parseDocument(payload, "document", "CNPJ/CPF da transportadora");
  if (!document.ok) return document;
  if (document.value !== undefined) columns.document = document.value;

  if (mode === "update" && Object.keys(columns).length === 0) {
    return parseFailure("Nada para salvar: nenhum campo foi informado.");
  }
  return { ok: true, value: columns };
}

export function parseDriverInput(
  payload: Payload,
  mode: "create" | "update"
): ParseResult<Record<string, unknown>> {
  const columns: Record<string, unknown> = {};
  const name = optionalText(payload, "name");
  if (mode === "create" && !name) return parseFailure("Informe o nome do motorista.");
  if (name === null) return parseFailure("O nome do motorista nao pode ficar vazio.");
  if (name) columns.name = name;

  // O documento do motorista e livre (CPF ou CNH): a balanca tambem nao valida.
  const document = optionalText(payload, "document");
  if (document !== undefined) columns.document = document;
  const phone = optionalText(payload, "phone");
  if (phone !== undefined) columns.phone = phone;

  if (Object.prototype.hasOwnProperty.call(payload, "isIndependent")) {
    const value = optionalBoolean(payload, "isIndependent");
    if (value === undefined)
      return parseFailure("Valor invalido em isIndependent: use true ou false.");
    columns.is_independent = value;
  }

  if (mode === "update" && Object.keys(columns).length === 0) {
    return parseFailure("Nada para salvar: nenhum campo foi informado.");
  }
  return { ok: true, value: columns };
}

/** Placa como a balanca compara: maiusculas, sem espaco nem hifen. */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

export function parseVehicleInput(
  payload: Payload,
  mode: "create" | "update"
): ParseResult<Record<string, unknown>> {
  const columns: Record<string, unknown> = {};
  const plateText = optionalText(payload, "plate");
  if (mode === "create" && !plateText) return parseFailure("Informe a placa do veiculo.");
  if (plateText === null) return parseFailure("A placa nao pode ficar vazia.");
  if (plateText) {
    const plate = normalizePlate(plateText);
    if (!/^[A-Z0-9]{3,10}$/.test(plate)) {
      return parseFailure("Placa invalida: use letras e numeros (ex.: ABC1D23).");
    }
    columns.plate = plate;
  }

  const description = optionalText(payload, "description");
  if (description !== undefined) columns.description = description;
  const carrierId = optionalText(payload, "carrierId");
  if (carrierId !== undefined) columns.carrier_id = carrierId;

  if (mode === "update" && Object.keys(columns).length === 0) {
    return parseFailure("Nada para salvar: nenhum campo foi informado.");
  }
  return { ok: true, value: columns };
}

// ---------------------------------------------------------------------------
// Preco
// ---------------------------------------------------------------------------

export interface PriceInput {
  unitPriceCents: number;
  unit: string;
  validFrom: string | null;
  validTo: string | null;
}

/** Preco em CENTAVOS inteiros — o site nunca manda reais com virgula para ca. */
export function parsePriceInput(payload: Payload): ParseResult<PriceInput> {
  const raw = payload.unitPriceCents;
  const cents = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(cents) || cents < 0) {
    return parseFailure("Preco invalido: informe o valor em centavos, sem casas decimais.");
  }
  const unitText = optionalText(payload, "unit");
  const unit = unitText ? unitText.toLowerCase() : "ton";

  const validFrom = parseIsoDate(payload, "validFrom");
  if (!validFrom.ok) return parseFailure("Data inicial invalida: use o formato AAAA-MM-DD.");
  const validTo = parseIsoDate(payload, "validTo");
  if (!validTo.ok) return parseFailure("Data final invalida: use o formato AAAA-MM-DD.");

  return {
    ok: true,
    value: {
      unitPriceCents: cents,
      unit,
      validFrom: validFrom.value ?? null,
      validTo: validTo.value ?? null
    }
  };
}

// ---------------------------------------------------------------------------
// OMIE
// ---------------------------------------------------------------------------

/** Telefone "(11) 99999-9999" -> DDD e numero, do mesmo jeito que a balanca faz. */
export function splitPhoneForOmie(phone: unknown): { ddd?: string; number?: string } {
  if (typeof phone !== "string") return {};
  const match = phone.match(/\(?(\d{2})\)?\s*(\d+)/);
  return match ? { ddd: match[1], number: match[2] } : {};
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Payload do `push_customer` da `omie-sync`, montado a partir da linha de `customers`. */
export function buildOmieCustomerPayload(row: Record<string, unknown>): Record<string, unknown> {
  const phone = splitPhoneForOmie(row.phone);
  const legalName = String(row.legal_name ?? "");
  return {
    localCustomerId: String(row.id ?? ""),
    omieCustomerId: typeof row.omie_customer_id === "number" ? row.omie_customer_id : undefined,
    razaoSocial: legalName,
    nomeFantasia: textOrUndefined(row.trade_name) ?? legalName,
    cnpjCpf: textOrUndefined(row.document),
    email: textOrUndefined(row.email),
    telefone1Ddd: phone.ddd,
    telefone1Numero: phone.number,
    zipcode: textOrUndefined(row.zipcode),
    addressStreet: textOrUndefined(row.address_street),
    addressNumber: textOrUndefined(row.address_number),
    neighborhood: textOrUndefined(row.neighborhood),
    city: textOrUndefined(row.city),
    state: textOrUndefined(row.state),
    defaultPaymentTermId: textOrUndefined(row.default_payment_term_id),
    // O KyberRock e dono deste campo: string vazia LIMPA a observacao no OMIE.
    observations: typeof row.observations === "string" ? row.observations : ""
  };
}

/** Payload do `push_carrier` — a nuvem so guarda nome e documento da transportadora. */
export function buildOmieCarrierPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    // Mesmo prefixo que a balanca usa: o codigo de integracao no OMIE tem de ser o mesmo,
    // senao a transportadora que a balanca ja mandou nasceria de novo la.
    localCustomerId: `carrier:${String(row.id ?? "")}`,
    omieCustomerId: typeof row.omie_customer_id === "number" ? row.omie_customer_id : undefined,
    name: String(row.name ?? ""),
    cnpjCpf: textOrUndefined(row.document)
  };
}
