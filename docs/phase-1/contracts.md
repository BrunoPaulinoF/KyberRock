# Contracts - Fase 1

Status: draft inicial. Estes contratos guiam os futuros pacotes TypeScript; ainda nao sao codigo fonte.

## Tipos Base

```ts
export type UUID = string;
export type ISODateTime = string;
export type MoneyCents = number;
export type WeightKg = number;

export type DataSource = "kyberrock" | "omie" | "local" | "hybrid";

export type SyncStatus = "pending" | "running" | "done" | "failed" | "dead_letter";
```

## Multiunidade

```ts
export interface Company {
  id: UUID;
  legalName: string;
  tradeName?: string;
  document?: string;
}

export interface Unit {
  id: UUID;
  companyId: UUID;
  name: string;
  timezone: string;
  receiptSequence: number;
}

export interface Device {
  id: UUID;
  companyId: UUID;
  unitId: UUID;
  name: string;
  type: "desktop_scale";
  installationId: string;
  isActive: boolean;
}
```

## Balanca

```ts
export type ScaleAdapterType = "serial" | "usb_serial" | "tcp" | "http" | "file" | "custom";

export interface ScaleConfig {
  id: UUID;
  deviceId: UUID;
  adapterType: ScaleAdapterType;
  manufacturer?: string;
  model?: string;
  connectionConfig: Record<string, unknown>;
  stabilityConfig: {
    minStableReadings: number;
    maxVariationKg: number;
    stableWindowMs: number;
  };
  unit: "kg" | "ton" | "raw";
  kgFactor: number;
  isActive: boolean;
}

export interface ScaleReading {
  raw: string;
  weightKg: WeightKg;
  isStable: boolean;
  capturedAt: ISODateTime;
  status: "ok" | "unstable" | "disconnected" | "error";
  errorMessage?: string;
}

export interface ScaleAdapter {
  connect(config: ScaleConfig): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  read(): Promise<ScaleReading>;
  getStatus(): Promise<ScaleReading["status"]>;
}
```

Regra: a UI nunca recebe campo para digitar peso; ela apenas solicita captura ao adapter ativo.

## Impressao

```ts
export type PrintDocumentType = "receipt_80mm" | "report_a4";

export interface PrintProfile {
  id: UUID;
  deviceId: UUID;
  documentType: PrintDocumentType;
  windowsPrinterName: string;
  paperWidthMm?: number;
  marginsMm: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  font: {
    family?: string;
    sizePx: number;
  };
  copies: number;
  cutPaper: boolean;
  isActive: boolean;
}

export interface PrintJobResult {
  ok: boolean;
  printerName: string;
  printedAt?: ISODateTime;
  errorMessage?: string;
}
```

## Operacao De Pesagem

```ts
export type OperationStatus =
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

export type OperationType = "invoice" | "internal";

export interface FreightInfo {
  payer: "customer" | "quarry" | "third_party";
  carrierId?: UUID;
  distanceKm?: number;
  weightKg: WeightKg;
  calculationMode: "distance_weight" | "manual_adjustment";
  freightTotalCents: MoneyCents;
  omieMode?: "0" | "1" | "2" | "3" | "4" | "9";
}

export interface WeighingOperation {
  id: UUID;
  companyId: UUID;
  unitId: UUID;
  deviceId: UUID;
  status: OperationStatus;
  operationType: OperationType;
  customerId: UUID;
  vehicleId: UUID;
  driverId: UUID;
  carrierId?: UUID;
  productId: UUID;
  paymentTermId?: UUID;
  entryWeightKg: WeightKg;
  entryWeightCapturedAt: ISODateTime;
  exitWeightKg?: WeightKg;
  exitWeightCapturedAt?: ISODateTime;
  netWeightKg?: WeightKg;
  unitPriceCents?: MoneyCents;
  productTotalCents?: MoneyCents;
  freight?: FreightInfo;
  totalCents?: MoneyCents;
  omieSalesOrderId?: number;
  omieServiceOrderId?: number;
  cancelReason?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
```

## Sync Queue

```ts
export type SyncTarget = "cloud" | "omie";

export interface SyncQueueItem<TPayload = unknown> {
  id: UUID;
  target: SyncTarget;
  action:
    | "upsert_loading_request"
    | "upsert_operation"
    | "close_loading_request"
    | "create_customer"
    | "create_sales_order"
    | "create_service_order"
    | "cancel_sales_order"
    | "cancel_service_order";
  entityType: string;
  entityId: UUID;
  idempotencyKey: string;
  payload: TPayload;
  status: SyncStatus;
  attemptCount: number;
  nextAttemptAt: ISODateTime;
  lastError?: string;
}
```

## OMIE

```ts
export interface OmieRequest<TParam = unknown> {
  endpoint: string;
  call: string;
  param: TParam[];
}

export interface OmieResponse<TResult = unknown> {
  result: TResult;
}

export interface OmieError {
  code: number | string;
  description: string;
  fatal?: boolean;
}
```

Chamadas candidatas por area:

| Area             | Endpoint                         | Calls                                                               |
| ---------------- | -------------------------------- | ------------------------------------------------------------------- |
| Clientes         | `/api/v1/geral/clientes/`        | `ListarClientes`, `ConsultarCliente`, `UpsertCliente`               |
| Produtos         | `/api/v1/geral/produtos/`        | `ListarProdutos`, `ConsultarProduto`                                |
| Pedido           | `/api/v1/produtos/pedido/`       | `IncluirPedido`, `StatusPedido`, `ConsultarPedido`, `ExcluirPedido` |
| OS               | `/api/v1/servicos/os/`           | `IncluirOS`, `StatusOS`, `ConsultarOS`, `ExcluirOS`                 |
| Contas a receber | `/api/v1/financas/contareceber/` | `ListarContasReceber`, `ConsultarContaReceber`                      |

## Auditoria

```ts
export interface AuditLogEntry {
  id: UUID;
  companyId: UUID;
  unitId: UUID;
  deviceId?: UUID;
  entityType: string;
  entityId: UUID;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  createdAt: ISODateTime;
}
```

## Eventos Criticos Auditaveis

- Captura de peso de entrada.
- Captura de peso de saida.
- Alteracao de cliente, produto, veiculo, motorista, preco, condicao ou frete.
- Cancelamento de operacao.
- Reimpressao de cupom.
- Sincronizacao manual OMIE.
- Erros e reprocessamentos de sync.
