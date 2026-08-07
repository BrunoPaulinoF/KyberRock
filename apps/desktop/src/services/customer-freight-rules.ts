import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import {
  freightMemoryKey,
  freightModalityLookupKeys,
  getFreightModalityInfo,
  isFreightModality
} from "./freight.js";
import type { FreightModality, FreightRule } from "./freight.js";

export interface CustomerFreightRuleRow {
  id: string;
  customer_id: string;
  product_id: string | null;
  rule_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Origem de um valor de frete por tipo: cadastro do cliente ou memoria da ultima venda. */
export type CustomerFreightValueSource = "manual" | "last_used";

/**
 * Valor de frete de UM tipo de frete (modalidade) do cliente. Fica dentro do
 * `rule_json` da regra, num mapa por modalidade: assim o cadastro guarda um valor por
 * tipo de frete sem mexer no schema (nem no espelho da nuvem), que continua com uma
 * linha por (cliente, produto).
 */
export interface CustomerFreightModalityValue {
  type: FreightRule["type"];
  baseValueCents: number;
  fixedValueCents?: number;
  minValueCents?: number;
  distanceKm?: number;
  /** Destino/observacao usado da ultima vez nesse tipo de frete. */
  destination?: string | null;
  /** Se o valor do frete saiu impresso no cupom da ultima operacao desse tipo. */
  showOnReceipt?: boolean;
  source: CustomerFreightValueSource;
  updatedAt: string;
}

export type CustomerFreightModalityValues = Partial<
  Record<FreightModality, CustomerFreightModalityValue>
>;

export interface CustomerFreightRule {
  id: string;
  customerId: string;
  productId: string | null;
  productDescription: string | null;
  rule: FreightRule;
  /** Valores por tipo de frete; vazio nas regras antigas (so o valor unico). */
  modalities: CustomerFreightModalityValues;
  /** Tipo de frete que originou `rule` quando ela veio do mapa por modalidade. */
  modality?: FreightModality;
  /** Origem do valor resolvido: cadastro do cliente ou ultima venda. */
  source?: CustomerFreightValueSource;
  /** Destino/observacao memorizado junto com o valor resolvido. */
  destination?: string | null;
  /** Se o valor do frete deve sair impresso no cupom (memoria da ultima venda). */
  showOnReceipt?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetCustomerFreightRuleInput {
  customerId: string;
  productId?: string | null;
  /** Quando informado, grava o valor apenas para esse tipo de frete. */
  modality?: FreightModality | null;
  rule: FreightRule;
}

export interface RememberCustomerFreightValueInput {
  customerId: string;
  productId?: string | null;
  modality: FreightModality;
  rule: FreightRule;
  /** Destino/observacao da operacao, para a proxima entrada do cliente ja vir com ele. */
  destination?: string | null;
  /** Se o valor do frete saiu no cupom desta operacao. */
  showOnReceipt?: boolean;
}

interface RuleJsonPayload extends FreightRule {
  modalities?: CustomerFreightModalityValues;
}

const RULE_SELECT = `SELECT r.id, r.customer_id, r.product_id, r.rule_json, r.is_active, r.created_at, r.updated_at,
              p.description AS product_description
       FROM customer_freight_rules r
       LEFT JOIN products p ON p.id = r.product_id`;

interface RuleQueryRow extends CustomerFreightRuleRow {
  product_description: string | null;
}

export function getCustomerFreightRules(
  database: DesktopDatabase,
  customerId: string
): CustomerFreightRule[] {
  const rows = database
    .prepare(
      `${RULE_SELECT}
       WHERE r.customer_id = ? AND r.deleted_at IS NULL AND r.is_active = 1
       ORDER BY r.product_id IS NULL DESC, p.description ASC`
    )
    .all(customerId) as RuleQueryRow[];

  return rows.map((row) => mapQueryRow(row));
}

/**
 * Valor de frete a puxar na venda para (cliente, produto, tipo de frete).
 *
 * Precedencia: o que esta configurado no cadastro vence a memoria da ultima venda, e
 * o valor do produto vence o valor padrao do cliente. Sem nada por tipo de frete, cai
 * na regra unica antiga (compatibilidade com os cadastros ja gravados).
 */
export function getCustomerFreightRuleForProduct(
  database: DesktopDatabase,
  customerId: string,
  productId: string,
  modality?: FreightModality | null
): CustomerFreightRule | null {
  const specific = database
    .prepare(
      `${RULE_SELECT}
       WHERE r.customer_id = ? AND r.product_id = ? AND r.deleted_at IS NULL AND r.is_active = 1
       LIMIT 1`
    )
    .get(customerId, productId) as RuleQueryRow | undefined;

  const fallback = database
    .prepare(
      `${RULE_SELECT}
       WHERE r.customer_id = ? AND r.product_id IS NULL AND r.deleted_at IS NULL AND r.is_active = 1
       LIMIT 1`
    )
    .get(customerId) as RuleQueryRow | undefined;

  const candidates = [specific, fallback].filter((row): row is RuleQueryRow => Boolean(row));
  if (candidates.length === 0) return null;

  if (modality) {
    // As chaves legadas (FOB, terceiros, transporte proprio) entram na busca depois da
    // chave atual: o valor que o cliente usou antes da simplificacao dos tipos de frete
    // continua sendo puxado na proxima entrada.
    const lookupKeys = freightModalityLookupKeys(modality);
    for (const source of ["manual", "last_used"] as const) {
      for (const key of lookupKeys) {
        for (const row of candidates) {
          const mapped = mapQueryRow(row);
          const value = mapped.modalities[key];
          if (value && value.source === source) {
            return {
              ...mapped,
              rule: toFreightRule(value, key),
              modality: freightMemoryKey(key),
              source,
              destination: value.destination ?? null,
              showOnReceipt: value.showOnReceipt ?? true
            };
          }
        }
      }
    }
  }

  // Sem valor para o tipo de frete pedido, cai na regra unica antiga — mas so quando
  // ela tem valor: uma linha que so carrega valores por tipo preencheria zero.
  const legacy = candidates.map(mapQueryRow).find((rule) => rule.rule.baseValueCents > 0);
  return legacy ?? null;
}

/**
 * Grava o valor de frete do cliente. Com `modality`, grava so aquele tipo de frete
 * (marcado como vindo do cadastro); sem ela, atualiza a regra unica antiga.
 */
export function setCustomerFreightRule(
  database: DesktopDatabase,
  input: SetCustomerFreightRuleInput,
  now: Date = new Date()
): CustomerFreightRule {
  const id = upsertRule(database, {
    customerId: input.customerId,
    productId: input.productId ?? null,
    modality: input.modality ? freightMemoryKey(input.modality) : null,
    rule: input.rule,
    source: "manual",
    now
  });
  return getCustomerFreightRules(database, input.customerId).find((r) => r.id === id)!;
}

/**
 * Memoriza o valor de frete usado na venda para (cliente, produto, tipo de frete),
 * para a proxima venda do mesmo cliente ja vir preenchida. Nunca sobrepoe um valor
 * configurado no cadastro: a memoria e so o que preenche quando nao ha configuracao.
 */
export function rememberCustomerFreightValue(
  database: DesktopDatabase,
  input: RememberCustomerFreightValueInput,
  now: Date = new Date()
): void {
  if (!isFreightModality(input.modality)) return;
  if (!getFreightModalityInfo(input.modality).supportsCharge) return;
  upsertRule(database, {
    customerId: input.customerId,
    productId: input.productId ?? null,
    modality: freightMemoryKey(input.modality),
    rule: input.rule,
    destination: input.destination ?? null,
    showOnReceipt: input.showOnReceipt,
    source: "last_used",
    now
  });
}

/**
 * Quantas entradas do cliente sao olhadas para achar a ultima observacao de frete. A
 * observacao mora dentro do `freight_json` da operacao, entao nao da para filtrar no
 * SQL sem depender do JSON1 — o corte existe para a consulta nao ler o historico
 * inteiro de um cliente antigo. Quem escreveu a observacao acabou de escrever: ela
 * esta nas ultimas entradas, nao no ano passado.
 */
const FREIGHT_NOTE_LOOKBACK = 25;

/**
 * Observacao de frete que o cliente usou na ULTIMA entrada em que escreveu uma, seja
 * qual for o produto ou o tipo de frete. A memoria por (cliente, produto, tipo) de
 * `getCustomerFreightRuleForProduct` continua mandando quando existe — esta aqui e a
 * rede de seguranca para a proxima entrada do cliente ja vir com o combinado dele
 * mesmo quando o produto ou o tipo de frete mudou.
 *
 * Le as operacoes (e nao a regra do cliente) de proposito: e a "ultima entrada que ele
 * deu", inclusive a que ainda esta aberta na balanca.
 */
export function getLastCustomerFreightNote(
  database: DesktopDatabase,
  customerId: string
): string | null {
  const rows = database
    .prepare(
      `SELECT freight_json
       FROM weighing_operations
       WHERE customer_id = ?
         AND deleted_at IS NULL
         AND freight_json IS NOT NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(customerId, FREIGHT_NOTE_LOOKBACK) as Array<{ freight_json: string | null }>;

  for (const row of rows) {
    const note = readFreightJsonDestination(row.freight_json);
    if (note) return note;
  }
  return null;
}

/** Destino/observacao de um `freight_json`; JSON quebrado vale como sem observacao. */
function readFreightJsonDestination(freightJson: string | null): string | null {
  if (!freightJson) return null;
  try {
    const parsed = JSON.parse(freightJson) as { destination?: unknown };
    return typeof parsed.destination === "string" && parsed.destination.trim()
      ? parsed.destination.trim()
      : null;
  } catch {
    return null;
  }
}

export function removeCustomerFreightRule(
  database: DesktopDatabase,
  ruleId: string,
  now: Date = new Date()
): void {
  database
    .prepare(
      `UPDATE customer_freight_rules SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`
    )
    .run(now.toISOString(), now.toISOString(), ruleId);
}

/**
 * Remove apenas o valor de um tipo de frete. A regra so e excluida quando sobra vazia
 * (sem outros tipos e sem a regra unica antiga).
 */
export function removeCustomerFreightModality(
  database: DesktopDatabase,
  ruleId: string,
  modality: FreightModality,
  now: Date = new Date()
): void {
  const row = database
    .prepare("SELECT rule_json FROM customer_freight_rules WHERE id = ? AND deleted_at IS NULL")
    .get(ruleId) as { rule_json: string } | undefined;
  if (!row) return;

  const payload = parseRulePayload(row.rule_json);
  const modalities = { ...readModalities(payload) };
  delete modalities[modality];

  if (Object.keys(modalities).length === 0 && payload.baseValueCents <= 0) {
    removeCustomerFreightRule(database, ruleId, now);
    return;
  }

  const nowIso = now.toISOString();
  database
    .prepare("UPDATE customer_freight_rules SET rule_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify({ ...payload, modalities }), nowIso, ruleId);
}

function upsertRule(
  database: DesktopDatabase,
  input: {
    customerId: string;
    productId: string | null;
    modality: FreightModality | null;
    rule: FreightRule;
    destination?: string | null;
    showOnReceipt?: boolean;
    source: CustomerFreightValueSource;
    now: Date;
  }
): string {
  const timestamp = input.now.toISOString();
  const existing = database
    .prepare(
      `SELECT id, rule_json FROM customer_freight_rules
       WHERE customer_id = ? AND ${input.productId ? "product_id = ?" : "product_id IS NULL"}
       AND deleted_at IS NULL`
    )
    .get(input.customerId, ...(input.productId ? [input.productId] : [])) as
    | { id: string; rule_json: string }
    | undefined;

  const id = existing?.id ?? randomUUID();
  const current = existing ? parseRulePayload(existing.rule_json) : null;
  const payload = buildRulePayload({
    current,
    modality: input.modality,
    rule: input.rule,
    destination: input.destination ?? null,
    showOnReceipt: input.showOnReceipt,
    source: input.source,
    timestamp
  });
  if (!payload) return id;

  database
    .prepare(
      `INSERT INTO customer_freight_rules (
         id, customer_id, product_id, rule_json, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         product_id = excluded.product_id,
         rule_json = excluded.rule_json,
         is_active = 1,
         updated_at = excluded.updated_at`
    )
    .run(id, input.customerId, input.productId, JSON.stringify(payload), timestamp, timestamp);

  return id;
}

function buildRulePayload(input: {
  current: RuleJsonPayload | null;
  modality: FreightModality | null;
  rule: FreightRule;
  destination?: string | null;
  showOnReceipt?: boolean;
  source: CustomerFreightValueSource;
  timestamp: string;
}): RuleJsonPayload | null {
  const modalities = { ...readModalities(input.current) };

  if (!input.modality) {
    // Regra unica (sem tipo de frete): mantem os valores por tipo ja gravados.
    return { ...input.rule, modalities };
  }

  const previous = modalities[input.modality];
  const base: FreightRule = input.current
    ? stripModalities(input.current)
    : { id: "default", name: "Frete do cliente", type: "per_ton", baseValueCents: 0, unit: "ton" };

  // A memoria da ultima venda nunca sobrepoe o VALOR configurado no cadastro — mas o
  // cadastro nao diz se esse valor sai na nota/cupom, isso e escolha da venda. Entao ela
  // e memorizada por cima do valor do cadastro, que fica intacto: sem isso a proxima
  // entrada do cliente voltava a marcar "valor na nota" mesmo apos ele desmarcar.
  if (input.source === "last_used" && previous?.source === "manual") {
    if (input.showOnReceipt === undefined || input.showOnReceipt === previous.showOnReceipt) {
      return null;
    }
    modalities[input.modality] = {
      ...previous,
      showOnReceipt: input.showOnReceipt,
      updatedAt: input.timestamp
    };
    return { ...base, modalities };
  }

  modalities[input.modality] = {
    type: input.rule.type,
    baseValueCents: input.rule.baseValueCents,
    fixedValueCents: input.rule.fixedValueCents,
    minValueCents: input.rule.minValueCents,
    distanceKm: input.rule.distanceKm,
    // Cadastro sem destino/cupom informados nao apaga o que a ultima venda memorizou.
    destination: input.destination ?? previous?.destination ?? null,
    showOnReceipt: input.showOnReceipt ?? previous?.showOnReceipt,
    source: input.source,
    updatedAt: input.timestamp
  };

  return { ...base, modalities };
}

function toFreightRule(
  value: CustomerFreightModalityValue,
  modality: FreightModality
): FreightRule {
  return {
    id: `customer-freight-${modality}`,
    name: `Frete ${getFreightModalityInfo(modality).label}`,
    type: value.type,
    baseValueCents: value.baseValueCents,
    fixedValueCents: value.fixedValueCents,
    minValueCents: value.minValueCents,
    distanceKm: value.distanceKm,
    unit: "ton"
  };
}

function readModalities(payload: RuleJsonPayload | null): CustomerFreightModalityValues {
  // Vem de JSON gravado: nada aqui e confiavel antes de validar campo a campo.
  const raw = payload?.modalities as
    | Record<string, Partial<CustomerFreightModalityValue>>
    | undefined;
  if (!raw || typeof raw !== "object") return {};
  const result: CustomerFreightModalityValues = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isFreightModality(key) || !value || typeof value !== "object") continue;
    const baseValueCents = Number(value.baseValueCents);
    if (!Number.isFinite(baseValueCents)) continue;
    result[key] = {
      type: value.type ?? "per_ton",
      baseValueCents,
      fixedValueCents: numberOrUndefined(value.fixedValueCents),
      minValueCents: numberOrUndefined(value.minValueCents),
      distanceKm: numberOrUndefined(value.distanceKm),
      destination: typeof value.destination === "string" ? value.destination : null,
      showOnReceipt: typeof value.showOnReceipt === "boolean" ? value.showOnReceipt : undefined,
      source: value.source === "manual" ? "manual" : "last_used",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
    };
  }
  return result;
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A regra unica (compatibilidade) sem o mapa de valores por tipo de frete. */
function stripModalities(payload: RuleJsonPayload): FreightRule {
  const rule = { ...payload };
  delete rule.modalities;
  return rule;
}

function parseRulePayload(value: string): RuleJsonPayload {
  try {
    return JSON.parse(value) as RuleJsonPayload;
  } catch {
    return {
      id: "default",
      name: "Padrao",
      type: "per_ton",
      baseValueCents: 0,
      unit: "ton"
    };
  }
}

function mapQueryRow(row: RuleQueryRow): CustomerFreightRule {
  const payload = parseRulePayload(row.rule_json);
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productDescription: row.product_description,
    rule: stripModalities(payload),
    modalities: readModalities(payload),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
