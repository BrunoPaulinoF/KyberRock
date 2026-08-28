# Data Model

Status: documento vivo. Reflete o schema local na **versão 57** das migrations
(`apps/desktop/src/database/migrations.ts`) e as migrations do Supabase em
`supabase/migrations/`.

> A fonte da verdade é o código: `migrations.ts` para o SQLite e `supabase/migrations/*.sql`
> para o Postgres. Este documento existe para dar o mapa — quais tabelas existem, para que
> servem, quais colunas importam e como os dois lados se relacionam. Colunas novas entram nas
> migrations e só aparecem aqui quando mudam o entendimento do modelo.

## Convenções

- Toda tabela operacional tem `id` UUID global.
- Datas em UTC ISO-8601 (texto no SQLite, `timestamptz` no Postgres).
- Dinheiro em centavos inteiros (`*_cents`).
- Pesos em kg (`REAL` no SQLite), arredondados a 3 casas no cálculo do líquido.
- Toda tabela sincronizável no SQLite tem `created_at`, `updated_at`, `deleted_at` e
  `sync_version`.
- **A exclusão lógica local vira `is_active = false` na nuvem.** As tabelas de cadastro
  espelhadas no Postgres não têm `deleted_at`; o push converte (`cloudActive` em
  `supabase-sync.ts`).
- Campos vindos do OMIE ficam bloqueados para edição local; a origem é marcada em `source`
  (`omie` | `local` | `hybrid`) e o par `omie_updated_at` / `local_updated_at` decide o conflito.

## Inventário SQLite (desktop)

41 tabelas, agrupadas por assunto:

| Grupo                | Tabelas                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade           | `companies`, `units`, `devices`, `local_settings`                                                                                           |
| Hardware             | `scale_configs`, `print_profiles`                                                                                                           |
| Cadastro operacional | `customers`, `products`, `vehicles`, `drivers`, `carriers`                                                                                  |
| Vínculos             | `customer_carriers`, `customer_vehicles`, `driver_carriers`, `vehicle_carriers`                                                             |
| Preço e frete        | `price_tables`, `price_table_items`, `customer_price_tables`, `customer_special_prices`, `product_default_prices`, `customer_freight_rules` |
| Pagamento            | `payment_terms`, `payment_methods`, `payment_method_aliases`, `accounts`                                                                    |
| Crédito              | `customer_credit_balances`, `customer_credit_movements`, `customer_future_billing_invoices`                                                 |
| Operação             | `weighing_operations`, `loading_requests`, `quotations`, `print_receipts`                                                                   |
| OMIE                 | `omie_sync_entities`, `omie_sync_runs`, `omie_raw_records`, `omie_categories`, `omie_payment_terms`                                         |
| Relatórios           | `report_recipients`                                                                                                                         |
| Infraestrutura       | `sync_queue`, `audit_logs`, `technical_logs`                                                                                                |

## Inventário Supabase Postgres

41 tabelas. As de cadastro e operação são projeção do SQLite; as demais nascem na nuvem.

| Grupo                   | Tabelas                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade e acesso     | `companies`, `units`, `device_registrations`, `user_profiles`, `user_password_vault`                                                                                                        |
| Projeção do cadastro    | `customers`, `products`, `vehicles`, `drivers`, `carriers`, `customer_carriers`, `customer_vehicles`, `driver_carriers`, `vehicle_carriers`, `accounts`, `payment_terms`, `payment_methods` |
| Projeção de preço/frete | `price_tables`, `price_table_items`, `customer_price_tables`, `customer_special_prices`, `product_default_prices`, `customer_freight_rules`                                                 |
| Projeção da operação    | `weighing_operations`, `loading_requests`, `print_receipts`, `quotations`, `audit_logs`                                                                                                     |
| Crédito                 | `customer_credit_balances`, `customer_credit_movements`, `customer_future_billing_invoices`                                                                                                 |
| Relatórios              | `report_recipients`, `report_channel_settings`, `daily_report_dispatches`, `financial_report_dispatches`                                                                                    |
| Cobrança da plataforma  | `billing_settings`, `billing_invoices`, `billing_events`                                                                                                                                    |
| Suporte e operação      | `whatsapp_connection_links`, `omie_missing_documents`, `ai_assistant_settings`                                                                                                              |

Tabelas que **não** sobem para a nuvem: `sync_queue`, `technical_logs`, `local_settings`,
`scale_configs`, `print_profiles`, `omie_*` e `payment_method_aliases` — são estado de máquina.

## Entidades Centrais

| Entidade            | SQLite                                                              | Supabase Postgres             | Observação                          |
| ------------------- | ------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| Empresa             | `companies`                                                         | `companies`                   | Multiempresa desde o início         |
| Unidade             | `units`                                                             | `units`                       | Pedreira/local operacional          |
| Dispositivo         | `devices` (espelho)                                                 | `device_registrations` (dono) | PC da balança                       |
| Cliente             | `customers`                                                         | `customers`                   | OMIE + bloco comercial da principal |
| Produto             | `products`                                                          | `products`                    | Origem OMIE                         |
| Transportadora      | `carriers`                                                          | `carriers`                    | Origem OMIE quando possível         |
| Veículo/motorista   | `vehicles`, `drivers`                                               | `vehicles`, `drivers`         | Cadastro KyberRock                  |
| Preço               | `price_tables`, `customer_special_prices`, `product_default_prices` | mesmas                        | Dono é a balança principal          |
| Forma/condição      | `payment_methods`, `payment_terms`                                  | mesmas                        | Condição vem do OMIE                |
| Operação            | `weighing_operations`                                               | `weighing_operations`         | Registro principal                  |
| Carregamento aberto | `loading_requests`                                                  | `loading_requests`            | É o que o carregador enxerga        |
| Cupom               | `print_receipts`                                                    | `print_receipts`              | Reimpressão auditada                |
| Fila de sync        | `sync_queue`                                                        | —                             | Local-only                          |
| Auditoria           | `audit_logs`                                                        | `audit_logs`                  | Histórico imutável                  |
| Logs técnicos       | `technical_logs`                                                    | —                             | Sem segredos                        |

## `weighing_operations` (SQLite, 69 colunas)

O registro principal. Por assunto:

| Assunto              | Colunas                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade e escopo  | `id`, `company_id`, `unit_id`, `device_id`, `operation_code`, `status`, `operation_type`                                                                                                                    |
| Partes               | `customer_id`, `vehicle_id`, `driver_id`, `carrier_id`, `product_id`                                                                                                                                        |
| Pesagem              | `entry_weight_kg`, `entry_weight_captured_at`, `exit_weight_kg`, `exit_weight_captured_at`, `net_weight_kg`                                                                                                 |
| Preço                | `unit_price_cents`, `base_unit_price_cents`, `price_unit`, `price_savings_percent`, `applied_price_table_id`, `applied_price_table_name`, `applied_price_table_item_id`                                     |
| Valores              | `product_total_cents`, `freight_total_cents`, `total_cents`                                                                                                                                                 |
| Frete                | `freight_type`, `freight_json`                                                                                                                                                                              |
| Pagamento            | `payment_term_id`, `payment_method_id`, `manual_installments`, `manual_down_payment_cents`                                                                                                                  |
| Crédito do cliente   | `deduct_freight_from_credit`, `product_credit_debit_cents`, `freight_credit_debit_cents`                                                                                                                    |
| Carteira             | `wallet_settlement_method_id`, `wallet_settlement_due_date`, `wallet_settled_at`, `wallet_settlement_note`                                                                                                  |
| Adiantamento OMIE    | `settle_from_advance`, `omie_advance_settle_cents`, `omie_advance_settled_cents`, `omie_advance_status`, `omie_advance_message`, `omie_advance_settled_at`                                                  |
| Integração OMIE      | `omie_sales_order_id`, `omie_service_order_id`, `omie_order_number`, `omie_invoice_number`, `omie_billing_status`, `omie_billing_message`, `omie_billed_at`, `omie_billing_checked_at`, `omie_document_url` |
| Faturamento futuro   | `future_billing_nfe_number`, `future_billing_invoice_id`                                                                                                                                                    |
| Origem remota        | `remote_plate`, `remote_driver_name`, `remote_customer_name`, `remote_product_description`                                                                                                                  |
| Sync e ciclo de vida | `cloud_synced_at`, `omie_synced_at`, `cancel_reason`, `quotation_id`, `created_at`, `updated_at`, `deleted_at`, `sync_version`                                                                              |

As colunas `remote_*` guardam o texto que veio de outra balança quando o id referenciado ainda não
chegou: a linha continua legível na tela mesmo antes de o cadastro sincronizar.

A projeção cloud (`weighing_operations` no Postgres, 51 colunas) é um subconjunto desnormalizado:
carrega `plate`, `customer_name`, `driver_name`, `product_description`, `carrier_name` já
resolvidos, e omite o que é só da máquina (capturas de peso com timestamp, mensagens de
faturamento, controle do adiantamento além de `omie_advance_settle_cents`).

## `customers` (SQLite, 61 colunas)

| Assunto                     | Colunas                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade                  | `id`, `company_id`, `source`, `legal_name`, `trade_name`, `document`, `is_individual`, `is_foreign`, `customer_type`                                                                                                                                            |
| Contato e endereço          | `phone`, `phone_secondary`, `email`, `homepage`, `contact_name`, `zipcode`, `address_*`, `neighborhood`, `city`, `state`, `country*`, `ibge_*`                                                                                                                  |
| OMIE                        | `omie_customer_id`, `omie_integration_code`, `state_registration`, `municipal_registration`, `tags_json`, `salesperson_id`, `internal_code`, `observations`                                                                                                     |
| Financeiro OMIE             | `credit_limit_cents`, `open_receivables_cents`, `omie_billing_blocked`, `financial_cache_at`                                                                                                                                                                    |
| **Bloco comercial/crédito** | `default_payment_method_id`, `default_carrier_id`, `nf_required`, `credit_mode`, `credit_account_enabled`, `credit_periodicity`, `credit_closing_day`, `credit_second_closing_day`, `credit_boleto_days`, `credit_second_boleto_days`, `credit_closing_weekday` |
| Outros padrões              | `default_payment_term_id`, `default_freight_modality`, `fiscal_emails`                                                                                                                                                                                          |
| Sync                        | `sync_status`, `needs_push`, `omie_updated_at`, `local_updated_at`, `last_synced_at`, `is_active`, `created_at`, `updated_at`, `deleted_at`, `sync_version`                                                                                                     |

O **bloco comercial/crédito** tem dono: só a balança principal o publica, e na nuvem
`customers.commercial_published_at` separa "a principal limpou o padrão" de "ninguém publicou
ainda". Regra completa em `docs/preco-balanca-principal.md`.

## Outras Tabelas Que Merecem Nota

- **`devices` (SQLite) × `device_registrations` (Postgres)**: o dono é a nuvem. O desktop reescreve
  seu espelho local com o que o `desktop-status` devolve a cada heartbeat — nome, cor e número do
  dispositivo mudam pelo painel. Só o Postgres tem `token_hash`, `update_channel`,
  `is_price_master`, `app_version` e `update_notice_*`.
- **`units`**: `receipt_sequence` (sequencial de cupom por unidade) é local; `avg_quarry_minutes`,
  `desktop_activation_code*` e `desktop_publishable_key` só existem na nuvem.
- **`loading_requests`**: projeção do que o carregador vê. Além do que o SQLite tem,
  `loader_completed_at` marca a conclusão feita pelo carregador no site e volta para a balança pelo
  pull. Não carrega dado financeiro.
- **`sync_queue`** (local-only): `target` (`cloud` | `omie`), `action`, `entity_type`, `entity_id`,
  `idempotency_key` (único), `payload_json`, `status` (`pending`/`running`/`done`/`failed`/
  `dead_letter`), `attempt_count`, `next_attempt_at`, `last_error`.
- **`customer_credit_movements`**: extrato de crédito. `source = 'omie'` marca o que veio espelhado
  do adiantamento (com `omie_title_id` como chave de idempotência); o que nasce localmente é
  consumo — débito no fechamento e estorno no cancelamento.
- **`quotations`**: orçamento aberto para um cliente/produto, consumido por uma operação
  (`consumed_operation_id`).
- **`omie_sync_entities` / `omie_sync_runs` / `omie_raw_records`**: cursor por entidade, histórico
  de execuções e payload bruto para diagnóstico. Estado de máquina, não sobem.
- **`local_settings`**: chave/valor JSON com a configuração da instalação (intervalos de sync,
  configuração do adiantamento, marcas de republicação pendente).
- **`billing_invoices` / `billing_settings` / `billing_events`**: cobrança da plataforma, só na
  nuvem. Ver `docs/financeiro.md`.

## Índices

Os índices acompanham as migrations. Os que sustentam o caminho quente:

SQLite:

- `customers(company_id, document)`, `products(company_id, omie_product_id)`,
  `vehicles(company_id, plate)`;
- `weighing_operations(unit_id, status, created_at)` e `(unit_id, vehicle_id, status)`;
- `sync_queue(status, target, next_attempt_at)`;
- `audit_logs(entity_type, entity_id, created_at)`;
- índices únicos **parciais em `deleted_at IS NULL`** nas tabelas de vínculo
  (`customer_vehicles`, `customer_carriers`, …), para o mesmo par poder ser desvinculado e
  religado sem colidir com o tombstone antigo.

Supabase Postgres:

- `loading_requests(unit_id, status, updated_at)`;
- `weighing_operations(unit_id, status, updated_at)` e `(company_id, unit_id, created_at)`;
- índices de `updated_at` por empresa que sustentam o **pull incremental**
  (`202608050002_incremental_pull_indexes.sql`) e os índices de FK
  (`202608050003_remaining_fk_indexes.sql`).

## Regras De Conflito

- Campos de origem OMIE vencem quando houver conflito.
- **Preço e bloco comercial/crédito do cliente têm dono**: a balança principal publica, a
  secundária cede. Entre duas principais o desempate é pelo `updated_at` da própria linha (empate
  no maior `id`), para as duas pontas decidirem igual seja qual for a ordem do sync. A política
  fica em `priceConflictPolicy` (`cloud` na secundária, `newest` entre principais, `local` sem
  principal) e a mesma regra vive nos dois runtimes — `cloudRowWins` no desktop, `winsConflict` na
  nuvem. Detalhe em `docs/preco-balanca-principal.md`.
- Nos demais campos exclusivos do KyberRock vence o `updated_at` mais recente.
- **O pull não apaga preço**: quem tira o par disputado é o tombstone que chega junto com o preço
  novo.
- Alterações críticas geram auditoria e não sobrescrevem silenciosamente.
- Operação fechada não é alterada sem registrar motivo; a correção é cancelar e refazer.
- Operação enviada ao OMIE respeita as regras de cancelamento/alteração do OMIE.
