# Balança principal da pedreira

Uma balança eleita por pedreira é dona do **cadastro de preço** e do **cadastro comercial e de
crédito do cliente**. Este documento cobre os dois: o preço primeiro, porque foi o caso que deu
origem ao mecanismo, e o bloco comercial depois, que reusa a mesma eleição por um caminho um pouco
diferente.

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
preserva o bloco da principal.

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
secundária só aplica o bloco — nulos incluídos — depois que ela existe. É a mesma disciplina do
`priceMasterDeviceId` ausente versus nulo, promovida ao nível da linha.

### Uma republicação na atualização

O push do cadastro é incremental por cursor. Sem zerar o cursor dos clientes, o bloco só chegaria à
nuvem nos poucos clientes que alguém editasse depois da atualização. Por isso a migração local
`customer_commercial_republish` (v57) grava `CUSTOMER_COMMERCIAL_REPUBLISH_KEY`, e o primeiro push
depois dela reenvia todos os clientes.

Diferente do `PRICE_MASTER_REPUBLISH_KEY`, essa marca vale também para a pedreira **sem** principal
eleita: lá o bloco continua compartilhado (última escrita vence) e precisa igualmente chegar à nuvem
uma primeira vez. Quem não publica é só a secundária — que não consome a marca, e passa a usá-la no
dia em que for eleita principal.

### Os dois ids precisam de tradutor

O bloco carrega dois ids, e nenhum dos dois pode ser copiado direto:

- **Forma de pagamento**: a forma padrão do sistema nasce com id **sorteado em cada balança**
  (migração `local_payment_methods_and_customer_credit_account`), então o id que a principal
  publicou nunca existe na secundária. `resolvePaymentMethodId` acha a gêmea pelo `code`.
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

## Migração

Duas, e migrações **não são automatizadas** (ver AGENTS.md "SQL migrations") — aplique as duas antes
de usar a aba:

- `supabase/migrations/202608270001_device_price_master.sql` — a eleição em si. Enquanto a coluna
  não existe, o painel carrega normalmente (nenhuma balança aparece como principal), o
  `desktop-status` omite os campos e todas as balanças seguem no comportamento anterior.
- `supabase/migrations/202608280001_customer_commercial_master.sql` — o bloco comercial/crédito do
  cliente. Enquanto ela não roda, o `desktop-sync` descarta as colunas novas do payload e regrava o
  resto (`_shared/unknown-column.ts`), e as balanças ficam sem a marca de publicação — ou seja,
  seguem exatamente no comportamento anterior, cada uma com a sua configuração.

Nessa segunda, as duas colunas de id vão **sem FK** de propósito: a ordem do push manda os clientes
antes das transportadoras e das formas de pagamento, e uma FK derrubaria o lote inteiro de clientes
por causa de um padrão que a nuvem ainda não recebeu.
