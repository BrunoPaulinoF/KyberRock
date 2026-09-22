# `web-api` — contrato do site web com a nuvem

Versão: 1.0 — 22/09/2026
Contexto: `docs/plano-migracao-web.md` (Etapa 1, decisões D3 e D4). Este é o documento que o
repositório do site (`Kyberrock-Web`) precisa para falar com o Supabase do KyberRock.

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

| `role`      | Lê                                        | Grava pela `web-api`                                     |
| ----------- | ----------------------------------------- | -------------------------------------------------------- |
| `comercial` | Todo o cadastro e as operações da empresa | Cliente, transportadora, motorista, veículo e vínculos   |
| `gestor`    | O mesmo                                   | Tudo do comercial **+ preços + bloco comercial/crédito** |
| `loader`    | Só a fila da unidade (site do carregador) | Nada — a `web-api` responde 403                          |

Quem cria usuários hoje é o painel `/admin` da Kybernan (seção "Comercial", campo Perfil).

## 3. Leitura (RLS)

Com o usuário logado, o `supabase-js` já manda o token; basta consultar. A migração
`202609220003_web_access_roles` abre leitura, sempre **da própria empresa**, em:

`customers`, `products`, `carriers`, `drivers`, `vehicles`, `customer_vehicles`,
`customer_carriers`, `driver_carriers`, `vehicle_carriers`, `product_default_prices`,
`customer_special_prices`, `price_tables`, `price_table_items`, `customer_price_tables`,
`customer_freight_rules`, `customer_future_billing_invoices`, `payment_terms`,
`payment_methods`, `accounts`, `customer_credit_movements`, `customer_credit_balances`,
`quotations`, `loading_requests`, `weighing_operations`, `units`, `companies`.

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

| Status | Significado                                                        |
| ------ | ------------------------------------------------------------------ |
| 400    | Payload inválido — a mensagem é para mostrar ao usuário            |
| 401    | Sem sessão — mandar para o login                                   |
| 403    | Perfil sem permissão para a ação (ex.: comercial mexendo em preço) |
| 404    | Id não encontrado **na empresa do usuário**                        |
| 409    | Conflito: CNPJ/CPF ou placa já cadastrados (a mensagem diz quem)   |
| 503    | Banco indisponível — tentar de novo                                |

`warnings` nunca é erro: o cadastro **foi gravado**. Ele avisa, por exemplo, que o OMIE não
aceitou agora (a próxima edição tenta de novo) ou que o cliente ficou sem documento.

Convenções de payload: campos em **camelCase**; campo **ausente** não mexe na coluna; campo
**`null`** limpa a coluna; datas em `AAAA-MM-DD`; preço em **centavos inteiros**.

### 4.1 Sessão

| Ação | Payload | Devolve                                                                           |
| ---- | ------- | --------------------------------------------------------------------------------- |
| `me` | —       | `user { id, email, name, role, unitId, canManagePrices }`, `companyId`, `units[]` |

### 4.2 Cliente (comercial e gestor)

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

### 4.3 Bloco comercial e crédito (só gestor)

| Ação                      | Payload                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `set_customer_commercial` | `id`, e um ou mais de: `defaultPaymentMethodId?`, `defaultCarrierId?`, `defaultFreightModality?`, `nfRequired?: boolean`, `creditAccountEnabled?: boolean`, `creditMode?: "normal" \| "prepaid"`, `creditPeriodicity?: "monthly" \| "biweekly" \| "weekly"`, `creditClosingDay?` (1–31), `creditSecondClosingDay?` (1–31), `creditBoletoDays?` (0–365), `creditSecondBoletoDays?` (0–365), `creditClosingWeekday?` (0–6) |

Grava só o que veio e carimba `commercial_published_at` — é essa marca que faz as balanças
adotarem o bloco. `defaultCarrierId` e `defaultPaymentMethodId` precisam existir na empresa.

### 4.4 Transportadora, motorista, veículo (comercial e gestor)

| Ação                 | Payload                                                                                | Devolve                        |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `upsert_carrier`     | `id?`, `name` (obrigatório ao criar), `document?`                                      | `id`, `omieCustomerId \| null` |
| `set_carrier_active` | `id`, `isActive`                                                                       | `id`, `isActive`               |
| `upsert_driver`      | `id?`, `name` (obrigatório ao criar), `document?`, `phone?`, `isIndependent?: boolean` | `id`                           |
| `set_driver_active`  | `id`, `isActive`                                                                       | `id`, `isActive`               |
| `upsert_vehicle`     | `id?`, `plate` (obrigatório ao criar), `description?`, `carrierId?`                    | `id`                           |
| `set_vehicle_active` | `id`, `isActive`                                                                       | `id`, `isActive`               |

A placa é gravada em maiúsculas, sem espaço nem hífen (`ABC1D23`); placa repetida na empresa é 409. A transportadora com documento também sobe para o OMIE (`push_carrier`).

### 4.5 Vínculos (comercial e gestor)

| Ação                   | Payload                               |
| ---------------------- | ------------------------------------- |
| `set_customer_vehicle` | `customerId`, `vehicleId`, `isActive` |
| `set_customer_carrier` | `customerId`, `carrierId`, `isActive` |
| `set_driver_carrier`   | `driverId`, `carrierId`, `isActive`   |
| `set_vehicle_carrier`  | `vehicleId`, `carrierId`, `isActive`  |

`isActive: false` desfaz o vínculo (a linha fica, inativa). Repetir com `true` reaproveita a
mesma linha — nunca nasce um par duplicado.

### 4.6 Preços (só gestor)

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

Regra de ouro do preço: **uma linha viva por chave natural** (produto; cliente+produto;
tabela+produto). A `web-api` atualiza a linha que existe em vez de criar outra — era o segundo id
para o mesmo par que fazia duas balanças brigarem. Remover é exclusão lógica (`deleted_at`),
que chega às balanças como tombstone.

### 4.7 O que ainda não está na `web-api` (próximas versões)

- Regra de frete do cliente (`customer_freight_rules.rule_json`) — o formato do JSON é o da
  balança (`apps/desktop/src/services/customer-freight-rules.ts`) e precisa ser documentado
  antes de abrir a escrita.
- Nota de faturamento futuro, baixa de carteira, fechamento de faturas: leitura já funciona;
  escrita fica para a Etapa 2b do plano.
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
