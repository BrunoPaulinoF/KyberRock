import { randomUUID } from "node:crypto";
import type { ScaleStatus } from "@kyberrock/scale-adapters";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { FinancialBlockService } from "./financial-block.js";
import {
  FreightCalculator,
  freightModalityOmieCode,
  getFreightModalityInfo,
  type FreightModality,
  type FreightRule
} from "./freight.js";
import { calculateSavingsPercent, PricingService, type PriceDetails } from "./pricing.js";
import { cancelPendingOmieJobs, enqueueSyncJob } from "./sync-queue.js";
import { CreditService } from "./credit.js";
import { buildOmieIntegrationCode } from "@kyberrock/omie-client";
import { formatEmailListForOmie } from "@kyberrock/shared";
import { DEFAULT_NFE_EMAIL_KEY } from "./customers.js";
import { readStringLocalSetting } from "./local-settings.js";
import { DEFAULT_OMIE_CATEGORY_SETTING_KEY, resolveOrderCategoryCode } from "./omie-categories.js";
import { consumeQuotation } from "./quotations.js";

type OperationStatus =
  | "draft"
  | "entry_registered"
  | "loading_requested"
  | "awaiting_exit"
  | "closed_local"
  | "pending_cloud"
  | "pending_omie"
  | "synced"
  | "sync_error"
  | "cancelled";

/**
 * Status de uma operacao ja concluida (fechada localmente), em qualquer estagio da
 * sincronizacao. Uma operacao "concluida" nasce em `closed_local` e caminha por
 * `pending_cloud`/`pending_omie` ate `synced` — ou para em `sync_error`. Em todos esses
 * estados a pesagem ja terminou (peso de saida capturado, cupom emitido), entao ela
 * continua sendo uma operacao concluida: precisa aparecer na lista de Concluidas, entrar
 * nos relatorios e permitir reimpressao/exclusao. Apenas `cancelled` sai desse conjunto.
 *
 * Antes, varias consultas filtravam so por `closed_local`, e a operacao sumia da lista de
 * Concluidas assim que a sincronizacao com a nuvem/OMIE mudava o status para `synced`.
 */
export const CLOSED_OPERATION_STATUSES = [
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error"
] as const satisfies readonly OperationStatus[];

/** Lista de status concluidos ja formatada para interpolar num `IN (...)` de SQL. */
export const CLOSED_OPERATION_STATUS_SQL_LIST = CLOSED_OPERATION_STATUSES.map(
  (status) => `'${status}'`
).join(", ");

/** True quando o status representa uma operacao concluida (fechada, em qualquer estagio de sync). */
export function isClosedOperationStatus(status: string): boolean {
  return (CLOSED_OPERATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Status em que a operacao ainda esta EM ANDAMENTO (nasceu, mas nao fechou). Sao os
 * unicos em que os dados comerciais podem ser alterados — depois do fechamento o pedido
 * / OS ja foi montado para o OMIE e a correcao passa a ser cancelar e refazer.
 */
export const OPEN_OPERATION_STATUSES = [
  "draft",
  "entry_registered",
  "loading_requested",
  "awaiting_exit"
] as const satisfies readonly OperationStatus[];

/** True quando a operacao ainda esta aberta (em andamento). */
export function isOpenOperationStatus(status: string): boolean {
  return (OPEN_OPERATION_STATUSES as readonly string[]).includes(status);
}

export type OperationType = "invoice" | "internal";
export type FreightPayer = "customer" | "quarry" | "third_party";

export interface OperationFreightInput {
  payer: FreightPayer;
  rule: FreightRule;
  destination?: string | null;
}

export interface ScaleCaptureAudit {
  weightKg: number;
  status: ScaleStatus;
  stable: boolean;
  capturedAt: string;
  receivedAt: string;
  rawFrame?: string;
  deviceId?: string;
  adapterName?: string;
}

export interface CreateSimulatedWeighingOperationInput {
  identity: LocalDesktopIdentity;
  operationType?: OperationType;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  paymentTermName?: string;
  unitPriceCents?: number;
  entryWeightKg: number;
}

export interface CreateWeighingOperationInput {
  identity: LocalDesktopIdentity;
  operationType?: OperationType;
  customerId: string;
  vehicleId: string;
  carrierId?: string;
  driverId: string;
  productId: string;
  paymentTermId?: string;
  paymentMethodId?: string;
  manualInstallments?: number;
  manualDownPaymentCents?: number;
  entryWeightKg: number;
  entryScaleCapture?: ScaleCaptureAudit | null;
  freight?: OperationFreightInput | null;
  /** Tipo (modalidade) de frete enviado ao OMIE; default "none" (sem frete). */
  freightModality?: FreightModality | null;
  quotationId?: string;
  deductFreightFromCredit?: boolean;
}

export interface CloseWeighingOperationInput {
  operationId: string;
  exitWeightKg: number;
  exitScaleCapture?: ScaleCaptureAudit | null;
  operationType?: OperationType;
}

export interface CancelWeighingOperationInput {
  operationId: string;
  reason: string;
}

export interface WeighingOperationSummary {
  id: string;
  status: OperationStatus;
  operationType: OperationType;
  customerId: string | null;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  /**
   * Ids locais dos vinculos da operacao. Alimentam a edicao completa (a tela precisa
   * pre-selecionar o que ja esta gravado) e ficam nulos em operacoes projetadas da
   * nuvem que ainda nao tem o cadastro correspondente nesta maquina.
   */
  productId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  carrierId: string | null;
  carrierName: string | null;
  paymentTermId: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentTermName: string | null;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  netWeightKg: number | null;
  unitPriceCents: number | null;
  baseUnitPriceCents: number | null;
  appliedPriceTableId: string | null;
  appliedPriceTableName: string | null;
  appliedPriceTableItemId: string | null;
  priceUnit: "ton";
  priceSavingsPercent: number | null;
  productTotalCents: number | null;
  freightTotalCents: number;
  freightJson: string | null;
  freightModality: FreightModality;
  totalCents: number | null;
  deductFreightFromCredit: boolean;
  productCreditDebitCents: number;
  freightCreditDebitCents: number;
  quotationId: string | null;
  omieSalesOrderId: number | null;
  /** Numero da ordem de servico criada no OMIE para a operacao interna (sem nota). */
  omieServiceOrderId: number | null;
  omieBillingStatus: string | null;
  omieBillingMessage: string | null;
  omieBilledAt: string | null;
  omieDocumentUrl: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Computador da pedreira que criou a operacao (multi-desktop). Alimenta o
   * contorno colorido e a legenda da tela de Operacoes.
   */
  deviceId: string | null;
  deviceName: string | null;
  deviceColor: string | null;
  /**
   * Quando o carregador marcou a carga como concluida no loader-web (projetado
   * de volta para o desktop pela sincronizacao cloud). `null` enquanto a carga
   * ainda aguarda o carregador. So e populado por `listOpenWeighingOperations`.
   */
  loaderCompletedAt?: string | null;
}

interface OperationRow {
  id: string;
  status: OperationStatus;
  operation_type: OperationType;
  entry_weight_kg: number | null;
  exit_weight_kg: number | null;
  net_weight_kg: number | null;
  unit_price_cents: number | null;
  base_unit_price_cents: number | null;
  applied_price_table_id: string | null;
  applied_price_table_name: string | null;
  applied_price_table_item_id: string | null;
  price_unit: "ton";
  price_savings_percent: number | null;
  product_total_cents: number | null;
  freight_total_cents: number;
  freight_json: string | null;
  freight_type: string | null;
  total_cents: number | null;
  deduct_freight_from_credit: number;
  product_credit_debit_cents: number;
  freight_credit_debit_cents: number;
  quotation_id: string | null;
  omie_sales_order_id: number | null;
  omie_service_order_id: number | null;
  omie_billing_status: string | null;
  omie_billing_message: string | null;
  omie_billed_at: string | null;
  omie_document_url: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string | null;
  customer_name: string | null;
  plate: string | null;
  driver_name: string | null;
  product_description: string | null;
  product_id?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  carrier_id?: string | null;
  carrier_name?: string | null;
  payment_term_id?: string | null;
  payment_method_id?: string | null;
  payment_method_name?: string | null;
  payment_term_name: string | null;
  device_id?: string | null;
  device_name?: string | null;
  device_color?: string | null;
  loader_completed_at?: string | null;
}

export function createSimulatedWeighingOperation(
  database: DesktopDatabase,
  input: CreateSimulatedWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  validateRequired("customerName", input.customerName);
  validateRequired("plate", input.plate);
  validateRequired("driverName", input.driverName);
  validateRequired("productDescription", input.productDescription);
  validateOperationType(input.operationType ?? "invoice");
  validateUnitPrice(input.unitPriceCents);

  if (input.entryWeightKg <= 0) {
    throw new Error("Entry weight must be greater than zero.");
  }

  const operationType = input.operationType ?? "invoice";
  const timestamp = now.toISOString();
  const ids = {
    operationId: randomUUID(),
    customerId: randomUUID(),
    vehicleId: randomUUID(),
    driverId: randomUUID(),
    productId: randomUUID(),
    paymentTermId: input.paymentTermName?.trim() ? randomUUID() : null,
    priceTableId: input.unitPriceCents === undefined ? null : randomUUID(),
    priceTableItemId: input.unitPriceCents === undefined ? null : randomUUID(),
    customerPriceTableId: input.unitPriceCents === undefined ? null : randomUUID(),
    loadingRequestId: randomUUID()
  };

  const createOperation = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, source, legal_name, trade_name, sync_status, created_at, updated_at)
         VALUES (?, ?, 'local', ?, ?, 'pending', ?, ?)`
      )
      .run(
        ids.customerId,
        input.identity.companyId,
        input.customerName.trim(),
        input.customerName.trim(),
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'kg', ?, ?)`
      )
      .run(
        ids.productId,
        input.identity.companyId,
        input.productDescription.trim(),
        input.productDescription.trim(),
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        ids.vehicleId,
        input.identity.companyId,
        normalizePlate(input.plate),
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO drivers (id, company_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(ids.driverId, input.identity.companyId, input.driverName.trim(), timestamp, timestamp);

    if (ids.paymentTermId && input.paymentTermName) {
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, created_at, updated_at)
           VALUES (?, ?, ?, '{}', ?, ?)`
        )
        .run(
          ids.paymentTermId,
          input.identity.companyId,
          input.paymentTermName.trim(),
          timestamp,
          timestamp
        );
    }

    if (
      ids.priceTableId &&
      ids.priceTableItemId &&
      ids.customerPriceTableId &&
      input.unitPriceCents !== undefined
    ) {
      database
        .prepare(
          `INSERT INTO price_tables (id, company_id, name, is_active, created_at, updated_at)
           VALUES (?, ?, 'Tabela simulada', 1, ?, ?)`
        )
        .run(ids.priceTableId, input.identity.companyId, timestamp, timestamp);
      database
        .prepare(
          `INSERT INTO price_table_items (id, price_table_id, product_id, unit_price_cents, unit, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ton', ?, ?)`
        )
        .run(
          ids.priceTableItemId,
          ids.priceTableId,
          ids.productId,
          input.unitPriceCents,
          timestamp,
          timestamp
        );
      database
        .prepare(
          `INSERT INTO customer_price_tables (id, customer_id, price_table_id, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`
        )
        .run(ids.customerPriceTableId, ids.customerId, ids.priceTableId, timestamp, timestamp);
    }

    database
      .prepare(
        `INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, customer_id, vehicle_id, driver_id, product_id,
          payment_term_id, entry_weight_kg, entry_weight_captured_at, unit_price_cents,
          base_unit_price_cents, applied_price_table_id, applied_price_table_name, applied_price_table_item_id,
          price_unit, price_savings_percent, freight_total_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'loading_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ton', ?, 0, ?, ?)`
      )
      .run(
        ids.operationId,
        input.identity.companyId,
        input.identity.unitId,
        input.identity.deviceId,
        operationType,
        ids.customerId,
        ids.vehicleId,
        ids.driverId,
        ids.productId,
        ids.paymentTermId,
        input.entryWeightKg,
        timestamp,
        input.unitPriceCents ?? null,
        input.unitPriceCents ?? null,
        ids.priceTableId,
        ids.priceTableId ? "Tabela simulada" : null,
        ids.priceTableItemId,
        null,
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO loading_requests (
          id, operation_id, company_id, unit_id, status, plate, customer_name, driver_name, product_description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ids.loadingRequestId,
        ids.operationId,
        input.identity.companyId,
        input.identity.unitId,
        normalizePlate(input.plate),
        input.customerName.trim(),
        input.driverName.trim(),
        input.productDescription.trim(),
        timestamp,
        timestamp
      );

    insertAuditLog(
      database,
      input.identity,
      ids.operationId,
      "entry_weight_captured",
      null,
      {
        entryWeightKg: input.entryWeightKg,
        operationType,
        unitPriceCents: input.unitPriceCents ?? null
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: ids.operationId,
        idempotencyKey: `cloud:operation:${ids.operationId}:entry`,
        payload: { operationId: ids.operationId }
      },
      now
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_loading_request",
        entityType: "loading_request",
        entityId: ids.loadingRequestId,
        idempotencyKey: `cloud:loading_request:${ids.loadingRequestId}:open`,
        payload: { operationId: ids.operationId }
      },
      now
    );
  });

  createOperation();

  return getWeighingOperation(database, ids.operationId);
}

export function createWeighingOperation(
  database: DesktopDatabase,
  input: CreateWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  if (!Number.isFinite(input.entryWeightKg) || input.entryWeightKg <= 0) {
    throw new Error("Peso de entrada deve ser maior que zero.");
  }
  if (
    input.manualInstallments !== undefined &&
    (!Number.isInteger(input.manualInstallments) || input.manualInstallments <= 0)
  ) {
    throw new Error("Numero de parcelas deve ser maior que zero.");
  }
  if (
    input.manualDownPaymentCents !== undefined &&
    (!Number.isInteger(input.manualDownPaymentCents) || input.manualDownPaymentCents < 0)
  ) {
    throw new Error("Valor de entrada invalido.");
  }

  const operationType = input.operationType ?? "invoice";
  validateOperationType(operationType);
  const timestamp = now.toISOString();

  const customer = database
    .prepare(
      "SELECT trade_name, is_active, omie_billing_blocked FROM customers WHERE id = ? AND deleted_at IS NULL"
    )
    .get(input.customerId) as
    | { trade_name: string; is_active: number; omie_billing_blocked: number }
    | undefined;
  const vehicle = database
    .prepare("SELECT plate FROM vehicles WHERE id = ? AND deleted_at IS NULL")
    .get(input.vehicleId) as { plate: string } | undefined;
  const driver = database
    .prepare("SELECT name FROM drivers WHERE id = ? AND deleted_at IS NULL")
    .get(input.driverId) as { name: string } | undefined;
  const product = database
    .prepare(
      `SELECT description, omie_product_id, item_type, fiscal_recommendations_json, is_active, blocked
       FROM products
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get(input.productId) as
    | {
        description: string;
        omie_product_id: number | null;
        item_type: string | null;
        fiscal_recommendations_json: string | null;
        is_active: number;
        blocked: number;
      }
    | undefined;

  if (!customer) throw new Error("Cliente selecionado nao foi encontrado.");
  if (customer.is_active !== 1) throw new Error("Cliente inativo nao pode iniciar pesagem.");
  if (customer.omie_billing_blocked === 1)
    throw new Error("Cliente bloqueado no OMIE nao pode iniciar pesagem.");
  if (!vehicle) throw new Error("Placa selecionada nao foi encontrada.");
  if (!driver) throw new Error("Motorista selecionado nao foi encontrado.");
  if (!product) throw new Error("Produto selecionado nao foi encontrado.");
  if (product.is_active !== 1 || product.blocked === 1) {
    throw new Error("Produto inativo ou bloqueado nao pode iniciar pesagem.");
  }
  if (!isFinishedGoodsProduct(product)) {
    throw new Error("Somente produtos OMIE tipo 04 - produtos acabados podem iniciar pesagem.");
  }

  if (input.paymentMethodId) {
    const paymentMethod = database
      .prepare("SELECT is_active FROM payment_methods WHERE id = ? AND deleted_at IS NULL")
      .get(input.paymentMethodId) as { is_active: number } | undefined;
    if (!paymentMethod) throw new Error("Forma de pagamento selecionada nao foi encontrada.");
    if (paymentMethod.is_active !== 1) {
      throw new Error("Forma de pagamento inativa nao pode ser usada na operacao.");
    }
  }

  const duplicateOpenOperation = database
    .prepare(
      `SELECT id
       FROM weighing_operations
       WHERE unit_id = ?
         AND vehicle_id = ?
         AND status IN ('draft', 'entry_registered', 'loading_requested', 'awaiting_exit')
       LIMIT 1`
    )
    .get(input.identity.unitId, input.vehicleId) as { id: string } | undefined;

  if (duplicateOpenOperation) {
    throw new Error(`Ja existe uma operacao aberta para a placa ${vehicle.plate}.`);
  }

  const priceDetails = new PricingService(database).getPriceDetailsForCustomerProduct(
    input.customerId,
    input.productId
  );
  if (!priceDetails || priceDetails.appliedUnitPriceCents === null) {
    throw new Error(
      "Sem preco cadastrado para este cliente/produto. Cadastre um preco padrao no produto ou um preco especial no cliente."
    );
  }
  const unitPriceCents = priceDetails.appliedUnitPriceCents;
  const financialBlock = new FinancialBlockService(database).canStartLoading(input.customerId);
  if (!financialBlock.allowed) {
    throw new Error(financialBlock.message ?? "Cliente bloqueado por limite financeiro.");
  }

  const operationId = randomUUID();
  const loadingRequestId = randomUUID();

  const createOperation = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, customer_id, vehicle_id, carrier_id, driver_id, product_id,
          payment_term_id, payment_method_id, manual_installments, manual_down_payment_cents, entry_weight_kg, entry_weight_captured_at, unit_price_cents,
          base_unit_price_cents, applied_price_table_id, applied_price_table_name, applied_price_table_item_id,
          price_unit, price_savings_percent, freight_total_cents, freight_json, freight_type, deduct_freight_from_credit,
          product_credit_debit_cents, freight_credit_debit_cents, quotation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'loading_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?)`
      )
      .run(
        operationId,
        input.identity.companyId,
        input.identity.unitId,
        input.identity.deviceId,
        operationType,
        input.customerId,
        input.vehicleId,
        input.carrierId ?? null,
        input.driverId,
        input.productId,
        input.paymentTermId ?? null,
        input.paymentMethodId ?? null,
        input.manualInstallments ?? null,
        input.manualDownPaymentCents ?? null,
        input.entryWeightKg,
        timestamp,
        unitPriceCents,
        priceDetails?.baseUnitPriceCents ?? null,
        null,
        null,
        null,
        priceDetails?.priceUnit ?? "ton",
        priceDetails?.savingsPercent ?? null,
        serializeOperationFreight(input.freight),
        getFreightModalityInfo(input.freightModality).key,
        input.deductFreightFromCredit ? 1 : 0,
        input.quotationId ?? null,
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO loading_requests (
          id, operation_id, company_id, unit_id, status, plate, customer_name, driver_name, product_description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        loadingRequestId,
        operationId,
        input.identity.companyId,
        input.identity.unitId,
        vehicle?.plate ?? "",
        customer?.trade_name ?? "",
        driver?.name ?? "",
        product?.description ?? "",
        timestamp,
        timestamp
      );

    // Primeira escolha vira padrao do cliente: a condicao e a forma usadas nesta
    // entrada preenchem os campos padrao ainda vazios do cadastro (nunca sobrescrevem
    // um padrao ja definido).
    if (input.paymentTermId || input.paymentMethodId) {
      database
        .prepare(
          `UPDATE customers SET
             default_payment_term_id = COALESCE(default_payment_term_id, ?),
             default_payment_method_id = COALESCE(default_payment_method_id, ?),
             updated_at = ?
           WHERE id = ?
             AND ((default_payment_term_id IS NULL AND ? IS NOT NULL)
               OR (default_payment_method_id IS NULL AND ? IS NOT NULL))`
        )
        .run(
          input.paymentTermId ?? null,
          input.paymentMethodId ?? null,
          timestamp,
          input.customerId,
          input.paymentTermId ?? null,
          input.paymentMethodId ?? null
        );
    }

    insertAuditLog(
      database,
      input.identity,
      operationId,
      "entry_weight_captured",
      null,
      {
        entryWeightKg: input.entryWeightKg,
        scaleCapture: input.entryScaleCapture ?? null,
        operationType,
        manualInstallments: input.manualInstallments ?? null,
        manualDownPaymentCents: input.manualDownPaymentCents ?? null,
        unitPriceCents,
        priceDetails: serializePriceDetails(priceDetails)
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: operationId,
        idempotencyKey: `cloud:operation:${operationId}:entry`,
        payload: { operationId }
      },
      now
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_loading_request",
        entityType: "loading_request",
        entityId: loadingRequestId,
        idempotencyKey: `cloud:loading_request:${loadingRequestId}:open`,
        payload: { operationId }
      },
      now
    );
  });

  createOperation();

  return getWeighingOperation(database, operationId);
}

export function closeWeighingOperation(
  database: DesktopDatabase,
  input: CloseWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  const operation = getWeighingOperation(database, input.operationId);

  // Guarda de idempotencia: uma operacao ja concluida (closed_local/pending_*/synced/
  // sync_error) ou cancelada nao deve ser reprocessada. Sem isto, um duplo-clique ou retry no
  // botao "Fechar" re-executava a transacao e debitava o credito do cliente pre-pago uma segunda
  // vez (o ledger de credito e aditivo). captureStableWeight e assincrono, entao dois IPC podem
  // chegar aqui em sequencia; a checagem sincrona serializa e o segundo vira um no-op idempotente,
  // retornando o estado atual (o ledger tambem e idempotente por operacao, como defesa extra).
  if (isClosedOperationStatus(operation.status) || operation.status === "cancelled") {
    return operation;
  }

  if (!operation.entryWeightKg) {
    throw new Error("Operation has no entry weight.");
  }

  const netWeightKg = calculateNetWeightKg(operation.entryWeightKg, input.exitWeightKg);
  const productTotalCents = calculateProductTotalCents(netWeightKg, operation.unitPriceCents);
  const freightTotalCents = calculateFreightTotalCents(operation.freightJson, netWeightKg);
  const totalCents = productTotalCents === null ? null : productTotalCents + freightTotalCents;
  const timestamp = now.toISOString();
  const nextOperationType: OperationType = input.operationType ?? operation.operationType;

  const opRow = database
    .prepare(
      `SELECT o.customer_id, o.deduct_freight_from_credit, o.quotation_id,
              COALESCE(pm.is_customer_credit, 0) AS payment_is_customer_credit
       FROM weighing_operations o
       LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
       WHERE o.id = ?`
    )
    .get(input.operationId) as
    | {
        customer_id: string | null;
        deduct_freight_from_credit: number;
        quotation_id: string | null;
        payment_is_customer_credit: number;
      }
    | undefined;

  let productCreditDebitCents = 0;
  let freightCreditDebitCents = 0;

  if (opRow?.customer_id && productTotalCents !== null) {
    const creditService = new CreditService(database);
    // A venda entra no extrato de credito do cliente quando o operador escolheu a
    // forma "credito do cliente" (fiado) ou quando o cadastro debita credito
    // pre-pago. Sem isso, uma venda no fiado nao consumia o limite nem aparecia
    // no extrato para cobranca posterior.
    const usesCustomerCredit =
      opRow.payment_is_customer_credit === 1 || creditService.isCustomerPrepaid(opRow.customer_id);

    if (usesCustomerCredit) {
      const deductFreight = opRow.deduct_freight_from_credit === 1;
      const required = deductFreight
        ? productTotalCents + (freightTotalCents ?? 0)
        : productTotalCents;

      const validation = creditService.validateDebit(opRow.customer_id, required);
      if (!validation.allowed) {
        throw new Error(validation.message ?? "Crédito insuficiente.");
      }

      productCreditDebitCents = productTotalCents;
      freightCreditDebitCents = deductFreight ? (freightTotalCents ?? 0) : 0;
    }
  }

  const closeOperation = database.transaction(() => {
    if (input.operationType) {
      database
        .prepare(
          `UPDATE weighing_operations
           SET status = 'closed_local', operation_type = ?, exit_weight_kg = ?, exit_weight_captured_at = ?, net_weight_kg = ?, product_total_cents = ?, freight_total_cents = ?, total_cents = ?,
               product_credit_debit_cents = ?, freight_credit_debit_cents = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextOperationType,
          input.exitWeightKg,
          timestamp,
          netWeightKg,
          productTotalCents,
          freightTotalCents,
          totalCents,
          productCreditDebitCents,
          freightCreditDebitCents,
          timestamp,
          input.operationId
        );
    } else {
      database
        .prepare(
          `UPDATE weighing_operations
           SET status = 'closed_local', exit_weight_kg = ?, exit_weight_captured_at = ?, net_weight_kg = ?, product_total_cents = ?, freight_total_cents = ?, total_cents = ?,
               product_credit_debit_cents = ?, freight_credit_debit_cents = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.exitWeightKg,
          timestamp,
          netWeightKg,
          productTotalCents,
          freightTotalCents,
          totalCents,
          productCreditDebitCents,
          freightCreditDebitCents,
          timestamp,
          input.operationId
        );
    }

    if (productCreditDebitCents > 0 || freightCreditDebitCents > 0) {
      if (opRow?.customer_id) {
        const creditService = new CreditService(database);
        creditService.applyDebit(
          opRow.customer_id,
          input.operationId,
          productCreditDebitCents,
          freightCreditDebitCents
        );
        // Parte que sai do adiantamento (dinheiro que o cliente ja depositou no
        // OMIE) precisa ser baixada la tambem, senao o saldo cai so aqui. O que
        // exceder o adiantamento disponivel e fiado e nao gera baixa.
        const settleCents = Math.min(
          productCreditDebitCents + freightCreditDebitCents,
          creditService.getAdvanceAvailableToSettleCents(opRow.customer_id)
        );
        if (settleCents > 0) {
          database
            .prepare(
              `UPDATE weighing_operations
                 SET omie_advance_settle_cents = ?, omie_advance_status = 'pending', updated_at = ?
               WHERE id = ?`
            )
            .run(settleCents, timestamp, input.operationId);
        }
      }
    }

    if (opRow?.quotation_id) {
      consumeQuotation(database, opRow.quotation_id, input.operationId, now);
    }

    database
      .prepare(
        "UPDATE loading_requests SET status = 'closed', closed_at = ?, updated_at = ? WHERE operation_id = ?"
      )
      .run(timestamp, timestamp, input.operationId);

    insertAuditLog(
      database,
      null,
      input.operationId,
      "exit_weight_captured",
      operation,
      {
        exitWeightKg: input.exitWeightKg,
        netWeightKg,
        scaleCapture: input.exitScaleCapture ?? null,
        productTotalCents,
        freightTotalCents,
        totalCents,
        operationType: input.operationType ?? operation.operationType
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:closed`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const closedLoadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (closedLoadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: closedLoadingRequest.id,
          idempotencyKey: `cloud:loading_request:${closedLoadingRequest.id}:closed`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }

    // Reconstroi o job a partir da operacao ja atualizada nesta transacao (buildOmieBillingJob
    // le os valores recem-gravados). Retorna null sem omie_customer_id (nada a enviar).
    // O faturamento (emissao de NF-e) e feito INTEIRAMENTE no OMIE: o app apenas cria o
    // pedido/OS (o pedido entra na etapa "Faturar" do kanban de Vendas — ver edge function).
    const billingJob = buildOmieBillingJob(database, input.operationId);
    if (billingJob) {
      enqueueOmieBillingJob(database, input.operationId, billingJob, now);
    } else {
      // Aqui buildOmieBillingJob so retorna null quando o cliente nao tem codigo OMIE E
      // nao tem CNPJ/CPF (sem documento o OMIE nao permite cadastrar o cliente na hora).
      // Registra o motivo (em vez de pular em silencio) para aparecer na tela Concluidas;
      // apos informar o documento do cliente, "Refaturar" cria o cliente e envia o
      // pedido/OS. Vale para os DOIS tipos: a operacao interna tambem vira ordem de
      // servico no OMIE, entao ficar sem job precisa ser tao visivel quanto na fiscal.
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextOperationType === "invoice"
            ? "Cliente sem CNPJ/CPF: informe o documento do cliente para cadastra-lo no OMIE e enviar o pedido (use Refaturar)."
            : "Cliente sem CNPJ/CPF: informe o documento do cliente para cadastra-lo no OMIE e enviar a ordem de servico (use Reenviar).",
          timestamp,
          input.operationId
        );
    }
  });

  closeOperation();

  return getWeighingOperation(database, input.operationId);
}

export type FiscalMissingField = "address_number" | "email";

export interface CustomerFiscalReadiness {
  ready: boolean;
  missing: FiscalMissingField[];
  source: string | null;
  message: string | null;
}

const FISCAL_FIELD_LABELS: Record<FiscalMissingField, string> = {
  address_number: "Numero do Endereco",
  email: "E-mail"
};

/**
 * O OMIE exige Numero do Endereco + E-mail no cadastro do cliente para emitir a NF-e
 * (rejeitado apenas no FaturarPedidoVenda). Pre-valida esses dois campos antes de tentar
 * faturar, para nao criar um pedido condenado nem gerar retry storm.
 */
export function validateCustomerFiscalReadiness(
  database: DesktopDatabase,
  customerId: string | null
): CustomerFiscalReadiness {
  if (!customerId) {
    return {
      ready: false,
      missing: ["address_number", "email"],
      source: null,
      message: "Operacao fiscal sem cliente vinculado."
    };
  }
  const row = database
    .prepare("SELECT address_number, email, source FROM customers WHERE id = ?")
    .get(customerId) as
    | { address_number: string | null; email: string | null; source: string | null }
    | undefined;
  if (!row) {
    return {
      ready: false,
      missing: ["address_number", "email"],
      source: null,
      message: "Cliente nao encontrado no cadastro local."
    };
  }
  const missing: FiscalMissingField[] = [];
  if (!(row.address_number ?? "").trim()) missing.push("address_number");
  if (!(row.email ?? "").trim()) missing.push("email");
  if (missing.length === 0) {
    return { ready: true, missing: [], source: row.source, message: null };
  }
  const fields = missing.map((field) => FISCAL_FIELD_LABELS[field]).join(" e ");
  let message = `Cadastro do cliente incompleto para NF-e: falta ${fields}. Preencha no cadastro do cliente e refature.`;
  if (row.source === "omie") {
    message += " Cliente de origem OMIE: corrija diretamente no portal OMIE.";
  }
  return { ready: false, missing, source: row.source, message };
}

/** Igual a validateCustomerFiscalReadiness, resolvendo o cliente pela operacao. */
export function validateOperationFiscalReadiness(
  database: DesktopDatabase,
  operationId: string
): CustomerFiscalReadiness {
  const row = database
    .prepare("SELECT customer_id FROM weighing_operations WHERE id = ?")
    .get(operationId) as { customer_id: string | null } | undefined;
  return validateCustomerFiscalReadiness(database, row?.customer_id ?? null);
}

/**
 * Cadastro do cliente enviado junto ao pedido para o edge criar/localizar o cliente no
 * OMIE na hora, quando ele ainda nao tem codigo OMIE (customerOmieId = 0). Espelha os
 * campos de PushCustomerPayload do edge.
 */
export interface OmieOrderCustomerCadastro {
  localCustomerId: string;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjCpf?: string;
  email?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

/**
 * Cadastro da transportadora enviado junto com o pedido quando ela ainda nao existe
 * no OMIE. O edge cria/localiza (find-or-create por CNPJ/CPF, com a tag
 * "transportadora") ANTES de montar o pedido e usa o codigo resultante em
 * `codigo_transportadora` — assim o primeiro fechamento com uma transportadora nova
 * ja sai com ela preenchida, sem depender do proximo sync de cadastros.
 */
export interface OmieOrderCarrierCadastro {
  localCarrierId: string;
  name: string;
  /** Obrigatorio no OMIE: sem CNPJ/CPF nao da para cadastrar, entao nem enviamos. */
  cnpjCpf: string;
  email?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

/**
 * Dados de transporte da operacao enviados ao OMIE no bloco `frete` do pedido de
 * venda (placa, transportadora, pesos da carga) e nos dados adicionais da NF
 * (motorista). A transportadora e a escolhida na operacao (senao a vinculada ao
 * veiculo) e so vai como codigo quando ja existe no OMIE; quando nao existe, o
 * cadastro segue em `carrier` para o edge cria-la antes do pedido.
 */
export interface OmieOrderTransport {
  plate: string | null;
  /**
   * UF de emplacamento do veiculo (`placa_estado` do bloco frete). A NF-e pede placa E UF
   * do veiculo no transporte; vem do cadastro de veiculos (sincronizado do OMIE).
   */
  plateState: string | null;
  driverName: string | null;
  carrierOmieId: number | null;
  /**
   * Nome da transportadora. A OS nao tem bloco `frete` para referenciar o cadastro
   * (so o pedido de venda tem), entao ela entra pelo nome nos dados adicionais.
   */
  carrierName: string | null;
  /** Peso liquido da carga em kg (vai em peso_bruto/peso_liquido do frete — granel, sem embalagem). */
  cargoWeightKg: number | null;
  /** true quando a modalidade e transporte proprio (modFrete 3/4) — veiculo_proprio "S". */
  ownVehicle: boolean;
}

export interface OmieBillingJobPayload {
  operationId: string;
  operationType: OperationType;
  /** Codigo OMIE do cliente. 0 quando ainda nao vinculado — o edge cria pelo campo `customer`. */
  customerOmieId: number;
  /** Id local do cliente, para gravar o codigo OMIE de volta apos o envio. */
  localCustomerId: string | null;
  /** Cadastro para criar o cliente no OMIE na hora quando customerOmieId = 0. */
  customer: OmieOrderCustomerCadastro | null;
  productOmieId: number | null;
  serviceDescription: string | null;
  quantity: number;
  unitPrice: number;
  freightTotalCents: number;
  /** Codigo "modalidade" do frete no OMIE (modFrete da NF-e): 0 CIF, 1 FOB, 2 terceiros, 3/4 proprio, 9 sem frete. */
  freightModalidade: string;
  issueDate: string;
  paymentTermOmieCode: string | null;
  paymentTermInstallmentCount: number | null;
  /** Dias de vencimento das parcelas da condicao OMIE (ex: [7,14,21]); null = a vista. */
  paymentTermInstallmentDays: number[] | null;
  /** Codigo NFe/OMIE do meio de pagamento escolhido na operacao ("01", "17"...). */
  paymentMethodOmieCode: string | null;
  /** nCodCC (OMIE) da conta vinculada ao meio escolhido; vai em codigo_conta_corrente/nCodCC. */
  accountOmieCode: string | null;
  /**
   * Nome da conta vinculada ao meio (ex.: "OMIE Cash"). Usado pelo edge para resolver o
   * nCodCC pelo nome direto no OMIE quando o accountOmieCode local ainda esta nulo,
   * garantindo que o meio de pagamento sempre caia na conta a ele vinculada.
   */
  accountName: string | null;
  /**
   * Categoria do plano gerencial do OMIE (codigo_categoria) em que a venda entra:
   * a cadastrada no produto, senao a padrao da unidade, senao "1.01.01".
   */
  omieCategoryCode: string;
  /** Placa, motorista, transportadora e pesos da carga para o frete do pedido. */
  transport: OmieOrderTransport | null;
  /** Id local da transportadora, para gravar o codigo OMIE devolvido pelo envio. */
  localCarrierId: string | null;
  /** Cadastro da transportadora a criar no OMIE antes do pedido (null = ja existe la). */
  carrier: OmieOrderCarrierCadastro | null;
}

export interface BuiltOmieBillingJob {
  payload: OmieBillingJobPayload;
  idempotencyKey: string;
  action: "create_and_bill_order" | "create_order";
  unitId: string;
}

/**
 * Reconstroi o job de faturamento/pedido OMIE a partir da operacao ja persistida, de forma
 * IDENTICA ao que o fechamento produz (mesmo payload e idempotencyKey), para que fechamento e
 * refaturamento (apos corrigir o cadastro) sejam byte-a-byte iguais e reusem o mesmo pedido no
 * OMIE. Retorna null quando o cliente nao tem omie_customer_id (nada a enviar).
 */
/**
 * Codigo "modalidade" do frete para o OMIE a partir do tipo salvo. Compat: operacoes
 * anteriores a esta feature nao tem tipo salvo (default "none" -> "9"); quando elas tem
 * valor de frete, mantemos o comportamento legado (CIF "0" com valor), evitando enviar
 * "sem frete" para um pedido que tinha frete.
 */
function resolveFreightModalidade(
  freightType: string | null | undefined,
  freightTotalCents: number
): string {
  // FOB (frete por conta do cliente) vai ao OMIE como "9 - sem incidencia de frete":
  // quando o frete e responsabilidade do cliente a Pedreira nao contrata nem responde
  // pelo transporte, entao a operacao nao deve nascer no OMIE como "frete por conta do
  // destinatario". Sai antes da compatibilidade abaixo de proposito: FOB com valor
  // lancado continua "9", nao vira CIF.
  if (getFreightModalityInfo(freightType).key === "fob") return "9";
  const code = freightModalityOmieCode(freightType);
  if (code === "9" && freightTotalCents > 0) return "0";
  return code;
}

/**
 * UF de emplacamento do veiculo da operacao (`placa_estado` do bloco frete do pedido).
 * Vem do cadastro de veiculos, alimentado pelo sync do OMIE. Null quando o veiculo
 * ainda nao tem UF — o pedido segue so com a placa, como antes.
 */
function resolveVehiclePlateState(
  database: DesktopDatabase,
  vehicleId: string | null
): string | null {
  if (!vehicleId) return null;
  const row = database.prepare("SELECT plate_state FROM vehicles WHERE id = ?").get(vehicleId) as
    | { plate_state: string | null }
    | undefined;
  const state = (row?.plate_state ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(state) ? state : null;
}

interface OrderCustomerRow {
  omie_customer_id: number | null;
  legal_name: string | null;
  trade_name: string | null;
  document: string | null;
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  address_street: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

/** Separa o telefone (so digitos) em DDD + numero, como o OMIE espera. */
function splitPhoneForOmie(phone: string | null): { ddd?: string; numero?: string } {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return {};
  return { ddd: digits.slice(0, 2), numero: digits.slice(2) };
}

/**
 * Monta o cadastro do cliente para o edge criar/localizar no OMIE junto com o pedido.
 * Sem e-mail proprio o cliente sai com o e-mail padrao de NF-e configurado: o OMIE cobra
 * o campo no IncluirCliente e, sem ele, o cadastro (e o fechamento junto) e recusado.
 * O cliente pode ter varios e-mails: todos vao no campo do OMIE (virgula), respeitando
 * o limite de 500 caracteres do cadastro.
 */
function buildOrderCustomerCadastro(
  localCustomerId: string,
  row: OrderCustomerRow,
  fallbackEmail: string | null
): OmieOrderCustomerCadastro {
  const phone = splitPhoneForOmie(row.phone);
  return {
    localCustomerId,
    razaoSocial: row.legal_name ?? row.trade_name ?? "",
    nomeFantasia: row.trade_name ?? row.legal_name ?? undefined,
    cnpjCpf: row.document?.trim() || undefined,
    email: formatEmailListForOmie(row.email) || formatEmailListForOmie(fallbackEmail) || undefined,
    telefone1Ddd: phone.ddd,
    telefone1Numero: phone.numero,
    zipcode: row.zipcode ?? undefined,
    addressStreet: row.address_street ?? undefined,
    addressNumber: row.address_number ?? undefined,
    neighborhood: row.neighborhood ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined
  };
}

export function buildOmieBillingJob(
  database: DesktopDatabase,
  operationId: string
): BuiltOmieBillingJob | null {
  const row = database
    .prepare(
      "SELECT unit_id, customer_id, product_id, vehicle_id, carrier_id, payment_term_id, payment_method_id, freight_type, exit_weight_captured_at FROM weighing_operations WHERE id = ?"
    )
    .get(operationId) as
    | {
        unit_id: string;
        customer_id: string | null;
        product_id: string | null;
        vehicle_id: string | null;
        carrier_id: string | null;
        payment_term_id: string | null;
        payment_method_id: string | null;
        freight_type: string | null;
        exit_weight_captured_at: string | null;
      }
    | undefined;
  if (!row) return null;

  const customerRow = row.customer_id
    ? (database
        .prepare(
          `SELECT omie_customer_id, legal_name, trade_name, document, phone, email,
                  zipcode, address_street, address_number, neighborhood, city, state
           FROM customers WHERE id = ?`
        )
        .get(row.customer_id) as OrderCustomerRow | undefined)
    : undefined;

  const omieCustomerId = customerRow?.omie_customer_id ?? null;
  const customerDocument = customerRow?.document?.trim() || null;
  // Sem codigo OMIE e sem documento: nao da para criar o cliente no OMIE, entao nao ha
  // pedido a enviar. O fechamento marca cadastro_incompleto pedindo o CNPJ/CPF do cliente.
  if (!omieCustomerId && !customerDocument) return null;

  // Cliente ainda nao vinculado (mas com documento): envia o cadastro para o edge
  // criar/localizar o cliente no OMIE na hora, antes de criar o pedido.
  const customerCadastro: OmieOrderCustomerCadastro | null =
    !omieCustomerId && customerRow && row.customer_id
      ? buildOrderCustomerCadastro(
          row.customer_id,
          customerRow,
          readStringLocalSetting(database, DEFAULT_NFE_EMAIL_KEY)
        )
      : null;

  const productRow = row.product_id
    ? (database
        .prepare("SELECT omie_product_id, omie_category_code FROM products WHERE id = ?")
        .get(row.product_id) as
        | { omie_product_id: number | null; omie_category_code: string | null }
        | undefined)
    : undefined;
  const omieProductId = productRow?.omie_product_id ?? null;

  // Categoria do plano gerencial em que a venda entra no OMIE: a do produto manda,
  // depois a padrao da unidade. Antes o edge mandava um codigo fixo, entao toda venda
  // era classificada na mesma categoria independentemente do produto.
  const omieCategoryCode = resolveOrderCategoryCode(
    productRow?.omie_category_code,
    readStringLocalSetting(database, DEFAULT_OMIE_CATEGORY_SETTING_KEY)
  );

  // Espelho OMIE (quando a condicao local esta vinculada a um codigo) tem precedencia;
  // sem vinculo, os campos da propria condicao local (parse do texto digitado) valem —
  // e a edge cria a parcela no cadastro do OMIE a partir deles.
  const omieParcela = row.payment_term_id
    ? (database
        .prepare(
          `SELECT pt.omie_parcela_code AS code,
                  COALESCE(opt.installment_count, pt.installment_count) AS installment_count,
                  COALESCE(opt.installment_days_json, pt.installment_days_json) AS installment_days_json,
                  COALESCE(opt.first_installment_days, pt.first_installment_days) AS first_installment_days,
                  COALESCE(opt.installment_interval_days, pt.installment_interval_days) AS installment_interval_days
           FROM payment_terms pt
           LEFT JOIN omie_payment_terms opt
             ON opt.company_id = pt.company_id AND opt.code = pt.omie_parcela_code AND opt.is_active = 1
           WHERE pt.id = ?`
        )
        .get(row.payment_term_id) as
        | {
            code: string | null;
            installment_count: number | null;
            installment_days_json: string | null;
            first_installment_days: number | null;
            installment_interval_days: number | null;
          }
        | undefined)
    : undefined;

  // Codigos OMIE do meio de pagamento escolhido e da conta vinculada a ele
  // (payment_methods.account_id -> accounts.omie_code). Vao no job para o pedido/OS
  // ja nascer no OMIE com o meio e a conta corrente da operacao.
  const omiePayment = row.payment_method_id
    ? (database
        .prepare(
          `SELECT pm.omie_code AS method_code, ac.omie_code AS account_code, ac.name AS account_name
           FROM payment_methods pm
           LEFT JOIN accounts ac ON ac.id = pm.account_id AND ac.deleted_at IS NULL
           WHERE pm.id = ?`
        )
        .get(row.payment_method_id) as
        | { method_code: string | null; account_code: string | null; account_name: string | null }
        | undefined)
    : undefined;

  const operation = getWeighingOperation(database, operationId);

  // Transportadora do pedido OMIE: a ESCOLHIDA na operacao manda. So quando a
  // operacao nao tem transportadora caimos no vinculo do veiculo (mais recente
  // ativo) — antes so o vinculo do veiculo era consultado, entao a transportadora
  // que o operador selecionou na entrada nao chegava ao pedido e o campo
  // "Transportadora" ficava vazio no OMIE.
  const orderCarrier = resolveOrderCarrier(database, row.carrier_id, row.vehicle_id);
  const carrierOmieId =
    orderCarrier?.omie_customer_id && orderCarrier.omie_customer_id > 0
      ? orderCarrier.omie_customer_id
      : null;
  // Ainda sem codigo OMIE: o cadastro sobe junto e o edge cria a transportadora
  // antes de montar o pedido, para o primeiro fechamento ja sair com ela.
  const carrierCadastro = buildOrderCarrierCadastro(orderCarrier);
  const freightModalidade = resolveFreightModalidade(row.freight_type, operation.freightTotalCents);
  const transport: OmieOrderTransport = {
    plate: operation.plate?.trim() || null,
    plateState: resolveVehiclePlateState(database, row.vehicle_id),
    driverName: operation.driverName?.trim() || null,
    carrierOmieId: carrierOmieId && carrierOmieId > 0 ? carrierOmieId : null,
    carrierName: orderCarrier?.name?.trim() || null,
    cargoWeightKg: operation.netWeightKg,
    ownVehicle: freightModalidade === "3" || freightModalidade === "4"
  };

  // O app so CRIA o pedido/OS no OMIE; o faturamento (NF-e/NFS-e) e feito no proprio
  // OMIE (pedido entra na etapa "Faturar"). O botao manual de faturar promove o job
  // para create_and_bill_order em processFiscalBillingNow.
  const action = "create_order";
  const idempotencyAction =
    operation.operationType === "invoice" ? "create_sales_order" : "create_service_order";

  return {
    unitId: row.unit_id,
    action,
    idempotencyKey: buildOmieIntegrationCode(
      row.unit_id ?? "unknown",
      operationId,
      idempotencyAction
    ),
    payload: {
      operationId,
      operationType: operation.operationType,
      customerOmieId: omieCustomerId ?? 0,
      localCustomerId: row.customer_id,
      customer: customerCadastro,
      productOmieId: omieProductId,
      serviceDescription: operation.productDescription,
      quantity: (operation.netWeightKg ?? 0) / 1000,
      unitPrice: operation.unitPriceCents ? operation.unitPriceCents / 100 : 0,
      freightTotalCents: operation.freightTotalCents,
      freightModalidade,
      issueDate: (row.exit_weight_captured_at ?? "").slice(0, 10),
      paymentTermOmieCode: omieParcela?.code ?? null,
      paymentTermInstallmentCount: omieParcela?.installment_count ?? null,
      paymentTermInstallmentDays: resolveInstallmentDays(omieParcela),
      paymentMethodOmieCode: omiePayment?.method_code ?? null,
      accountOmieCode: omiePayment?.account_code ?? null,
      accountName: omiePayment?.account_name ?? null,
      omieCategoryCode,
      transport,
      localCarrierId: orderCarrier?.id ?? null,
      carrier: carrierCadastro
    }
  };
}

/**
 * Codigo OMIE da transportadora que vai no bloco `frete` do pedido. A transportadora
 * escolhida na operacao tem precedencia; sem ela, usa a vinculada ao veiculo. Retorna
 * null quando a transportadora ainda nao existe no OMIE (`omie_customer_id` vazio) —
 * nesse caso o OMIE nao tem como referenciar o cadastro e o campo fica em branco ate
 * a transportadora ser sincronizada.
 */
function resolveOrderCarrier(
  database: DesktopDatabase,
  carrierId: string | null,
  vehicleId: string | null
): OrderCarrierRow | null {
  const fromOperation = carrierId
    ? (database
        .prepare(
          `SELECT ${ORDER_CARRIER_COLUMNS} FROM carriers WHERE id = ? AND deleted_at IS NULL`
        )
        .get(carrierId) as OrderCarrierRow | undefined)
    : undefined;
  // A escolhida na operacao manda mesmo sem codigo OMIE: nesse caso ela sobe ao OMIE
  // junto com o pedido. So caimos no vinculo do veiculo quando a operacao nao tem uma.
  if (fromOperation) return fromOperation;

  const fromVehicle = vehicleId
    ? (database
        .prepare(
          `SELECT ${ORDER_CARRIER_COLUMNS.split(", ")
            .map((column) => `c.${column}`)
            .join(", ")}
           FROM vehicle_carriers vc
           JOIN carriers c ON c.id = vc.carrier_id AND c.deleted_at IS NULL
           WHERE vc.vehicle_id = ? AND vc.deleted_at IS NULL AND vc.is_active = 1
           ORDER BY vc.created_at DESC
           LIMIT 1`
        )
        .get(vehicleId) as OrderCarrierRow | undefined)
    : undefined;
  return fromVehicle ?? null;
}

const ORDER_CARRIER_COLUMNS =
  "id, omie_customer_id, name, document, phone, email, zipcode, address_street, address_number, neighborhood, city, state";

interface OrderCarrierRow {
  id: string;
  omie_customer_id: number | null;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  address_street: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

/**
 * Cadastro a enviar para o edge criar a transportadora no OMIE antes do pedido.
 * `null` quando ela ja tem codigo OMIE (nada a criar) ou quando nao tem CNPJ/CPF —
 * o OMIE exige o documento, e falhar aqui derrubaria o pedido inteiro; sem ele o
 * pedido segue sem transportadora, como antes.
 */
function buildOrderCarrierCadastro(
  carrier: OrderCarrierRow | null
): OmieOrderCarrierCadastro | null {
  if (!carrier) return null;
  if (carrier.omie_customer_id && carrier.omie_customer_id > 0) return null;
  const document = carrier.document?.trim();
  if (!document) return null;

  const phone = splitPhoneForOmie(carrier.phone);
  return {
    localCarrierId: carrier.id,
    name: carrier.name,
    cnpjCpf: document,
    email: formatEmailListForOmie(carrier.email) || undefined,
    telefone1Ddd: phone.ddd,
    telefone1Numero: phone.numero,
    zipcode: carrier.zipcode ?? undefined,
    addressStreet: carrier.address_street ?? undefined,
    addressNumber: carrier.address_number ?? undefined,
    neighborhood: carrier.neighborhood ?? undefined,
    city: carrier.city ?? undefined,
    state: carrier.state ?? undefined
  };
}

/**
 * Dias de vencimento das parcelas da condicao OMIE vinculada: usa o JSON explicito
 * (ex: [7,14,21]) quando presente, senao deriva de primeiro dia + intervalo + quantidade.
 * Retorna null quando a condicao nao informa dias (edge trata como a vista).
 */
function resolveInstallmentDays(
  omieParcela:
    | {
        installment_days_json: string | null;
        first_installment_days: number | null;
        installment_interval_days: number | null;
        installment_count: number | null;
      }
    | undefined
): number[] | null {
  if (!omieParcela) return null;

  if (omieParcela.installment_days_json) {
    try {
      const parsed = JSON.parse(omieParcela.installment_days_json) as unknown;
      if (Array.isArray(parsed)) {
        const days = parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0);
        if (days.length > 0) return days;
      }
    } catch {
      // JSON invalido no espelho OMIE: cai na derivacao abaixo.
    }
  }

  const count = omieParcela.installment_count;
  const first = omieParcela.first_installment_days;
  if (!count || count < 1 || first === null || first < 0) return null;
  const interval = omieParcela.installment_interval_days ?? 0;
  return Array.from({ length: count }, (_, index) => first + index * interval);
}

/** Enfileira o job de faturamento/pedido OMIE reconstruido por buildOmieBillingJob. */
export function enqueueOmieBillingJob(
  database: DesktopDatabase,
  operationId: string,
  job: BuiltOmieBillingJob,
  now: Date = new Date()
): void {
  enqueueSyncJob(
    database,
    {
      target: "omie",
      action: job.action,
      entityType: "weighing_operation",
      entityId: operationId,
      idempotencyKey: job.idempotencyKey,
      payload: job.payload
    },
    now
  );
}

export function cancelWeighingOperation(
  database: DesktopDatabase,
  input: CancelWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  validateRequired("Cancellation reason", input.reason);

  const operation = getWeighingOperation(database, input.operationId);

  // Guarda de idempotencia: cancelar de novo estornaria o credito (applyRefund) uma segunda vez
  // sobre product_credit_debit_cents, inflando o saldo. Retorna o estado atual como no-op (o
  // cancelamento duplo tambem nao duplica jobs OMIE, pela chave idempotente / ledger idempotente).
  if (operation.status === "cancelled") {
    return operation;
  }

  const timestamp = now.toISOString();

  const opRow = database
    .prepare(
      `SELECT customer_id, product_credit_debit_cents, freight_credit_debit_cents, quotation_id,
              omie_sales_order_id, omie_service_order_id, omie_billing_status
       FROM weighing_operations WHERE id = ?`
    )
    .get(input.operationId) as
    | {
        customer_id: string | null;
        product_credit_debit_cents: number;
        freight_credit_debit_cents: number;
        quotation_id: string | null;
        omie_sales_order_id: number | null;
        omie_service_order_id: number | null;
        omie_billing_status: string | null;
      }
    | undefined;

  const cancelOperation = database.transaction(() => {
    database
      .prepare(
        "UPDATE weighing_operations SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?"
      )
      .run(input.reason.trim(), timestamp, input.operationId);
    database
      .prepare(
        "UPDATE loading_requests SET status = 'cancelled', closed_at = ?, updated_at = ? WHERE operation_id = ?"
      )
      .run(timestamp, timestamp, input.operationId);

    if (opRow?.customer_id) {
      const productDebit = opRow.product_credit_debit_cents ?? 0;
      const freightDebit = opRow.freight_credit_debit_cents ?? 0;
      if (productDebit > 0 || freightDebit > 0) {
        new CreditService(database).applyRefund(
          opRow.customer_id,
          input.operationId,
          productDebit,
          freightDebit,
          input.reason.trim()
        );
      }

      if (opRow.quotation_id) {
        database
          .prepare(
            `UPDATE quotations SET status = 'open', consumed_operation_id = NULL, updated_at = ? WHERE id = ?`
          )
          .run(timestamp, opRow.quotation_id);
      }
    }

    insertAuditLog(
      database,
      null,
      input.operationId,
      "operation_cancelled",
      operation,
      { reason: input.reason.trim() },
      timestamp
    );

    // "Antes Do OMIE": neutraliza jobs de criacao ainda pendentes para nao criar/faturar
    // um pedido no OMIE depois do cancelamento local (docs/phase-1/sync-strategy.md).
    cancelPendingOmieJobs(database, input.operationId, now);

    // "Depois Do OMIE": se ja existe pedido/OS no OMIE, solicita o cancelamento la.
    const omieOrderId = opRow?.omie_sales_order_id ?? opRow?.omie_service_order_id ?? null;
    if (omieOrderId) {
      const orderType = opRow?.omie_sales_order_id ? "sales" : "service";
      enqueueSyncJob(
        database,
        {
          target: "omie",
          action: "cancel_order",
          entityType: "weighing_operation",
          entityId: input.operationId,
          idempotencyKey: `omie:cancel:${input.operationId}`,
          payload: {
            operationId: input.operationId,
            orderType,
            omieOrderId,
            reason: input.reason.trim()
          }
        },
        now
      );
      insertAuditLog(
        database,
        null,
        input.operationId,
        "omie_cancel_requested",
        operation,
        { orderType, omieOrderId, reason: input.reason.trim() },
        timestamp
      );
    }

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:cancelled`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const loadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (loadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: loadingRequest.id,
          idempotencyKey: `cloud:loading_request:${loadingRequest.id}:cancelled`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }
  });

  cancelOperation();

  return getWeighingOperation(database, input.operationId);
}

export function listOpenWeighingOperations(database: DesktopDatabase): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.freight_json, o.freight_type, o.total_cents,
        o.deduct_freight_from_credit, o.product_credit_debit_cents, o.freight_credit_debit_cents, o.quotation_id,
        o.omie_sales_order_id, o.omie_service_order_id, o.omie_billing_status, o.omie_billing_message,
        o.omie_billed_at, o.omie_document_url,
        o.cancel_reason, o.created_at, o.updated_at,
        c.id AS customer_id,
        COALESCE(c.trade_name, o.remote_customer_name) AS customer_name,
        COALESCE(v.plate, o.remote_plate) AS plate,
        COALESCE(d.name, o.remote_driver_name) AS driver_name,
        COALESCE(p.description, o.remote_product_description) AS product_description,
        o.product_id, o.vehicle_id, o.driver_id, o.carrier_id,
        o.payment_term_id, o.payment_method_id,
        crr.name AS carrier_name, pmd.name AS payment_method_name,
        o.device_id, dv.name AS device_name, dv.color AS device_color,
        lr.loader_completed_at AS loader_completed_at,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       LEFT JOIN carriers crr ON crr.id = o.carrier_id
       LEFT JOIN payment_methods pmd ON pmd.id = o.payment_method_id
       LEFT JOIN devices dv ON dv.id = o.device_id
       LEFT JOIN loading_requests lr ON lr.operation_id = o.id
        WHERE o.status IN ('loading_requested', 'awaiting_exit', 'entry_registered')
          AND o.deleted_at IS NULL
        ORDER BY o.created_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function listCanceledWeighingOperations(
  database: DesktopDatabase
): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.freight_json, o.freight_type, o.total_cents,
        o.deduct_freight_from_credit, o.product_credit_debit_cents, o.freight_credit_debit_cents, o.quotation_id,
        o.omie_sales_order_id, o.omie_service_order_id, o.omie_billing_status, o.omie_billing_message,
        o.omie_billed_at, o.omie_document_url,
        o.cancel_reason, o.created_at, o.updated_at,
        c.id AS customer_id,
        COALESCE(c.trade_name, o.remote_customer_name) AS customer_name,
        COALESCE(v.plate, o.remote_plate) AS plate,
        COALESCE(d.name, o.remote_driver_name) AS driver_name,
        COALESCE(p.description, o.remote_product_description) AS product_description,
        o.product_id, o.vehicle_id, o.driver_id, o.carrier_id,
        o.payment_term_id, o.payment_method_id,
        crr.name AS carrier_name, pmd.name AS payment_method_name,
        o.device_id, dv.name AS device_name, dv.color AS device_color,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       LEFT JOIN carriers crr ON crr.id = o.carrier_id
       LEFT JOIN payment_methods pmd ON pmd.id = o.payment_method_id
       LEFT JOIN devices dv ON dv.id = o.device_id
       WHERE o.status = 'cancelled'
         AND o.deleted_at IS NULL
       ORDER BY o.updated_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function listClosedWeighingOperations(
  database: DesktopDatabase
): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.freight_json, o.freight_type, o.total_cents,
        o.deduct_freight_from_credit, o.product_credit_debit_cents, o.freight_credit_debit_cents, o.quotation_id,
        o.omie_sales_order_id, o.omie_service_order_id, o.omie_billing_status, o.omie_billing_message,
        o.omie_billed_at, o.omie_document_url,
        o.cancel_reason, o.created_at, o.updated_at,
        c.id AS customer_id,
        COALESCE(c.trade_name, o.remote_customer_name) AS customer_name,
        COALESCE(v.plate, o.remote_plate) AS plate,
        COALESCE(d.name, o.remote_driver_name) AS driver_name,
        COALESCE(p.description, o.remote_product_description) AS product_description,
        o.product_id, o.vehicle_id, o.driver_id, o.carrier_id,
        o.payment_term_id, o.payment_method_id,
        crr.name AS carrier_name, pmd.name AS payment_method_name,
        o.device_id, dv.name AS device_name, dv.color AS device_color,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       LEFT JOIN carriers crr ON crr.id = o.carrier_id
       LEFT JOIN payment_methods pmd ON pmd.id = o.payment_method_id
       LEFT JOIN devices dv ON dv.id = o.device_id
       WHERE o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
         AND o.deleted_at IS NULL
       ORDER BY o.updated_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function clearCanceledWeighingOperations(
  database: DesktopDatabase,
  now: Date = new Date()
): number {
  const timestamp = now.toISOString();
  const result = database
    .prepare(
      `UPDATE weighing_operations
       SET deleted_at = ?, updated_at = ?
       WHERE status = 'cancelled' AND deleted_at IS NULL`
    )
    .run(timestamp, timestamp);

  return result.changes;
}

/**
 * Limpa a lista de concluidas de uma vez (soft-delete), como ja existia para as
 * canceladas. Antes so dava para excluir uma a uma — limpar o historico de teste
 * de uma balanca significava dezenas de cliques.
 *
 * `untilDate` (ISO yyyy-mm-dd, inclusive) limita a limpeza ao que foi criado ate
 * aquele dia: e o que permite preservar o movimento do dia corrente. Sem ela,
 * limpa todas as concluidas.
 *
 * Nao mexe no OMIE: pedido/OS ja enviado continua la e deve ser tratado no
 * proprio OMIE. Jobs OMIE ainda nao enviados sao neutralizados, como na exclusao
 * individual, para nao criar pedido de uma operacao que o operador excluiu.
 */
export function clearClosedWeighingOperations(
  database: DesktopDatabase,
  options: { untilDate?: string } = {},
  now: Date = new Date()
): number {
  const timestamp = now.toISOString();
  const untilDate = options.untilDate?.trim() || null;

  const selectSql = `SELECT id FROM weighing_operations
     WHERE status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
       AND deleted_at IS NULL
       ${untilDate ? "AND date(created_at) <= date(?)" : ""}`;
  const rows = (
    untilDate ? database.prepare(selectSql).all(untilDate) : database.prepare(selectSql).all()
  ) as Array<{ id: string }>;
  if (rows.length === 0) return 0;

  const markDeleted = database.prepare(
    "UPDATE weighing_operations SET deleted_at = ?, updated_at = ? WHERE id = ?"
  );
  const clear = database.transaction(() => {
    for (const row of rows) {
      markDeleted.run(timestamp, timestamp, row.id);
      cancelPendingOmieJobs(database, row.id, now);
    }
  });
  clear();

  return rows.length;
}

/**
 * Exclui (soft-delete) uma operacao ja concluida (qualquer status concluido: closed_local,
 * pending_cloud, pending_omie, synced ou sync_error). Nao remove nada no OMIE — o pedido/OS
 * de la, se ja enviado, deve ser tratado no proprio OMIE. Serve para limpar a lista local de
 * operacoes concluidas.
 */
export function deleteClosedWeighingOperation(
  database: DesktopDatabase,
  operationId: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare("SELECT status FROM weighing_operations WHERE id = ? AND deleted_at IS NULL")
    .get(operationId) as { status: OperationStatus } | undefined;
  if (!existing) {
    throw new Error("Operacao nao encontrada.");
  }
  if (!isClosedOperationStatus(existing.status)) {
    throw new Error("Apenas operacoes concluidas podem ser excluidas por aqui.");
  }
  const timestamp = now.toISOString();
  const removeOperation = database.transaction(() => {
    database
      .prepare("UPDATE weighing_operations SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, operationId);

    // Neutraliza jobs de criacao/faturamento OMIE ainda nao enviados. Sem isto, excluir uma
    // operacao fiscal antes de a fila drenar criava um pedido de venda / NF-e "fantasma" no
    // OMIE para uma operacao que o operador considera excluida (divergencia local<->nuvem).
    cancelPendingOmieJobs(database, operationId, now);
  });
  removeOperation();
}

export function getWeighingOperation(
  database: DesktopDatabase,
  operationId: string
): WeighingOperationSummary {
  const row = database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.freight_json, o.freight_type, o.total_cents,
        o.deduct_freight_from_credit, o.product_credit_debit_cents, o.freight_credit_debit_cents, o.quotation_id,
        o.omie_sales_order_id, o.omie_service_order_id, o.omie_billing_status, o.omie_billing_message,
        o.omie_billed_at, o.omie_document_url,
        o.cancel_reason, o.created_at, o.updated_at,
        c.id AS customer_id,
        COALESCE(c.trade_name, o.remote_customer_name) AS customer_name,
        COALESCE(v.plate, o.remote_plate) AS plate,
        COALESCE(d.name, o.remote_driver_name) AS driver_name,
        COALESCE(p.description, o.remote_product_description) AS product_description,
        o.product_id, o.vehicle_id, o.driver_id, o.carrier_id,
        o.payment_term_id, o.payment_method_id,
        crr.name AS carrier_name, pmd.name AS payment_method_name,
        o.device_id, dv.name AS device_name, dv.color AS device_color,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       LEFT JOIN carriers crr ON crr.id = o.carrier_id
       LEFT JOIN payment_methods pmd ON pmd.id = o.payment_method_id
       LEFT JOIN devices dv ON dv.id = o.device_id
       WHERE o.id = ?`
    )
    .get(operationId) as OperationRow | undefined;

  if (!row) {
    throw new Error(`Weighing operation ${operationId} was not found.`);
  }

  return mapOperationRow(row);
}

export interface UpdateWeighingOperationProductInput {
  operationId: string;
  newProductId: string;
}

export function updateWeighingOperationProduct(
  database: DesktopDatabase,
  input: UpdateWeighingOperationProductInput,
  now: Date = new Date()
): WeighingOperationSummary {
  const operation = getWeighingOperation(database, input.operationId);

  if (!isOpenOperationStatus(operation.status)) {
    throw new Error("Somente operacoes abertas podem ter o produto alterado.");
  }

  const product = database
    .prepare(
      `SELECT description, omie_product_id, item_type, fiscal_recommendations_json, is_active, blocked
       FROM products
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get(input.newProductId) as
    | {
        description: string;
        omie_product_id: number | null;
        item_type: string | null;
        fiscal_recommendations_json: string | null;
        is_active: number;
        blocked: number;
      }
    | undefined;

  if (!product) throw new Error("Produto selecionado nao foi encontrado.");
  if (product.is_active !== 1 || product.blocked === 1) {
    throw new Error("Produto inativo ou bloqueado nao pode ser selecionado.");
  }
  if (!isFinishedGoodsProduct(product)) {
    throw new Error("Somente produtos OMIE tipo 04 - produtos acabados podem ser selecionados.");
  }

  const customerId = database
    .prepare("SELECT customer_id FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(input.operationId) as string | undefined;

  if (!customerId) {
    throw new Error("Operacao sem cliente vinculado.");
  }

  const priceDetails = new PricingService(database).getPriceDetailsForCustomerProduct(
    customerId,
    input.newProductId
  );
  if (!priceDetails || priceDetails.appliedUnitPriceCents === null) {
    throw new Error(
      "Sem preco cadastrado para este cliente/produto. Cadastre um preco padrao no produto ou um preco especial no cliente."
    );
  }

  const timestamp = now.toISOString();

  const updateProduct = database.transaction(() => {
    database
      .prepare(
        `UPDATE weighing_operations
         SET product_id = ?, unit_price_cents = ?, base_unit_price_cents = ?,
             applied_price_table_id = NULL, applied_price_table_name = NULL,
             applied_price_table_item_id = NULL, price_savings_percent = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.newProductId,
        priceDetails.appliedUnitPriceCents,
        priceDetails.baseUnitPriceCents ?? null,
        priceDetails.savingsPercent ?? null,
        timestamp,
        input.operationId
      );

    database
      .prepare(
        `UPDATE loading_requests
         SET product_description = ?, updated_at = ?
         WHERE operation_id = ?`
      )
      .run(product.description, timestamp, input.operationId);

    insertAuditLog(
      database,
      null,
      input.operationId,
      "product_changed",
      { productId: operation.productDescription },
      {
        newProductId: input.newProductId,
        newProductDescription: product.description,
        unitPriceCents: priceDetails.appliedUnitPriceCents,
        priceDetails: serializePriceDetails(priceDetails)
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:product_changed`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const loadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (loadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: loadingRequest.id,
          idempotencyKey: `cloud:loading_request:${loadingRequest.id}:product_changed`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }
  });

  updateProduct();

  return getWeighingOperation(database, input.operationId);
}

export interface UpdateWeighingOperationCustomerInput {
  operationId: string;
  newCustomerId: string;
}

export function updateWeighingOperationCustomer(
  database: DesktopDatabase,
  input: UpdateWeighingOperationCustomerInput,
  now: Date = new Date()
): WeighingOperationSummary {
  const operation = getWeighingOperation(database, input.operationId);

  if (!isOpenOperationStatus(operation.status)) {
    throw new Error("Somente operacoes abertas podem ter o cliente alterado.");
  }

  const customer = database
    .prepare(
      "SELECT trade_name, is_active, omie_billing_blocked FROM customers WHERE id = ? AND deleted_at IS NULL"
    )
    .get(input.newCustomerId) as
    | { trade_name: string; is_active: number; omie_billing_blocked: number }
    | undefined;

  if (!customer) throw new Error("Cliente selecionado nao foi encontrado.");
  if (customer.is_active !== 1) throw new Error("Cliente inativo nao pode ser selecionado.");
  if (customer.omie_billing_blocked === 1) {
    throw new Error("Cliente bloqueado no OMIE nao pode ser selecionado.");
  }

  const financialBlock = new FinancialBlockService(database).canStartLoading(input.newCustomerId);
  if (!financialBlock.allowed) {
    throw new Error(financialBlock.message ?? "Cliente bloqueado por limite financeiro.");
  }

  const productId = database
    .prepare("SELECT product_id FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(input.operationId) as string | undefined;

  if (!productId) {
    throw new Error("Operacao sem produto vinculado.");
  }

  const priceDetails = new PricingService(database).getPriceDetailsForCustomerProduct(
    input.newCustomerId,
    productId
  );
  if (!priceDetails || priceDetails.appliedUnitPriceCents === null) {
    throw new Error(
      "Sem preco cadastrado para este cliente/produto. Cadastre um preco padrao no produto ou um preco especial no cliente."
    );
  }

  const timestamp = now.toISOString();

  const updateCustomer = database.transaction(() => {
    database
      .prepare(
        `UPDATE weighing_operations
         SET customer_id = ?, unit_price_cents = ?, base_unit_price_cents = ?,
             applied_price_table_id = NULL, applied_price_table_name = NULL,
             applied_price_table_item_id = NULL, price_savings_percent = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.newCustomerId,
        priceDetails.appliedUnitPriceCents,
        priceDetails.baseUnitPriceCents ?? null,
        priceDetails.savingsPercent ?? null,
        timestamp,
        input.operationId
      );

    database
      .prepare(
        `UPDATE loading_requests
         SET customer_name = ?, updated_at = ?
         WHERE operation_id = ?`
      )
      .run(customer.trade_name, timestamp, input.operationId);

    insertAuditLog(
      database,
      null,
      input.operationId,
      "customer_changed",
      { customerId: operation.customerId, customerName: operation.customerName },
      {
        newCustomerId: input.newCustomerId,
        newCustomerName: customer.trade_name,
        unitPriceCents: priceDetails.appliedUnitPriceCents,
        priceDetails: serializePriceDetails(priceDetails)
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:customer_changed`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const loadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (loadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: loadingRequest.id,
          idempotencyKey: `cloud:loading_request:${loadingRequest.id}:customer_changed`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }
  });

  updateCustomer();

  return getWeighingOperation(database, input.operationId);
}

export interface UpdateWeighingOperationCarrierInput {
  operationId: string;
  newCarrierId: string | null;
}

export function updateWeighingOperationCarrier(
  database: DesktopDatabase,
  input: UpdateWeighingOperationCarrierInput,
  now: Date = new Date()
): WeighingOperationSummary {
  const operation = getWeighingOperation(database, input.operationId);

  if (!isOpenOperationStatus(operation.status)) {
    throw new Error("Somente operacoes abertas podem ter a transportadora alterada.");
  }

  let carrierName: string | null = null;
  if (input.newCarrierId) {
    const carrier = database
      .prepare("SELECT name, is_active FROM carriers WHERE id = ? AND deleted_at IS NULL")
      .get(input.newCarrierId) as { name: string; is_active: number } | undefined;

    if (!carrier) throw new Error("Transportadora selecionada nao foi encontrada.");
    if (carrier.is_active !== 1) {
      throw new Error("Transportadora inativa nao pode ser selecionada.");
    }
    carrierName = carrier.name;
  }

  const previousCarrierId = database
    .prepare("SELECT carrier_id FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(input.operationId) as string | null | undefined;

  const timestamp = now.toISOString();

  const updateCarrier = database.transaction(() => {
    database
      .prepare(
        `UPDATE weighing_operations
         SET carrier_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.newCarrierId ?? null, timestamp, input.operationId);

    insertAuditLog(
      database,
      null,
      input.operationId,
      "carrier_changed",
      { carrierId: previousCarrierId ?? null },
      { newCarrierId: input.newCarrierId ?? null, newCarrierName: carrierName },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:carrier_changed`,
        payload: { operationId: input.operationId }
      },
      now
    );
  });

  updateCarrier();

  return getWeighingOperation(database, input.operationId);
}

/**
 * Edicao completa de uma operacao EM ANDAMENTO. Todo campo e opcional: o que nao vier no
 * input fica como esta (`undefined` = nao mexer). Campos que aceitam vazio — transportadora,
 * forma e condicao de pagamento — usam `null` explicito para limpar.
 *
 * Existe porque as alteracoes pontuais (produto/cliente/transportadora) nao cobriam o que a
 * balanca precisa corrigir depois que o caminhao ja entrou: preco do produto, valor e regra
 * de frete, placa, motorista, pagamento e ate o tipo de fechamento. Sem isso, um preco
 * digitado errado na entrada so tinha conserto cancelando a operacao e refazendo a pesagem.
 */
export interface UpdateWeighingOperationDetailsInput {
  operationId: string;
  customerId?: string;
  productId?: string;
  vehicleId?: string;
  driverId?: string;
  /** `null` remove a transportadora da operacao. */
  carrierId?: string | null;
  /** `null` remove a forma de pagamento. */
  paymentMethodId?: string | null;
  /** `null` remove a condicao (volta a "a vista"). */
  paymentTermId?: string | null;
  operationType?: OperationType;
  /** Preco do produto por tonelada, em centavos. Grava o valor digitado como preco aplicado. */
  unitPriceCents?: number;
  /** Frete da operacao; `null` remove o valor lancado (a operacao fica sem frete). */
  freight?: OperationFreightInput | null;
  freightModality?: FreightModality;
  deductFreightFromCredit?: boolean;
}

interface EditableOperationRow {
  unit_id: string;
  customer_id: string | null;
  product_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  carrier_id: string | null;
  payment_term_id: string | null;
  payment_method_id: string | null;
  operation_type: OperationType;
  unit_price_cents: number | null;
  base_unit_price_cents: number | null;
  deduct_freight_from_credit: number;
}

export function updateWeighingOperationDetails(
  database: DesktopDatabase,
  input: UpdateWeighingOperationDetailsInput,
  now: Date = new Date()
): WeighingOperationSummary {
  const before = getWeighingOperation(database, input.operationId);

  if (!isOpenOperationStatus(before.status)) {
    throw new Error("Somente operacoes em andamento podem ser editadas.");
  }

  const current = database
    .prepare(
      `SELECT unit_id, customer_id, product_id, vehicle_id, driver_id, carrier_id,
              payment_term_id, payment_method_id, operation_type, unit_price_cents,
              base_unit_price_cents, deduct_freight_from_credit
       FROM weighing_operations
       WHERE id = ?`
    )
    .get(input.operationId) as EditableOperationRow | undefined;
  if (!current) throw new Error("Operacao nao encontrada.");

  const customerId = input.customerId ?? current.customer_id;
  const productId = input.productId ?? current.product_id;
  const vehicleId = input.vehicleId ?? current.vehicle_id;
  const driverId = input.driverId ?? current.driver_id;
  const carrierId = input.carrierId !== undefined ? input.carrierId : current.carrier_id;
  const paymentMethodId =
    input.paymentMethodId !== undefined ? input.paymentMethodId : current.payment_method_id;
  const paymentTermId =
    input.paymentTermId !== undefined ? input.paymentTermId : current.payment_term_id;
  const operationType = input.operationType ?? current.operation_type;
  validateOperationType(operationType);

  if (!customerId) throw new Error("Operacao sem cliente vinculado.");
  if (!productId) throw new Error("Operacao sem produto vinculado.");
  if (!vehicleId) throw new Error("Operacao sem placa vinculada.");
  if (!driverId) throw new Error("Operacao sem motorista vinculado.");

  const customer = database
    .prepare(
      "SELECT trade_name, is_active, omie_billing_blocked FROM customers WHERE id = ? AND deleted_at IS NULL"
    )
    .get(customerId) as
    | { trade_name: string; is_active: number; omie_billing_blocked: number }
    | undefined;
  if (!customer) throw new Error("Cliente selecionado nao foi encontrado.");
  if (customer.is_active !== 1) throw new Error("Cliente inativo nao pode ser selecionado.");
  if (customer.omie_billing_blocked === 1) {
    throw new Error("Cliente bloqueado no OMIE nao pode ser selecionado.");
  }
  // O limite financeiro so e reavaliado quando o cliente muda: a operacao ja esta em curso e
  // travar uma correcao de preco por causa do limite de quem ja entrou nao ajudaria ninguem.
  if (customerId !== current.customer_id) {
    const financialBlock = new FinancialBlockService(database).canStartLoading(customerId);
    if (!financialBlock.allowed) {
      throw new Error(financialBlock.message ?? "Cliente bloqueado por limite financeiro.");
    }
  }

  const product = database
    .prepare(
      `SELECT description, omie_product_id, item_type, fiscal_recommendations_json, is_active, blocked
       FROM products
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get(productId) as
    | {
        description: string;
        omie_product_id: number | null;
        item_type: string | null;
        fiscal_recommendations_json: string | null;
        is_active: number;
        blocked: number;
      }
    | undefined;
  if (!product) throw new Error("Produto selecionado nao foi encontrado.");
  if (product.is_active !== 1 || product.blocked === 1) {
    throw new Error("Produto inativo ou bloqueado nao pode ser selecionado.");
  }
  if (!isFinishedGoodsProduct(product)) {
    throw new Error("Somente produtos OMIE tipo 04 - produtos acabados podem ser selecionados.");
  }

  const vehicle = database
    .prepare("SELECT plate FROM vehicles WHERE id = ? AND deleted_at IS NULL")
    .get(vehicleId) as { plate: string } | undefined;
  if (!vehicle) throw new Error("Placa selecionada nao foi encontrada.");
  if (vehicleId !== current.vehicle_id) {
    // Mesma trava da entrada: duas operacoes abertas para a mesma placa se confundem no
    // patio e no fechamento.
    const duplicate = database
      .prepare(
        `SELECT id FROM weighing_operations
         WHERE unit_id = ? AND vehicle_id = ? AND id <> ?
           AND status IN ('draft', 'entry_registered', 'loading_requested', 'awaiting_exit')
           AND deleted_at IS NULL
         LIMIT 1`
      )
      .get(current.unit_id, vehicleId, input.operationId) as { id: string } | undefined;
    if (duplicate) {
      throw new Error(`Ja existe uma operacao aberta para a placa ${vehicle.plate}.`);
    }
  }

  const driver = database
    .prepare("SELECT name FROM drivers WHERE id = ? AND deleted_at IS NULL")
    .get(driverId) as { name: string } | undefined;
  if (!driver) throw new Error("Motorista selecionado nao foi encontrado.");

  if (carrierId) {
    const carrier = database
      .prepare("SELECT is_active FROM carriers WHERE id = ? AND deleted_at IS NULL")
      .get(carrierId) as { is_active: number } | undefined;
    if (!carrier) throw new Error("Transportadora selecionada nao foi encontrada.");
    if (carrier.is_active !== 1) {
      throw new Error("Transportadora inativa nao pode ser selecionada.");
    }
  }

  if (paymentMethodId) {
    const paymentMethod = database
      .prepare("SELECT is_active FROM payment_methods WHERE id = ? AND deleted_at IS NULL")
      .get(paymentMethodId) as { is_active: number } | undefined;
    if (!paymentMethod) throw new Error("Forma de pagamento selecionada nao foi encontrada.");
    if (paymentMethod.is_active !== 1) {
      throw new Error("Forma de pagamento inativa nao pode ser usada na operacao.");
    }
  }

  if (paymentTermId) {
    const paymentTerm = database
      .prepare("SELECT id FROM payment_terms WHERE id = ? AND deleted_at IS NULL")
      .get(paymentTermId) as { id: string } | undefined;
    if (!paymentTerm) throw new Error("Condicao de pagamento selecionada nao foi encontrada.");
  }

  // Condicao informada na edicao apaga o parcelamento manual da entrada: ele tem
  // precedencia sobre a condicao na exibicao (cupom, lista, relatorio do cliente), entao
  // deixa-lo gravado faria a nova condicao "nao pegar" na tela.
  const clearManualInstallments = input.paymentTermId !== undefined;

  // Preco: o digitado manda; sem preco digitado, trocar cliente/produto re-precifica pela
  // tabela (mesma regra das alteracoes pontuais); sem nenhum dos dois, o preco fica intacto.
  const catalogChanged = customerId !== current.customer_id || productId !== current.product_id;
  let unitPriceCents = current.unit_price_cents;
  let baseUnitPriceCents = current.base_unit_price_cents;
  let savingsPercent = before.priceSavingsPercent;
  let repriced = false;

  if (input.unitPriceCents !== undefined) {
    if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) {
      throw new Error("Preco do produto invalido.");
    }
    const priceDetails = new PricingService(database).getPriceDetailsForCustomerProduct(
      customerId,
      productId
    );
    unitPriceCents = input.unitPriceCents;
    baseUnitPriceCents =
      priceDetails?.baseUnitPriceCents ?? (catalogChanged ? null : baseUnitPriceCents);
    savingsPercent = calculateSavingsPercent(baseUnitPriceCents, unitPriceCents);
    repriced = true;
  } else if (catalogChanged) {
    const priceDetails = new PricingService(database).getPriceDetailsForCustomerProduct(
      customerId,
      productId
    );
    if (!priceDetails || priceDetails.appliedUnitPriceCents === null) {
      throw new Error(
        "Sem preco cadastrado para este cliente/produto. Cadastre um preco padrao no produto ou um preco especial no cliente."
      );
    }
    unitPriceCents = priceDetails.appliedUnitPriceCents;
    baseUnitPriceCents = priceDetails.baseUnitPriceCents ?? null;
    savingsPercent = priceDetails.savingsPercent ?? null;
    repriced = true;
  }

  // Frete: `undefined` mantem o que esta gravado; `null` limpa. O valor total continua sendo
  // calculado no fechamento (depende do peso liquido), entao aqui so a regra e persistida.
  const freightProvided = input.freight !== undefined;
  const freightJson = freightProvided
    ? serializeOperationFreight(input.freight)
    : before.freightJson;
  const freightModality = getFreightModalityInfo(
    input.freightModality ?? before.freightModality
  ).key;
  const deductFreightFromCredit =
    input.deductFreightFromCredit !== undefined
      ? input.deductFreightFromCredit
      : current.deduct_freight_from_credit === 1;

  const timestamp = now.toISOString();

  const updateOperation = database.transaction(() => {
    database
      .prepare(
        `UPDATE weighing_operations
         SET customer_id = ?, product_id = ?, vehicle_id = ?, driver_id = ?, carrier_id = ?,
             payment_term_id = ?, payment_method_id = ?, operation_type = ?,
             unit_price_cents = ?, base_unit_price_cents = ?, price_savings_percent = ?,
             applied_price_table_id = CASE WHEN ? = 1 THEN NULL ELSE applied_price_table_id END,
             applied_price_table_name = CASE WHEN ? = 1 THEN NULL ELSE applied_price_table_name END,
             applied_price_table_item_id = CASE WHEN ? = 1 THEN NULL ELSE applied_price_table_item_id END,
             manual_installments = CASE WHEN ? = 1 THEN NULL ELSE manual_installments END,
             manual_down_payment_cents = CASE WHEN ? = 1 THEN NULL ELSE manual_down_payment_cents END,
             freight_json = ?, freight_type = ?, deduct_freight_from_credit = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        customerId,
        productId,
        vehicleId,
        driverId,
        carrierId ?? null,
        paymentTermId ?? null,
        paymentMethodId ?? null,
        operationType,
        unitPriceCents,
        baseUnitPriceCents,
        savingsPercent,
        repriced ? 1 : 0,
        repriced ? 1 : 0,
        repriced ? 1 : 0,
        clearManualInstallments ? 1 : 0,
        clearManualInstallments ? 1 : 0,
        freightJson,
        freightModality,
        deductFreightFromCredit ? 1 : 0,
        timestamp,
        input.operationId
      );

    // A solicitacao de carga e o que o carregador ve no loader-web: sem espelhar os novos
    // dados, ele continuaria carregando o material/placa antigos.
    database
      .prepare(
        `UPDATE loading_requests
         SET plate = ?, customer_name = ?, driver_name = ?, product_description = ?, updated_at = ?
         WHERE operation_id = ?`
      )
      .run(
        vehicle.plate,
        customer.trade_name,
        driver.name,
        product.description,
        timestamp,
        input.operationId
      );

    insertAuditLog(
      database,
      null,
      input.operationId,
      "operation_updated",
      {
        customerId: current.customer_id,
        productId: current.product_id,
        vehicleId: current.vehicle_id,
        driverId: current.driver_id,
        carrierId: current.carrier_id,
        paymentTermId: current.payment_term_id,
        paymentMethodId: current.payment_method_id,
        operationType: current.operation_type,
        unitPriceCents: current.unit_price_cents,
        freightJson: before.freightJson,
        freightModality: before.freightModality,
        deductFreightFromCredit: current.deduct_freight_from_credit === 1
      },
      {
        customerId,
        customerName: customer.trade_name,
        productId,
        productDescription: product.description,
        vehicleId,
        plate: vehicle.plate,
        driverId,
        driverName: driver.name,
        carrierId: carrierId ?? null,
        paymentTermId: paymentTermId ?? null,
        paymentMethodId: paymentMethodId ?? null,
        operationType,
        unitPriceCents,
        freightJson,
        freightModality,
        deductFreightFromCredit
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:updated:${timestamp}`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const loadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (loadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: loadingRequest.id,
          idempotencyKey: `cloud:loading_request:${loadingRequest.id}:updated:${timestamp}`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }
  });

  updateOperation();

  return getWeighingOperation(database, input.operationId);
}

function calculateNetWeightKg(entryWeightKg: number, exitWeightKg: number): number {
  if (exitWeightKg <= entryWeightKg) {
    throw new Error("Exit weight must be greater than entry weight.");
  }

  return Math.round((exitWeightKg - entryWeightKg) * 1000) / 1000;
}

function calculateProductTotalCents(
  netWeightKg: number,
  unitPriceCents: number | null
): number | null {
  return unitPriceCents === null ? null : Math.round((netWeightKg / 1000) * unitPriceCents);
}

function serializeOperationFreight(
  freight: OperationFreightInput | null | undefined
): string | null {
  if (!freight) return null;
  if (!freight.payer) throw new Error("Responsavel pelo frete e obrigatorio.");
  if (!freight.rule?.type) throw new Error("Regra de frete invalida.");
  if (freight.rule.baseValueCents < 0) throw new Error("Valor de frete nao pode ser negativo.");
  return JSON.stringify({
    payer: freight.payer,
    rule: freight.rule,
    destination: freight.destination?.trim() || null
  });
}

function calculateFreightTotalCents(freightJson: string | null, netWeightKg: number): number {
  if (!freightJson) return 0;
  try {
    const freight = JSON.parse(freightJson) as { rule?: FreightRule };
    if (!freight.rule) return 0;
    return new FreightCalculator().calculate(netWeightKg, freight.rule);
  } catch (error) {
    throw new Error(
      `Nao foi possivel calcular o frete: ${error instanceof Error ? error.message : "regra invalida"}.`
    );
  }
}

function insertAuditLog(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity | null,
  operationId: string,
  action: string,
  before: unknown,
  after: unknown,
  createdAt: string
): void {
  database
    .prepare(
      `INSERT INTO audit_logs (id, company_id, unit_id, device_id, entity_type, entity_id, action, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, 'weighing_operation', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      identity?.companyId ?? null,
      identity?.unitId ?? null,
      identity?.deviceId ?? null,
      operationId,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      createdAt
    );
}

function mapOperationRow(row: OperationRow): WeighingOperationSummary {
  return {
    id: row.id,
    status: row.status,
    operationType: row.operation_type,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name ?? "",
    plate: row.plate ?? "",
    driverName: row.driver_name ?? "",
    productDescription: row.product_description ?? "",
    productId: row.product_id ?? null,
    vehicleId: row.vehicle_id ?? null,
    driverId: row.driver_id ?? null,
    carrierId: row.carrier_id ?? null,
    carrierName: row.carrier_name ?? null,
    paymentTermId: row.payment_term_id ?? null,
    paymentMethodId: row.payment_method_id ?? null,
    paymentMethodName: row.payment_method_name ?? null,
    paymentTermName: row.payment_term_name,
    entryWeightKg: row.entry_weight_kg,
    exitWeightKg: row.exit_weight_kg,
    netWeightKg: row.net_weight_kg,
    unitPriceCents: row.unit_price_cents,
    baseUnitPriceCents: row.base_unit_price_cents,
    appliedPriceTableId: row.applied_price_table_id,
    appliedPriceTableName: row.applied_price_table_name,
    appliedPriceTableItemId: row.applied_price_table_item_id,
    priceUnit: row.price_unit,
    priceSavingsPercent: row.price_savings_percent,
    productTotalCents: row.product_total_cents,
    freightTotalCents: row.freight_total_cents,
    freightJson: row.freight_json,
    freightModality: getFreightModalityInfo(row.freight_type).key,
    totalCents: row.total_cents,
    deductFreightFromCredit: row.deduct_freight_from_credit === 1,
    productCreditDebitCents: row.product_credit_debit_cents ?? 0,
    freightCreditDebitCents: row.freight_credit_debit_cents ?? 0,
    quotationId: row.quotation_id,
    omieSalesOrderId: row.omie_sales_order_id,
    omieServiceOrderId: row.omie_service_order_id ?? null,
    omieBillingStatus: row.omie_billing_status,
    omieBillingMessage: row.omie_billing_message,
    omieBilledAt: row.omie_billed_at,
    omieDocumentUrl: row.omie_document_url,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deviceId: row.device_id ?? null,
    deviceName: row.device_name ?? null,
    deviceColor: row.device_color ?? null,
    loaderCompletedAt: row.loader_completed_at ?? null
  };
}

function validateRequired(fieldName: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
}

function validateOperationType(operationType: string): asserts operationType is OperationType {
  if (operationType !== "invoice" && operationType !== "internal") {
    throw new Error("Operation type must be invoice or internal.");
  }
}

function validateUnitPrice(unitPriceCents: number | undefined): void {
  if (unitPriceCents !== undefined && unitPriceCents < 0) {
    throw new Error("Unit price cannot be negative.");
  }
}

function serializePriceDetails(priceDetails: PriceDetails | null): PriceDetails | null {
  return priceDetails;
}

function normalizePlate(plate: string): string {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isFinishedGoodsProduct(product: {
  omie_product_id: number | null;
  item_type: string | null;
  fiscal_recommendations_json: string | null;
}): boolean {
  if (product.omie_product_id === null) return false;
  const candidates = [
    product.item_type,
    ...extractFiscalRecommendationValues(product.fiscal_recommendations_json)
  ];
  return candidates.some((value) => matchesFinishedGoodsType(value));
}

function extractFiscalRecommendationValues(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const values: string[] = [];
    collectFiscalRecommendationValues(parsed, values);
    return values;
  } catch {
    return [];
  }
}

function collectFiscalRecommendationValues(value: unknown, output: string[]): void {
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiscalRecommendationValues(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeFiscalTypeText(key);
      if (
        normalizedKey.includes("tipo") &&
        (normalizedKey.includes("produto") || normalizedKey.includes("item"))
      ) {
        collectFiscalRecommendationValues(nested, output);
      }
      if (normalizedKey === "codigo" || normalizedKey === "cod" || normalizedKey === "code") {
        collectFiscalRecommendationValues(nested, output);
      }
    }
  }
}

function matchesFinishedGoodsType(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeFiscalTypeText(value);
  return (
    normalized === "04" ||
    normalized.startsWith("04 ") ||
    normalized.includes("produtos acabados") ||
    normalized.includes("produto acabado")
  );
}

function normalizeFiscalTypeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_/.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
