# `web-api` — contrato do site web com a nuvem

Versão: 1.1 — 22/09/2026 (carteira e fechamento de faturas)
Contexto: `docs/plano-migracao-web.md` (Etapa 1, decisões D3 e D4). Este é o documento que o
site (`apps/web`, workspace `@kyberrock/web`) precisa para falar com o Supabase do KyberRock.

## Em uma frase

O site **lê** o Postgres direto (com o login do usuário e RLS) e **grava** só pela Edge Function
`web-api`. Nunca `insert`/`update` direto do navegador: as tabelas de cadastro recusam
(`no direct client access`), e é assim que as regras ficam num lugar só.

## 1. Configuração do site

| Variável                        | Valor                                                  |
| ------------------------------- | ------------------------------------------------------ |
| `VITE_SUPABASE_URL`             | `https://vksihzfrgqoemcqpquit.supabase.co`             |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | a chave **publicável** do projeto (painel do Supabase) |

Nunca a chave de serviço no site. Tipos das tabelas: gerar com
`supabase gen types typescript --project-id vksihzfrgqoemcqpquit --schema public`, nunca
escrever à mão.

## 2. Login e perfis

Login por e-mail e senha no Supabase Auth (`supabase.auth.signInWithPassword`). Depois do login,
o perfil está em `user_profiles` (o usuário só enxerga a própria linha):

```ts
const { data: profile } = await supabase
  .from("user_profiles")
  .select("id, email, name, role, company_id, unit_id, is_active")
  .eq("id", session.user.id)
  .single();
```

| `role`          | Telas no site                                                                                                                     | Grava pela `web-api`                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `monitoramento` | Só **Monitoramento** (vendas em tempo real), sem configurações                                                                    | Nada — só consulta (403 em toda escrita)                                                                                                        |
| `comercial`     | Insights, Conferência de faturamento, Relatórios, Controle de caminhões, Relatório por cliente e **Cadastros**, sem configurações | Todo o cadastro (cliente, bloco comercial, frota e preço), **sem senha de preço**; não pesa, não mexe em carteira, fechamento nem destinatários |
| `gestor`        | Todas, **menos a Nova entrada**, com configurações                                                                                | Tudo, menos a Nova entrada (`request_operation` `entry`)                                                                                        |
| `operacao`      | Todas, com configurações                                                                                                          | Tudo; mudar preço **sempre** pede a senha da pedreira                                                                                           |
| `administrador` | Todas **+ Logs** (suporte), com configurações                                                                                     | Tudo, sem senha nenhuma, **+ `support_overview`**                                                                                               |
| `loader`        | Só a fila da unidade (tela `/carregamento`)                                                                                       | Nada — a `web-api` responde 403                                                                                                                 |

Para LEITURA (RLS) os cinco perfis do site enxergam o mesmo — a empresa inteira; o que muda é a
tela e a escrita. As telas de cada perfil estão em `apps/web/src/lib/permissions.ts`
(`SCREENS_BY_ROLE`): a que não é do perfil nem aparece no menu, e o endereço digitado à mão volta
para a tela inicial dele. `administrador` entrou na migração
`202609260001_perfis_por_tela_e_aviso_de_vendas`. A regra de quem grava o quê vive em
`_shared/web-session.ts` (`canWrite`, `canCreateEntry`, `canSeeSupport`,
`requiresPricePasswordFor`) e o mapa ação → grupo em `web-api/handler.ts` (`actionDenial`); um
teste garante que toda ação nova caia em algum grupo, para nenhuma nascer liberada a quem só
consulta. `me` devolve `canManagePrices`, `canEditPrices`, `canEditCustomers`, `canEditFleet`,
`canOperate`, `canCreateEntry`, `canSeeSupport` e `requiresPricePassword`.

**Senha de preço.** Quem tem `requiresPricePassword` digita a senha de alteração de preço da
pedreira (`companies.price_change_password`, a mesma da balança) para mudar preço — o da
pesagem (`request_operation` `update` com `unitPriceCents`) e o do cadastro (todas as ações de
4.6, inclusive remover). A `operacao` sempre pede, o `administrador` e o `comercial` nunca
(negociar preço é o trabalho do comercial), e o `gestor` segue a marca "Pede senha de preço" do
login no painel. Cinco erros em 15 minutos travam o
login por 15 minutos (429). Pedreira sem senha definida responde 403 pedindo para definir no
painel, sem contar como erro.

O carregador e o comercial ainda entram também pelo KyberRock Portal (`apps/loader-web`); o
portal deixa de receber os dois depois dos testes.

Quem cria usuários é o painel `/admin` da Kybernan: aba **Acessos do sistema** (um login por
computador cadastrado, coluna "Login do site", gravado com `user_profiles.device_id`) ou
**Usuários do site** (login sem computador). O perfil troca na própria linha
(`update_user_role` na `admin-api`).

## 3. Leitura (RLS)

Com o usuário logado, o `supabase-js` já manda o token; basta consultar. A migração
`202609220003_web_access_roles` abre leitura, sempre **da própria empresa**, em:

`customers`, `products`, `carriers`, `drivers`, `vehicles`, `customer_vehicles`,
`customer_carriers`, `driver_carriers`, `vehicle_carriers`, `product_default_prices`,
`customer_special_prices`, `price_tables`, `price_table_items`, `customer_price_tables`,
`customer_freight_rules`, `customer_future_billing_invoices`, `payment_terms`,
`payment_methods`, `accounts`, `customer_credit_movements`, `customer_credit_balances`,
`quotations`, `loading_requests`, `weighing_operations`, `billing_requests`, `units`, `companies`.

Regras de leitura que o site precisa respeitar:

- **Linha viva** é `deleted_at is null`. `is_active = false` é **inativo** (continua na lista,
  com a marca) — excluído e inativo são coisas diferentes.
- **Documento** (`customers.document`) está sem máscara e pode ter **letras** (CNPJ
  alfanumérico). Para exibir, formate; para comparar, compare sem pontuação e sem diferenciar
  caixa — nunca `replace(/\D/g, "")`.
- **Preço** está em **centavos** (`unit_price_cents`) e a unidade em `unit` (`ton`).
- Um cliente tem no máximo **uma** linha viva em `customer_price_tables`.
- `weighing_operations`: para relatórios de dinheiro, recorte pela data de **fechamento**
  (`closed_at`/data de saída), não por `created_at` — ver CLAUDE.md, "Data da pesagem nos
  relatórios".

Realtime: a tabela `cadastro_change_pings` (uma linha por empresa) é publicada no Realtime e
muda a cada escrita de cadastro. Assinar `company_id=eq.<sua empresa>` e recarregar a lista
aberta é o jeito barato de o site refletir o que a balança acabou de cadastrar.

## 4. Escrita (`web-api`)

```ts
const { data, error } = await supabase.functions.invoke("web-api", {
  body: {
    action: "upsert_customer",
    payload: { legalName: "Polymix Ltda", document: "11.222.333/0001-81" }
  }
});
```

O `supabase-js` manda o token da sessão sozinho. Toda resposta de sucesso é
`{ ok: true, ...resultado, warnings: string[] }`; erro é `{ error: string }` com o status HTTP:

| Status | Significado                                                                                |
| ------ | ------------------------------------------------------------------------------------------ |
| 400    | Payload inválido — a mensagem é para mostrar ao usuário                                    |
| 401    | Sem sessão — mandar para o login                                                           |
| 403    | Perfil sem permissão para a ação (ex.: comercial pedindo pesagem) ou senha de preço errada |
| 404    | Id não encontrado **na empresa do usuário**                                                |
| 409    | Conflito: CNPJ/CPF ou placa já cadastrados (a mensagem diz quem)                           |
| 503    | Banco indisponível — tentar de novo                                                        |

`warnings` nunca é erro: o cadastro **foi gravado**. Ele avisa, por exemplo, que o OMIE não
aceitou agora (a próxima edição tenta de novo) ou que o cliente ficou sem documento.

Convenções de payload: campos em **camelCase**; campo **ausente** não mexe na coluna; campo
**`null`** limpa a coluna; datas em `AAAA-MM-DD`; preço em **centavos inteiros**.

### 4.1 Sessão

| Ação | Payload | Devolve                                                                                                                                                                                            |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `me` | —       | `user { id, email, name, role, unitId, canManagePrices, canEditPrices, canEditCustomers, canEditFleet, canOperate, canCreateEntry, canSeeSupport, requiresPricePassword }`, `companyId`, `units[]` |

### 4.2 Cliente (comercial, gestor, operação e administrador)

| Ação                  | Payload                                                                                                                                                                                                                                                                                                                  | Devolve                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `upsert_customer`     | `id?` (sem id cria), `legalName` (obrigatório ao criar), `tradeName?`, `document?`, `email?`, `phone?`, `phoneSecondary?`, `contactName?`, `zipcode?`, `addressStreet?`, `addressNumber?`, `addressComplement?`, `neighborhood?`, `city?`, `state?` (UF), `stateRegistration?`, `observations?`, `defaultPaymentTermId?` | `id`, `omieCustomerId \| null` |
| `set_customer_active` | `id`, `isActive: boolean`                                                                                                                                                                                                                                                                                                | `id`, `isActive`               |

O que acontece por baixo no `upsert_customer`: valida o documento (CPF/CNPJ, inclusive
alfanumérico), recusa documento repetido na empresa (409, citando quem já tem — e se está
inativo), grava, e **manda para o OMIE** pelo mesmo caminho da balança (`push_customer`, com o
cliente virando "alteração" quando já tem código OMIE). Cliente sem documento é gravado mas não
vai ao OMIE (o OMIE exige) — vem um `warning`.

**Não existe excluir cliente pela `web-api`.** Cliente com histórico só inativa; cadastro
repetido se unifica na balança ("Cadastros repetidos"). É a regra D7 do plano.

### 4.3 Bloco comercial e crédito (comercial, gestor, operação e administrador)

| Ação                      | Payload                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `set_customer_commercial` | `id`, e um ou mais de: `defaultPaymentMethodId?`, `defaultCarrierId?`, `defaultFreightModality?`, `nfRequired?: boolean`, `creditAccountEnabled?: boolean`, `creditMode?: "normal" \| "prepaid"`, `creditPeriodicity?: "monthly" \| "biweekly" \| "weekly"`, `creditClosingDay?` (1–31), `creditSecondClosingDay?` (1–31), `creditBoletoDays?` (0–365), `creditSecondBoletoDays?` (0–365), `creditClosingWeekday?` (0–6) |

Grava só o que veio e carimba `commercial_published_at` — é essa marca que faz as balanças
adotarem o bloco. `defaultCarrierId` e `defaultPaymentMethodId` precisam existir na empresa.

### 4.4 Transportadora, motorista, veículo (comercial, gestor, operação e administrador)

| Ação                 | Payload                                                                                | Devolve                        |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `upsert_carrier`     | `id?`, `name` (obrigatório ao criar), `document?`                                      | `id`, `omieCustomerId \| null` |
| `set_carrier_active` | `id`, `isActive`                                                                       | `id`, `isActive`               |
| `upsert_driver`      | `id?`, `name` (obrigatório ao criar), `document?`, `phone?`, `isIndependent?: boolean` | `id`                           |
| `set_driver_active`  | `id`, `isActive`                                                                       | `id`, `isActive`               |
| `upsert_vehicle`     | `id?`, `plate` (obrigatório ao criar), `description?`, `carrierId?`                    | `id`                           |
| `set_vehicle_active` | `id`, `isActive`                                                                       | `id`, `isActive`               |

A placa é gravada em maiúsculas, sem espaço nem hífen (`ABC1D23`); placa repetida na empresa é 409. A transportadora com documento também sobe para o OMIE (`push_carrier`).

### 4.5 Vínculos (comercial, gestor, operação e administrador)

| Ação                   | Payload                               |
| ---------------------- | ------------------------------------- |
| `set_customer_vehicle` | `customerId`, `vehicleId`, `isActive` |
| `set_customer_carrier` | `customerId`, `carrierId`, `isActive` |
| `set_driver_carrier`   | `driverId`, `carrierId`, `isActive`   |
| `set_vehicle_carrier`  | `vehicleId`, `carrierId`, `isActive`  |

`isActive: false` desfaz o vínculo (a linha fica, inativa). Repetir com `true` reaproveita a
mesma linha — nunca nasce um par duplicado.

### 4.6 Preços (comercial, gestor, operação e administrador — com a senha de preço de quem precisa)

| Ação                            | Payload                                                                          | Devolve                |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| `set_product_default_price`     | `productId`, `unitPriceCents`, `unit?` (padrão `ton`), `validFrom?`, `validTo?`  | `id`, `unitPriceCents` |
| `set_customer_special_price`    | `customerId`, `productId`, `unitPriceCents`, `unit?`, `validFrom?`, `validTo?`   | `id`, `unitPriceCents` |
| `remove_customer_special_price` | `customerId`, `productId`                                                        | `removed`              |
| `upsert_price_table`            | `id?`, `name` (obrigatório ao criar), `validFrom?`, `validTo?`                   | `id`                   |
| `set_price_table_active`        | `id`, `isActive`                                                                 | `id`, `isActive`       |
| `set_price_table_item`          | `priceTableId`, `productId`, `unitPriceCents`, `unit?`, `validFrom?`, `validTo?` | `id`, `unitPriceCents` |
| `remove_price_table_item`       | `priceTableId`, `productId`                                                      | `removed`              |
| `set_customer_price_table`      | `customerId`, `priceTableId` (`null` desvincula)                                 | `id`, `priceTableId`   |

Toda ação desta seção aceita `pricePassword` — obrigatório para quem tem `requiresPricePassword`
(ver seção 2). A senha é conferida e descartada; nunca é gravada.

Regra de ouro do preço: **uma linha viva por chave natural** (produto; cliente+produto;
tabela+produto). A `web-api` atualiza a linha que existe em vez de criar outra — era o segundo id
para o mesmo par que fazia duas balanças brigarem. Remover é exclusão lógica (`deleted_at`),
que chega às balanças como tombstone.

### 4.7 Carteira (gestor, operação e administrador)

| Ação            | Payload                                                                  | Devolve    |
| --------------- | ------------------------------------------------------------------------ | ---------- |
| `settle_wallet` | `operationIds[]`, `settlementMethodId`, `dueDate?` (AAAA-MM-DD), `note?` | `settled`  |
| `reopen_wallet` | `operationIds[]`                                                         | `reopened` |

Mesmas regras da tela Carteira da balança: a forma escolhida precisa ser de **recebimento**
(não "em carteira") e ativa; a venda precisa ter sido em carteira (`payment_methods.is_wallet`)
e não pode estar cancelada; venda quitada pelo adiantamento não reabre. A leitura da carteira é
direta: `weighing_operations` com `payment_method_id` de uma forma `is_wallet` — em aberto é
`wallet_settled_at is null`; `omie_advance_settle_cents` é quanto o adiantamento já cobriu.

### 4.8 Fechamento de faturas (gestor, operação e administrador)

| Ação                      | Payload          | Devolve                                                         |
| ------------------------- | ---------------- | --------------------------------------------------------------- |
| `request_invoice_closing` | `operationIds[]` | `requested`, `requestIds[]`, `skipped[{ operationId, reason }]` |

**O site não fatura — ele pede.** Faturar no OMIE exige montar o pedido inteiro (parcelas, meio
de pagamento, frete, adiantamento), e isso só a balança sabe fazer. A ação deixa um pedido por
pesagem em `billing_requests`; a balança da unidade pega no tique de 30 s da fila OMIE, fatura
pelo mesmo caminho do botão "Fazer fechamento" e devolve o resultado. O site acompanha lendo
`billing_requests` (RLS): `status` = `pending` → `processing` → `done` | `failed`, com
`result_message` (ex.: "Faturado — NF-e 28727." ou "Preencha o número do endereço do cliente").

A peneira é a mesma da balança e vem em `skipped` com o motivo: só venda com nota
(`operation_type = 'invoice'`), só pesagem concluída, **nunca quem já tem
`omie_invoice_number` ou `omie_billing_status = 'billed'`** (refaturar duplica a NF-e), e nunca
quem já tem pedido `pending`/`processing`.

Para montar a tela do fechamento: `weighing_operations` (período pela data de **fechamento**,
`closed_at`), com `omie_billing_status`, `omie_billing_message` e `omie_invoice_number` — a
balança projeta essas três colunas a partir da versão que traz a migração `202609220004`.
Se a balança da unidade estiver desligada, o pedido fica `pending` até ela ligar.

### 4.9 Pesagem pelo site (operação e administrador; o gestor tudo menos a entrada)

| Ação                | Payload                                          | Devolve                                              |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `operation_status`  | —                                                | `executor { name, online }`, `requiresPricePassword` |
| `request_operation` | `kind`, `operationId?`, `data`, `pricePassword?` | `requestId`, `operationId`, `warnings`               |

**O site não pesa — ele pede, e a balança executora executa.** Mesmo desenho do fechamento de
faturas, pelo mesmo motivo: a conta da pesagem (preço na entrada, frete, crédito/adiantamento,
faturamento futuro, pedido do OMIE, fila do carregador, número da pesagem, cupom) vive inteira
no desktop. A ação grava um pedido em `operation_requests` (migração `202609250001`); a balança
marcada no painel como **executora da unidade** (Acessos do sistema → "Pesagem do site") é
avisada pelo Realtime (`operation_request_pings`, 1 a 3 s; tique de 30 s de reserva), executa
pelas mesmas funções dos botões do desktop e devolve o resultado.

`kind` e `data`:

| `kind`    | `data`                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entry`   | `customerId`, `vehicleId`, `driverId`, `productId`, `entryWeightKg`; opcionais `carrierId`, `paymentMethodId`, `paymentTermId`, `conditionText`, `operationType` (`invoice` padrão, ou `internal`), `freightModality`, `freight`, `deductFreightFromCredit` (ver abaixo) |
| `exit`    | `exitWeightKg`; opcional `operationType`. O cupom sai na impressora da executora, com o número de vias do perfil dela (1 ou 2)                                                                                                                                           |
| `update`  | só o que muda: `customerId`, `productId`, `vehicleId`, `driverId`, `carrierId` (`null` tira), `paymentMethodId`, `paymentTermId`, `operationType`, `unitPriceCents`. Pesagem concluída: só cliente, produto e transportadora                                             |
| `cancel`  | `reason`                                                                                                                                                                                                                                                                 |
| `reprint` | — (só pesagem concluída)                                                                                                                                                                                                                                                 |

- O peso é **digitado** (como a balança virtual) e fica marcado `WEB:<kg>` na auditoria da pesagem.
- **Frete e condição da entrada** — o mesmo bloco da Nova entrada do desktop:
  - `freightModality`: `fob` (com frete, valor na nota), `cif` (com frete, valor só no sistema),
    `third_party` (sem frete, transportador na nota) ou `none` (sem ocorrência). Ausente = o padrão
    da balança (`third_party`), como antes.
  - `freight` (só com `fob`/`cif`): `calculationType` (`per_ton` | `per_ton_km` | `fixed_plus_ton`),
    `baseValueCents`, `fixedValueCents?`, `distanceKm` (obrigatória no ton-km), `destination?`. A
    balança monta o frete como o `buildFreightInput` do desktop (pagador pela situação, valor no
    cupom só no `fob`) e, com frete da Pedreira na forma "crédito do cliente", abate do crédito.
  - `conditionText`: a condição digitada ("30", "7 14 21", "s+20"); vence `paymentTermId`. A
    balança reusa a condição local com a mesma regra ou cria uma nova (a mesma do campo livre da
    tela); texto que o desktop não entende volta como falha com a mensagem dele.
  - Executora abaixo da `0.8.253` (`ENTRY_FREIGHT_MIN_EXECUTOR_VERSION`, lida de
    `device_registrations.app_version`) registraria a entrada **ignorando** frete e condição, em
    silêncio: por isso a ação responde 409 pedindo a atualização da balança.
  - As regras de frete e de condição do site (`apps/web/src/lib/desktop/`) são cópias de
    `apps/desktop/src/services/` guardadas por teste (`desktop-copies.test.ts`).
- Na entrada o id da pesagem nasce na `web-api` (`operationId` da resposta): executar o mesmo
  pedido duas vezes (resposta perdida, pedido devolvido à fila) encontra a pesagem em vez de
  criar outro caminhão no pátio. Fechar ou cancelar de novo também é reconhecido como já feito.
- Mudar `unitPriceCents` exige `pricePassword` (a senha de alteração de preço da pedreira) de
  quem tem `user_profiles.requires_price_password` — marcado no painel, por login. A senha é
  conferida aqui e nunca é gravada no pedido.
- Sem executora marcada na unidade a ação responde 409. Executora fora do ar: o pedido é aceito,
  fica `pending` e vem um aviso em `warnings`.
- O site acompanha lendo `operation_requests` (RLS + Realtime): `status` `pending` →
  `processing` → `done` | `failed`, `result_message` (a mesma mensagem que o desktop mostraria,
  ex.: "Ja existe uma operacao aberta para a placa ABC-1234."), `result` (número, pesos,
  totais) e `print_status`/`print_message` ("pesagem registrada, mas o cupom não imprimiu").

### 4.10 Destinatários do fechamento diário (gestor, operação e administrador)

| Ação                      | Payload                                                                                                                                                                    | Devolve                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `list_report_recipients`  | —                                                                                                                                                                          | `recipients[]`, `channels` |
| `save_report_recipient`   | `id?`, `displayName`, `email`, `whatsappPhone`, `sendEmail`, `sendWhatsapp`, `reportTypes` (`sales`/`trucks`/`both`), `sendFinancial`, `financialScheduleTime`, `isActive` | `id`                       |
| `delete_report_recipient` | `id`                                                                                                                                                                       | `id`                       |

A tela Relatórios do desktop, na aba "Destinatarios" do `/relatorios`. Grava em
`report_recipients` com as regras de `apps/desktop/src/services/report-recipients.ts`
(`_shared/report-recipients.ts`): pelo menos um canal, e-mail e WhatsApp válidos, sem repetir
e-mail nem WhatsApp. Excluir é tombstone (`deleted_at`), que a balança puxa no `desktop-pull`.
`channels` diz só **se** o SMTP e o WhatsApp da pedreira estão configurados — senha e token
nunca saem da nuvem; configurar os canais e o horário dos envios continua na balança.

### 4.11 Balanças da unidade (todos os perfis)

| Ação           | Payload | Devolve     |
| -------------- | ------- | ----------- |
| `unit_devices` | —       | `devices[]` |

A engrenagem do rodapé do site (Configurações → Balança, Impressão e Cloud), no lugar das telas
de mesmo nome do desktop. No desktop elas configuram o computador em que ele roda; o site não tem
balança nem impressora, então mostra o **estado** das balanças da unidade de quem entrou: nome,
número, versão, anel de atualização (`teste`/`producao`), último sinal e se está ligada (sinal há
até 15 min), se é a principal de preços, se executa os pedidos do site e o resumo de saúde da
fila (`health`: pendentes, parados, mais antigo, último erro). Só leitura; fica de fora o
dispositivo virtual do site (`web-…`), a balança inativa e — sempre — o token.

### 4.12 Logs de suporte (só administrador)

| Ação               | Payload | Devolve                                                                                                                                                                                |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support_overview` | —       | `generatedAt`, `units[]`, `devices[]`, `latestAppVersion`, `operationRequests[]`, `billingRequests[]`, `omieProblems[]`, `reportDispatches[]`, `pricePasswordFailures[]`, `webUsers[]` |

A tela **Logs** do administrador (suporte da Kybernan): tudo o que ajuda a achar a falha sem ir
até a pedreira, só leitura e com janela e teto em cada lista. `devices` são todas as balanças da
empresa (de todas as unidades, inclusive as inativas) no mesmo formato de `unit_devices`, e
`latestAppVersion` é a maior versão entre as ativas, para marcar as desatualizadas. Os pedidos
de pesagem do site são os dos últimos 7 dias (até 300) e os de fechamento, os de 30 dias (até
200). `omieProblems` são as pesagens dos últimos 30 dias com `sync_error`, com faturamento no
OMIE parado por falha (`failed`, `cadastro_incompleto`, `service_order_failed`,
`missing_in_omie`) ou fechadas há mais de 2 h e ainda sem subir (`closed_local`,
`pending_cloud`, `pending_omie`) — cada pesagem uma vez só. Entram também os relatórios
automáticos (diário e financeiro) de 30 dias, as senhas de preço erradas de 7 dias e os logins
da empresa (sem senha, claro).

### 4.13 O que ainda não está na `web-api` (próximas versões)

- Regra de frete do cliente (`customer_freight_rules.rule_json`) — o formato do JSON é o da
  balança (`apps/desktop/src/services/customer-freight-rules.ts`) e precisa ser documentado
  antes de abrir a escrita.
- Nota de faturamento futuro (`customer_future_billing_invoices`): leitura já funciona.
- Gestão de usuários pela própria pedreira (hoje é o painel `/admin`).

## 5. Como o cadastro do site chega na balança

Nada a fazer no site. Toda escrita nas tabelas de cadastro carimba `cloud_synced_at` (gatilho) e
avisa o Realtime (`cadastro_change_pings`); a balança puxa em 1 a 3 s. Preço e bloco comercial
gravados pelo site vencem na balança porque `updated_at` é a hora da nuvem (`newest`) — e,
depois da virada da Etapa 4 (dispositivo virtual "Web — Comercial" como principal), todas as
balanças passam a aceitar sem discutir.

## 6. O OMIE por trás

O site nunca fala com o OMIE. A `web-api` chama a `omie-sync` como o **dispositivo virtual**
`web-<company_id>` (criado sozinho na primeira gravação; aparece na aba Balanças do painel
como "Web — Comercial", sempre offline, porque não é uma balança). Desativar esse dispositivo
no painel corta o envio do site ao OMIE sem derrubar o site.
