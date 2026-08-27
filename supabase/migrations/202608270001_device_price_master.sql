-- Balanca principal de precos da pedreira.
--
-- Todo preco que a pedreira define fora do OMIE — preco padrao do produto, preco especial
-- por cliente, tabela de preco (e o vinculo dela com o cliente) e o valor de frete do
-- cadastro — nasce no SQLite de UMA balanca. A projecao na nuvem existe desde o cadastro
-- compartilhado, mas ela empatava: quando duas maquinas cadastravam o mesmo par
-- (cliente, produto) antes do primeiro sync, cada uma ficava com um id diferente e o pull
-- de cada lado DESCARTAVA a linha da outra para nao violar o indice unico local. O
-- resultado na operacao era o que o cliente relatou: preco especial que existe numa
-- balanca e nao existe na outra, para sempre.
--
-- A saida e dar dono ao cadastro de preco: uma balanca por pedreira e a principal, e as
-- demais espelham o que ela publica em vez de disputar. Esta coluna e esse dono.
--
-- O indice unico e por EMPRESA (e nao por unidade) de proposito: as tabelas de preco na
-- nuvem sao todas `company_id`, e o `desktop-pull` devolve o cadastro de preco por
-- empresa. Duas principais na mesma empresa — uma por unidade — voltariam a disputar o
-- mesmo conjunto de linhas, que e exatamente o problema que esta migracao encerra.
--
-- `default false` protege quem ja esta instalado: sem principal definida, nada muda e cada
-- balanca continua publicando o proprio cadastro de preco (o comportamento de hoje).
-- Eleger a principal e um ato explicito do administrador, no painel.

alter table public.device_registrations
  add column if not exists is_price_master boolean not null default false;

create unique index if not exists idx_device_registrations_price_master
  on public.device_registrations (company_id)
  where is_price_master;

comment on column public.device_registrations.is_price_master is
  'Balanca principal de precos da pedreira: a unica que publica preco padrao, preco especial por cliente, tabelas de preco e valor de frete do cadastro. As demais balancas da empresa espelham o que ela publica. Definido no painel administrativo e entregue ao desktop pelo desktop-status.';

notify pgrst, 'reload schema';
