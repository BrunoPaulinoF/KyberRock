/**
 * Implementacao ficticia da API do preload (`window.kyberrockDesktop`) usada apenas
 * pelo harness de capturas de tela. Nada aqui toca banco, balanca, nuvem ou OMIE:
 * todo retorno e dado inventado, para documentar as telas sem expor dados reais.
 */
import {
  ACCOUNTS,
  CARRIERS,
  CUSTOMERS,
  DRIVERS,
  NOW,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  PRICE_TABLES,
  PRODUCTS,
  UNIT,
  VEHICLES,
  dayIso,
  daysAgo,
  daysAhead,
  iso,
  minutesAgo,
  seeded
} from "./demo-data";
import {
  CANCELED_OPERATIONS,
  CLOSED_OPERATIONS,
  DAILY_SERIES,
  OPEN_OPERATIONS
} from "./demo-operations";

type AnyRecord = Record<string, unknown>;

function delay<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function matches(search: string | undefined, ...fields: Array<string | null | undefined>): boolean {
  if (!search || !search.trim()) return true;
  const needle = search.trim().toLowerCase();
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

const CUSTOMER_ROWS = CUSTOMERS.map((customer, index) => ({
  id: customer.id,
  omieCustomerId: customer.omieCustomerId,
  legalName: customer.legalName,
  tradeName: customer.tradeName,
  document: customer.document,
  phone: customer.phone,
  email: customer.email,
  fiscalEmails: customer.email,
  creditLimitCents: customer.creditLimitCents,
  creditMode: customer.creditMode,
  openReceivablesCents: customer.openReceivablesCents,
  omieBillingBlocked: false,
  source: index % 4 === 3 ? ("local" as const) : ("omie" as const),
  syncStatus: index % 7 === 5 ? ("pending" as const) : ("synced" as const),
  needsPush: index % 7 === 5,
  lastSyncedAt: iso(minutesAgo(35 + index * 7)),
  observations: index === 2 ? "Carregamento apenas ate as 16h (portaria da obra)." : null,
  defaultCarrierId: CARRIERS[index % CARRIERS.length].id,
  defaultPaymentTermId: PAYMENT_TERMS[(index + 3) % PAYMENT_TERMS.length].id,
  defaultPaymentMethodId: PAYMENT_METHODS[(index + 1) % 4].id,
  creditAccountEnabled: index % 3 === 0,
  creditClosingDay: index % 3 === 0 ? 25 : null,
  creditBoletoDays: index % 3 === 0 ? 10 : null,
  nfRequired: true,
  creditPeriodicity: "monthly" as const,
  creditSecondClosingDay: null,
  creditSecondBoletoDays: null,
  creditClosingWeekday: null,
  zipcode: `3${index}550-${100 + index}`,
  addressStreet: [
    "Rodovia BR-040 km",
    "Avenida das Industrias",
    "Rua das Pedreiras",
    "Avenida Central"
  ][index % 4],
  addressNumber: String(120 + index * 37),
  addressComplement: index % 2 === 0 ? "Galpao 2" : null,
  neighborhood: ["Distrito Industrial", "Cinco", "Jardim das Acacias", "Centro"][index % 4],
  city: customer.city,
  state: customer.state,
  isActive: true
}));

const PRODUCT_ROWS = PRODUCTS.map((product) => ({
  id: product.id,
  omieProductId: product.omieProductId,
  code: product.code,
  description: product.description,
  unit: "TON",
  ncm: "25171000",
  ean: null,
  unitPriceCents: product.unitPriceCents,
  itemType: "00",
  fiscalRecommendationsJson: null,
  isActive: true
}));

const VEHICLE_ROWS = VEHICLES.map((vehicle) => ({
  id: vehicle.id,
  plate: vehicle.plate,
  plateState: "MG",
  description: vehicle.description,
  carrierId: vehicle.carrierId,
  isActive: true
}));

const DRIVER_ROWS = DRIVERS.map((driver) => ({
  id: driver.id,
  name: driver.name,
  document: driver.document,
  phone: driver.phone,
  isIndependent: driver.carrierId === null,
  isActive: true
}));

const CARRIER_ROWS = CARRIERS.map((carrier, index) => ({
  id: carrier.id,
  omieCustomerId: carrier.omieCustomerId,
  name: carrier.name,
  document: carrier.document,
  phone: carrier.phone,
  email: carrier.email,
  zipcode: `32${index}40-0${index}0`,
  addressStreet: "Avenida dos Transportadores",
  addressNumber: String(400 + index * 55),
  addressComplement: null,
  neighborhood: "Distrito Industrial",
  city: carrier.city,
  state: carrier.state,
  nfRequired: true,
  source: "omie" as const,
  syncStatus: "synced" as const,
  needsPush: false,
  lastSyncedAt: iso(minutesAgo(48 + index * 11)),
  isActive: true
}));

const PAYMENT_TERM_ROWS = PAYMENT_TERMS.map((term) => ({
  id: term.id,
  omieCode: term.omieCode,
  omieParcelaCode: term.omieCode,
  name: term.name,
  rulesJson: JSON.stringify({ installments: term.installmentCount }),
  installmentCount: term.installmentCount,
  isActive: true
}));

const PAYMENT_METHOD_ROWS = PAYMENT_METHODS.map((method) => ({
  id: method.id,
  code: method.code,
  name: method.name,
  alias: null,
  displayName: method.name,
  omieCode: method.omieCode,
  accountId: method.accountId,
  accountName: method.accountName,
  isSystem: method.isWallet || method.isCustomerCredit,
  isCustomerCredit: method.isCustomerCredit,
  isWallet: method.isWallet,
  sortOrder: method.sortOrder,
  isActive: true
}));

const ACCOUNT_ROWS = ACCOUNTS.map((account) => ({
  id: account.id,
  code: account.code,
  name: account.name,
  omieCode: account.omieCode,
  isSystem: account.isSystem,
  sortOrder: account.sortOrder,
  isActive: true
}));

const PRICE_TABLE_ROWS = PRICE_TABLES.map((table) => ({
  id: table.id,
  name: table.name,
  omieTableId: table.omieTableId,
  needsPush: false,
  lastSyncedAt: iso(minutesAgo(180)),
  isActive: true
}));

const PRICE_TABLE_ITEM_ROWS = PRICE_TABLES.flatMap((table, tableIndex) =>
  PRODUCTS.map((product, index) => ({
    id: `pti_${tableIndex}_${index}`,
    priceTableId: table.id,
    productId: product.id,
    unitPriceCents: Math.round(product.unitPriceCents * (1 - tableIndex * 0.06)),
    unit: "TON"
  }))
);

const CUSTOMER_PRICE_TABLE_ROWS = CUSTOMERS.slice(0, 4).map((customer, index) => ({
  id: `cpt_${index}`,
  customerId: customer.id,
  priceTableId: PRICE_TABLES[index % PRICE_TABLES.length].id
}));

const CACHE_ROWS: Record<string, AnyRecord[]> = {
  customer: CUSTOMER_ROWS,
  product: PRODUCT_ROWS,
  vehicle: VEHICLE_ROWS,
  driver: DRIVER_ROWS,
  carrier: CARRIER_ROWS,
  payment_term: PAYMENT_TERM_ROWS,
  payment_method: PAYMENT_METHOD_ROWS,
  account: ACCOUNT_ROWS,
  price_table: PRICE_TABLE_ROWS,
  price_table_item: PRICE_TABLE_ITEM_ROWS,
  customer_price_table: CUSTOMER_PRICE_TABLE_ROWS
};

const STATUS_SNAPSHOT = {
  internet: "online" as const,
  scale: "connected" as const,
  cloud: "online" as const,
  omie: "online" as const,
  pendingSyncJobs: 2,
  pendingOmieJobs: 1,
  pendingCloudJobs: 1,
  cloudLastRunAt: iso(minutesAgo(3)),
  cloudInitialized: true,
  cloudReachable: true,
  internetOnline: true,
  lastBackupAt: iso(minutesAgo(240)),
  databasePath: "C:\\KyberRock\\dados\\kyberrock.db",
  identity: {
    companyId: UNIT.companyId,
    unitId: UNIT.unitId,
    deviceId: UNIT.deviceId,
    companyName: UNIT.companyName,
    unitName: UNIT.unitName,
    deviceName: UNIT.deviceName
  },
  generatedAt: iso(NOW)
};

const ACCESS_STATUS = {
  status: "active",
  canOperate: true,
  requiresActivation: false,
  message: "Licenca ativa.",
  companyId: UNIT.companyId,
  companyName: UNIT.companyName,
  unitId: UNIT.unitId,
  unitName: UNIT.unitName,
  deviceId: UNIT.deviceId,
  lastSuccessfulCheckAt: iso(minutesAgo(6)),
  graceExpiresAt: null,
  lastError: null,
  checkedAt: iso(minutesAgo(6))
};

const RECEIPT_TEMPLATE_CONFIG = {
  headerTitle: "PEDREIRA NORTE - KM 42",
  headerSubtitle: "Mineracao Serra do Cedro LTDA",
  showDocument: true,
  showAddress: true,
  showPhone: true,
  fontFamily: "monospace",
  fontSizePt: 10,
  lineHeight: 1.25,
  showFreight: true,
  showUnitPrice: true,
  showTotals: true,
  footerMessage: "Obrigado pela preferencia!"
} as AnyRecord;

const PRINT_PROFILE = {
  id: "prf_receipt_01",
  deviceId: UNIT.deviceId,
  documentType: "receipt_80mm" as const,
  printerType: "windows" as const,
  windowsPrinterName: "EPSON TM-T20X Receipt",
  networkHost: null,
  networkPort: null,
  paperWidthMm: 80,
  copies: 2,
  cutPaper: true,
  receiptLogo: {
    dataUrl: null,
    widthMm: 24,
    heightMm: 16,
    fit: "contain" as const
  },
  templateConfig: RECEIPT_TEMPLATE_CONFIG,
  isActive: true,
  createdAt: iso(daysAgo(120)),
  updatedAt: iso(daysAgo(6))
};

const PRINT_RECEIPTS = CLOSED_OPERATIONS.slice(0, 10).map((operation, index) => ({
  id: `rct_${index}`,
  operationId: operation.id,
  unitId: UNIT.unitId,
  receiptNumber: 10_480 - index,
  deviceNumber: 1,
  copyNumber: 1,
  printerName: "EPSON TM-T20X Receipt",
  status: index === 3 ? "error" : "printed",
  errorMessage: index === 3 ? "Impressora sem papel" : null,
  printedAt: operation.updatedAt,
  createdAt: operation.updatedAt,
  updatedAt: operation.updatedAt
}));

const SCALE_READING = {
  weightKg: 46_820,
  unit: "kg" as const,
  status: "stable" as const,
  stable: true,
  capturedAt: iso(minutesAgo(0)),
  receivedAt: iso(minutesAgo(0)),
  rawFrame: "\u000246820kg\u0003",
  deviceId: UNIT.deviceId,
  adapterName: "toledo-tcp"
};

const OMIE_QUEUE = [
  {
    id: "job_0001",
    action: "create_sales_order",
    status: "pending",
    attemptCount: 0,
    lastError: null,
    nextAttemptAt: iso(minutesAgo(-2)),
    createdAt: iso(minutesAgo(9)),
    operationId: CLOSED_OPERATIONS[4].id,
    operationType: "invoice",
    operationStatus: "pending_omie",
    customerName: CLOSED_OPERATIONS[4].customerName,
    plate: CLOSED_OPERATIONS[4].plate,
    totalCents: CLOSED_OPERATIONS[4].totalCents,
    closedAt: CLOSED_OPERATIONS[4].updatedAt
  },
  {
    id: "job_0002",
    action: "create_sales_order",
    status: "failed",
    attemptCount: 3,
    lastError: "Cliente sem inscricao estadual valida no cadastro do OMIE",
    nextAttemptAt: iso(minutesAgo(-14)),
    createdAt: iso(minutesAgo(41)),
    operationId: CLOSED_OPERATIONS[6].id,
    operationType: "invoice",
    operationStatus: "sync_error",
    customerName: CLOSED_OPERATIONS[6].customerName,
    plate: CLOSED_OPERATIONS[6].plate,
    totalCents: CLOSED_OPERATIONS[6].totalCents,
    closedAt: CLOSED_OPERATIONS[6].updatedAt
  }
];

function totalsFor(operations: typeof CLOSED_OPERATIONS) {
  const netWeightKg = operations.reduce((sum, row) => sum + (row.netWeightKg ?? 0), 0);
  const productCents = operations.reduce((sum, row) => sum + (row.productTotalCents ?? 0), 0);
  const freightCents = operations.reduce((sum, row) => sum + row.freightTotalCents, 0);
  const totalCents = productCents + freightCents;
  const count = operations.length || 1;
  return {
    operations: operations.length,
    netWeightKg,
    productCents,
    freightCents,
    totalCents,
    avgPriceCentsPerTon: netWeightKg ? Math.round(productCents / (netWeightKg / 1000)) : 0,
    avgTicketCents: Math.round(totalCents / count),
    avgNetWeightKg: Math.round(netWeightKg / count),
    invoiceOperations: operations.filter((row) => row.operationType === "invoice").length,
    internalOperations: operations.filter((row) => row.operationType === "internal").length,
    cancelledOperations: 1,
    cancelledNetWeightKg: 26_400,
    firstOperationDate: dayIso(daysAgo(29)),
    lastOperationDate: dayIso(NOW)
  };
}

/**
 * Movimento diario do periodo pedido. O grafico, os KPIs e as tabelas saem todos
 * daqui, entao os totais das telas sempre fecham entre si.
 */
function seriesFor(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const points: Array<{
    date: string;
    totalOperations: number;
    totalNetWeightKg: number;
    totalCents: number;
  }> = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return points;

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = new Date(cursor);
    const weekday = day.getDay();
    const seasonal = weekday === 0 ? 0.16 : weekday === 6 ? 0.55 : 1;
    const seed = day.getFullYear() * 10_000 + (day.getMonth() + 1) * 100 + day.getDate();
    const noise = 0.82 + seeded(seed) * 0.36;
    const operations = Math.max(1, Math.round(31 * seasonal * noise));
    const avgLoadKg = 26_400 + Math.round(seeded(seed + 7) * 3_800);
    const weight = operations * avgLoadKg;
    const avgPricePerTon = 8_320 + Math.round(seeded(seed + 13) * 640);
    points.push({
      date: dayIso(day),
      totalOperations: operations,
      totalNetWeightKg: weight,
      totalCents: Math.round((weight / 1000) * avgPricePerTon)
    });
  }
  return points;
}

function sumSeries(points: ReturnType<typeof seriesFor>) {
  return {
    operations: points.reduce((sum, point) => sum + point.totalOperations, 0),
    weightKg: points.reduce((sum, point) => sum + point.totalNetWeightKg, 0),
    cents: points.reduce((sum, point) => sum + point.totalCents, 0)
  };
}

const PRODUCT_SHARES = [0.26, 0.21, 0.16, 0.13, 0.1, 0.08, 0.06];
const CUSTOMER_SHARES = [0.2, 0.18, 0.15, 0.13, 0.11, 0.09, 0.08, 0.06];

function productReportFor(startDate: string, endDate: string) {
  const totals = sumSeries(seriesFor(startDate, endDate));
  return PRODUCTS.map((product, index) => {
    const share = PRODUCT_SHARES[index] ?? 0.04;
    const weight = Math.round(totals.weightKg * share);
    return {
      productCode: product.code,
      productDescription: product.description,
      totalOperations: Math.max(1, Math.round(totals.operations * share)),
      totalWeightKg: weight,
      totalValueCents: Math.round((weight / 1000) * product.unitPriceCents)
    };
  }).sort((a, b) => b.totalValueCents - a.totalValueCents);
}

/** Uma linha por cliente, com o recorte de cada um dentro do total do periodo. */
function customerRowsFor(startDate: string, endDate: string) {
  const totals = sumSeries(seriesFor(startDate, endDate));
  const rows = CUSTOMERS.map((customer, index) => {
    const share = CUSTOMER_SHARES[index] ?? 0.05;
    const weight = Math.round(totals.weightKg * share);
    // Cada cliente compra um mix diferente, entao o preco medio nao pode ser igual em todos.
    const avgPricePerTon = 8_050 + Math.round(seeded(index + 3) * 1_450);
    return {
      customerId: customer.id,
      customerName: customer.tradeName,
      totalOperations: Math.max(1, Math.round(totals.operations * share)),
      totalWeightKg: weight,
      totalValueCents: Math.round((weight / 1000) * avgPricePerTon)
    };
  });

  // Normaliza para a soma das linhas bater com o faturamento do periodo: os KPIs e a
  // tabela dinamica ficam no mesmo numero em vez de divergirem por arredondamento.
  const rowsTotal = rows.reduce((sum, row) => sum + row.totalValueCents, 0);
  const factor = rowsTotal ? totals.cents / rowsTotal : 1;
  return rows
    .map((row) => ({ ...row, totalValueCents: Math.round(row.totalValueCents * factor) }))
    .sort((a, b) => b.totalValueCents - a.totalValueCents);
}

function customerReportFor(startDate: string, endDate: string) {
  return customerRowsFor(startDate, endDate).map((row) => ({
    customerName: row.customerName,
    totalOperations: row.totalOperations,
    totalWeightKg: row.totalWeightKg,
    totalValueCents: row.totalValueCents
  }));
}

const MONTH_SERIES = DAILY_SERIES;
const MONTH_TOTAL_WEIGHT = MONTH_SERIES.reduce((sum, point) => sum + point.totalNetWeightKg, 0);
const MONTH_TOTAL_CENTS = MONTH_SERIES.reduce((sum, point) => sum + point.totalCents, 0);
const MONTH_TOTAL_OPERATIONS = MONTH_SERIES.reduce((sum, point) => sum + point.totalOperations, 0);

function buildInstallmentTotals(base: number) {
  return {
    installments: 14,
    amountCents: base,
    overdueInstallments: 2,
    overdueCents: Math.round(base * 0.14),
    upcomingInstallments: 12,
    upcomingCents: Math.round(base * 0.86),
    nextDueDate: dayIso(daysAhead(4)),
    nextDueCents: Math.round(base * 0.09)
  };
}

function buildCustomerReport(customerId: string, startDate: string, endDate: string) {
  const customer = CUSTOMERS.find((row) => row.id === customerId) ?? CUSTOMERS[0];
  const operations = CLOSED_OPERATIONS.filter((row) => row.customerId === customer.id);
  const source = operations.length ? operations : CLOSED_OPERATIONS.slice(0, 4);
  const shape = totalsFor(source);
  // Os numeros do cliente saem do mesmo recorte do periodo usado pelo Insights e pela
  // tabela dinamica: o relatorio individual bate com o resumo geral.
  const row =
    customerRowsFor(startDate, endDate).find((item) => item.customerId === customer.id) ?? null;
  const totalCents = row?.totalValueCents ?? shape.totalCents;
  const freightCents = Math.round(totalCents * 0.05);
  const scaled = {
    ...shape,
    operations: row?.totalOperations ?? shape.operations,
    netWeightKg: row?.totalWeightKg ?? shape.netWeightKg,
    productCents: totalCents - freightCents,
    freightCents,
    totalCents,
    avgPriceCentsPerTon: row
      ? Math.round((totalCents - freightCents) / (row.totalWeightKg / 1000))
      : shape.avgPriceCentsPerTon,
    avgTicketCents: row
      ? Math.round(totalCents / Math.max(1, row.totalOperations))
      : shape.avgTicketCents,
    avgNetWeightKg: row
      ? Math.round(row.totalWeightKg / Math.max(1, row.totalOperations))
      : shape.avgNetWeightKg,
    invoiceOperations: Math.round((row?.totalOperations ?? shape.operations) * 0.9),
    internalOperations: Math.round((row?.totalOperations ?? shape.operations) * 0.1),
    firstOperationDate: startDate,
    lastOperationDate: endDate
  };

  return {
    customer: {
      id: customer.id,
      legalName: customer.legalName,
      tradeName: customer.tradeName,
      document: customer.document,
      phone: customer.phone,
      email: customer.email,
      addressLine: "Avenida das Industrias, 480 - Distrito Industrial",
      city: customer.city,
      state: customer.state,
      creditLimitCents: customer.creditLimitCents,
      openReceivablesCents: customer.openReceivablesCents,
      omieCustomerId: customer.omieCustomerId,
      defaultPaymentTermName: "30/60 dias",
      defaultCarrierName: CARRIERS[0].name
    },
    startDate,
    endDate,
    periodLabel: "Ultimos 30 dias",
    totals: scaled,
    byProduct: PRODUCTS.slice(0, 5).map((product, index) => {
      const weight = Math.round(scaled.netWeightKg * [0.34, 0.26, 0.18, 0.13, 0.09][index]);
      return {
        productCode: product.code,
        productDescription: product.description,
        operations: Math.max(
          1,
          Math.round(scaled.operations * [0.34, 0.26, 0.18, 0.13, 0.09][index])
        ),
        netWeightKg: weight,
        productCents: Math.round((weight / 1000) * product.unitPriceCents),
        freightCents: Math.round(weight * 1.2),
        totalCents: Math.round((weight / 1000) * product.unitPriceCents + weight * 1.2),
        avgPriceCentsPerTon: product.unitPriceCents
      };
    }),
    byPlate: VEHICLES.slice(0, 5).map((vehicle, index) => ({
      plate: vehicle.plate,
      driverName: DRIVERS[index].name,
      carrierName: CARRIERS[index % CARRIERS.length].name,
      operations: 12 - index,
      netWeightKg: Math.round(scaled.netWeightKg * [0.3, 0.24, 0.19, 0.15, 0.12][index]),
      totalCents: Math.round(scaled.totalCents * [0.3, 0.24, 0.19, 0.15, 0.12][index]),
      totalMinutes: (12 - index) * 41,
      avgMinutes: 41 - index,
      lastOperationAt: iso(minutesAgo(120 + index * 60))
    })),
    byCarrier: CARRIERS.map((carrier, index) => ({
      carrierName: carrier.name,
      carrierDocument: carrier.document,
      operations: 18 - index * 4,
      netWeightKg: Math.round(scaled.netWeightKg * [0.46, 0.33, 0.21][index]),
      freightCents: Math.round(scaled.freightCents * [0.46, 0.33, 0.21][index]),
      plates: VEHICLES.filter((vehicle) => vehicle.carrierId === carrier.id).map((v) => v.plate)
    })),
    byPaymentMethod: [
      {
        name: "Boleto bancario",
        operations: 21,
        netWeightKg: Math.round(scaled.netWeightKg * 0.52),
        totalCents: Math.round(scaled.totalCents * 0.52)
      },
      {
        name: "PIX",
        operations: 11,
        netWeightKg: Math.round(scaled.netWeightKg * 0.28),
        totalCents: Math.round(scaled.totalCents * 0.28)
      },
      {
        name: "Em carteira",
        operations: 8,
        netWeightKg: Math.round(scaled.netWeightKg * 0.2),
        totalCents: Math.round(scaled.totalCents * 0.2)
      }
    ],
    byPaymentTerm: [
      {
        name: "30/60 dias",
        operations: 24,
        netWeightKg: Math.round(scaled.netWeightKg * 0.6),
        totalCents: Math.round(scaled.totalCents * 0.6)
      },
      {
        name: "28 dias",
        operations: 10,
        netWeightKg: Math.round(scaled.netWeightKg * 0.25),
        totalCents: Math.round(scaled.totalCents * 0.25)
      },
      {
        name: "A vista",
        operations: 6,
        netWeightKg: Math.round(scaled.netWeightKg * 0.15),
        totalCents: Math.round(scaled.totalCents * 0.15)
      }
    ],
    byFreightModality: [
      {
        name: "FOB (cliente paga o frete)",
        operations: 26,
        netWeightKg: Math.round(scaled.netWeightKg * 0.65),
        totalCents: Math.round(scaled.totalCents * 0.65)
      },
      {
        name: "CIF (pedreira paga o frete)",
        operations: 14,
        netWeightKg: Math.round(scaled.netWeightKg * 0.35),
        totalCents: Math.round(scaled.totalCents * 0.35)
      }
    ],
    byDay: DAILY_SERIES.slice(-12).map((point) => ({
      period: point.date,
      operations: Math.max(1, Math.round(point.totalOperations * 0.2)),
      netWeightKg: Math.round(point.totalNetWeightKg * 0.2),
      productCents: Math.round(point.totalCents * 0.18),
      freightCents: Math.round(point.totalCents * 0.02),
      totalCents: Math.round(point.totalCents * 0.2)
    })),
    byMonth: [
      {
        period: "2026-05",
        operations: 38,
        netWeightKg: 1_042_000,
        productCents: 9_180_000,
        freightCents: 610_000,
        totalCents: 9_790_000
      },
      {
        period: "2026-06",
        operations: 44,
        netWeightKg: 1_218_400,
        productCents: 10_740_000,
        freightCents: 702_000,
        totalCents: 11_442_000
      },
      {
        period: "2026-07",
        operations: scaled.operations,
        netWeightKg: scaled.netWeightKg,
        productCents: scaled.productCents,
        freightCents: scaled.freightCents,
        totalCents: scaled.totalCents
      }
    ],
    operations: source.map((operation) => ({
      ...operation,
      date: dayIso(new Date(operation.createdAt)),
      statusLabel: operation.status === "synced" ? "Sincronizada" : "Pendente OMIE",
      cloudSyncedAt: operation.updatedAt,
      omieSyncedAt: operation.omieBilledAt
    })),
    cancelledOperations: CANCELED_OPERATIONS.slice(0, 1).map((operation) => ({
      ...operation,
      date: dayIso(new Date(operation.createdAt)),
      statusLabel: "Cancelada",
      cloudSyncedAt: operation.updatedAt,
      omieSyncedAt: null
    })),
    installments: Array.from({ length: 10 }, (_, index) => {
      const due = daysAhead(index * 3 - 6);
      return {
        operationId: CLOSED_OPERATIONS[index % CLOSED_OPERATIONS.length].id,
        operationDate: dayIso(daysAgo(30 - index * 2)),
        dueDate: dayIso(due),
        number: (index % 2) + 1,
        installmentCount: 2,
        amountCents: 148_000 + index * 21_500,
        situation: index < 2 ? "overdue" : index === 2 ? "today" : "upcoming",
        daysUntilDue: index * 3 - 6,
        productDescription: PRODUCTS[index % PRODUCTS.length].description,
        plate: VEHICLES[index % VEHICLES.length].plate,
        paymentTermName: "30/60 dias",
        paymentMethodName: "Boleto bancario",
        omieSalesOrderId: 302_100 + index
      };
    }),
    installmentsByMonth: [
      { period: "2026-07", installments: 6, amountCents: 968_000 },
      { period: "2026-08", installments: 5, amountCents: 812_400 },
      { period: "2026-09", installments: 3, amountCents: 498_100 }
    ],
    installmentTotals: buildInstallmentTotals(2_278_500),
    referenceDate: dayIso(NOW)
  };
}

function buildCustomersOverview(startDate: string, endDate: string) {
  const rows = customerRowsFor(startDate, endDate)
    .map((row, index) => {
      const customer = CUSTOMERS.find((item) => item.id === row.customerId) ?? CUSTOMERS[index];
      const weight = row.totalWeightKg;
      const total = row.totalValueCents;
      const operations = row.totalOperations;
      return {
        customer: { id: customer.id, name: customer.tradeName, document: customer.document },
        totals: {
          operations,
          netWeightKg: weight,
          productCents: Math.round(total * 0.94),
          freightCents: Math.round(total * 0.06),
          totalCents: total,
          avgPriceCentsPerTon: Math.round((total * 0.94) / (weight / 1000)),
          avgTicketCents: Math.round(total / Math.max(1, operations)),
          avgNetWeightKg: Math.round(weight / Math.max(1, operations)),
          invoiceOperations: Math.round(operations * 0.9),
          internalOperations: operations - Math.round(operations * 0.9),
          cancelledOperations: index % 3 === 0 ? 1 : 0,
          cancelledNetWeightKg: index % 3 === 0 ? 27_600 : 0,
          firstOperationDate: startDate,
          lastOperationDate: endDate
        },
        installmentTotals: buildInstallmentTotals(Math.round(total * 0.42))
      };
    })
    .sort((a, b) => b.totals.totalCents - a.totals.totalCents);

  const totals = rows.reduce(
    (acc, row) => ({
      operations: acc.operations + row.totals.operations,
      netWeightKg: acc.netWeightKg + row.totals.netWeightKg,
      productCents: acc.productCents + row.totals.productCents,
      freightCents: acc.freightCents + row.totals.freightCents,
      totalCents: acc.totalCents + row.totals.totalCents,
      avgPriceCentsPerTon: 0,
      avgTicketCents: 0,
      avgNetWeightKg: 0,
      invoiceOperations: acc.invoiceOperations + row.totals.invoiceOperations,
      internalOperations: acc.internalOperations + row.totals.internalOperations,
      cancelledOperations: acc.cancelledOperations + row.totals.cancelledOperations,
      cancelledNetWeightKg: acc.cancelledNetWeightKg + row.totals.cancelledNetWeightKg,
      firstOperationDate: startDate,
      lastOperationDate: endDate
    }),
    {
      operations: 0,
      netWeightKg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0,
      avgPriceCentsPerTon: 0,
      avgTicketCents: 0,
      avgNetWeightKg: 0,
      invoiceOperations: 0,
      internalOperations: 0,
      cancelledOperations: 0,
      cancelledNetWeightKg: 0,
      firstOperationDate: startDate,
      lastOperationDate: endDate
    }
  );

  totals.avgPriceCentsPerTon = Math.round(totals.productCents / (totals.netWeightKg / 1000));
  totals.avgTicketCents = Math.round(totals.totalCents / Math.max(1, totals.operations));
  totals.avgNetWeightKg = Math.round(totals.netWeightKg / Math.max(1, totals.operations));

  return {
    startDate,
    endDate,
    periodLabel: "Ultimos 30 dias",
    referenceDate: dayIso(NOW),
    customers: rows,
    totals,
    installmentTotals: buildInstallmentTotals(Math.round(totals.totalCents * 0.42))
  };
}

const WALLET_REPORT = (() => {
  // Poucos grupos de proposito: a lista da carteira cresce sem paginacao e a tela
  // fica com os cartoes espremidos quando o conteudo passa da altura da janela.
  const groups = CUSTOMERS.slice(0, 3).map((customer, index) => {
    const operations = Array.from({ length: 3 - (index % 2) }, (_, opIndex) => {
      const product = PRODUCTS[(index + opIndex) % PRODUCTS.length];
      const weight = 26_000 + opIndex * 3_400 + index * 1_800;
      const settled = index === 2 && opIndex > 0;
      return {
        operationId: `op_wallet_${index}_${opIndex}`,
        soldAt: iso(daysAgo(index * 2 + opIndex + 1)),
        customerId: customer.id,
        customerName: customer.tradeName,
        plate: VEHICLES[(index + opIndex) % VEHICLES.length].plate,
        productDescription: product.description,
        netWeightKg: weight,
        totalCents: Math.round((weight / 1000) * product.unitPriceCents),
        paymentMethodName: "Em carteira",
        settlementMethodId: settled ? "pay_003" : null,
        settlementMethodName: settled ? "Boleto bancario" : null,
        settlementDueDate: settled ? dayIso(daysAhead(12 + opIndex)) : null,
        settledAt: settled ? iso(daysAgo(1)) : null,
        settlementNote: settled ? "Fechamento combinado com o comercial" : null,
        omieSalesOrderId: settled ? 302_200 + index * 10 + opIndex : null
      };
    });
    return {
      customerId: customer.id,
      customerName: customer.tradeName,
      operations,
      totalCents: operations.reduce((sum, row) => sum + row.totalCents, 0)
    };
  });

  const open = groups.flatMap((group) => group.operations).filter((row) => !row.settledAt);
  const settled = groups.flatMap((group) => group.operations).filter((row) => row.settledAt);

  return {
    groups,
    summary: {
      openCount: open.length,
      openTotalCents: open.reduce((sum, row) => sum + row.totalCents, 0),
      settledCount: settled.length,
      settledTotalCents: settled.reduce((sum, row) => sum + row.totalCents, 0)
    }
  };
})();

const TRUCK_CONTROL = (() => {
  const trucks = VEHICLES.map((vehicle, index) => {
    const operations = 34 - index * 4;
    const avg = 34 + Math.round(seeded(index + 11) * 26);
    const totalWeight = operations * (26_000 + index * 900);
    // Cada caminhao roda um mix proprio de produtos, com pesos diferentes.
    const mix = [0.52, 0.31, 0.17];
    const products = mix.map((share, productIndex) => {
      const product = PRODUCTS[(index + productIndex) % PRODUCTS.length];
      return {
        productDescription: product.description,
        totalNetWeightKg: Math.round(totalWeight * share),
        operations: Math.max(1, Math.round(operations * share))
      };
    });
    return {
      plate: vehicle.plate,
      driverName: DRIVERS[index % DRIVERS.length].name,
      operations,
      totalMinutes: operations * avg,
      avgMinutes: avg,
      totalNetWeightKg: totalWeight,
      lastOperationAt: iso(minutesAgo(45 + index * 90)),
      products
    };
  });

  return {
    startDate: dayIso(daysAgo(29)),
    endDate: dayIso(NOW),
    averageMinutes: 43,
    totalOperations: trucks.reduce((sum, truck) => sum + truck.operations, 0),
    totalNetWeightKg: trucks.reduce((sum, truck) => sum + truck.totalNetWeightKg, 0),
    trucks
  };
})();

const REPORT_RECIPIENTS = [
  {
    id: "rcp_001",
    email: "diretoria@serradocedro.demo",
    whatsappPhone: "+55 31 99999-0001",
    sendEmail: true,
    sendWhatsapp: true,
    scheduleFrequency: "daily",
    scheduleTime: "18:00",
    reportTypes: "both" as const,
    sendFinancial: true,
    financialScheduleTime: "08:00",
    displayName: "Diretoria",
    isActive: true,
    syncStatus: "synced" as const,
    lastError: null,
    lastSyncedAt: iso(minutesAgo(120))
  },
  {
    id: "rcp_002",
    email: "operacao@serradocedro.demo",
    whatsappPhone: null,
    sendEmail: true,
    sendWhatsapp: false,
    scheduleFrequency: "daily",
    scheduleTime: "17:30",
    reportTypes: "trucks" as const,
    sendFinancial: false,
    financialScheduleTime: null,
    displayName: "Coordenacao de operacao",
    isActive: true,
    syncStatus: "synced" as const,
    lastError: null,
    lastSyncedAt: iso(minutesAgo(120))
  },
  {
    id: "rcp_003",
    email: null,
    whatsappPhone: "+55 31 98888-0042",
    sendEmail: false,
    sendWhatsapp: true,
    scheduleFrequency: "weekly",
    scheduleTime: "09:00",
    reportTypes: "sales" as const,
    sendFinancial: false,
    financialScheduleTime: null,
    displayName: "Comercial (grupo)",
    isActive: true,
    syncStatus: "pending" as const,
    lastError: null,
    lastSyncedAt: null
  }
];

/** Registra as chamadas nao previstas para facilitar o ajuste do harness. */
const unhandled = new Set<string>();

export function createMockDesktopApi(): AnyRecord {
  const api: AnyRecord = {
    getStatus: () => delay(STATUS_SNAPSHOT),
    getAccessStatus: () => delay(ACCESS_STATUS, 10),
    validateDesktopAccess: () => delay(ACCESS_STATUS),
    activateDesktop: () => delay(ACCESS_STATUS),
    logoutDesktop: () => delay(undefined),
    getUpdateState: () => delay({ status: "idle", availableVersion: null, errorMessage: null }),
    checkForUpdates: () => delay({ status: "idle", availableVersion: null, errorMessage: null }),
    downloadAndInstallUpdate: () =>
      delay({ status: "idle", availableVersion: null, errorMessage: null }),
    exportBackup: () => delay({ path: "C:\\KyberRock\\backups\\kyberrock-2026-07-14.db" }),
    restoreBackup: () => delay(true),

    listOpenWeighingOperations: () => delay(OPEN_OPERATIONS),
    listClosedWeighingOperations: () => delay(CLOSED_OPERATIONS),
    listCanceledWeighingOperations: () => delay(CANCELED_OPERATIONS),
    clearCanceledWeighingOperations: () => delay(0),
    clearClosedWeighingOperations: () => delay(0),
    deleteClosedWeighingOperation: () => delay(undefined),
    operationOmieIssue: () => delay({ operationId: "", reason: null, fields: [] }),
    pullLoaderCompletions: () => delay({ pulled: 0, errors: [] }),
    pullCloudNow: () => delay({ pulled: 0, errors: [] }),
    listUnitDevices: () =>
      delay([
        {
          id: "dev_balanca_01",
          name: "Balanca 01",
          color: "#2563eb",
          deviceNumber: 1,
          isActive: true,
          isSelf: true
        },
        {
          id: "dev_balanca_02",
          name: "Balanca 02",
          color: "#16a34a",
          deviceNumber: 2,
          isActive: true,
          isSelf: false
        }
      ]),

    startWeighing: () => delay(OPEN_OPERATIONS[0]),
    closeWeighing: () => delay(CLOSED_OPERATIONS[0]),
    cancelWeighing: () => delay(CANCELED_OPERATIONS[0]),
    updateWeighingProduct: () => delay(OPEN_OPERATIONS[0]),
    updateWeighingCustomer: () => delay(OPEN_OPERATIONS[0]),
    updateWeighingCarrier: () => delay(OPEN_OPERATIONS[0]),
    updateWeighingOperation: () => delay(OPEN_OPERATIONS[0]),
    getCustomerLastEntryPreferences: () =>
      delay({
        carrierId: CARRIERS[0].id,
        paymentTermId: PAYMENT_TERMS[4].id,
        paymentMethodId: PAYMENT_METHODS[2].id
      }),

    getCustomerFreightRules: () => delay([]),
    getCustomerFreightForProduct: () => delay(null),
    setCustomerFreightRule: () => delay(undefined),
    removeCustomerFreightRule: () => delay(undefined),
    removeCustomerFreightModality: () => delay(undefined),

    queryCache: (options: AnyRecord) => {
      const entityType = String(options?.entityType ?? "");
      const rows = CACHE_ROWS[entityType] ?? [];
      const search = options?.search as string | undefined;
      const filtered = rows.filter((row) =>
        matches(
          search,
          row.legalName as string,
          row.tradeName as string,
          row.name as string,
          row.description as string,
          row.plate as string,
          row.code as string,
          row.document as string
        )
      );
      const offset = Number(options?.offset ?? 0);
      const limit = Number(options?.limit ?? 50);
      return delay({ rows: filtered.slice(offset, offset + limit), total: filtered.length }, 20);
    },

    listWindowsPrinters: () =>
      delay([
        { name: "EPSON TM-T20X Receipt", isDefault: true },
        { name: "Bematech MP-4200 TH", isDefault: false },
        { name: "HP LaserJet M404 (relatorios A4)", isDefault: false },
        { name: "Microsoft Print to PDF", isDefault: false }
      ]),
    listPrintProfiles: () => delay([PRINT_PROFILE]),
    getActiveReceiptProfile: () => delay(PRINT_PROFILE),
    configureReceiptPrintProfile: () => delay(PRINT_PROFILE),
    listPrintReceipts: () => delay(PRINT_RECEIPTS),
    printReceipt: () => delay(PRINT_RECEIPTS[0]),
    reprintReceipt: () => delay(PRINT_RECEIPTS[0]),
    printTestReceipt: () => delay(PRINT_RECEIPTS[0]),
    billFiscalOperation: () => delay({ success: true, omieSalesOrderId: 302_119, message: null }),

    bootstrapCloudData: () =>
      delay({
        mode: "cloud",
        synced: 3,
        pulled: {
          customers: 8,
          products: 7,
          operations: 23,
          loadingRequests: 4,
          printReceipts: 10
        },
        errors: []
      }),
    syncToCloud: () => delay({ success: true, synced: 4, failed: 0, errors: [] }),
    getCloudStatus: () => delay({ totalOperations: 1_482, lastSync: iso(minutesAgo(3)) }),
    isCloudConnected: () => delay(true),
    syncCloudNow: () => delay({ success: true, synced: 4, failed: 0, errors: [] }),
    getCloudSyncSchedulerStatus: () =>
      delay({
        enabled: true,
        intervalMinutes: 5,
        lastRunAt: iso(minutesAgo(3)),
        nextRunAt: iso(minutesAgo(-2))
      }),
    setCloudSyncConfig: () =>
      delay({
        enabled: true,
        intervalMinutes: 5,
        lastRunAt: iso(minutesAgo(3)),
        nextRunAt: iso(minutesAgo(-2))
      }),
    probeConnectivity: () =>
      delay({ internetOnline: true, cloudReachable: true, omieReachable: true }),

    getOmieStatus: () =>
      delay({
        configured: true,
        appKeyMasked: "••••••••4472",
        hasSyncedData: true,
        totalCustomers: CUSTOMERS.length,
        totalProducts: PRODUCTS.length,
        totalPaymentTerms: PAYMENT_TERMS.length,
        pendingPushCustomers: 1,
        pendingPushCarriers: 0,
        pendingOmieJobs: 2,
        lastSyncAt: iso(minutesAgo(22))
      }),
    omieConfig: () => delay({ configured: true, appKeyMasked: "••••••••4472" }),
    omieSync: () =>
      delay({
        customersPulled: 8,
        customersPushed: 1,
        suppliersSynced: 3,
        productsSynced: 7,
        paymentTermsSynced: 6,
        errors: []
      }),
    omieQueueList: () => delay(OMIE_QUEUE),
    omieQueueDelete: () => delay(undefined),
    omieQueueSendNow: () => delay(undefined),
    syncOmieDirect: () => delay({ customersPulled: 8, productsSynced: 7 }),
    syncOmieMasterData: () =>
      delay({ customersPulled: 8, productsSynced: 7, paymentTermsSynced: 6, errors: [] }),
    getLastOmieSyncRun: () =>
      delay({
        id: "run_2026_07_14",
        startedAt: iso(minutesAgo(23)),
        finishedAt: iso(minutesAgo(22)),
        success: true,
        mode: "incremental",
        triggeredBy: "scheduler"
      }),
    getOmieSyncEntitiesByRun: () =>
      delay([
        {
          entity: "customers",
          success: true,
          totalFetched: 8,
          totalCreated: 0,
          totalUpdated: 2,
          totalSkipped: 6,
          errorMessage: null
        },
        {
          entity: "products",
          success: true,
          totalFetched: 7,
          totalCreated: 0,
          totalUpdated: 1,
          totalSkipped: 6,
          errorMessage: null
        },
        {
          entity: "payment_terms",
          success: true,
          totalFetched: 6,
          totalCreated: 0,
          totalUpdated: 0,
          totalSkipped: 6,
          errorMessage: null
        }
      ]),
    listOmieDocumentTypes: () =>
      delay([
        { code: "NFE", description: "Nota Fiscal Eletronica" },
        { code: "NFSE", description: "Nota Fiscal de Servico" }
      ]),
    resetOmieMaster: () => delay(undefined),
    startOmieDataEntryLoop: () =>
      delay({
        customersPulled: 8,
        productsSynced: 7,
        paymentTermsSynced: 6,
        iterations: 1,
        finished: true,
        errors: []
      }),
    getOmieLoopStatus: () => delay(null),
    getOmieSchedulerStatus: () =>
      delay({
        enabled: true,
        intervalMinutes: 30,
        lastPullAt: iso(minutesAgo(22)),
        nextPullAt: iso(minutesAgo(-8))
      }),
    setOmieSchedulerConfig: () =>
      delay({
        enabled: true,
        intervalMinutes: 30,
        lastPullAt: iso(minutesAgo(22)),
        nextPullAt: iso(minutesAgo(-8))
      }),
    omieCategoriesList: () =>
      delay([
        { code: "1.01.01", description: "Venda de agregados" },
        { code: "1.01.02", description: "Venda de brita" },
        { code: "1.02.01", description: "Frete sobre vendas" }
      ]),
    productOmieCategorySet: () => delay(undefined),
    omieDefaultCategoryGet: () => delay("1.01.01"),
    omieDefaultCategorySet: () => delay("1.01.01"),
    omieAdvanceConfigGet: () =>
      delay({
        categoryCodes: ["2.01.05"],
        accountCode: 3110024,
        accountName: "Banco Cedro - C/C 4471-2"
      }),
    omieAdvanceConfigSet: () =>
      delay({
        categoryCodes: ["2.01.05"],
        accountCode: 3110024,
        accountName: "Banco Cedro - C/C 4471-2"
      }),

    getDailyReport: (date: string) =>
      delay({
        date,
        totalOperations: 31,
        totalNetWeightKg: 842_600,
        totalProductCents: 7_281_400,
        totalFreightCents: 412_800,
        totalCents: 7_694_200,
        operations: CLOSED_OPERATIONS.map((operation) => ({
          id: operation.id,
          customerName: operation.customerName,
          productDescription: operation.productDescription,
          netWeightKg: operation.netWeightKg ?? 0,
          productTotalCents: operation.productTotalCents ?? 0,
          freightTotalCents: operation.freightTotalCents,
          totalCents: operation.totalCents ?? 0
        }))
      }),
    getMonthlyReport: (year: number, month: number) =>
      delay({
        year,
        month,
        totalOperations: MONTH_TOTAL_OPERATIONS,
        totalNetWeightKg: MONTH_TOTAL_WEIGHT,
        totalProductCents: Math.round(MONTH_TOTAL_CENTS * 0.94),
        totalFreightCents: Math.round(MONTH_TOTAL_CENTS * 0.06),
        totalCents: MONTH_TOTAL_CENTS
      }),
    getReportHtml: () => delay("<html><body><h1>Relatorio</h1></body></html>"),
    exportReportPdf: () => delay({ path: "C:\\KyberRock\\relatorios\\relatorio.pdf" }),
    exportReportExcel: () => delay({ path: "C:\\KyberRock\\relatorios\\relatorio.xlsx" }),
    getReportByProduct: (startDate: string, endDate: string) =>
      delay(productReportFor(startDate, endDate)),
    getReportByCustomer: (startDate: string, endDate: string) =>
      delay(customerReportFor(startDate, endDate)),
    getDailySeries: (startDate: string, endDate: string) => delay(seriesFor(startDate, endDate)),
    getOperationMix: (startDate: string, endDate: string) => {
      const totals = sumSeries(seriesFor(startDate, endDate));
      return delay({
        invoice: {
          count: Math.round(totals.operations * 0.88),
          weightKg: Math.round(totals.weightKg * 0.9),
          totalCents: Math.round(totals.cents * 0.91)
        },
        internal: {
          count: Math.round(totals.operations * 0.12),
          weightKg: Math.round(totals.weightKg * 0.1),
          totalCents: Math.round(totals.cents * 0.09)
        },
        cancelled: {
          count: Math.max(1, Math.round(totals.operations * 0.012)),
          weightKg: Math.round(totals.weightKg * 0.009)
        }
      });
    },
    getSalesPivot: (startDate: string, endDate: string) => {
      const rows = customerReportFor(startDate, endDate);
      const totalWeight = rows.reduce((sum, row) => sum + row.totalWeightKg, 0);
      const totalValue = rows.reduce((sum, row) => sum + row.totalValueCents, 0);
      return delay({
        rows: rows.map((row) => ({
          customerName: row.customerName,
          productDescription: null,
          date: null,
          totalOperations: row.totalOperations,
          totalWeightKg: row.totalWeightKg,
          totalValueCents: row.totalValueCents,
          avgPriceCentsPerTon: Math.round(row.totalValueCents / (row.totalWeightKg / 1000))
        })),
        totals: {
          totalOperations: rows.reduce((sum, row) => sum + row.totalOperations, 0),
          totalWeightKg: totalWeight,
          totalValueCents: totalValue,
          avgPriceCentsPerTon: Math.round(totalValue / (totalWeight / 1000))
        },
        customers: CUSTOMERS.map((customer) => ({ id: customer.id, name: customer.tradeName })),
        products: PRODUCTS.map((product) => ({ id: product.id, name: product.description }))
      });
    },
    getTruckControl: () => delay(TRUCK_CONTROL),
    exportTruckControlPdf: () => delay({ path: "C:\\KyberRock\\relatorios\\caminhoes.pdf" }),

    listCustomerReportCustomers: () =>
      delay(
        CUSTOMERS.map((customer) => ({
          id: customer.id,
          name: customer.tradeName,
          document: customer.document
        }))
      ),
    getCustomersOverview: (startDate: string, endDate: string) =>
      delay(buildCustomersOverview(startDate, endDate), 120),
    exportCustomersOverview: () => delay([{ path: "C:\\KyberRock\\relatorios\\clientes.pdf" }]),
    getCustomerReport: (customerId: string, startDate: string, endDate: string) =>
      delay(buildCustomerReport(customerId, startDate, endDate), 120),
    exportCustomerReport: () => delay([{ path: "C:\\KyberRock\\relatorios\\cliente.pdf" }]),

    listReportRecipients: () => delay(REPORT_RECIPIENTS),
    createReportRecipient: () => delay(REPORT_RECIPIENTS[0]),
    updateReportRecipient: () => delay(REPORT_RECIPIENTS[0]),
    deleteReportRecipient: () => delay(undefined),
    sendTestEmail: () => delay({ success: true }),
    sendDailyReportEmail: () => delay({ success: true }),
    sendRangeReportEmail: () => delay({ success: true }),
    verifySmtpConfig: () => delay({ success: true, message: "Conexao SMTP validada." }),
    getReportChannelSettings: () =>
      delay({
        smtpHost: "smtp.serradocedro.demo",
        smtpPort: 587,
        smtpUser: "relatorios@serradocedro.demo",
        smtpPassword: "••••••••",
        smtpSender: "KyberRock <relatorios@serradocedro.demo>",
        uazapiBaseUrl: "https://api.whatsapp.demo",
        uazapiInstanceToken: "••••••••",
        uazapiInstanceName: "pedreira-norte",
        uazapiStatus: "connected",
        uazapiProfileName: "KyberRock Pedreira Norte",
        cloudPushPending: false,
        cloudPushError: null,
        updatedAt: iso(daysAgo(3))
      }),
    saveReportChannelSettings: (input: AnyRecord) => delay(input),
    whatsappStatus: () =>
      delay({
        status: "connected",
        connected: true,
        loggedIn: true,
        qrcode: null,
        paircode: null,
        profileName: "KyberRock Pedreira Norte",
        owner: "+55 31 99999-0001",
        instanceToken: "••••••••",
        lastDisconnectReason: null
      }),
    whatsappConnect: () =>
      delay({
        status: "connected",
        connected: true,
        loggedIn: true,
        qrcode: null,
        paircode: null,
        profileName: "KyberRock Pedreira Norte",
        owner: "+55 31 99999-0001",
        instanceToken: "••••••••",
        lastDisconnectReason: null
      }),
    whatsappDisconnect: () =>
      delay({
        status: "disconnected",
        connected: false,
        loggedIn: false,
        qrcode: null,
        paircode: null,
        profileName: null,
        owner: null,
        instanceToken: null,
        lastDisconnectReason: "Desconectado pelo operador"
      }),
    getReportDispatchConfig: () =>
      delay({
        settings: {
          enabled: true,
          sendHour: 18,
          daily: true,
          weekly: true,
          monthly: false,
          updatedAt: iso(daysAgo(3))
        },
        state: {
          lastDailyDate: dayIso(daysAgo(1)),
          lastWeeklyDate: dayIso(daysAgo(6)),
          lastMonthlyMonth: "2026-06",
          lastAttemptAt: iso(daysAgo(1)),
          lastError: null
        }
      }),
    saveReportDispatchConfig: () =>
      delay({
        settings: {
          enabled: true,
          sendHour: 18,
          daily: true,
          weekly: true,
          monthly: false,
          updatedAt: iso(NOW)
        },
        state: {
          lastDailyDate: dayIso(daysAgo(1)),
          lastWeeklyDate: dayIso(daysAgo(6)),
          lastMonthlyMonth: "2026-06",
          lastAttemptAt: iso(daysAgo(1)),
          lastError: null
        }
      }),
    sendReportsNow: () => delay({ sent: 3, skipped: 0, errors: [] }),
    sendFinancialReportNow: () =>
      delay([{ recipient: "diretoria@serradocedro.demo", success: true, message: null }]),

    getPriceForCustomerProduct: () => delay(9_250),
    getPriceDetailsForCustomerProduct: (_customerId: string, productId: string) => {
      const product = PRODUCTS.find((row) => row.id === productId) ?? PRODUCTS[1];
      const applied = Math.round(product.unitPriceCents * 0.926);
      return delay({
        productId: product.id,
        baseUnitPriceCents: product.unitPriceCents,
        appliedUnitPriceCents: applied,
        source: "special",
        specialPriceId: `csp_${product.id}`,
        defaultPriceId: `pdp_${product.id}`,
        priceUnit: "ton",
        savingsPercent: 7.4
      });
    },
    productDefaultPricesList: () =>
      delay(
        PRODUCTS.map((product) => ({
          id: `pdp_${product.id}`,
          productId: product.id,
          productCode: product.code,
          productDescription: product.description,
          unitPriceCents: product.unitPriceCents,
          unit: "TON",
          omieCategoryCode: "1.01.01"
        }))
      ),
    productDefaultPricesUpsert: () => delay(undefined),
    productDefaultPricesRemove: () => delay(undefined),
    customerSpecialPricesList: () =>
      delay(
        PRODUCTS.slice(0, 3).map((product, index) => ({
          id: `csp_${index}`,
          customerId: CUSTOMERS[0].id,
          productId: product.id,
          productCode: product.code,
          productDescription: product.description,
          unitPriceCents: Math.round(product.unitPriceCents * 0.94),
          unit: "TON"
        }))
      ),
    customerSpecialPricesSet: () => delay(undefined),
    customerSpecialPricesRemove: () => delay(undefined),

    customerCreditBalance: () => delay(1_284_000),
    customerCreditSummary: () =>
      delay({
        customerId: CUSTOMERS[0].id,
        creditMode: "normal",
        creditLimitCents: CUSTOMERS[0].creditLimitCents,
        balanceCents: 1_284_000,
        availableCents: 7_681_500,
        creditAccountEnabled: true,
        creditClosingDay: 25,
        creditBoletoDays: 10,
        creditPeriodicity: "monthly",
        creditSecondClosingDay: null,
        creditSecondBoletoDays: null,
        creditClosingWeekday: null
      }),
    customerCreditMovements: () =>
      delay(
        Array.from({ length: 6 }, (_, index) => ({
          id: `mov_${index}`,
          customerId: CUSTOMERS[0].id,
          type: index % 2 === 0 ? "advance" : "consumption",
          amountCents: index % 2 === 0 ? 500_000 : -184_500,
          balanceAfterCents: 1_284_000 + index * 84_000,
          operationId: index % 2 === 0 ? null : CLOSED_OPERATIONS[index].id,
          description: index % 2 === 0 ? "Adiantamento recebido (OMIE)" : "Consumo em venda",
          createdAt: iso(daysAgo(index * 3 + 1))
        }))
      ),
    customerCreditSyncAdvances: () => delay({ scanned: 42, imported: 3, errors: [] }),

    quotationsCreate: () => delay({ id: "quo_001" }),
    quotationsCancel: () => delay(undefined),
    quotationsListOpenForCustomer: () => delay([]),

    customersCreate: () => delay(undefined),
    customersUpdate: () => delay(undefined),
    customersDelete: () => delay(undefined),
    getDefaultNfeEmail: () => delay("notas@serradocedro.demo"),
    setDefaultNfeEmail: () => delay(undefined),
    applyDefaultNfeEmailToAll: () => delay(0),
    enrichAllCustomersFromCnpj: () => delay({ updated: 0, errors: [] }),
    enrichAllCarriersFromCnpj: () => delay({ updated: 0, errors: [] }),
    paymentMethodsUpdate: () => delay(undefined),

    walletReport: (query: AnyRecord) => {
      const status = String(query?.status ?? "open");
      if (status === "all") return delay(WALLET_REPORT, 90);
      const keepSettled = status === "settled";
      const groups = WALLET_REPORT.groups
        .map((group) => {
          const operations = group.operations.filter(
            (row) => Boolean(row.settledAt) === keepSettled
          );
          return {
            ...group,
            operations,
            totalCents: operations.reduce((sum, row) => sum + row.totalCents, 0)
          };
        })
        .filter((group) => group.operations.length > 0);
      return delay({ groups, summary: WALLET_REPORT.summary }, 90);
    },
    walletSettle: () => delay({ settled: 0 }),
    walletReopen: () => delay({ reopened: 0 }),

    accountsList: () => delay(ACCOUNT_ROWS),
    accountsUpdate: () => delay(undefined),
    paymentTermsCreate: () => delay(undefined),
    paymentTermsUpdate: () => delay(undefined),
    paymentTermsDelete: () => delay(undefined),
    paymentTermsListOmie: () =>
      delay(PAYMENT_TERM_ROWS.map((term) => ({ code: term.omieCode, description: term.name }))),

    priceTablesCreate: () => delay(PRICE_TABLE_ROWS[0]),
    priceTablesUpdateName: () => delay(undefined),
    priceTablesDelete: () => delay(undefined),
    priceTablesAddItem: () => delay(undefined),
    priceTablesUpdateItem: () => delay(undefined),
    priceTablesRemoveItem: () => delay(undefined),
    priceTablesLinkCustomer: () => delay(undefined),
    priceTablesUnlinkCustomer: () => delay(undefined),
    priceTablesList: () => delay(PRICE_TABLE_ROWS),
    priceTablesListItems: (priceTableId: string) =>
      delay(PRICE_TABLE_ITEM_ROWS.filter((item) => item.priceTableId === priceTableId)),
    priceTablesListCustomerLinks: (priceTableId: string) =>
      delay(CUSTOMER_PRICE_TABLE_ROWS.filter((link) => link.priceTableId === priceTableId)),

    vehiclesCreate: () => delay(VEHICLE_ROWS[0]),
    vehiclesUpdate: () => delay(undefined),
    vehiclesDelete: () => delay(undefined),
    vehiclesFindOrCreate: () => delay(VEHICLE_ROWS[0]),
    vehiclesGetCarriers: () => delay([CARRIER_ROWS[0]]),
    vehiclesLinkCarrier: () => delay(undefined),
    customersByCarrier: () => delay(CUSTOMER_ROWS.slice(0, 3)),
    driversCreate: () => delay(DRIVER_ROWS[0]),
    driversUpdate: () => delay(undefined),
    driversDelete: () => delay(undefined),
    driversFindOrCreate: () => delay(DRIVER_ROWS[0]),
    carriersCreate: () => delay(CARRIER_ROWS[0]),
    carriersUpdate: () => delay(undefined),
    carriersDelete: () => delay(undefined),
    carriersList: () => delay(CARRIER_ROWS),
    carriersGetVehicles: (carrierId: string) =>
      delay(VEHICLE_ROWS.filter((v) => v.carrierId === carrierId)),
    linkCustomerCarrier: () => delay(undefined),
    unlinkCustomerCarrier: () => delay(undefined),
    listCarriersByCustomer: () => delay([CARRIER_ROWS[0]]),
    listCustomersByCarrier: () => delay(CUSTOMER_ROWS.slice(0, 3)),
    linkDriverCarrier: () => delay(undefined),
    unlinkDriverCarrier: () => delay(undefined),
    listCarriersByDriver: () => delay([CARRIER_ROWS[0]]),
    listDriversByCarrier: (carrierId: string) =>
      delay(
        DRIVER_ROWS.filter((d) => DRIVERS.find((row) => row.id === d.id)?.carrierId === carrierId)
      ),
    listIndependentDrivers: () => delay(DRIVER_ROWS.filter((d) => d.isIndependent)),

    scaleConnect: () => delay(undefined),
    scaleDisconnect: () => delay(undefined),
    scaleListSerialPorts: () =>
      delay([
        { path: "COM3", manufacturer: "Prolific", serialNumber: "PL2303-0042" },
        { path: "COM5", manufacturer: "FTDI", serialNumber: "FT232-1180" }
      ]),
    scaleRead: () => delay(SCALE_READING, 20),
    scaleReadSampled: () => delay(SCALE_READING, 20),
    scaleCaptureStable: () => delay({ captureId: "cap_0001", reading: SCALE_READING }),
    scaleDiscover: () => delay({ host: "192.168.10.42", port: 4001 }),
    scaleGetStatus: () =>
      delay({
        state: "connected",
        lastReading: SCALE_READING,
        lastReadingAt: iso(minutesAgo(0)),
        errorMessage: null,
        reconnectAttempts: 0,
        stale: false,
        receivingRawData: true,
        lastRawSample: "\u000246820kg\u0003"
      }),
    scaleGetConfig: () =>
      delay({
        id: "scl_001",
        adapterType: "toledo_tcp",
        connection: {
          host: "192.168.10.42",
          port: 4001,
          serialPath: "COM3",
          baudRate: 9600,
          serialTransport: "usb",
          autoConnect: true,
          protocol: "toledo",
          stableReadingMs: 4000
        }
      }),
    scaleSaveConfig: (input: AnyRecord) => delay(input),
    virtualScaleSetWeight: () => delay(undefined),
    virtualScaleConnect: () => delay(undefined),

    verifyPriceChangePassword: () => delay(true),
    lookupCep: () =>
      delay({
        zipcode: "32250-100",
        street: "Avenida das Industrias",
        complement: "",
        neighborhood: "Distrito Industrial",
        city: "Contagem",
        state: "MG"
      }),
    lookupCnpj: () =>
      delay({
        found: true,
        cnpj: "18.204.336/0001-52",
        legalName: "Construtora Vale Verde Engenharia LTDA",
        tradeName: "Vale Verde Engenharia",
        email: "compras@valeverde.demo",
        phone: "(31) 3255-4180",
        zipcode: "32250-100",
        addressStreet: "Avenida das Industrias",
        addressNumber: "480",
        addressComplement: null,
        neighborhood: "Distrito Industrial",
        city: "Betim",
        state: "MG",
        status: "ATIVA"
      }),

    onUpdateAvailable: () => undefined,
    offUpdateAvailable: () => undefined,
    onUpdateDownloadProgress: () => undefined,
    offUpdateDownloadProgress: () => undefined,
    onUpdateDownloaded: () => undefined,
    offUpdateDownloaded: () => undefined,
    onPlateScanned: () => undefined,
    onScaleReading: (callback: (reading: AnyRecord) => void) => {
      // Mantem o mostrador da balanca vivo nas capturas, com uma pequena oscilacao.
      const timer = window.setInterval(() => {
        const drift = Math.round((Math.random() - 0.5) * 40);
        callback({
          ...SCALE_READING,
          weightKg: SCALE_READING.weightKg + drift,
          capturedAt: new Date().toISOString()
        });
      }, 1200);
      (callback as AnyRecord).__timer = timer;
    },
    offScaleReading: (callback: AnyRecord) => {
      if (typeof callback?.__timer === "number") window.clearInterval(callback.__timer as number);
    }
  };

  // Qualquer metodo nao implementado devolve um valor inocuo em vez de quebrar a tela.
  return new Proxy(api, {
    get(target, property: string) {
      if (property in target) return target[property];
      if (typeof property !== "string" || property.startsWith("__")) return undefined;
      if (!unhandled.has(property)) {
        unhandled.add(property);
        console.warn(`[screenshots] metodo nao mockado: ${property}`);
      }
      return () => delay(null);
    }
  });
}
