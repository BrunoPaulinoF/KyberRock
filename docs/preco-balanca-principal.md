# Balança principal de preços

## O problema

Numa pedreira com duas balanças, o preço especial de um cliente existia em uma máquina e não
existia na outra. O mesmo valia para o preço padrão do produto, para as tabelas de preço e para o
valor de frete do cadastro. Na operação isso aparecia como caminhão cobrado a valores diferentes
conforme o computador que registrou a entrada.

Não era falta de sincronização: essas tabelas **já** viajavam para a nuvem junto do cadastro
compartilhado (`pushSharedCadastroToCloud` / `desktop-pull`). O que faltava era **dono**.

O cadastro de preço nasce no SQLite de uma máquina, com um `id` sorteado ali. Quando duas balanças
cadastram o preço do mesmo par (cliente, produto) antes do primeiro sync, nascem **duas linhas com
ids diferentes para o mesmo par**. Do lado local existe um índice único:

```sql
CREATE UNIQUE INDEX idx_customer_special_prices_customer_product
  ON customer_special_prices(customer_id, product_id)
  WHERE deleted_at IS NULL;
```

Gravar as duas violaria o índice e derrubaria o pull inteiro. Por isso `upsertCloudCustomerSpecialPrices`
**descartava** a linha que vinha da nuvem sempre que já havia uma local para o mesmo par. Como as
duas máquinas faziam o mesmo, cada uma ficava com o preço que ela mesma digitou — e ficava para
sempre, porque o descarte se repetia a cada ciclo.

Na nuvem existe o mesmo índice único, então lá sobra apenas uma linha por par: a de quem publicou
primeiro. A outra máquina recebia essa linha e a jogava fora.

## A solução: dono único

O administrador elege, no painel do loader-web, **uma balança principal de preços por pedreira**. A
partir dela:

| Papel                        | Publica preço? | Preço da nuvem          | Edita preço na tela? |
| ---------------------------- | -------------- | ----------------------- | -------------------- |
| **Principal** (`master`)     | sim            | como sempre             | sim                  |
| **Secundária** (`follower`)  | não            | **vence** a linha local | não                  |
| Sem principal (`standalone`) | sim            | como sempre             | sim                  |

O terceiro caso é o comportamento anterior, intacto: pedreira que não eleger principal continua
exatamente como estava.

O que tem dono está em `PRICE_MASTERED_CADASTRO_KEYS`
(`apps/desktop/src/services/price-authority.ts`):

- `product_default_prices` — preço padrão do produto
- `customer_special_prices` — preço especial por cliente
- `price_tables`, `price_table_items`, `customer_price_tables` — tabelas de preço e o vínculo
- `customer_freight_rules` — valor de frete do cadastro

A lista vale nos **dois sentidos**: o que a secundária deixa de empurrar é exatamente o que ela
aceita da nuvem sem discutir.

## Onde se define

Painel administrativo → aba **Balanças** → coluna **Preços**. O `admin-api` grava
`device_registrations.is_price_master` (ação `update_device_price_master`), limpando a principal
anterior **antes** de marcar a nova — o índice único parcial admite uma só por empresa, então
marcar primeiro derrubaria a troca.

O índice é por **empresa**, e não por unidade: as tabelas de preço na nuvem são todas `company_id` e
o `desktop-pull` devolve o cadastro de preço por empresa. Duas principais na mesma empresa — uma por
unidade — voltariam a disputar exatamente as mesmas linhas.

Voltar a principal para "Espelha a principal" deixa a pedreira **sem** principal: cada máquina
retoma a publicação do próprio cadastro de preço.

## Como chega na balança

`desktop-status` (o heartbeat de 5 s que já valida o acesso) devolve `priceMasterDeviceId` e
`priceMasterDeviceName`. O desktop grava os dois em `local_settings`, então o papel sobrevive a
reinício e a queda de internet.

Campo **ausente** na resposta significa "a nuvem não falou disso" — função antiga, ou migração ainda
não aplicada — e **não** é confundido com `null`, que significa "esta pedreira não tem principal".
Confundir os dois devolveria ao empate cada balança que já espelha os preços. É a mesma disciplina
do `updateChannel`.

## A nuvem também precisa ceder

Dar dono no desktop não basta, porque o empate se repete na nuvem. As tabelas de preço lá têm o
**mesmo índice único** pela chave natural, e o `desktop-sync` grava com `onConflict: "id"`. Com dois
ids para o mesmo par, quem publicou primeiro ocupa a linha e o `upsert` do outro é **recusado
(23505)**.

Isso inverte o combinado: o preço da principal — o único que deveria valer — é justamente o que não
entra, porque a secundária chegou primeiro. Por isso, quando quem envia é a principal, a linha
concorrente é excluída logicamente **antes** do upsert (`_shared/price-master-conflicts.ts`).

Sai como exclusão lógica, e não apagada: o tombstone viaja no `desktop-pull` seguinte e é o que faz
a balança que criou a linha largar a cópia local dela. Apagar de vez deixaria a outra máquina com
uma linha viva que a nuvem não tem mais.

`customer_freight_rules` entra nessa lista mesmo sem índice único na nuvem: ela **tem** índice único
local, e duas linhas do mesmo par chegando juntas na secundária fariam o vencedor depender da ordem
do lote.

## Troca de papel: uma passada de cada lado

Eleger a principal não basta: o preço que ela já tinha está "atrás do cursor" do push incremental.
Por isso a troca arma **uma** passada em cada lado:

- **Principal recém-eleita** (`PRICE_MASTER_REPUBLISH_KEY`): o próximo push zera os cursores das
  chaves de preço e republica tudo o que ela tem.
- **Secundária recém-criada** (`PRICE_MASTER_RESYNC_KEY`): o próximo pull vem **completo**, mesmo
  quando o ciclo pediu incremental.

Fora dessas passadas, o dia a dia é o ciclo normal: a principal publica no push, as secundárias
recebem no pull, e o par duplicado cede na própria gravação (`authoritative`).

## O pull não apaga preço

Uma versão anterior deste fluxo retirava da secundária o preço que a principal não tivesse
publicado. Parecia espelhamento; na prática abria uma **janela de balança sem preço**: a secundária
descobre o papel em 5 s e puxa em 20 s, enquanto a principal só republica na próxima varredura
completa — até 30 minutos depois. Nesse intervalo o par disputado ficava sem valor nenhum, com
caminhão na balança.

O par disputado é resolvido pelo tombstone da seção anterior, que chega **junto** com o preço novo e
nunca antes dele. E o preço que só existe numa máquina converge para as duas (a principal também o
recebe no pull) em vez de sumir de uma delas — tirá-lo de cena continua sendo gesto do operador, na
principal, e a exclusão viaja para todas.

## A trava de edição

A recusa está no **runtime** (`assertPriceAuthority`), não só na tela. Preço digitado numa
secundária valeria até o próximo pull e sumiria depois — o pior dos dois mundos para quem está com o
caminhão na balança. A tela avisa antes (`PriceMasterNotice`) e desabilita os campos, dizendo o nome
do computador onde alterar.

Ficam **fora** da trava:

- `rememberCustomerFreightValue` — a memória da última venda é desta máquina, não é cadastro.
- A categoria OMIE do produto — categoria não é preço e não tem dono na pedreira.

## Frete: cadastro e memória na mesma linha

`customer_freight_rules` guarda duas coisas de donos diferentes dentro do mesmo `rule_json`:

- `source: "manual"` — o valor combinado com o cliente. É cadastro, e a principal define para a
  pedreira inteira.
- `source: "last_used"` — o valor usado na última venda **desta** máquina, que serve só para
  pré-preencher a próxima entrada.

Espelhar a linha inteira apagaria a memória local a cada pull; ignorar a linha manteria o frete
divergente. A função pura que resolve isso vive em `customer-freight-rules.ts`:

- `mergeFollowerFreightRuleJson` — a principal vence em tudo que ela define; a memória local
  sobrevive nos tipos de frete que ela não definiu.

## Migração

`supabase/migrations/202608270001_device_price_master.sql`. Migrações **não são automatizadas** (ver
AGENTS.md "SQL migrations"): aplique antes de usar a aba. Enquanto a coluna não existe, o painel
carrega normalmente (nenhuma balança aparece como principal), o `desktop-status` omite os campos e
todas as balanças seguem no comportamento anterior.
