# Contracts

Status: documento vivo. Os contratos deixaram de ser esboço — todos existem em código. Este
documento diz **onde cada um vive** e registra as decisões de contrato que não se leem no tipo.

## Onde vive cada contrato

| Contrato                              | Arquivo                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| Tipos de domínio e status da operação | `packages/shared/src/operation.ts`, `ids.ts`, `format.ts`         |
| Adapter de balança                    | `packages/scale-adapters/src/scale-adapter.ts`                    |
| Cupom e relatório                     | `packages/print-templates/src/receipt-template.ts`                |
| Cliente OMIE (por serviço)            | `packages/omie-client/src/*-service.ts`                           |
| Fronteira renderer ↔ main             | `apps/desktop/src/preload/preload.ts` + `renderer/desktop-api.ts` |
| Push/pull do desktop                  | `supabase/functions/desktop-sync`, `desktop-pull`                 |
| Heartbeat e bloqueio                  | `supabase/functions/desktop-status`                               |
| Ativação da balança                   | `supabase/functions/desktop-activate`                             |
| API do painel                         | `supabase/functions/admin-api`, `admin-auth`, `admin-billing`     |

## Tipos Base

```ts
export type UUID = string;
export type ISODateTime = string;
export type MoneyCents = number;
export type WeightKg = number;

export type DataSource = "kyberrock" | "omie" | "local" | "hybrid";
export type SyncStatus = "pending" | "running" | "done" | "failed" | "dead_letter";
```

## Operação

`OPERATION_STATUSES` e `isTerminalOperationStatus` vivem em `packages/shared/src/operation.ts` —
é a única definição, consumida pelo desktop, pelo loader-web e pelas Edge Functions.
`calculateNetWeightKg` recusa peso negativo e recusa saída menor ou igual à entrada: **não existe
caminho que produza peso líquido inválido**.

`operation_type` é `invoice` (com nota → pedido de venda no OMIE) ou `internal` (interna → ordem
de serviço).

### Frete

As modalidades reais estão em `apps/desktop/src/services/freight.ts` (`FREIGHT_MODALITIES`) —
quatro situações que o operador escolhe, em dois grupos:

| Chave         | Grupo     | O que sai na nota                             | Código OMIE |
| ------------- | --------- | --------------------------------------------- | ----------- |
| `fob`         | com frete | valor do frete + transportador; soma no total | `1`         |
| `cif`         | com frete | só o transportador; valor fica no KyberRock   | `1`         |
| `third_party` | sem frete | só o transportador                            | `1`         |
| `none`        | sem frete | nem transportador nem valor                   | `9`         |

`third_party` é o padrão de quem não informou nada — é o comportamento histórico da balança.
`own_sender` e `own_recipient` são **legado**: não aparecem mais no seletor, mas continuam
gravados em operações fechadas e na memória de frete dos clientes, e por isso seguem em
`LEGACY_FREIGHT_MODALITIES` para leitura.

## Balança

```ts
export const SCALE_CONNECTION_TYPES = ["serial", "usb_serial", "tcp", "http", "file", "custom"];

export type ScaleStatus =
  | "stable"
  | "unstable"
  | "overload"
  | "negative"
  | "zero"
  | "no_data"
  | "error";

export interface ScaleReading {
  weightKg: number;
  unit: "kg";
  status: ScaleStatus;
  stable: boolean;
  capturedAt: string;
  receivedAt: string;
  rawFrame?: string;
  deviceId?: string;
  adapterName?: string;
}

export interface ScaleAdapter {
  read: () => Promise<ScaleReading>;
}
```

O contrato do adapter é deliberadamente mínimo — só `read()`. Conexão, reconexão com backoff e
parsing de protocolo são responsabilidade de cada adapter (`toledo/`, `virtual-scale-adapter.ts`),
não da interface. A normalização para kg (`normalizeScaleReading`) e a captura estável
(`ScaleSamplingOptions`: janela, variação máxima, peso mínimo) são compartilhadas.

Implementados: Toledo serial, Toledo TCP e balança virtual. `usb_serial`, `http`, `file` e
`custom` estão no enum e ainda não têm adapter.

Regra que o contrato sustenta: **a UI nunca recebe campo para digitar peso**; ela só pede captura
ao adapter ativo, e sem adapter funcional a pesagem fica bloqueada.

## Impressão

```ts
export type PrintDocumentType = "receipt_80mm" | "report_a4";
```

Perfil por dispositivo e tipo de documento (impressora do Windows, largura, margens, fonte,
cópias, corte). Dois caminhos de saída: `webContents.print` e ESC-POS bruto (inclusive por rede).
Cada tentativa vira uma linha em `print_receipts` — falha de impressão **não** altera nem apaga a
operação fechada.

## Fronteira Renderer ↔ Main (IPC)

É o contrato mais usado do sistema: ~224 canais `desktop:*`, todos declarados em
`src/preload/preload.ts` e tipados para o renderer em `src/renderer/desktop-api.ts`. Não há outra
porta — o renderer roda com `contextIsolation` ligado e `nodeIntegration` desligado.

Grupos de canais:

| Grupo              | Exemplos                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acesso e status    | `activate`, `validate-access`, `get-access-status`, `get-status`, `logout`                                                                                     |
| Balança            | `scale-connect`, `scale-read`, `scale-capture-stable`, `scale-discover`, `virtual-scale-*`                                                                     |
| Operação           | `start-weighing`, `close-weighing`, `cancel-weighing`, `update-weighing-*`, `list-*-weighing-operations`                                                       |
| Impressão          | `print-receipt`, `reprint-receipt`, `list-windows-printers`, `list-print-profiles`                                                                             |
| Cadastro           | `customers-*`, `vehicles-*`, `drivers-*`, `carriers-*`, `payment-*`, `accounts-*`                                                                              |
| Preço e frete      | `get-price`, `price-tables-*`, `customer-special-prices-*`, `product-default-prices-*`, `*-customer-freight-*`, `price-authority-get`, `verify-price-password` |
| Crédito e carteira | `customer-credit-*`, `wallet-*`, `*-future-billing-*`, `invoice-closing-*`                                                                                     |
| OMIE               | `omie-sync`, `omie-queue-*`, `omie-scheduler-*`, `bill-fiscal-operation`, `operation-omie-issue`, `reconcile-omie-invoice-numbers`                             |
| Nuvem              | `sync-to-cloud`, `cloud-sync-now`, `pull-cloud-now`, `cloud-scheduler-*`, `get-cloud-status`, `bootstrap-cloud-data`                                           |
| Relatórios         | `get-daily-report`, `get-monthly-report`, `get-report-by-*`, `export-report-*`, `report-dispatch-*`, `report-channels-*`, `*-report-recipient`                 |
| WhatsApp           | `whatsapp-connect`, `whatsapp-status`, `whatsapp-connection-link-*`                                                                                            |
| Atualização        | `check-for-updates`, `download-and-install-update`, `get-update-state`, `update-*` (eventos)                                                                   |
| Ajuda              | `docs-assistant-ask`                                                                                                                                           |
| Backup             | `export-backup`, `restore-backup`                                                                                                                              |

Canais `update-available`, `update-download-progress` e `update-downloaded` são **eventos**
main → renderer; o resto é `invoke`/`handle`.

## Fila De Sync

```ts
export type SyncTarget = "cloud" | "omie";

export interface SyncQueueItem<TPayload = unknown> {
  id: UUID;
  target: SyncTarget;
  action: string; // upsert_operation, create_sales_order, settle_advance, ...
  entityType: string;
  entityId: UUID;
  idempotencyKey: string; // kyberrock:{unitId}:{operationId}:{action}
  payload: TPayload;
  status: SyncStatus;
  attemptCount: number;
  nextAttemptAt: ISODateTime;
  lastError?: string;
}
```

`idempotency_key` é único na tabela: enfileirar de novo a mesma intenção não cria segunda linha.
O ciclo, o backoff e o tratamento de `dead_letter` estão em `sync-strategy.md`.

## Contrato Desktop ↔ Nuvem

Todas as chamadas levam o token do dispositivo; a Edge Function resolve empresa e unidade a partir
dele (`_shared/device-scope.ts`) — o cliente **não** escolhe o escopo que quer ler.

| Função             | Entrada relevante                                                              | Saída relevante                                                   |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `desktop-activate` | `activationCode`, `deviceName`, `installationId`, `previousDeviceId`, `unitId` | registro do dispositivo + token                                   |
| `desktop-status`   | token, `appVersion`                                                            | empresa/unidade, nome e cor, canal, balanças principais, bloqueio |
| `desktop-sync`     | operações, cupons e cadastro compartilhado                                     | o que foi aceito, o que conflitou                                 |
| `desktop-pull`     | `cadastroSince`, `historySince`                                                | cadastro compartilhado e histórico, paginados por `id`            |

O `cadastroSince`/`historySince` fazem o pull incremental; omiti-los pede a passada completa, que
se autocorrige. A ordem de gravação no desktop importa — `carriers` e `payment_methods` **antes**
de `customers`, porque o bloco comercial referencia ids que precisam existir do lado de cá.

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

A classificação de falha (o que é retentável e o que é erro definitivo) vive em
`apps/desktop/src/services/omie-fault-classifier.ts`. Limites de campo do OMIE, formatação de data
e tags ficam em `packages/omie-client/src/omie-field-limits.ts`, `omie-dates.ts` e `omie-tags.ts`.

Endpoints e chamadas em uso: ver `docs/ARCHITECTURE.md`, seção OMIE.

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

### Eventos críticos auditáveis

- Captura de peso de entrada e de saída.
- Alteração de cliente, produto, veículo, motorista, preço, condição ou frete.
- Cancelamento de operação (motivo obrigatório).
- Reimpressão de cupom.
- Sincronização manual OMIE.
- Erros e reprocessamentos de sync.
- Revelação de credenciais no painel (`credentials_revealed`) — **sem o valor revelado**.
