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
import { safeEqual } from "../_shared/crypto.ts";
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
import {
  canEditCustomers,
  canEditFleet,
  canManagePrices,
  canOperate,
  WEB_ROLE_LABELS,
  type WebRole,
  type WebSession,
  type WebSessionResult
} from "../_shared/web-session.ts";
import { selectOperationsForBillingRequest } from "../_shared/billing-requests.ts";
import {
  ENTRY_FREIGHT_MIN_EXECUTOR_VERSION,
  changesPrice,
  entryNeedsFreightSupport,
  isExecutorOnline,
  isOperationRequestKind,
  isVersionAtLeast,
  validateOperationRequest,
  type EntryRequestPayload,
  type OperationRequestKind,
  type OperationRequestPayload,
  type UpdateRequestPayload
} from "../_shared/operation-requests.ts";
import { recipientColumns, validateReportRecipient } from "../_shared/report-recipients.ts";

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
  "set_customer_price_table",
  "settle_wallet",
  "reopen_wallet",
  "request_invoice_closing",
  "operation_status",
  "request_operation",
  "list_report_recipients",
  "save_report_recipient",
  "delete_report_recipient",
  "unit_devices"
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
  "set_customer_price_table",
  "settle_wallet",
  "reopen_wallet",
  "request_invoice_closing",
  "list_report_recipients",
  "save_report_recipient",
  "delete_report_recipient"
]);

/** So leitura, para todo perfil do site. */
export const READ_ACTIONS: ReadonlySet<WebApiAction> = new Set<WebApiAction>([
  "me",
  "operation_status",
  "unit_devices"
]);

/** Pesagem pelo site: operacao e gestor (quem executa e a balanca da unidade). */
export const OPERATION_ACTIONS: ReadonlySet<WebApiAction> = new Set<WebApiAction>([
  "request_operation"
]);

/** Cadastro de cliente e os vinculos que partem dele: comercial e gestor. */
export const CUSTOMER_ACTIONS: ReadonlySet<WebApiAction> = new Set<WebApiAction>([
  "upsert_customer",
  "set_customer_active",
  "set_customer_vehicle",
  "set_customer_carrier"
]);

/** Veiculo, motorista, transportadora e os vinculos entre eles: tambem a operacao. */
export const FLEET_ACTIONS: ReadonlySet<WebApiAction> = new Set<WebApiAction>([
  "upsert_carrier",
  "set_carrier_active",
  "upsert_driver",
  "set_driver_active",
  "upsert_vehicle",
  "set_vehicle_active",
  "set_driver_carrier",
  "set_vehicle_carrier"
]);

/**
 * O que o perfil pode executar, ou a mensagem do 403. Toda acao cai em exatamente um grupo:
 * `me` (todos), cliente, frota ou gestor — o teste confere que nenhuma ficou de fora, para uma
 * acao nova nao nascer liberada para o monitoramento por esquecimento.
 */
export function actionDenial(role: WebRole, action: WebApiAction): string | null {
  if (READ_ACTIONS.has(action)) return null;
  const profile = WEB_ROLE_LABELS[role];
  if (OPERATION_ACTIONS.has(action)) {
    return canOperate(role)
      ? null
      : `O perfil ${profile} nao faz pesagem pelo site. Pesagem e da operacao e do gestor.`;
  }
  if (GESTOR_ONLY_ACTIONS.has(action)) {
    return canManagePrices(role)
      ? null
      : "So o gestor altera precos, o bloco comercial do cliente, a carteira, o fechamento e os destinatarios dos relatorios.";
  }
  if (CUSTOMER_ACTIONS.has(action)) {
    return canEditCustomers(role)
      ? null
      : `O perfil ${profile} so consulta clientes. Cadastro de cliente e do comercial.`;
  }
  if (FLEET_ACTIONS.has(action)) {
    return canEditFleet(role) ? null : `O perfil ${profile} so consulta, nao edita cadastro.`;
  }
  return `Acao nao liberada para o perfil ${profile}.`;
}

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
// Financeiro: carteira e fechamento de faturas (so gestor)
// ---------------------------------------------------------------------------

/** Lista de ids do payload, sem repetidos nem vazios, com teto para nao virar lote infinito. */
function idList(payload: Row, key: string, max = 200): string[] {
  const raw = payload[key];
  const values = Array.isArray(raw) ? raw : [];
  const ids = [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (ids.length > max) throw new WebApiError(400, `Envie no maximo ${max} pesagens por vez.`);
  return ids;
}

/**
 * Fechamento da carteira: define COMO o cliente vai pagar as vendas "em carteira" e quando.
 * Mesmas regras de `settleWalletOperations` na balanca: a forma escolhida precisa ser de
 * recebimento (nao "em carteira") e ativa; a venda precisa ter sido em carteira e nao pode
 * estar cancelada. O desktop puxa `wallet_*` da nuvem quando a nuvem e mais nova — e aqui
 * `updated_at` e a hora da nuvem.
 */
async function settleWallet(ctx: ActionContext): Promise<Row> {
  const operationIds = idList(ctx.payload, "operationIds");
  if (operationIds.length === 0) {
    throw new WebApiError(400, "Selecione ao menos uma venda em carteira para fechar.");
  }
  const methodId = requiredId(ctx.payload, "settlementMethodId", "a forma de recebimento");
  const method = await requireRow(ctx, "payment_methods", methodId, "Forma de pagamento");
  if (method.is_wallet === true) {
    throw new WebApiError(
      400,
      `"${String(method.alias || method.name)}" e uma forma em carteira. Escolha como o cliente vai pagar (dinheiro, PIX, boleto...).`
    );
  }
  if (method.is_active === false) {
    throw new WebApiError(400, `A forma de pagamento "${String(method.name)}" esta inativa.`);
  }
  const dueDate = parseIsoDate(ctx.payload, "dueDate");
  if (!dueDate.ok)
    throw new WebApiError(400, "Data de vencimento invalida: use o formato AAAA-MM-DD.");
  const note = optionalText(ctx.payload, "note") ?? null;

  const walletMethods = new Map<string, boolean>();
  const operations: Row[] = [];
  for (const operationId of operationIds) {
    const operation = await requireRow(ctx, "weighing_operations", operationId, "Pesagem");
    if (operation.status === "cancelled") {
      throw new WebApiError(400, `A pesagem ${operationId} foi cancelada e nao pode ser fechada.`);
    }
    const paymentMethodId =
      typeof operation.payment_method_id === "string" ? operation.payment_method_id : "";
    if (paymentMethodId && !walletMethods.has(paymentMethodId)) {
      const row = await ctx.store.getRow("payment_methods", ctx.session.companyId, paymentMethodId);
      walletMethods.set(paymentMethodId, row?.is_wallet === true);
    }
    if (!paymentMethodId || walletMethods.get(paymentMethodId) !== true) {
      throw new WebApiError(400, `A pesagem ${operationId} nao foi vendida em carteira.`);
    }
    if (
      operation.wallet_settled_at &&
      !operation.wallet_settlement_method_id &&
      Number(operation.omie_advance_settle_cents ?? 0) > 0
    ) {
      throw new WebApiError(
        400,
        `A pesagem ${operationId} foi quitada pelo adiantamento do cliente e nao precisa de fechamento.`
      );
    }
    operations.push(operation);
  }

  for (const operation of operations) {
    await ctx.store.updateRow("weighing_operations", ctx.session.companyId, String(operation.id), {
      wallet_settlement_method_id: methodId,
      wallet_settlement_due_date: dueDate.value ?? null,
      wallet_settled_at: ctx.nowIso,
      wallet_settlement_note: note,
      updated_at: ctx.nowIso
    });
  }
  return { settled: operations.length };
}

/** Desfaz um fechamento lancado errado — menos o que foi abatido do adiantamento (`reopenWalletOperations`). */
async function reopenWallet(ctx: ActionContext): Promise<Row> {
  const operationIds = idList(ctx.payload, "operationIds");
  if (operationIds.length === 0)
    throw new WebApiError(400, "Selecione ao menos uma venda para reabrir.");

  let reopened = 0;
  for (const operationId of operationIds) {
    const operation = await requireRow(ctx, "weighing_operations", operationId, "Pesagem");
    if (!operation.wallet_settled_at) continue;
    if (
      !operation.wallet_settlement_method_id &&
      Number(operation.omie_advance_settle_cents ?? 0) > 0
    ) {
      throw new WebApiError(
        400,
        "Esta venda foi abatida do adiantamento do cliente e nao pode ser reaberta. Para desfazer, cancele a operacao na balanca — o adiantamento volta para o saldo dele."
      );
    }
    await ctx.store.updateRow("weighing_operations", ctx.session.companyId, operationId, {
      wallet_settlement_method_id: null,
      wallet_settlement_due_date: null,
      wallet_settled_at: null,
      wallet_settlement_note: null,
      updated_at: ctx.nowIso
    });
    reopened++;
  }
  return { reopened };
}

/**
 * "Fazer fechamento" pelo site: deixa um pedido por pesagem em `billing_requests`. Quem
 * fatura e a balanca da unidade, pelo mesmo caminho do botao dela (ver a migracao
 * `202609220004` e `_shared/billing-requests.ts` para a peneira).
 */
async function requestInvoiceClosing(ctx: ActionContext): Promise<Row> {
  const operationIds = idList(ctx.payload, "operationIds");
  if (operationIds.length === 0) {
    throw new WebApiError(400, "Selecione ao menos uma pesagem para o fechamento.");
  }

  const operations: Row[] = [];
  for (const operationId of operationIds) {
    operations.push(await requireRow(ctx, "weighing_operations", operationId, "Pesagem"));
  }
  const [pending, processing] = await Promise.all([
    ctx.store.listRows("billing_requests", ctx.session.companyId, "operation_id, status", [
      { column: "status", value: "pending" }
    ]),
    ctx.store.listRows("billing_requests", ctx.session.companyId, "operation_id, status", [
      { column: "status", value: "processing" }
    ])
  ]);

  const selection = selectOperationsForBillingRequest(
    operations.map((operation) => ({
      id: String(operation.id),
      operation_type: operation.operation_type,
      status: operation.status,
      omie_billing_status: operation.omie_billing_status,
      omie_invoice_number: operation.omie_invoice_number
    })),
    [...pending, ...processing].map((row) => ({
      operation_id: String(row.operation_id),
      status: String(row.status)
    }))
  );

  const byId = new Map(operations.map((operation) => [String(operation.id), operation]));
  const requested: string[] = [];
  for (const operationId of selection.eligible) {
    const operation = byId.get(operationId);
    const id = ctx.newId();
    await ctx.store.insertRow("billing_requests", {
      id,
      company_id: ctx.session.companyId,
      // A unidade do pedido e a da PESAGEM: e a balanca daquela unidade que fatura.
      unit_id: operation?.unit_id ?? ctx.session.unitId,
      operation_id: operationId,
      requested_by: ctx.session.userId,
      requested_at: ctx.nowIso,
      status: "pending",
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
    requested.push(id);
  }
  return { requested: requested.length, requestIds: requested, skipped: selection.skipped };
}

// ---------------------------------------------------------------------------
// Pesagem pelo site (operation_requests)
// ---------------------------------------------------------------------------

/** Status da pesagem aberta na nuvem: o desktop projeta todas as fases em andamento como `open`. */
const OPEN_OPERATION_STATUS = "open";

/** Campos que ainda podem mudar depois que a pesagem fechou (os "Alterar" da lista de concluidas). */
const CLOSED_EDITABLE_FIELDS: ReadonlySet<string> = new Set([
  "customerId",
  "productId",
  "carrierId"
]);

/**
 * A balanca que executa os pedidos do site nesta unidade, e se ela esta perguntando por
 * pedidos agora. Sem executora marcada no painel o site nem deixa pedir: o pedido ficaria
 * parado para sempre.
 */
async function executorOf(ctx: ActionContext, unitId: string): Promise<Row | null> {
  const rows = await ctx.store.listRows(
    "device_registrations",
    ctx.session.companyId,
    "id, name, unit_id, is_active, executes_web_operations, web_executor_seen_at, app_version",
    [
      { column: "unit_id", value: unitId },
      { column: "executes_web_operations", value: true }
    ]
  );
  return rows.find((row) => row.is_active === true) ?? null;
}

async function operationStatus(ctx: ActionContext): Promise<Row> {
  const executor = await executorOf(ctx, ctx.session.unitId);
  return {
    executor: executor
      ? {
          deviceId: executor.id,
          name: executor.name,
          seenAt: executor.web_executor_seen_at ?? null,
          online: isExecutorOnline(
            typeof executor.web_executor_seen_at === "string"
              ? executor.web_executor_seen_at
              : null,
            new Date(ctx.nowIso)
          )
        }
      : null,
    requiresPricePassword: ctx.session.requiresPricePassword
  };
}

// ---------------------------------------------------------------------------
// Destinatarios do fechamento diario (tela Relatorios do desktop)
// ---------------------------------------------------------------------------

const RECIPIENT_COLUMNS =
  "id, display_name, email, whatsapp_phone, send_email, send_whatsapp, schedule_frequency, schedule_time, report_types, send_financial, financial_schedule_time, is_active, deleted_at, updated_at";

/**
 * A lista e a situacao dos canais. Os canais (SMTP, instancia do WhatsApp) guardam senha e
 * token: aqui so sai SE estao configurados — a configuracao continua na balanca.
 */
async function listReportRecipients(ctx: ActionContext): Promise<Row> {
  const [recipients, channels] = await Promise.all([
    ctx.store.listRows("report_recipients", ctx.session.companyId, RECIPIENT_COLUMNS, [], {
      live: true
    }),
    ctx.store.listRows(
      "report_channel_settings",
      ctx.session.companyId,
      "smtp_host, smtp_user, smtp_password, smtp_sender, whatsapp_url, whatsapp_instance_token, whatsapp_status",
      []
    )
  ]);
  const channel = channels[0] ?? {};
  return {
    recipients,
    channels: {
      emailConfigured: Boolean(channel.smtp_host && channel.smtp_user && channel.smtp_password),
      emailSender: typeof channel.smtp_sender === "string" ? channel.smtp_sender : null,
      whatsappConfigured: Boolean(channel.whatsapp_url && channel.whatsapp_instance_token),
      whatsappStatus: typeof channel.whatsapp_status === "string" ? channel.whatsapp_status : null
    }
  };
}

async function saveReportRecipient(ctx: ActionContext): Promise<Row> {
  const validation = validateReportRecipient(ctx.payload);
  if (!validation.ok) throw new WebApiError(400, validation.error);
  const value = validation.value;
  const id = typeof ctx.payload.id === "string" && ctx.payload.id ? ctx.payload.id : null;
  const live = await ctx.store.listRows(
    "report_recipients",
    ctx.session.companyId,
    "id, email, whatsapp_phone",
    [],
    { live: true }
  );
  const others = live.filter((row) => row.id !== id);
  if (value.email && others.some((row) => row.email === value.email)) {
    throw new WebApiError(409, "Ja existe um destinatario com esse e-mail.");
  }
  if (value.whatsappPhone && others.some((row) => row.whatsapp_phone === value.whatsappPhone)) {
    throw new WebApiError(409, "Ja existe um destinatario com esse WhatsApp.");
  }
  const columns = recipientColumns(value);
  if (id) {
    await requireRow(ctx, "report_recipients", id, "Destinatario");
    await ctx.store.updateRow("report_recipients", ctx.session.companyId, id, {
      ...columns,
      deleted_at: null,
      updated_at: ctx.nowIso
    });
    return { id };
  }
  const newId = ctx.newId();
  await ctx.store.insertRow("report_recipients", {
    id: newId,
    company_id: ctx.session.companyId,
    ...columns,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id: newId };
}

/** Exclusao por tombstone: a balanca puxa o `deleted_at` e tira o destinatario dela tambem. */
async function deleteReportRecipient(ctx: ActionContext): Promise<Row> {
  const id = typeof ctx.payload.id === "string" ? ctx.payload.id : "";
  if (!id) throw new WebApiError(400, "Informe o destinatario.");
  await requireRow(ctx, "report_recipients", id, "Destinatario");
  await ctx.store.updateRow("report_recipients", ctx.session.companyId, id, {
    is_active: false,
    deleted_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Configuracoes (o menu da engrenagem do desktop): as balancas da unidade
// ---------------------------------------------------------------------------

/** Sem sinal ha mais que isto, a balanca aparece fora do ar (a mesma folga do painel admin). */
const DEVICE_ONLINE_WINDOW_MS = 15 * 60 * 1000;

/**
 * As balancas da unidade do usuario, para as telas Balanca e Cloud do site: nome, versao,
 * anel de atualizacao, se executa os pedidos do site, se e a principal de precos e a saude da
 * fila (o mesmo resumo da coluna Saude do painel). Nunca o token nem a instalacao.
 */
async function unitDevices(ctx: ActionContext): Promise<Row> {
  const rows = await ctx.store.listRows(
    "device_registrations",
    ctx.session.companyId,
    "id, name, unit_id, is_active, device_number, app_version, update_channel, last_seen_at, is_price_master, executes_web_operations, web_executor_seen_at, health_queue_pending, health_queue_blocked, health_oldest_pending_at, health_last_error, health_collected_at",
    [{ column: "unit_id", value: ctx.session.unitId }]
  );
  const now = Date.parse(ctx.nowIso);
  const devices = rows
    .filter((row) => row.is_active === true && !String(row.id ?? "").startsWith("web-"))
    .map((row) => {
      const seen = typeof row.last_seen_at === "string" ? Date.parse(row.last_seen_at) : NaN;
      return {
        id: row.id,
        name: row.name,
        deviceNumber: row.device_number ?? null,
        appVersion: row.app_version ?? null,
        updateChannel: row.update_channel === "beta" ? "teste" : "producao",
        lastSeenAt: row.last_seen_at ?? null,
        online: Number.isFinite(seen) && now - seen <= DEVICE_ONLINE_WINDOW_MS,
        isPriceMaster: row.is_price_master === true,
        executesWebOperations: row.executes_web_operations === true,
        webExecutorSeenAt: row.web_executor_seen_at ?? null,
        health: {
          queuePending: row.health_queue_pending ?? null,
          queueBlocked: row.health_queue_blocked ?? null,
          oldestPendingAt: row.health_oldest_pending_at ?? null,
          lastError: row.health_last_error ?? null,
          collectedAt: row.health_collected_at ?? null
        }
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  return { devices };
}

async function requireLive(ctx: ActionContext, table: string, id: string, label: string) {
  const row = await requireRow(ctx, table, id, label);
  if (row.is_active === false) throw new WebApiError(400, `${label} esta inativo.`);
  return row;
}

/** Cadastro citado no pedido existe na empresa (e esta ativo): o erro volta na hora, no site. */
async function checkReferences(ctx: ActionContext, payload: Row): Promise<void> {
  const checks: Array<[string, string, string]> = [
    ["customerId", "customers", "Cliente"],
    ["productId", "products", "Produto"],
    ["vehicleId", "vehicles", "Veiculo"],
    ["driverId", "drivers", "Motorista"],
    ["carrierId", "carriers", "Transportadora"],
    ["paymentMethodId", "payment_methods", "Forma de pagamento"],
    ["paymentTermId", "payment_terms", "Condicao de pagamento"]
  ];
  for (const [key, table, label] of checks) {
    const id = payload[key];
    if (typeof id === "string" && id.length > 0) await requireLive(ctx, table, id, label);
  }
}

/** Tentativas erradas da senha de preco antes de travar o login por um tempo. */
const PRICE_PASSWORD_MAX_FAILURES = 5;
const PRICE_PASSWORD_WINDOW_MS = 15 * 60 * 1000;

async function checkPricePassword(ctx: ActionContext): Promise<void> {
  if (!ctx.session.requiresPricePassword) return;
  const typed = optionalText(ctx.payload, "pricePassword");
  if (!typed) throw new WebApiError(403, "Digite a senha de alteracao de preco.");
  // A senha tem 4 digitos e e a mesma da balanca: sem limite, bastaria tentar todas.
  const since = Date.parse(ctx.nowIso) - PRICE_PASSWORD_WINDOW_MS;
  const failures = (
    await ctx.store.listRows("price_password_failures", ctx.session.companyId, "attempted_at", [
      { column: "user_id", value: ctx.session.userId }
    ])
  ).filter((row) => Date.parse(String(row.attempted_at ?? "")) >= since);
  if (failures.length >= PRICE_PASSWORD_MAX_FAILURES) {
    throw new WebApiError(
      429,
      "Muitas tentativas erradas da senha de preco. Espere 15 minutos e tente de novo."
    );
  }
  const [company] = await ctx.store.listRows(
    "companies",
    ctx.session.companyId,
    "id, price_change_password",
    [{ column: "id", value: ctx.session.companyId }],
    { anyCompany: true }
  );
  const expected = String(company?.price_change_password ?? "");
  if (!expected || !safeEqual(typed, expected)) {
    await ctx.store.insertRow("price_password_failures", {
      id: ctx.newId(),
      company_id: ctx.session.companyId,
      user_id: ctx.session.userId,
      attempted_at: ctx.nowIso
    });
    throw new WebApiError(403, "Senha de alteracao de preco incorreta.");
  }
}

async function requestOperation(ctx: ActionContext): Promise<Row> {
  const kind = ctx.payload.kind;
  if (!isOperationRequestKind(kind)) {
    throw new WebApiError(400, "Tipo de pedido invalido (entry, exit, update, cancel, reprint).");
  }
  const raw =
    ctx.payload.data && typeof ctx.payload.data === "object" ? (ctx.payload.data as Row) : {};
  const validation = validateOperationRequest(kind, raw);
  if (!validation.ok) throw new WebApiError(400, validation.error);
  const data: OperationRequestPayload = validation.value;

  // Entrada: o id da pesagem nasce aqui (ver migracao `202609250001`: e o que torna a repeticao
  // do pedido segura). Os outros tipos apontam para uma pesagem que ja existe na nuvem.
  let operationId: string;
  let unitId = ctx.session.unitId;
  if (kind === "entry") {
    operationId = ctx.newId();
    await checkReferences(ctx, data as EntryRequestPayload as unknown as Row);
  } else {
    operationId = optionalText(ctx.payload, "operationId") ?? "";
    if (!operationId) throw new WebApiError(400, "Informe a pesagem.");
    const operation = await requireRow(ctx, "weighing_operations", operationId, "Pesagem");
    unitId = typeof operation.unit_id === "string" ? operation.unit_id : unitId;
    await checkOperationState(ctx, kind, operation, data);
    if (kind === "update") await checkReferences(ctx, data as UpdateRequestPayload as Row);
  }
  if (changesPrice(kind, data)) await checkPricePassword(ctx);

  const executor = await executorOf(ctx, unitId);
  if (!executor) {
    throw new WebApiError(
      409,
      "Nenhuma balanca desta unidade esta marcada para executar os pedidos do site. Marque uma no painel (Acessos do sistema)."
    );
  }
  if (
    kind === "entry" &&
    entryNeedsFreightSupport(data as EntryRequestPayload) &&
    !isVersionAtLeast(executor.app_version, ENTRY_FREIGHT_MIN_EXECUTOR_VERSION)
  ) {
    throw new WebApiError(
      409,
      `A balanca ${String(executor.name ?? "executora")} precisa ser atualizada (versao ${ENTRY_FREIGHT_MIN_EXECUTOR_VERSION} ou mais nova) para receber entrada com frete ou condicao digitada. Atualize a balanca ou envie sem frete e com a condicao da lista.`
    );
  }

  const id = ctx.newId();
  await insertOperationRequest(ctx, {
    id,
    company_id: ctx.session.companyId,
    unit_id: unitId,
    kind,
    operation_id: operationId,
    payload: data,
    requested_by: ctx.session.userId,
    requested_by_name: ctx.session.name || ctx.session.email,
    requested_at: ctx.nowIso,
    status: "pending",
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso
  });
  if (
    !isExecutorOnline(
      typeof executor.web_executor_seen_at === "string" ? executor.web_executor_seen_at : null,
      new Date(ctx.nowIso)
    )
  ) {
    ctx.warnings.push(
      `A balanca ${String(executor.name ?? "executora")} esta fora do ar agora. O pedido fica na fila e e executado quando ela voltar.`
    );
  }
  return { requestId: id, operationId };
}

/**
 * Grava o pedido. O indice `operation_requests_one_close_or_cancel` e a garantia contra dois
 * fechamentos/cancelamentos simultaneos que passaram juntos pela checagem de leitura: vira o
 * mesmo 409 dela.
 */
async function insertOperationRequest(ctx: ActionContext, row: Row): Promise<void> {
  try {
    await ctx.store.insertRow("operation_requests", row);
  } catch (error) {
    if (error instanceof Error && error.message.includes("23505")) {
      throw new WebApiError(
        409,
        "Ja existe um fechamento ou cancelamento desta pesagem esperando a balanca."
      );
    }
    throw error;
  }
}

async function checkOperationState(
  ctx: ActionContext,
  kind: Exclude<OperationRequestKind, "entry">,
  operation: Row,
  data: OperationRequestPayload
): Promise<void> {
  const status = String(operation.status ?? "");
  if (status === "cancelled") {
    throw new WebApiError(409, "Esta pesagem esta cancelada.");
  }
  const open = status === OPEN_OPERATION_STATUS;
  if (kind === "exit" && !open) {
    throw new WebApiError(409, "Esta pesagem ja foi fechada.");
  }
  if (kind === "reprint" && open) {
    throw new WebApiError(409, "O cupom sai no fechamento: esta pesagem ainda esta no patio.");
  }
  if (kind === "update" && !open) {
    const blocked = Object.keys(data).filter((key) => !CLOSED_EDITABLE_FIELDS.has(key));
    if (blocked.length > 0) {
      throw new WebApiError(
        409,
        "Pesagem concluida: pelo site so da para alterar cliente, produto ou transportadora."
      );
    }
  }
  // Dois fechamentos (ou fechamento e cancelamento) da mesma pesagem na fila: a balanca
  // executaria o segundo em cima do resultado do primeiro.
  if (kind === "exit" || kind === "cancel") {
    const queued = await ctx.store.listRows(
      "operation_requests",
      ctx.session.companyId,
      "id, kind, status",
      [{ column: "operation_id", value: String(operation.id) }]
    );
    const busy = queued.some(
      (row) =>
        (row.status === "pending" || row.status === "processing") &&
        (row.kind === "exit" || row.kind === "cancel")
    );
    if (busy) {
      throw new WebApiError(
        409,
        "Ja existe um fechamento ou cancelamento desta pesagem esperando a balanca."
      );
    }
  }
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
      canManagePrices: canManagePrices(ctx.session.role),
      canEditCustomers: canEditCustomers(ctx.session.role),
      canEditFleet: canEditFleet(ctx.session.role),
      canOperate: canOperate(ctx.session.role),
      requiresPricePassword: ctx.session.requiresPricePassword
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
    case "settle_wallet":
      return settleWallet(ctx);
    case "reopen_wallet":
      return reopenWallet(ctx);
    case "request_invoice_closing":
      return requestInvoiceClosing(ctx);
    case "operation_status":
      return operationStatus(ctx);
    case "request_operation":
      return requestOperation(ctx);
    case "list_report_recipients":
      return listReportRecipients(ctx);
    case "save_report_recipient":
      return saveReportRecipient(ctx);
    case "delete_report_recipient":
      return deleteReportRecipient(ctx);
    case "unit_devices":
      return unitDevices(ctx);
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
  const denial = actionDenial(session.role, body.action);
  if (denial) return jsonResponse({ error: denial }, 403);

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
