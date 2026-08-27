# Balanças principais da pedreira

As balanças marcadas no painel são donas do **cadastro de preço** e do **cadastro comercial e de
crédito do cliente**. Este documento cobre os dois: o preço primeiro, porque foi o caso que deu
origem ao mecanismo, e o bloco comercial depois, que reusa a mesma eleição e o mesmo desempate por
um caminho um pouco diferente.

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

## O bloco comercial e de crédito do cliente

A mesma eleição decide um segundo conjunto, `MASTERED_CUSTOMER_COLUMNS` — a aba **Comercial** do
cadastro do cliente:

- `default_payment_method_id` — forma de pagamento padrão
- `default_carrier_id` — transportadora padrão (e, por consequência, o **transporte próprio** da
  aba Transporte, que grava essa mesma coluna)
- `nf_required` — exige nota fiscal
- `credit_mode` — uso de crédito OMIE
- `credit_account_enabled`, `credit_periodicity`, `credit_closing_day`, `credit_second_closing_day`,
  `credit_boleto_days`, `credit_second_boleto_days`, `credit_closing_weekday` — a conta de crédito

O problema aqui era mais simples que o do preço e mais grave: essas colunas **nunca saíam do
SQLite**. Não havia empate a resolver — não havia sincronização nenhuma. O mesmo cliente podia ter
crédito habilitado num computador e não no outro, e cada balança carregava a configuração que aquele
operador digitou.

O caminho é diferente do preço porque o dono é de **parte de uma linha**. Preço é uma entidade
inteira, e a secundária simplesmente deixa de publicá-la. O cliente não: nome, documento, telefone,
endereço e limite de crédito não têm dono, e qualquer balança precisa continuar publicando o
cadastro. Então a secundária publica a linha **sem estas colunas** (`masteredColumns` em
`CADASTRO_PUSH_ENTITIES`). Coluna ausente do payload não entra no `SET` do upsert, então a nuvem
preserva o bloco de quem publicou.

O desempate é o mesmo do preço — a `priceConflictPolicy`, com `cloudRowWins` no `newest`. E aqui o
`newest` não é detalhe: "a principal nunca adota o que vem da nuvem" seria uma regra correta com uma
principal só, e com duas devolveria exatamente o problema de origem — cada uma ficaria para sempre
com a configuração que ela mesma digitou. Comparando o `updated_at` do cliente, as duas convergem
para quem editou por último. Um detalhe do `local`, porém, é diferente do preço: lá `local` quer
dizer "a linha local sempre vence", e aqui quer dizer o que as demais colunas do cliente já fazem —
a projeção vence, menos quando há edição local ainda não enviada. O bloco seguir outro critério
faria a mesma tela ter duas regras.

O que fica **fora** do bloco, e por quê:

- `default_payment_term_id` (condição de pagamento padrão) e `observations` (observações internas)
  viajam pelo **OMIE**: sobem no `push_customer` e voltam no cadastro de referência, então já são
  iguais em todas as máquinas sem precisar de dono aqui. A observação só era **lida** do OMIE, e
  isso a perdia até na própria máquina: a edição marcava `needs_push`, o push ao OMIE zerava a
  marca sem levar o campo, e a leitura seguinte do cadastro de referência devolvia o texto antigo.
  Enviá-la fecha o ciclo — e por isso a string vazia LIMPA a observação no OMIE, em vez de ser
  descartada pelo `dropEmptyFields` como os demais campos.
- `default_freight_modality` (tipo de frete padrão, aba Transporte) continua compartilhado sem dono
  — qualquer balança altera e a última escrita vence, como o resto do cadastro.

### Nulo não é "vazio" enquanto ninguém publicou

Estas são colunas, não linhas: não dá para "não existir na nuvem". Antes da migração, e em toda
linha que a principal ainda não republicou, elas chegam **nulas** — e esse nulo não quer dizer
"vazio", quer dizer "não sei". Gravá-lo apagaria a configuração boa da secundária, que é o oposto do
que este recurso existe para fazer; ignorá-lo para sempre impediria a principal de **limpar** uma
transportadora padrão.

`customers.commercial_published_at` desfaz a ambiguidade. Quem publica o bloco carimba a marca; a
secundária só aplica o bloco — nulos incluídos — depois que ela existe. É a mesma disciplina da
lista de principais ausente versus vazia, promovida ao nível da linha.

### Uma republicação na atualização

O push do cadastro é incremental por cursor. Sem zerar o cursor dos clientes, o bloco só chegaria à
nuvem nos poucos clientes que alguém editasse depois da atualização. Por isso a migração local
`customer_commercial_republish` (v57) grava `CUSTOMER_COMMERCIAL_REPUBLISH_KEY`, e o primeiro push
depois dela reenvia todos os clientes.

Diferente do `PRICE_MASTER_REPUBLISH_KEY`, essa marca vale também para a pedreira **sem** principal
eleita: lá o bloco continua compartilhado e precisa igualmente chegar à nuvem uma primeira vez. Quem
não publica é só a secundária — que não consome a marca, e passa a usá-la no dia em que for marcada
como principal.

### Os dois ids precisam de tradutor

O bloco carrega dois ids, e nenhum dos dois pode ser copiado direto:

- **Forma de pagamento**: a forma padrão do sistema nasce com id **sorteado em cada balança**
  (migração `local_payment_methods_and_customer_credit_account`), então o id que a outra máquina
  publicou nunca existe aqui. `resolvePaymentMethodId` acha a gêmea pelo `code`.
- **Transportadora**: o id é único, mas pode não ter sido espelhado ainda. `resolveMirroredId`
  mantém o vínculo anterior em vez de apagá-lo por causa de um cadastro atrasado.

Nos dois casos, id vazio continua sendo id vazio — é assim que a principal limpa o padrão.

Isso obrigou a **reordenar o pull**: `carriers` e `payment_methods` passaram a ser gravados **antes**
de `customers` (`upsertCloudCustomerReferences`). Enquanto rodavam depois, o padrão chegava sem
tradutor, o cliente era gravado sem forma de pagamento e sem transportadora — e o pull seguinte, por
ser incremental, não trazia a linha de novo para corrigir. O padrão ficava vazio para sempre.

### A trava de edição, aqui também

`assertCommercialAuthority` recusa no runtime, e a tela desabilita os campos com o mesmo
`PriceMasterNotice`. Uma diferença em relação ao preço: a tela de clientes salva o formulário
**inteiro** numa chamada só, então recusar por menção deixaria a secundária sem conseguir corrigir
nem o telefone de um cliente. `findChangedMasteredCustomerFields` compara o que a tela mandou com o
que já está gravado e só recusa quando a edição **mudaria** um campo com dono.

## Migrações

- `supabase/migrations/202608270001_device_price_master.sql` — cria a coluna
  `is_price_master`.
- `supabase/migrations/202608270003_device_price_masters.sql` — remove o índice único que limitava a
  pedreira a **uma** principal. A coluna fica; o que muda é só quantas balanças podem publicar preço.
- `supabase/migrations/202608280001_customer_commercial_master.sql` — o bloco comercial/crédito do
  cliente. Enquanto ela não roda, o `desktop-sync` descarta as colunas novas do payload e regrava o
  resto (`_shared/unknown-column.ts`), e as balanças ficam sem a marca de publicação — ou seja,
  seguem exatamente no comportamento anterior, cada uma com a sua configuração. As duas colunas de
  id vão **sem FK** de propósito: a ordem do push manda os clientes antes das transportadoras e das
  formas de pagamento, e uma FK derrubaria o lote inteiro de clientes por causa de um padrão que a
  nuvem ainda não recebeu.

Migrações **não são automatizadas** (ver AGENTS.md "SQL migrations"): aplique antes de usar a aba.
Enquanto a coluna não existe, o painel carrega normalmente (nenhuma balança aparece como principal), o
`desktop-status` omite os campos e todas as balanças seguem no comportamento anterior. Enquanto o
índice único não for removido, marcar a segunda principal é recusado pelo banco — o painel mostra o
erro e nada mais muda.
