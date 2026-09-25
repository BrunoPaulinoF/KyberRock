# Condição de pagamento padrão do cliente

A Nova entrada (desktop e site) preenche a **condição** de pagamento com a condição padrão do
**cadastro** do cliente (`customers.default_payment_term_id`). A **forma** de pagamento e a
transportadora continuam vindo da última pesagem do cliente, e o **preço** continua vindo só do
cadastro (preço especial do cliente, depois o preço padrão do produto).

## Por onde a condição padrão viaja

- Nasce na balança: no cadastro do cliente, ou na primeira entrada dele. Nesse caso a condição
  usada preenche o padrão ainda vazio (`createWeighingOperation`), sem nunca sobrescrever um
  padrão que já existe.
- Sobe para a nuvem no push do cadastro (`getCustomerPayload`) e desce para as outras balanças
  no pull (`upsertCloudCustomers`). No pull, **nulo não apaga** o valor local, e edição local
  ainda não enviada (`needs_push = 1`) não é sobrescrita.
- **Não** viaja pelo OMIE. A listagem de clientes de lá não traz esse campo, que chega sempre
  nulo. Até a versão que trouxe esta regra, a passada do OMIE (`localFirst`) gravava esse nulo
  por cima e apagava a condição do cadastro. Além disso, o pull da nuvem não lia a coluna, e
  cada balança ficava com a sua condição.

## Preencher o cadastro com a condição da última pesagem (uma vez, por pedreira)

Para ninguém precisar digitar a condição de cliente por cliente, o cadastro de cada cliente
recebe a condição da **última pesagem** dele. Entram só as pesagens que:

- não foram canceladas;
- usam uma condição ativa e não apagada;
- não usam a condição "Informe o número de parcelas", que a Nova entrada não lista.

**Quando rodar:** só depois de **todas** as balanças da pedreira estarem na versão com esta
regra. Antes disso, a passada do OMIE numa balança antiga apagaria a condição local de novo, e
o push seguinte levaria o nulo de volta para a nuvem.

Na nuvem, o gatilho de `cloud_synced_at` e o aviso de `cadastro_change_pings` fazem as balanças
puxarem a mudança em segundos. O `updated_at` fica como está de propósito: é ele que desempata
o bloco comercial entre balanças principais, e esta atualização não é uma edição comercial.

```sql
-- Troque :company_id pelo id da pedreira. Rode primeiro o SELECT (previa), depois o UPDATE.
with last_op as (
  select distinct on (o.customer_id) o.customer_id, o.payment_term_id
  from weighing_operations o
  join payment_terms pt on pt.id = o.payment_term_id
   and pt.deleted_at is null and pt.is_active
   and not (lower(pt.name) like '%informe%' and lower(pt.name) like '%parcela%')
  where o.company_id = :company_id
    and o.status <> 'cancelled'
    and o.customer_id is not null
  order by o.customer_id, o.created_at desc
)
update customers c
   set default_payment_term_id = l.payment_term_id
  from last_op l
 where c.id = l.customer_id
   and c.company_id = :company_id
   and c.deleted_at is null
   and c.default_payment_term_id is distinct from l.payment_term_id;
```

Prévia na Pedreira Ibiúna em 25/09/2026:

- 44 clientes sem condição no cadastro seriam preenchidos;
- 17 clientes com condição diferente da última pesagem seriam trocados;
- 45 clientes já estavam iguais.
