/**
 * Operacoes de pesagem ficticias (abertas, concluidas e canceladas) usadas nas
 * capturas de tela. Os pesos, precos e horarios sao inventados.
 */
import {
  CARRIERS,
  CUSTOMERS,
  DRIVERS,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  PRODUCTS,
  VEHICLES,
  daysAgo,
  iso,
  minutesAgo
} from "./demo-data";

export interface DemoOperation {
  id: string;
  operationCode: number | null;
  status: string;
  operationType: "invoice" | "internal";
  customerId: string | null;
  customerName: string;
  customerDocument: string | null;
  plate: string;
  driverName: string;
  productDescription: string;
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
  freightModality: string;
  totalCents: number | null;
  deductFreightFromCredit: boolean;
  productCreditDebitCents: number;
  freightCreditDebitCents: number;
  quotationId: string | null;
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
  omieBillingStatus: string | null;
  omieBillingMessage: string | null;
  omieBilledAt: string | null;
  omieDocumentUrl: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  deviceId: string | null;
  deviceName: string | null;
  deviceColor: string | null;
  loaderCompletedAt?: string | null;
}

const DEVICES = [
  { id: "dev_balanca_01", name: "Balanca 01", color: "#2563eb" },
  { id: "dev_balanca_02", name: "Balanca 02", color: "#16a34a" }
];

function customer(index: number) {
  return CUSTOMERS[index % CUSTOMERS.length];
}

function product(index: number) {
  return PRODUCTS[index % PRODUCTS.length];
}

function vehicle(index: number) {
  return VEHICLES[index % VEHICLES.length];
}

function driver(index: number) {
  return DRIVERS[index % DRIVERS.length];
}

function carrier(id: string | null) {
  return CARRIERS.find((row) => row.id === id) ?? null;
}

interface BuildInput {
  code: number;
  status: string;
  customerIndex: number;
  productIndex: number;
  vehicleIndex: number;
  driverIndex: number;
  tare: number;
  gross: number | null;
  minutesAgoCreated: number;
  minutesAgoUpdated?: number;
  deviceIndex?: number;
  operationType?: "invoice" | "internal";
  paymentMethodIndex?: number;
  paymentTermIndex?: number;
  freightCents?: number;
  omieSalesOrderId?: number | null;
  omieBillingStatus?: string | null;
  omieBillingMessage?: string | null;
  cancelReason?: string | null;
  loaderCompletedMinutesAgo?: number | null;
  priceTableIndex?: number | null;
  createdAtDate?: Date;
  updatedAtDate?: Date;
}

const PRICE_TABLES = [
  { id: "ptb_001", name: "Tabela padrao 2026" },
  { id: "ptb_002", name: "Grandes volumes (acima de 500 t/mes)" }
];

export function buildOperation(input: BuildInput): DemoOperation {
  const cus = customer(input.customerIndex);
  const prd = product(input.productIndex);
  const veh = vehicle(input.vehicleIndex);
  const drv = driver(input.driverIndex);
  const car = carrier(veh.carrierId);
  const net = input.gross === null ? null : input.gross - input.tare;
  const unitPrice = prd.unitPriceCents;
  const productTotal = net === null ? null : Math.round((net / 1000) * unitPrice);
  const freight = input.freightCents ?? 0;
  const device = DEVICES[input.deviceIndex ?? 0];
  const method = PAYMENT_METHODS[input.paymentMethodIndex ?? 2];
  const term = PAYMENT_TERMS[input.paymentTermIndex ?? 4];
  const table =
    input.priceTableIndex === null || input.priceTableIndex === undefined
      ? null
      : PRICE_TABLES[input.priceTableIndex];
  const createdAt = input.createdAtDate ?? minutesAgo(input.minutesAgoCreated);
  const updatedAt =
    input.updatedAtDate ?? minutesAgo(input.minutesAgoUpdated ?? input.minutesAgoCreated);

  return {
    id: `op_${String(input.code).padStart(6, "0")}`,
    operationCode: input.code,
    status: input.status,
    operationType: input.operationType ?? "invoice",
    customerId: cus.id,
    customerName: cus.tradeName,
    customerDocument: cus.document,
    plate: veh.plate,
    driverName: drv.name,
    productDescription: prd.description,
    productId: prd.id,
    vehicleId: veh.id,
    driverId: drv.id,
    carrierId: car?.id ?? null,
    carrierName: car?.name ?? null,
    paymentTermId: term.id,
    paymentMethodId: method.id,
    paymentMethodName: method.name,
    paymentTermName: term.name,
    entryWeightKg: input.tare,
    exitWeightKg: input.gross,
    netWeightKg: net,
    unitPriceCents: unitPrice,
    baseUnitPriceCents: table ? Math.round(unitPrice * 1.08) : unitPrice,
    appliedPriceTableId: table?.id ?? null,
    appliedPriceTableName: table?.name ?? null,
    appliedPriceTableItemId: table ? `pti_${input.code}` : null,
    priceUnit: "ton",
    priceSavingsPercent: table ? 7.4 : null,
    productTotalCents: productTotal,
    freightTotalCents: freight,
    freightJson: freight
      ? JSON.stringify({ calculationType: "per_ton", baseValueCents: 1_250, payer: "customer" })
      : null,
    freightModality: freight ? "fob" : "third_party",
    totalCents: productTotal === null ? null : productTotal + freight,
    deductFreightFromCredit: false,
    productCreditDebitCents: 0,
    freightCreditDebitCents: 0,
    quotationId: null,
    omieSalesOrderId: input.omieSalesOrderId ?? null,
    omieServiceOrderId: null,
    omieBillingStatus: input.omieBillingStatus ?? null,
    omieBillingMessage: input.omieBillingMessage ?? null,
    omieBilledAt:
      input.omieBillingStatus === "billed" ? iso(minutesAgo(input.minutesAgoCreated - 2)) : null,
    omieDocumentUrl: null,
    cancelReason: input.cancelReason ?? null,
    createdAt: iso(createdAt),
    updatedAt: iso(updatedAt),
    deviceId: device.id,
    deviceName: device.name,
    deviceColor: device.color,
    loaderCompletedAt:
      input.loaderCompletedMinutesAgo === null || input.loaderCompletedMinutesAgo === undefined
        ? null
        : iso(minutesAgo(input.loaderCompletedMinutesAgo))
  };
}

export const OPEN_OPERATIONS: DemoOperation[] = [
  buildOperation({
    code: 4821,
    status: "awaiting_exit",
    customerIndex: 1,
    productIndex: 1,
    vehicleIndex: 2,
    driverIndex: 2,
    tare: 18_640,
    gross: null,
    minutesAgoCreated: 8,
    loaderCompletedMinutesAgo: 3,
    freightCents: 41_200,
    priceTableIndex: 1
  }),
  buildOperation({
    code: 4822,
    status: "loading_requested",
    customerIndex: 3,
    productIndex: 3,
    vehicleIndex: 0,
    driverIndex: 0,
    tare: 13_180,
    gross: null,
    minutesAgoCreated: 16,
    deviceIndex: 1
  }),
  buildOperation({
    code: 4823,
    status: "entry_registered",
    customerIndex: 0,
    productIndex: 0,
    vehicleIndex: 4,
    driverIndex: 4,
    tare: 21_020,
    gross: null,
    minutesAgoCreated: 27,
    freightCents: 38_500
  }),
  buildOperation({
    code: 4824,
    status: "loading_requested",
    customerIndex: 7,
    productIndex: 5,
    vehicleIndex: 3,
    driverIndex: 3,
    tare: 11_460,
    gross: null,
    minutesAgoCreated: 41,
    deviceIndex: 1,
    loaderCompletedMinutesAgo: 9
  }),
  buildOperation({
    code: 4825,
    status: "awaiting_exit",
    customerIndex: 6,
    productIndex: 2,
    vehicleIndex: 6,
    driverIndex: 5,
    tare: 19_880,
    gross: null,
    minutesAgoCreated: 63,
    operationType: "internal",
    paymentMethodIndex: 5
  }),
  buildOperation({
    code: 4826,
    status: "entry_registered",
    customerIndex: 2,
    productIndex: 6,
    vehicleIndex: 5,
    driverIndex: 1,
    tare: 16_740,
    gross: null,
    minutesAgoCreated: 127,
    paymentMethodIndex: 4
  })
];

const CLOSED_SPECS: Array<Partial<BuildInput> & { code: number }> = [
  {
    code: 4820,
    customerIndex: 1,
    productIndex: 1,
    vehicleIndex: 2,
    driverIndex: 2,
    tare: 18_540,
    gross: 46_820,
    minutesAgoCreated: 128,
    omieSalesOrderId: 302118,
    omieBillingStatus: "billed",
    freightCents: 44_800,
    priceTableIndex: 1
  },
  {
    code: 4819,
    customerIndex: 0,
    productIndex: 0,
    vehicleIndex: 0,
    driverIndex: 0,
    tare: 13_220,
    gross: 32_960,
    minutesAgoCreated: 152,
    omieSalesOrderId: 302117,
    omieBillingStatus: "billed"
  },
  {
    code: 4818,
    customerIndex: 4,
    productIndex: 3,
    vehicleIndex: 3,
    driverIndex: 3,
    tare: 11_380,
    gross: 27_540,
    minutesAgoCreated: 177,
    omieSalesOrderId: 302116,
    omieBillingStatus: "billed",
    freightCents: 21_900
  },
  {
    code: 4817,
    customerIndex: 7,
    productIndex: 2,
    vehicleIndex: 4,
    driverIndex: 4,
    tare: 21_140,
    gross: 58_420,
    minutesAgoCreated: 201,
    omieSalesOrderId: 302115,
    omieBillingStatus: "billed",
    deviceIndex: 1,
    priceTableIndex: 0
  },
  {
    code: 4816,
    customerIndex: 3,
    productIndex: 5,
    vehicleIndex: 5,
    driverIndex: 5,
    tare: 19_760,
    gross: 51_310,
    minutesAgoCreated: 238,
    omieSalesOrderId: null,
    omieBillingStatus: "pending",
    omieBillingMessage: "Aguardando envio ao OMIE (fila local)"
  },
  {
    code: 4815,
    customerIndex: 5,
    productIndex: 4,
    vehicleIndex: 6,
    driverIndex: 1,
    tare: 16_620,
    gross: 43_180,
    minutesAgoCreated: 264,
    omieSalesOrderId: 302113,
    omieBillingStatus: "billed",
    freightCents: 33_100
  },
  {
    code: 4814,
    customerIndex: 2,
    productIndex: 6,
    vehicleIndex: 1,
    driverIndex: 0,
    tare: 12_940,
    gross: 30_120,
    minutesAgoCreated: 289,
    omieSalesOrderId: null,
    omieBillingStatus: "error",
    omieBillingMessage: "Cliente sem inscricao estadual valida no cadastro do OMIE",
    deviceIndex: 1
  },
  {
    code: 4813,
    customerIndex: 6,
    productIndex: 1,
    vehicleIndex: 2,
    driverIndex: 2,
    tare: 18_480,
    gross: 47_960,
    minutesAgoCreated: 316,
    omieSalesOrderId: 302111,
    omieBillingStatus: "billed"
  },
  {
    code: 4812,
    customerIndex: 1,
    productIndex: 0,
    vehicleIndex: 0,
    driverIndex: 3,
    tare: 13_260,
    gross: 33_540,
    minutesAgoCreated: 344,
    omieSalesOrderId: 302110,
    omieBillingStatus: "billed",
    freightCents: 18_700
  },
  {
    code: 4811,
    customerIndex: 0,
    productIndex: 3,
    vehicleIndex: 3,
    driverIndex: 4,
    tare: 11_420,
    gross: 28_880,
    minutesAgoCreated: 372,
    operationType: "internal",
    paymentMethodIndex: 5,
    omieBillingStatus: null
  },
  {
    code: 4810,
    customerIndex: 4,
    productIndex: 2,
    vehicleIndex: 4,
    driverIndex: 5,
    tare: 21_080,
    gross: 57_640,
    minutesAgoCreated: 401,
    omieSalesOrderId: 302108,
    omieBillingStatus: "billed",
    priceTableIndex: 1
  },
  {
    code: 4809,
    customerIndex: 7,
    productIndex: 5,
    vehicleIndex: 5,
    driverIndex: 0,
    tare: 19_820,
    gross: 52_470,
    minutesAgoCreated: 433,
    omieSalesOrderId: 302107,
    omieBillingStatus: "billed",
    freightCents: 39_600,
    deviceIndex: 1
  },
  {
    code: 4808,
    customerIndex: 5,
    productIndex: 4,
    vehicleIndex: 6,
    driverIndex: 1,
    tare: 16_580,
    gross: 41_920,
    minutesAgoCreated: 462,
    omieSalesOrderId: 302106,
    omieBillingStatus: "billed"
  },
  {
    code: 4807,
    customerIndex: 3,
    productIndex: 6,
    vehicleIndex: 1,
    driverIndex: 2,
    tare: 12_880,
    gross: 31_460,
    minutesAgoCreated: 488,
    omieSalesOrderId: 302105,
    omieBillingStatus: "billed",
    paymentMethodIndex: 5
  }
];

export const CLOSED_OPERATIONS: DemoOperation[] = CLOSED_SPECS.map((spec) =>
  buildOperation({
    status:
      spec.omieBillingStatus === "billed"
        ? "synced"
        : spec.omieBillingStatus === "error"
          ? "sync_error"
          : "pending_omie",
    customerIndex: 0,
    productIndex: 0,
    vehicleIndex: 0,
    driverIndex: 0,
    tare: 0,
    gross: 0,
    minutesAgoCreated: 0,
    ...spec
  } as BuildInput)
);

export const CANCELED_OPERATIONS: DemoOperation[] = [
  buildOperation({
    code: 4806,
    status: "cancelled",
    customerIndex: 2,
    productIndex: 2,
    vehicleIndex: 3,
    driverIndex: 3,
    tare: 11_400,
    gross: null,
    minutesAgoCreated: 512,
    cancelReason: "Caminhao saiu da fila sem carregar"
  }),
  buildOperation({
    code: 4805,
    status: "cancelled",
    customerIndex: 5,
    productIndex: 4,
    vehicleIndex: 1,
    driverIndex: 1,
    tare: 12_900,
    gross: 30_260,
    minutesAgoCreated: 596,
    cancelReason: "Produto trocado apos o carregamento - refeita na 4812"
  }),
  buildOperation({
    code: 4804,
    status: "cancelled",
    customerIndex: 6,
    productIndex: 0,
    vehicleIndex: 6,
    driverIndex: 5,
    tare: 16_500,
    gross: null,
    minutesAgoCreated: 731,
    deviceIndex: 1,
    cancelReason: "Pedido cancelado pelo cliente"
  })
];

/** Serie de dias usada pelos graficos e relatorios. */
export const DAILY_SERIES = Array.from({ length: 30 }, (_, index) => {
  const date = daysAgo(29 - index);
  const weekday = date.getDay();
  const weekend = weekday === 0 ? 0 : weekday === 6 ? 0.35 : 1;
  const wave = 1 + Math.sin(index / 3.1) * 0.18 + Math.cos(index / 5.7) * 0.11;
  const operations = Math.max(0, Math.round(34 * weekend * wave));
  const weight = Math.round(operations * 27_400 * (0.94 + (index % 5) * 0.03));
  const cents = Math.round((weight / 1000) * 8_640 * 100) / 100;
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    totalOperations: operations,
    totalNetWeightKg: weight,
    totalCents: Math.round(cents)
  };
});
