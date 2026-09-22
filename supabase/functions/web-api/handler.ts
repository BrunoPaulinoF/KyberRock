/**
 * `web-api` — a escrita do cadastro pelo site web.
 *
 * Contexto em `docs/plano-migracao-web.md` (decisao D3) e contrato em `docs/web-api.md`. O
 * site le o Postgres direto (RLS, migracao `202609220003`) e GRAVA so por aqui: e o unico
 * jeito de as regras que tiraram o cadastro do SQLite valerem tambem para o navegador —
 * documento unico por empresa, CNPJ alfanumerico intacto, bloco comercial carimbado com
 * `commercial_published_at`, envio ao OMIE pelo mesmo caminho da balanca.
 *
 * Este modulo e a parte TESTAVEL: recebe um `WebApiStore` (quatro operacoes sobre linhas),
 * quem resolve a sessao e a ponte com o OMIE. `index.ts` liga tudo ao Supabase de verdade.
 *
 * Regras que valem para toda acao:
 *
 * - `company_id` vem da SESSAO, nunca do payload. Linha de outra empresa e "nao encontrada".
 * - Toda escrita carimba `updated_at` com a hora da nuvem: e ela que decide o desempate
 *   quando uma balanca principal editou a mesma linha (`cloudRowWins`, `newest`).
 * - Preco e bloco comercial sao so do `gestor`. O `comercial` recebe 403 e nada e gravado.
 * - Falha no OMIE nao desfaz o cadastro: a linha fica gravada e a resposta traz `warnings`.
 *   A proxima edicao tenta de novo. O que nao pode e o site "salvar" sem gravar.
 */

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { normalizeDocument } from "../_shared/document.ts";
import {
  buildOmieCarrierPayload,
  buildOmieCustomerPayload,
  optionalText,
  parseCarrierInput,
  parseCommercialInput,
  parseCustomerInput,
  parseDriverInput,
  parseIsoDate,
  parsePriceInput,
  parseVehicleInput
} from "../_shared/web-cadastro.ts";
import { canManagePrices, type WebSession, type WebSessionResult } from "../_shared/web-session.ts";

export type Row = Record<string, unknown>;

/** Filtro de igualdade; `value: null` vira `is null`. */
export interface RowFilter {
  column: string;
  value: unknown;
}

export interface ListRowsOptions {
  /** So linhas com `deleted_at is null` (tabelas que tem a coluna). */
  live?: boolean;
  /**
   * Nao filtra por empresa. Usado nos vinculos (`customer_carriers` e afins), cujo
   * `company_id` e nulo nas linhas antigas — filtrar por empresa nao acharia o vinculo que ja
   * existe e a insercao estouraria o indice unico do par.
   */
  anyCompany?: boolean;
}

/** As quatro operacoes que a `web-api` faz no banco. `index.ts` implementa sobre o Supabase. */
export interface WebApiStore {
  getRow(table: string, companyId: string, id: string): Promise<Row | null>;
  listRows(
    table: string,
    companyId: string,
    columns: string,
    filters: RowFilter[],
    options?: ListRowsOptions
  ): Promise<Row[]>;
  insertRow(table: string, row: Row): Promise<void>;
  updateRow(table: string, companyId: string, id: string, patch: Row): Promise<void>;
}

export type OmiePushAction = "push_customer" | "push_carrier";

/** A ponte com a `omie-sync`, pelo dispositivo virtual da empresa (`_shared/web-device.ts`). */
export interface OmieBridge {
  push(
    action: OmiePushAction,
    payload: Row,
    scope: { companyId: string; unitId: string }
  ): Promise<{ omieCustomerId: number }>;
}

export interface WebApiHandlerDependencies {
  store: WebApiStore;
  resolveSession: (authorization: string | null) => Promise<WebSessionResult>;
  omie: OmieBridge;
  now?: () => Date;
  newId?: () => string;
}

export const WEB_API_ACTIONS = [
  "me",
  "upsert_customer",
  "set_customer_active",
  "set_customer_commercial",
  "upsert_carrier",
  "set_carrier_active",
  "upsert_driver",
  "set_driver_active",
  "upsert_vehicle",
  "set_vehicle_active",
  "set_customer_vehicle",
  "set_customer_carrier",
  "set_driver_carrier",
  "set_vehicle_carrier",
  "set_product_default_price",
  "set_customer_special_price",
  "remove_customer_special_price",
  "upsert_price_table",
  "set_price_table_active",
  "set_price_table_item",
  "remove_price_table_item",
  "set_customer_price_table"
] as const;

export type WebApiAction = (typeof WEB_API_ACTIONS)[number];

/** Acoes que so o gestor executa (preco e bloco comercial/credito). */
export const GESTOR_ONLY_ACTIONS: ReadonlySet<WebApiAction> = new Set<WebApiAction>([
  "set_customer_commercial",
  "set_product_default_price",
  "set_customer_special_price",
  "remove_customer_special_price",
  "upsert_price_table",
  "set_price_table_active",
  "set_price_table_item",
  "remove_price_table_item",
  "set_customer_price_table"
]);

export class WebApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

interface ActionContext {
  store: WebApiStore;
  session: WebSession;
  omie: OmieBridge;
  payload: Row;
  nowIso: string;
  newId: () => string;
  warnings: string[];
}

function isAction(value: unknown): value is WebApiAction {
  return typeof value === "string" && (WEB_API_ACTIONS as readonly string[]).includes(value);
}

function requiredId(payload: Row, key: string, label: string): string {
  const value = optionalText(payload, key);
  if (!value) throw new WebApiError(400, `Informe ${label}.`);
  return value;
}

function requiredBoolean(payload: Row, key: string): boolean {
  const value = payload[key];
  if (typeof value === "boolean") return value;
  throw new WebApiError(400, `Informe ${key} como true ou false.`);
}

async function requireRow(
  ctx: ActionContext,
  table: string,
  id: string,
  label: string
): Promise<Row> {
  const row = await ctx.store.getRow(table, ctx.session.companyId, id);
  if (!row || row.deleted_at) throw new WebApiError(404, `${label} nao encontrado.`);
  return row;
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/**
 * Cliente vivo com o mesmo CNPJ/CPF na empresa — a mesma trava da balanca
 * (`assertDocumentIsFree`). Dois cadastros com o mesmo documento sao o mesmo cliente e
 * virariam o mesmo cadastro no OMIE; e foi assim que nasceram os duplicados que a migracao
 * `202609220002` unificou.
 */
async function assertCustomerDocumentIsFree(
  ctx: ActionContext,
  document: string,
  excludeId: string | null
): Promise<void> {
  const key = normalizeDocument(document);
  if (!key) return;
  const rows = await ctx.store.listRows(
    "customers",
    ctx.session.companyId,
    "id, document, trade_name, legal_name, is_active",
    [],
    { live: true }
  );
  const taken = rows.find(
    (row) => row.id !== excludeId && normalizeDocument(String(row.document ?? "")) === key
  );
  if (!taken) return;
  const name = String(taken.trade_name || taken.legal_name || "sem nome");
  const inactiveHint =
    taken.is_active === false
      ? " Ele esta inativo — procure por ele na lista e reative em vez de cadastrar de novo."
      : "";
  throw new WebApiError(409, `Ja existe um cliente com este CNPJ/CPF: ${name}.${inactiveHint}`);
}

async function pushCustomerToOmie(ctx: ActionContext, customerId: string): Promise<number | null> {
  const row = await ctx.store.getRow("customers", ctx.session.companyId, customerId);
  if (!row) return null;
  if (!row.document) {
    ctx.warnings.push(
      "Cliente salvo sem CPF/CNPJ: nao foi enviado ao OMIE, que exige o documento. Preencha o documento para enviar."
    );
    return null;
  }
  try {
    const { omieCustomerId } = await ctx.omie.push("push_customer", buildOmieCustomerPayload(row), {
      companyId: ctx.session.companyId,
      unitId: ctx.session.unitId
    });
    if (row.omie_customer_id !== omieCustomerId) {
      await ctx.store.updateRow("customers", ctx.session.companyId, customerId, {
        omie_customer_id: omieCustomerId,
        last_synced_at: ctx.nowIso,
        updated_at: ctx.nowIso
      });
    }
    return omieCustomerId;
  } catch (error) {
    ctx.warnings.push(
      `Cliente salvo, mas o OMIE nao aceitou agora: ${error instanceof Error ? error.message : String(error)}. A proxima edicao tenta de novo.`
    );
    return typeof row.omie_customer_id === "number" ? row.omie_customer_id : null;
  }
}

async function upsertCustomer(ctx: ActionContext): Promise<Row> {
  const id = optionalText(ctx.payload, "id") ?? null;
  const parsed = parseCustomerInput(ctx.payload, id ? "update" : "create");
  if (!parsed.ok) throw new WebApiError(400, parsed.error);
  const columns = parsed.value;

  if (typeof columns.document === "string") {
    await assertCustomerDocumentIsFree(ctx, columns.document, id);
  }

  let customerId = id;
  if (customerId) {
    await requireRow(ctx, "customers", customerId, "Cliente");
    await ctx.store.updateRow("customers", ctx.session.companyId, customerId, {
      ...columns,
      updated_at: ctx.nowIso
    });
  } else {
    customerId = ctx.newId();
    await ctx.store.insertRow("customers", {
      id: customerId,
      company_id: ctx.session.companyId,
      is_active: true,
      credit_mode: "normal",
      open_receivables_cents: 0,
      is_foreign: false,
      is_individual: false,
      omie_billing_blocked: false,
      ...columns,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
  }

  const omieCustomerId = await pushCustomerToOmie(ctx, customerId);
  return { id: customerId, omieCustomerId };
}

async function setCustomerCommercial(ctx: ActionContext): Promise<Row> {
  const id = requiredId(ctx.payload, "id", "o cliente");
  const parsed = parseCommercialInput(ctx.payload);
  if (!parsed.ok) throw new WebApiError(400, parsed.error);
  await requireRow(ctx, "customers", id, "Cliente");

  const columns = parsed.value;
  if (typeof columns.default_carrier_id === "string") {
    await requireRow(ctx, "carriers", columns.default_carrier_id, "Transportadora padrao");
  }
  if (typeof columns.default_payment_method_id === "string") {
    await requireRow(
      ctx,
      "payment_methods",
      columns.default_payment_method_id,
      "Forma de pagamento"
    );
  }

  await ctx.store.updateRow("customers", ctx.session.companyId, id, {
    ...columns,
    // E esta marca que faz a balanca adotar o bloco (`isCommercialBlockPublished`): sem ela
    // o nulo das demais colunas seria lido como "ninguem publicou ainda".
    commercial_published_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Transportadora, motorista, veiculo
// ---------------------------------------------------------------------------

async function pushCarrierToOmie(ctx: ActionContext, carrierId: string): Promise<number | null> {
  const row = await ctx.store.getRow("carriers", ctx.session.companyId, carrierId);
  if (!row) return null;
  if (!row.document) {
    ctx.warnings.push(
      "Transportadora salva sem CNPJ/CPF: nao foi enviada ao OMIE, que exige o documento."
    );
    return null;
  }
  try {
    const { omieCustomerId } = await ctx.omie.push("push_carrier", buildOmieCarrierPayload(row), {
      companyId: ctx.session.companyId,
      unitId: ctx.session.unitId
    });
    if (row.omie_customer_id !== omieCustomerId) {
      await ctx.store.updateRow("carriers", ctx.session.companyId, carrierId, {
        omie_customer_id: omieCustomerId,
        updated_at: ctx.nowIso
      });
    }
    return omieCustomerId;
  } catch (error) {
    ctx.warnings.push(
      `Transportadora salva, mas o OMIE nao aceitou agora: ${error instanceof Error ? error.message : String(error)}.`
    );
    return typeof row.omie_customer_id === "number" ? row.omie_customer_id : null;
  }
}

async function upsertCarrier(ctx: ActionContext): Promise<Row> {
  const id = optionalText(ctx.payload, "id") ?? null;
  const parsed = parseCarrierInput(ctx.payload, id ? "update" : "create");
  if (!parsed.ok) throw new WebApiError(400, parsed.error);

  let carrierId = id;
  if (carrierId) {
    await requireRow(ctx, "carriers", carrierId, "Transportadora");
    await ctx.store.updateRow("carriers", ctx.session.companyId, carrierId, {
      ...parsed.value,
      updated_at: ctx.nowIso
    });
  } else {
    carrierId = ctx.newId();
    await ctx.store.insertRow("carriers", {
      id: carrierId,
      company_id: ctx.session.companyId,
      source: "local",
      is_active: true,
      ...parsed.value,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
  }
  const omieCustomerId = await pushCarrierToOmie(ctx, carrierId);
  return { id: carrierId, omieCustomerId };
}

async function upsertDriver(ctx: ActionContext): Promise<Row> {
  const id = optionalText(ctx.payload, "id") ?? null;
  const parsed = parseDriverInput(ctx.payload, id ? "update" : "create");
  if (!parsed.ok) throw new WebApiError(400, parsed.error);

  if (id) {
    await requireRow(ctx, "drivers", id, "Motorista");
    await ctx.store.updateRow("drivers", ctx.session.companyId, id, {
      ...parsed.value,
      updated_at: ctx.nowIso
    });
    return { id };
  }
  const driverId = ctx.newId();
  await ctx.store.insertRow("drivers", {
    id: driverId,
    company_id: ctx.session.companyId,
    is_active: true,
    is_independent: false,
    ...parsed.value,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id: driverId };
}

async function upsertVehicle(ctx: ActionContext): Promise<Row> {
  const id = optionalText(ctx.payload, "id") ?? null;
  const parsed = parseVehicleInput(ctx.payload, id ? "update" : "create");
  if (!parsed.ok) throw new WebApiError(400, parsed.error);
  if (typeof parsed.value.carrier_id === "string") {
    await requireRow(ctx, "carriers", parsed.value.carrier_id, "Transportadora");
  }

  if (typeof parsed.value.plate === "string") {
    const same = await ctx.store.listRows(
      "vehicles",
      ctx.session.companyId,
      "id, plate",
      [{ column: "plate", value: parsed.value.plate }],
      { live: true }
    );
    if (same.some((row) => row.id !== id)) {
      throw new WebApiError(409, `Ja existe um veiculo com a placa ${parsed.value.plate}.`);
    }
  }

  if (id) {
    await requireRow(ctx, "vehicles", id, "Veiculo");
    await ctx.store.updateRow("vehicles", ctx.session.companyId, id, {
      ...parsed.value,
      updated_at: ctx.nowIso
    });
    return { id };
  }
  const vehicleId = ctx.newId();
  await ctx.store.insertRow("vehicles", {
    id: vehicleId,
    company_id: ctx.session.companyId,
    is_active: true,
    ...parsed.value,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id: vehicleId };
}

/** Inativar/reativar: o cadastro some do dia a dia sem esconder o historico dele. */
async function setActive(ctx: ActionContext, table: string, label: string): Promise<Row> {
  const id = requiredId(ctx.payload, "id", `o ${label.toLowerCase()}`);
  const isActive = requiredBoolean(ctx.payload, "isActive");
  await requireRow(ctx, table, id, label);
  await ctx.store.updateRow(table, ctx.session.companyId, id, {
    is_active: isActive,
    updated_at: ctx.nowIso
  });
  return { id, isActive };
}

// ---------------------------------------------------------------------------
// Vinculos
// ---------------------------------------------------------------------------

interface LinkSpec {
  table: string;
  left: { key: string; column: string; table: string; label: string };
  right: { key: string; column: string; table: string; label: string };
  /** A tabela tem `deleted_at` (so `customer_vehicles`). */
  hasDeletedAt: boolean;
}

const LINKS: Record<
  "set_customer_vehicle" | "set_customer_carrier" | "set_driver_carrier" | "set_vehicle_carrier",
  LinkSpec
> = {
  set_customer_vehicle: {
    table: "customer_vehicles",
    left: { key: "customerId", column: "customer_id", table: "customers", label: "Cliente" },
    right: { key: "vehicleId", column: "vehicle_id", table: "vehicles", label: "Veiculo" },
    hasDeletedAt: true
  },
  set_customer_carrier: {
    table: "customer_carriers",
    left: { key: "customerId", column: "customer_id", table: "customers", label: "Cliente" },
    right: { key: "carrierId", column: "carrier_id", table: "carriers", label: "Transportadora" },
    hasDeletedAt: false
  },
  set_driver_carrier: {
    table: "driver_carriers",
    left: { key: "driverId", column: "driver_id", table: "drivers", label: "Motorista" },
    right: { key: "carrierId", column: "carrier_id", table: "carriers", label: "Transportadora" },
    hasDeletedAt: false
  },
  set_vehicle_carrier: {
    table: "vehicle_carriers",
    left: { key: "vehicleId", column: "vehicle_id", table: "vehicles", label: "Veiculo" },
    right: { key: "carrierId", column: "carrier_id", table: "carriers", label: "Transportadora" },
    hasDeletedAt: false
  }
};

async function setLink(ctx: ActionContext, spec: LinkSpec): Promise<Row> {
  const leftId = requiredId(ctx.payload, spec.left.key, `o ${spec.left.label.toLowerCase()}`);
  const rightId = requiredId(ctx.payload, spec.right.key, `o ${spec.right.label.toLowerCase()}`);
  const isActive = requiredBoolean(ctx.payload, "isActive");
  // As duas pontas precisam ser da empresa da sessao — e a unica checagem de escopo, porque
  // a busca do vinculo em si nao filtra por empresa (ver `ListRowsOptions.anyCompany`).
  await requireRow(ctx, spec.left.table, leftId, spec.left.label);
  await requireRow(ctx, spec.right.table, rightId, spec.right.label);

  const existing = await ctx.store.listRows(
    spec.table,
    ctx.session.companyId,
    "id, is_active",
    [
      { column: spec.left.column, value: leftId },
      { column: spec.right.column, value: rightId }
    ],
    { anyCompany: true }
  );

  if (existing.length > 0) {
    for (const row of existing) {
      await ctx.store.updateRow(spec.table, ctx.session.companyId, String(row.id), {
        is_active: isActive,
        company_id: ctx.session.companyId,
        ...(spec.hasDeletedAt ? { deleted_at: null } : {}),
        updated_at: ctx.nowIso
      });
    }
    return { id: String(existing[0].id), isActive };
  }

  const id = ctx.newId();
  await ctx.store.insertRow(spec.table, {
    id,
    company_id: ctx.session.companyId,
    [spec.left.column]: leftId,
    [spec.right.column]: rightId,
    is_active: isActive,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id, isActive };
}

// ---------------------------------------------------------------------------
// Preco
// ---------------------------------------------------------------------------

/**
 * Preco por chave natural: se ja existe a linha viva do par, ela e ATUALIZADA (mesmo id).
 * Nunca nasce um segundo id para a mesma chave — e o segundo id que fazia duas balancas
 * principais se derrubarem (`_shared/price-master-conflicts.ts`). Quando a balanca ainda
 * publicar um id proprio para o mesmo par, o `desktop-sync` resolve pela hora da edicao, e a
 * nossa e a hora da nuvem.
 */
async function setPriceRow(
  ctx: ActionContext,
  table: string,
  naturalKey: RowFilter[],
  extraColumns: Row
): Promise<Row> {
  const parsed = parsePriceInput(ctx.payload);
  if (!parsed.ok) throw new WebApiError(400, parsed.error);
  const price = parsed.value;

  const live = await ctx.store.listRows(table, ctx.session.companyId, "id, is_active", naturalKey, {
    live: true
  });
  const current = live.find((row) => row.is_active !== false) ?? null;
  const values = {
    unit_price_cents: price.unitPriceCents,
    unit: price.unit,
    valid_from: price.validFrom,
    valid_to: price.validTo,
    updated_at: ctx.nowIso
  };

  if (current) {
    await ctx.store.updateRow(table, ctx.session.companyId, String(current.id), {
      ...values,
      is_active: true
    });
    return { id: String(current.id), unitPriceCents: price.unitPriceCents };
  }

  const id = ctx.newId();
  await ctx.store.insertRow(table, {
    id,
    company_id: ctx.session.companyId,
    ...extraColumns,
    ...values,
    is_active: true,
    created_at: ctx.nowIso
  });
  return { id, unitPriceCents: price.unitPriceCents };
}

/** Exclusao logica de todas as linhas vivas do par (o desktop le `deleted_at` como tombstone). */
async function retirePriceRows(
  ctx: ActionContext,
  table: string,
  naturalKey: RowFilter[]
): Promise<Row> {
  const live = await ctx.store.listRows(table, ctx.session.companyId, "id", naturalKey, {
    live: true
  });
  for (const row of live) {
    await ctx.store.updateRow(table, ctx.session.companyId, String(row.id), {
      deleted_at: ctx.nowIso,
      is_active: false,
      updated_at: ctx.nowIso
    });
  }
  return { removed: live.length };
}

async function setProductDefaultPrice(ctx: ActionContext): Promise<Row> {
  const productId = requiredId(ctx.payload, "productId", "o produto");
  await requireRow(ctx, "products", productId, "Produto");
  return setPriceRow(ctx, "product_default_prices", [{ column: "product_id", value: productId }], {
    product_id: productId
  });
}

async function setCustomerSpecialPrice(ctx: ActionContext): Promise<Row> {
  const customerId = requiredId(ctx.payload, "customerId", "o cliente");
  const productId = requiredId(ctx.payload, "productId", "o produto");
  await requireRow(ctx, "customers", customerId, "Cliente");
  await requireRow(ctx, "products", productId, "Produto");
  return setPriceRow(
    ctx,
    "customer_special_prices",
    [
      { column: "customer_id", value: customerId },
      { column: "product_id", value: productId }
    ],
    { customer_id: customerId, product_id: productId }
  );
}

async function removeCustomerSpecialPrice(ctx: ActionContext): Promise<Row> {
  const customerId = requiredId(ctx.payload, "customerId", "o cliente");
  const productId = requiredId(ctx.payload, "productId", "o produto");
  return retirePriceRows(ctx, "customer_special_prices", [
    { column: "customer_id", value: customerId },
    { column: "product_id", value: productId }
  ]);
}

async function upsertPriceTable(ctx: ActionContext): Promise<Row> {
  const id = optionalText(ctx.payload, "id") ?? null;
  const columns: Row = {};
  const name = optionalText(ctx.payload, "name");
  if (!id && !name) throw new WebApiError(400, "Informe o nome da tabela de preco.");
  if (name === null) throw new WebApiError(400, "O nome da tabela nao pode ficar vazio.");
  if (name) columns.name = name;
  const validFrom = parseIsoDate(ctx.payload, "validFrom");
  if (!validFrom.ok) throw new WebApiError(400, "Data inicial invalida: use o formato AAAA-MM-DD.");
  if (validFrom.value !== undefined) columns.valid_from = validFrom.value;
  const validTo = parseIsoDate(ctx.payload, "validTo");
  if (!validTo.ok) throw new WebApiError(400, "Data final invalida: use o formato AAAA-MM-DD.");
  if (validTo.value !== undefined) columns.valid_to = validTo.value;

  if (id) {
    await requireRow(ctx, "price_tables", id, "Tabela de preco");
    await ctx.store.updateRow("price_tables", ctx.session.companyId, id, {
      ...columns,
      updated_at: ctx.nowIso
    });
    return { id };
  }
  const tableId = ctx.newId();
  await ctx.store.insertRow("price_tables", {
    id: tableId,
    company_id: ctx.session.companyId,
    is_active: true,
    ...columns,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id: tableId };
}

async function setPriceTableItem(ctx: ActionContext): Promise<Row> {
  const priceTableId = requiredId(ctx.payload, "priceTableId", "a tabela de preco");
  const productId = requiredId(ctx.payload, "productId", "o produto");
  await requireRow(ctx, "price_tables", priceTableId, "Tabela de preco");
  await requireRow(ctx, "products", productId, "Produto");
  return setPriceRow(
    ctx,
    "price_table_items",
    [
      { column: "price_table_id", value: priceTableId },
      { column: "product_id", value: productId }
    ],
    { price_table_id: priceTableId, product_id: productId }
  );
}

async function removePriceTableItem(ctx: ActionContext): Promise<Row> {
  const priceTableId = requiredId(ctx.payload, "priceTableId", "a tabela de preco");
  const productId = requiredId(ctx.payload, "productId", "o produto");
  return retirePriceRows(ctx, "price_table_items", [
    { column: "price_table_id", value: priceTableId },
    { column: "product_id", value: productId }
  ]);
}

/** Um cliente tem no maximo UMA tabela viva: `priceTableId: null` desvincula. */
async function setCustomerPriceTable(ctx: ActionContext): Promise<Row> {
  const customerId = requiredId(ctx.payload, "customerId", "o cliente");
  await requireRow(ctx, "customers", customerId, "Cliente");
  const priceTableId = optionalText(ctx.payload, "priceTableId") ?? null;
  if (priceTableId) await requireRow(ctx, "price_tables", priceTableId, "Tabela de preco");

  const live = await ctx.store.listRows(
    "customer_price_tables",
    ctx.session.companyId,
    "id, price_table_id",
    [{ column: "customer_id", value: customerId }],
    { live: true }
  );
  const kept = live.find((row) => row.price_table_id === priceTableId) ?? null;
  for (const row of live) {
    if (row === kept) continue;
    await ctx.store.updateRow("customer_price_tables", ctx.session.companyId, String(row.id), {
      deleted_at: ctx.nowIso,
      is_active: false,
      updated_at: ctx.nowIso
    });
  }
  if (!priceTableId) return { id: null, priceTableId: null };
  if (kept) {
    await ctx.store.updateRow("customer_price_tables", ctx.session.companyId, String(kept.id), {
      is_active: true,
      updated_at: ctx.nowIso
    });
    return { id: String(kept.id), priceTableId };
  }
  const id = ctx.newId();
  await ctx.store.insertRow("customer_price_tables", {
    id,
    company_id: ctx.session.companyId,
    customer_id: customerId,
    price_table_id: priceTableId,
    is_active: true,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id, priceTableId };
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

async function me(ctx: ActionContext): Promise<Row> {
  const units = await ctx.store.listRows(
    "units",
    ctx.session.companyId,
    "id, name, timezone, is_active",
    []
  );
  return {
    user: {
      id: ctx.session.userId,
      email: ctx.session.email,
      name: ctx.session.name,
      role: ctx.session.role,
      unitId: ctx.session.unitId,
      canManagePrices: canManagePrices(ctx.session.role)
    },
    companyId: ctx.session.companyId,
    units
  };
}

async function runAction(action: WebApiAction, ctx: ActionContext): Promise<Row> {
  switch (action) {
    case "me":
      return me(ctx);
    case "upsert_customer":
      return upsertCustomer(ctx);
    case "set_customer_active":
      return setActive(ctx, "customers", "Cliente");
    case "set_customer_commercial":
      return setCustomerCommercial(ctx);
    case "upsert_carrier":
      return upsertCarrier(ctx);
    case "set_carrier_active":
      return setActive(ctx, "carriers", "Transportadora");
    case "upsert_driver":
      return upsertDriver(ctx);
    case "set_driver_active":
      return setActive(ctx, "drivers", "Motorista");
    case "upsert_vehicle":
      return upsertVehicle(ctx);
    case "set_vehicle_active":
      return setActive(ctx, "vehicles", "Veiculo");
    case "set_customer_vehicle":
    case "set_customer_carrier":
    case "set_driver_carrier":
    case "set_vehicle_carrier":
      return setLink(ctx, LINKS[action]);
    case "set_product_default_price":
      return setProductDefaultPrice(ctx);
    case "set_customer_special_price":
      return setCustomerSpecialPrice(ctx);
    case "remove_customer_special_price":
      return removeCustomerSpecialPrice(ctx);
    case "upsert_price_table":
      return upsertPriceTable(ctx);
    case "set_price_table_active":
      return setActive(ctx, "price_tables", "Tabela de preco");
    case "set_price_table_item":
      return setPriceTableItem(ctx);
    case "remove_price_table_item":
      return removePriceTableItem(ctx);
    case "set_customer_price_table":
      return setCustomerPriceTable(ctx);
  }
}

export async function handleWebApiRequest(
  req: Request,
  deps: WebApiHandlerDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const sessionResult = await deps.resolveSession(req.headers.get("authorization"));
  if (!sessionResult.ok) {
    return jsonResponse({ error: sessionResult.error }, sessionResult.status);
  }
  const session = sessionResult.session;

  let body: { action?: unknown; payload?: unknown };
  try {
    body = (await req.json()) as { action?: unknown; payload?: unknown };
  } catch {
    return jsonResponse({ error: "Corpo da requisicao invalido" }, 400);
  }
  if (!isAction(body.action)) {
    return jsonResponse({ error: "Acao desconhecida", actions: WEB_API_ACTIONS }, 400);
  }
  if (GESTOR_ONLY_ACTIONS.has(body.action) && !canManagePrices(session.role)) {
    return jsonResponse(
      { error: "So o gestor altera precos e o bloco comercial do cliente." },
      403
    );
  }

  const payload =
    body.payload && typeof body.payload === "object" ? (body.payload as Row) : ({} as Row);
  const ctx: ActionContext = {
    store: deps.store,
    session,
    omie: deps.omie,
    payload,
    nowIso: (deps.now ?? (() => new Date()))().toISOString(),
    newId: deps.newId ?? (() => crypto.randomUUID()),
    warnings: []
  };

  try {
    const result = await runAction(body.action, ctx);
    return jsonResponse({ ok: true, ...result, warnings: ctx.warnings });
  } catch (error) {
    if (error instanceof WebApiError) return jsonResponse({ error: error.message }, error.status);
    console.error("web-api falhou", { action: body.action, error });
    return jsonResponse({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
}
