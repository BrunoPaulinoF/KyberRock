# Balanças principais de preços

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

## A solução: dono do cadastro de preço

O administrador marca, no painel do loader-web, **quais balanças são principais**. Pode ser uma, e
pode ser mais de uma — na pedreira quem cadastra preço costuma ser mais de um posto (a balança da
portaria e a do escritório). A partir daí:

| Papel                        | Publica preço? | Linha da nuvem que disputa a mesma chave | Edita preço na tela? |
| ---------------------------- | -------------- | ---------------------------------------- | -------------------- |
| **Principal** (`master`)     | sim            | vence se foi **editada depois**          | sim                  |
| **Secundária** (`follower`)  | não            | **vence** a linha local                  | não                  |
| Sem principal (`standalone`) | sim            | perde para a linha local                 | sim                  |

O terceiro caso é o comportamento anterior, intacto: pedreira que não marcar nenhuma principal
continua exatamente como estava.

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
`device_registrations.is_price_master` (ação `update_device_price_master`). Cada balança é marcada
por conta própria: **marcar uma não rebaixa as outras**.

Voltar todas para "Espelha a principal" deixa a pedreira **sem** principal: cada máquina retoma a
publicação do próprio cadastro de preço.

## Duas principais não podem se derrubar

Com mais de uma principal, o critério de desempate deixa de ser detalhe e passa a ser o que
sustenta o recurso.

"Quem publica por último manda" — a regra natural com uma principal só — faria as duas se
derrubarem alternadamente a cada ciclo de sync, e o preço do par disputado ficaria **oscilando**
entre os dois valores em todas as balanças da pedreira. Pior que o problema original, que ao menos
era estável.

O critério é o **`updated_at` da própria linha**: quem editou por último manda; empate no relógio cai
no maior `id`. Comparando a hora da edição, as duas pontas chegam à mesma conclusão seja qual for a
ordem em que sincronizam — converge, e converge para o que alguém digitou por último. É o mesmo
padrão do `dropStaleOperationWrites`.

A regra vive nos **dois runtimes**, de propósito: `cloudRowWins` (desktop,
`price-authority.ts`) e `winsConflict` (nuvem, `_shared/price-master-conflicts.ts`). São ambientes
separados (Deno × workspace do desktop) e não há como compartilhar o módulo; mudar uma sem a outra
faz a balança e a nuvem discordarem sobre a mesma linha.

No desktop isso aparece como uma política de três valores (`priceConflictPolicy`), e não mais como
um booleano:

- `cloud` — secundária: a linha local sempre cede.
- `newest` — principal: cede quem foi editada antes.
- `local` — sem principal: a linha local manda (comportamento anterior).

## Como chega na balança

`desktop-status` (o heartbeat de 5 s que já valida o acesso) devolve `priceMasterDeviceIds` e
`priceMasterDeviceNames`. O desktop grava as duas listas em `local_settings`, então o papel sobrevive
a reinício e a queda de internet.

Campo **ausente** na resposta significa "a nuvem não falou disso" — função antiga, ou migração ainda
não aplicada — e **não** é confundido com lista vazia, que significa "esta pedreira não tem
principal". Confundir os dois devolveria ao empate cada balança que já espelha os preços. É a mesma
disciplina do `updateChannel`.

Os campos no singular (`priceMasterDeviceId`/`priceMasterDeviceName`) continuam na resposta para uma
instalação antiga, que só sabe ler uma principal — e vão `null` quando há duas ou mais. Dizer só uma
faria a outra principal se achar secundária e parar de publicar preço; `null` a devolve ao
comportamento anterior ao campo, que é o pior caso seguro. Pelo mesmo motivo o desktop ainda **lê** o
formato antigo gravado localmente: uma instalação que atualizou sem internet ficaria sem papel nenhum
até o primeiro heartbeat, e nesse intervalo uma secundária voltaria a aceitar edição de preço.

## A nuvem também precisa ceder

Dar dono no desktop não basta, porque o empate se repete na nuvem. As tabelas de preço lá têm o
**mesmo índice único** pela chave natural, e o `desktop-sync` grava com `onConflict: "id"`. Com dois
ids para o mesmo par, quem publicou primeiro ocupa a linha e o `upsert` do outro é **recusado
(23505)**.

Isso inverte o combinado: o preço da principal — o único que deveria valer — é justamente o que não
entra, porque a secundária chegou primeiro. Por isso, quando quem envia é uma principal,
`resolvePriceConflicts` (`_shared/price-master-conflicts.ts`) decide duas coisas antes do upsert:

- **`retire`** — a linha concorrente que já está na nuvem e perdeu é excluída logicamente.
- **`skip`** — a linha do payload que perdeu **sai do lote** em vez de ser tentada. Perder e ser
  recusada pelo índice não é a mesma coisa: um `23505` derruba o lote inteiro e vira erro de
  sincronização a cada ciclo, para sempre, num caso que não é erro nenhum — é só a outra principal
  ter editado depois.

Sai como exclusão lógica, e não apagada: o tombstone viaja no `desktop-pull` seguinte e é o que faz
a balança que criou a linha largar a cópia local dela. Apagar de vez deixaria a outra máquina com
uma linha viva que a nuvem não tem mais.

`customer_freight_rules` entra nessa lista mesmo sem índice único na nuvem: ela **tem** índice único
local, e duas linhas do mesmo par chegando juntas na secundária fariam o vencedor depender da ordem
do lote.

## Troca de papel: uma passada de cada lado

Eleger a principal não basta: o preço que ela já tinha está "atrás do cursor" do push incremental.
Por isso a troca arma **uma** passada em cada lado:

- **Principal recém-marcada** (`PRICE_MASTER_REPUBLISH_KEY`): o próximo push zera os cursores das
  chaves de preço e republica tudo o que ela tem.
- **Secundária recém-criada** (`PRICE_MASTER_RESYNC_KEY`): o próximo pull vem **completo**, mesmo
  quando o ciclo pediu incremental.

Quem **já tinha o mesmo papel** não rearma nada: sem isso, marcar a segunda principal faria toda a
pedreira reenviar o cadastro de preço a cada mexida na aba.

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
recebe no pull) em vez de sumir de uma delas — tirá-lo de cena continua sendo gesto do operador, numa
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

- `source: "manual"` — o valor combinado com o cliente. É cadastro, e as principais o definem para a
  pedreira inteira.
- `source: "last_used"` — o valor usado na última venda **desta** máquina, que serve só para
  pré-preencher a próxima entrada.

Espelhar a linha inteira apagaria a memória local a cada pull; ignorar a linha manteria o frete
divergente. A função pura que resolve isso vive em `customer-freight-rules.ts`:

- `mergeFollowerFreightRuleJson` — quem publicou vence em tudo que define; a memória local sobrevive
  nos tipos de frete que ela não definiu.

## A trava com mais de uma principal

A mensagem de recusa diz **onde** alterar, e com duas principais ela lista as duas: "Os precos desta
pedreira sao definidos nos computadores "Balanca 1" ou "Balanca 2"". Parar a operadora sem dizer para
onde ir é o que faz ela ligar para o suporte com o caminhão em cima da balança.

## Migrações

- `supabase/migrations/202608270001_device_price_master.sql` — cria a coluna
  `is_price_master`.
- `supabase/migrations/202608270003_device_price_masters.sql` — remove o índice único que limitava a
  pedreira a **uma** principal. A coluna fica; o que muda é só quantas balanças podem publicar preço.

Migrações **não são automatizadas** (ver AGENTS.md "SQL migrations"): aplique antes de usar a aba.
Enquanto a coluna não existe, o painel carrega normalmente (nenhuma balança aparece como principal), o
`desktop-status` omite os campos e todas as balanças seguem no comportamento anterior. Enquanto o
índice único não for removido, marcar a segunda principal é recusado pelo banco — o painel mostra o
erro e nada mais muda.
