# Data Model - Fase 1

Status: draft inicial.

## Convencoes

- Toda tabela operacional tem `id` UUID global.
- Tabelas locais podem ter `local_id` inteiro autoincrement para performance.
- Datas em UTC ISO-8601.
- Dinheiro em centavos inteiros quando possivel.
- Pesos em kg inteiros ou decimal controlado conforme precisao da balanca.
- Campos vindos do OMIE ficam marcados com `source = 'omie'` e bloqueados para edicao local quando aplicavel.
- Toda tabela sincronizavel tem `created_at`, `updated_at`, `deleted_at`, `sync_version`.

## Entidades Centrais

| Entidade            | SQLite                              | Supabase Postgres                         | Observacao                  |
| ------------------- | ----------------------------------- | ----------------------------------------- | --------------------------- |
| Empresa             | `companies`                         | `companies`                               | Multiempresa desde o inicio |
| Unidade             | `units`                             | `units`                                   | Pedreira/local operacional  |
| Dispositivo         | `devices`                           | `device_registrations`                    | PC da balanca               |
| Cliente             | `customers`                         | `customers`                               | OMIE ou local pendente      |
| Produto             | `products`                          | `products`                                | Origem OMIE                 |
| Transportadora      | `carriers`                          | Opcional                                  | Origem OMIE quando possivel |
| Veiculo             | `vehicles`                          | Opcional na fase inicial                  | Local operacional           |
| Motorista           | `drivers`                           | Opcional na fase inicial                  | Local operacional           |
| Tabela de preco     | `price_tables`, `price_table_items` | Opcional                                  | Fonte KyberRock             |
| Forma/condicao      | `payment_terms`                     | Opcional                                  | Origem OMIE                 |
| Operacao            | `weighing_operations`               | `weighing_operations`                     | Registro principal          |
| Carregamento aberto | derivado de operacao                | `loading_requests`                        | Projecao para carregador    |
| Cupom               | `print_receipts`                    | Opcional                                                        | Reimpressao auditada        |
| Fila sync           | `sync_queue`                        | Nao                                                             | Local-only                  |
| Auditoria           | `audit_logs`                        | Resumo opcional                                                 | Historico imutavel          |
| Logs tecnicos       | `technical_logs`                    | Agregado opcional                                               | Sem segredos                |

## SQLite Draft

### `companies`

| Campo        | Tipo    | Observacao                |
| ------------ | ------- | ------------------------- |
| `id`         | text pk | UUID global               |
| `legal_name` | text    | Razao social              |
| `trade_name` | text    | Nome fantasia             |
| `document`   | text    | CNPJ/CPF quando aplicavel |
| `created_at` | text    | UTC                       |
| `updated_at` | text    | UTC                       |

### `units`

| Campo              | Tipo    | Observacao                      |
| ------------------ | ------- | ------------------------------- |
| `id`               | text pk | UUID global                     |
| `company_id`       | text fk | Empresa                         |
| `name`             | text    | Nome da pedreira/unidade        |
| `timezone`         | text    | Ex.: `America/Sao_Paulo`        |
| `receipt_sequence` | integer | Sequencial de cupom por unidade |
| `created_at`       | text    | UTC                             |
| `updated_at`       | text    | UTC                             |

### `devices`

| Campo             | Tipo    | Observacao                      |
| ----------------- | ------- | ------------------------------- |
| `id`              | text pk | UUID global                     |
| `company_id`      | text fk | Empresa                         |
| `unit_id`         | text fk | Unidade                         |
| `name`            | text    | Identificacao do PC             |
| `device_type`     | text    | `desktop_scale` inicialmente    |
| `installation_id` | text    | Identificador local persistente |
| `is_active`       | integer | 0/1                             |
| `created_at`      | text    | UTC                             |
| `updated_at`      | text    | UTC                             |

### `scale_configs`

| Campo                    | Tipo    | Observacao                                |
| ------------------------ | ------- | ----------------------------------------- |
| `id`                     | text pk | UUID global                               |
| `device_id`              | text fk | Dispositivo                               |
| `adapter_type`           | text    | `serial`, `tcp`, `http`, `file`, `custom` |
| `manufacturer`           | text    | Ex.: Toledo                               |
| `model`                  | text    | Ex.: 950 IDLCG 2                          |
| `connection_config_json` | text    | Porta, host, baud etc. sem segredo        |
| `stability_config_json`  | text    | Regra de estabilidade                     |
| `unit`                   | text    | Unidade recebida da balanca               |
| `kg_factor`              | real    | Conversao para kg                         |
| `is_active`              | integer | 0/1                                       |

### `print_profiles`

| Campo                  | Tipo    | Observacao                  |
| ---------------------- | ------- | --------------------------- |
| `id`                   | text pk | UUID global                 |
| `device_id`            | text fk | Dispositivo                 |
| `document_type`        | text    | `receipt_80mm`, `report_a4` |
| `windows_printer_name` | text    | Nome exato no Windows       |
| `paper_width_mm`       | integer | 80 para cupom               |
| `margin_json`          | text    | Margens                     |
| `font_config_json`     | text    | Fonte/tamanho               |
| `copies`               | integer | Padrao 1                    |
| `cut_paper`            | integer | 0/1                         |
| `is_active`            | integer | 0/1                         |

### `customers`

| Campo                    | Tipo             | Observacao                                        |
| ------------------------ | ---------------- | ------------------------------------------------- |
| `id`                     | text pk          | UUID global                                       |
| `company_id`             | text fk          | Empresa                                           |
| `omie_customer_id`       | integer nullable | `codigo_cliente_omie`                             |
| `omie_integration_code`  | text nullable    | `codigo_cliente_integracao`                       |
| `source`                 | text             | `omie`, `local`, `hybrid`                         |
| `legal_name`             | text             | Razao social                                      |
| `trade_name`             | text             | Nome fantasia                                     |
| `document`               | text             | CPF/CNPJ                                          |
| `phone`                  | text nullable    | Telefone                                          |
| `email`                  | text nullable    | E-mail                                            |
| `credit_limit_cents`     | integer nullable | OMIE; zero/vazio desconsidera bloqueio por limite |
| `open_receivables_cents` | integer          | Cache financeiro                                  |
| `omie_billing_blocked`   | integer          | `bloquear_faturamento`                            |
| `financial_cache_at`     | text nullable    | UTC                                               |
| `sync_status`            | text             | `synced`, `pending`, `error`                      |
| `is_active`              | integer          | 0/1                                               |

### `products`

| Campo                   | Tipo          | Observacao                  |
| ----------------------- | ------------- | --------------------------- |
| `id`                    | text pk       | UUID global                 |
| `company_id`            | text fk       | Empresa                     |
| `omie_product_id`       | integer       | `codigo_produto`            |
| `omie_integration_code` | text nullable | `codigo_produto_integracao` |
| `code`                  | text          | Codigo visivel/SKU OMIE     |
| `description`           | text          | Descricao                   |
| `unit`                  | text          | Unidade OMIE                |
| `is_active`             | integer       | 0/1                         |
| `updated_from_omie_at`  | text          | UTC                         |

### `vehicles`

| Campo         | Tipo          | Observacao     |
| ------------- | ------------- | -------------- |
| `id`          | text pk       | UUID global    |
| `company_id`  | text fk       | Empresa        |
| `plate`       | text          | Normalizada    |
| `description` | text nullable | Tipo/modelo    |
| `carrier_id`  | text nullable | Transportadora |
| `is_active`   | integer       | 0/1            |

### `drivers`

| Campo        | Tipo          | Observacao   |
| ------------ | ------------- | ------------ |
| `id`         | text pk       | UUID global  |
| `company_id` | text fk       | Empresa      |
| `name`       | text          | Nome         |
| `document`   | text nullable | CPF opcional |
| `phone`      | text nullable | Opcional     |
| `is_active`  | integer       | 0/1          |

### `carriers`

| Campo              | Tipo             | Observacao                                                 |
| ------------------ | ---------------- | ---------------------------------------------------------- |
| `id`               | text pk          | UUID global                                                |
| `company_id`       | text fk          | Empresa                                                    |
| `omie_customer_id` | integer nullable | OMIE usa cadastro de clientes/fornecedores/transportadoras |
| `name`             | text             | Nome                                                       |
| `document`         | text nullable    | CPF/CNPJ                                                   |
| `source`           | text             | `omie`, `local`                                            |
| `is_active`        | integer          | 0/1                                                        |

### `payment_terms`

| Campo        | Tipo    | Observacao                     |
| ------------ | ------- | ------------------------------ |
| `id`         | text pk | UUID global                    |
| `company_id` | text fk | Empresa                        |
| `omie_code`  | text    | Codigo OMIE, ex. parcela/forma |
| `name`       | text    | Descricao                      |
| `rules_json` | text    | Regras como quinzenal/mensal   |
| `is_active`  | integer | 0/1                            |

### `price_tables` e `price_table_items`

`price_tables`: `id`, `company_id`, `name`, `is_active`, `valid_from`, `valid_to`.

`price_table_items`: `id`, `price_table_id`, `product_id`, `unit_price_cents`, `unit`, `valid_from`, `valid_to`.

### `customer_price_tables`

Vincula cliente a tabela: `id`, `customer_id`, `price_table_id`, `valid_from`, `valid_to`, `is_active`.

### `weighing_operations`

| Campo                      | Tipo             | Observacao                                  |
| -------------------------- | ---------------- | ------------------------------------------- |
| `id`                       | text pk          | UUID global                                 |
| `company_id`               | text fk          | Empresa                                     |
| `unit_id`                  | text fk          | Unidade                                     |
| `device_id`                | text fk          | Dispositivo                                 |
| `status`                   | text             | Enum operacional                            |
| `operation_type`           | text             | `invoice`, `internal`                       |
| `customer_id`              | text fk          | Cliente                                     |
| `vehicle_id`               | text fk          | Veiculo                                     |
| `driver_id`                | text fk          | Motorista                                   |
| `carrier_id`               | text nullable    | Transportadora                              |
| `product_id`               | text fk          | Produto                                     |
| `payment_term_id`          | text nullable    | Condicao                                    |
| `entry_weight_kg`          | real             | Peso automatico                             |
| `entry_weight_captured_at` | text             | UTC                                         |
| `exit_weight_kg`           | real nullable    | Peso automatico                             |
| `exit_weight_captured_at`  | text nullable    | UTC                                         |
| `net_weight_kg`            | real nullable    | Saida - entrada                             |
| `unit_price_cents`         | integer nullable | Preco produto                               |
| `product_total_cents`      | integer nullable | Produto                                     |
| `freight_total_cents`      | integer          | Frete separado                              |
| `total_cents`              | integer nullable | Produto + frete                             |
| `freight_json`             | text nullable    | Regra aplicada, distancia, peso, modalidade |
| `omie_sales_order_id`      | integer nullable | Pedido OMIE                                 |
| `omie_service_order_id`    | integer nullable | OS OMIE                                     |
| `cloud_synced_at`          | text nullable    | UTC                                         |
| `omie_synced_at`           | text nullable    | UTC                                         |
| `cancel_reason`            | text nullable    | Obrigatorio no cancelamento                 |
| `created_at`               | text             | UTC                                         |
| `updated_at`               | text             | UTC                                         |

### `loading_requests`

Projecao local da fila do carregador: `id`, `operation_id`, `company_id`, `unit_id`, `status`, `plate`, `customer_name`, `driver_name`, `product_description`, `created_at`, `closed_at`.

### `print_receipts`

`id`, `operation_id`, `unit_id`, `receipt_number`, `copy_number`, `content_snapshot_json`, `printed_at`, `printer_name`, `status`, `error_message`.

### `sync_queue`

| Campo             | Tipo          | Observacao                                            |
| ----------------- | ------------- | ----------------------------------------------------- |
| `id`              | text pk       | UUID global                                           |
| `target`          | text          | `cloud`, `omie`                                    |
| `action`          | text          | Ex.: `upsert_operation`, `create_sales_order`         |
| `entity_type`     | text          | Ex.: `operation`                                      |
| `entity_id`       | text          | UUID                                                  |
| `idempotency_key` | text unique   | Chave externa                                         |
| `payload_json`    | text          | Snapshot sem segredo                                  |
| `status`          | text          | `pending`, `running`, `done`, `failed`, `dead_letter` |
| `attempt_count`   | integer       | Tentativas                                            |
| `next_attempt_at` | text          | Backoff                                               |
| `last_error`      | text nullable | Sanitizado                                            |
| `created_at`      | text          | UTC                                                   |
| `updated_at`      | text          | UTC                                                   |

### `audit_logs`

`id`, `company_id`, `unit_id`, `device_id`, `entity_type`, `entity_id`, `action`, `before_json`, `after_json`, `reason`, `created_at`.

### `technical_logs`

`id`, `level`, `source`, `message`, `context_json`, `created_at`. Nao salvar segredos nem payloads OMIE completos com dados sensiveis.

## Supabase Postgres Draft

```text
companies
units
device_registrations
user_profiles
customers
products
weighing_operations
loading_requests
print_receipts
audit_logs
```

## Supabase Postgres Tabelas Principais

### `loading_requests`

Campos minimos para carregador:

- `company_id`
- `unit_id`
- `operation_id`
- `status`
- `plate`
- `customer_name`
- `driver_name`
- `product_description`
- `entry_weight_kg`
- `created_at`
- `updated_at`

Nao incluir dados financeiros sensiveis se o carregador nao precisa deles.

### `weighing_operations`

Versao cloud resumida da operacao para suporte, auditoria e dashboards. Deve conter pesos, status, valores principais e ids externos, mas regras de acesso precisam restringir quem pode ler.

## Indices Iniciais

SQLite:

- `customers(company_id, document)`
- `products(company_id, omie_product_id)`
- `vehicles(company_id, plate)`
- `weighing_operations(unit_id, status, created_at)`
- `weighing_operations(unit_id, vehicle_id, status)`
- `sync_queue(status, target, next_attempt_at)`
- `audit_logs(entity_type, entity_id, created_at)`

Supabase Postgres:

- `loading_requests`: `unit_id + status + updated_at`
- `weighing_operations`: `unit_id + status + updated_at`
- `weighing_operations`: `company_id + unit_id + created_at`

## Regras De Conflito

- Campos de origem OMIE vencem quando houver conflito.
- Campos exclusivos KyberRock vencem pelo `updated_at` mais recente quando nao forem criticos.
- Alteracoes criticas geram auditoria e nao sobrescrevem silenciosamente.
- Operacao fechada nao deve ser alterada sem registrar motivo.
- Operacao enviada ao OMIE deve respeitar regras de cancelamento/alteracao do OMIE.
