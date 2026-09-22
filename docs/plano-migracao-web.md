# Plano: um banco só — comercial pela web, balança offline-first

Versão: 1.0 — 22/09/2026
Origem: reunião interna de 22/09/2026 (Bruno e Pedro) sobre falhas de sincronização e
cadastros duplicados na pedreira. Este documento transforma o que foi decidido ali num plano
por etapas, com as decisões técnicas que a reunião deixou em aberto.

## 1. O problema, em uma frase

Hoje **cada computador tem um banco completo** (SQLite) e todos tentam se sincronizar entre si
pela nuvem. Com três ou quatro máquinas escrevendo cadastro ao mesmo tempo, aparece exatamente o
que a operação relatou: cadastro que uma pessoa edita e a outra nunca vê, relatório que dá um
número no PC principal e outro no da Fernanda, quatro cadastros da Polymix.

A causa não é bug pontual — é ter **vários donos para o mesmo dado**. A solução é ter um dono só.

## 2. O desenho final (para onde vamos)

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  BALANÇA (1 PC por balança)  │        │  EQUIPE (comercial, gestão)  │
│  Desktop Electron + SQLite   │        │  Navegador → site web        │
│                              │        │                              │
│  Dona da PESAGEM             │        │  Dona do CADASTRO:           │
│  • pesa sem internet         │        │  • clientes, preços, tabelas │
│  • fecha e imprime local     │        │  • veículos, motoristas,     │
│  • envia quando volta a rede │        │    transportadoras           │
│                              │        │  • relatórios, fechamentos   │
│  Cadastro: SEGUE a nuvem     │        │  • usuários e permissões     │
│  (só cadastro rápido na fila)│        │                              │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │  push/pull (já existe)                │  leitura RLS + escrita via Edge Function
               ▼                                       ▼
        ┌──────────────────────────────────────────────────────┐
        │  SUPABASE — o único banco de cadastro da pedreira    │
        │  Postgres + Edge Functions (omie-sync, relatórios…)  │
        └──────────────────────────┬───────────────────────────┘
                                   ▼
                                 OMIE
```

Regras que valem no desenho final:

| Dado                                  | Dono no desenho final | Quem mais pode mexer                                 |
| ------------------------------------- | --------------------- | ---------------------------------------------------- |
| Pesagem, cupom, solicitação de carga  | **Balança** (SQLite)  | Ninguém. A nuvem só recebe a cópia.                  |
| Cliente (nome, doc., endereço)        | OMIE                  | Web cria/edita e sobe para o OMIE (`push_customer`). |
| Cliente (bloco comercial e crédito)   | **Web**               | Balança só lê.                                       |
| Preço padrão, especial, tabela, frete | **Web**               | Balança só lê.                                       |
| Veículo, motorista, transportadora    | **Web**               | Balança pode **criar** na hora (caminhão na fila).   |
| Cliente novo urgente                  | Web                   | Balança pode **criar** (envio imediato já existe).   |
| Usuários e permissões                 | Web (painel)          | —                                                    |

## 3. Decisões técnicas

### D1 — A pesagem continua offline-first. O que muda de dono é o CADASTRO.

Na reunião falou-se em "Supabase como banco principal e SQLite só de contingência". Para o
**cadastro**, é exatamente isso. Para a **pesagem**, não: se a balança passar a depender da nuvem
para abrir e fechar pesagem, a pedreira para quando a internet cai — e a internet lá cai. Hoje a
balança já aguenta 7 dias offline; isso não pode ser perdido.

Então a mudança no desktop é: **ele vira seguidor de tudo que é cadastro comercial** e continua
dono absoluto da operação. Na prática:

- a balança **não edita** preço, bloco comercial nem crédito do cliente (a trava de "secundária"
  já existe no runtime — `price-authority.ts` — só passa a valer para todas as balanças);
- ao abrir uma tela de cadastro **com internet**, a balança puxa o que a nuvem tem antes de mostrar
  (hoje o pull é de 15 s em 15 s; para cadastro que acabou de ser editado no site, vamos puxar
  na abertura da tela);
- cadastro **rápido** continua permitido na balança (placa nova, motorista, cliente que chegou
  sem cadastro), com o envio imediato que já existe (`triggerCadastroCloudPush`).

### D2 — O site é o "principal de preços"

Hoje o dono do preço é uma balança marcada no painel (`device_registrations.is_price_master`).
No desenho final **nenhuma balança** é principal: o site é. Para não reescrever o mecanismo, o
site entra na nuvem como um **dispositivo virtual** ("Web — Comercial") marcado como principal.
Efeito imediato e sem mexer no desktop: todas as balanças viram secundárias, aceitam o preço da
nuvem e recusam edição local — e a Edge Function que grava preço pelo site reaproveita a mesma
regra de desempate (`_shared/price-master-conflicts.ts`).

### D3 — O site nunca escreve direto nas tabelas

Leitura: direto do Postgres com RLS, como o site do carregador já faz.
Escrita: por **Edge Function** (`web-api`), autenticada com o login do usuário.

Motivo: as regras que evitam os problemas atuais vivem em `supabase/functions/_shared/` —
CNPJ alfanumérico (`document.ts`), desempate de preço, `commercial_published_at`, tombstone da
disputa de preço. Se o site gravar direto, ou essas regras são copiadas (e divergem), ou são
puladas (e o problema volta). Além disso, várias tabelas hoje têm a política
`no direct client access`, de propósito.

### D4 — Onde fica o código do site (PRECISA DE DECISÃO)

Foi criado o repositório `Dev-PedroMarcelino/Kyberrock-Web` (ainda vazio). Minha recomendação é
**não usar um repositório separado** e construir as telas dentro de `apps/loader-web`, no monorepo:

| Critério                | Dentro do monorepo (`apps/loader-web`)                | Repositório separado                                      |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| Login, perfis, admin    | Já existem (`AuthContext`, `admin-*`, `SalesReport`)  | Refazer ou copiar                                         |
| Regras compartilhadas   | `@kyberrock/shared` importado direto                  | Copiar `normalizeDocument`, tipos, enums — e manter igual |
| Migrations do banco     | Um lugar só (`supabase/migrations`)                   | Dois repositórios mexendo no mesmo banco = risco real     |
| Deploy                  | Docker + nginx já prontos                             | Montar do zero                                            |
| CI (build, lint, teste) | Já roda                                               | Montar do zero                                            |
| "Economizar espaço"     | Não é um problema real: git não cobra por repositório | —                                                         |

Se mesmo assim preferirem o repositório separado, valem três regras inegociáveis: (1) migrations
**só** no repositório principal; (2) o site escreve **só** via Edge Function (D3); (3) os tipos do
banco vêm de `supabase gen types`, nunca escritos à mão.

### D5 — Perfis de acesso no site

Hoje `user_profiles.role` aceita `loader` (carregador) e `comercial` (relatório de vendas).
Proposta mínima:

| Perfil       | Vê                                                | Edita                                            |
| ------------ | ------------------------------------------------- | ------------------------------------------------ |
| `carregador` | Solicitações abertas da unidade (já existe)       | Nada                                             |
| `comercial`  | Tudo do cadastro + relatórios                     | Clientes, veículos, motoristas, transportadoras  |
| `gestor`     | Tudo do comercial + fechamento, carteira, crédito | Tudo do comercial + **preços** e bloco comercial |

Alterar preço continua pedindo a senha de alteração de preço (já existe em `companies`).

### D6 — Hospedagem

O `loader-web` já roda em Docker/nginx numa VPS. Se o site novo for a mesma aplicação (D4), o
deploy já está resolvido e não precisa de Hostinger. Se for repositório separado, a Hostinger
serve um build estático do Vite sem problema (só precisa da regra de reescrita para
`index.html`). Vercel fica descartada, como combinado.

### D7 — Exclusão de cliente

Hoje a exclusão já é **lógica** (`deleted_at`, com "Restaurar") e é bloqueada quando há pesagem
aberta ou por faturar. Vamos endurecer como o Bruno pediu: **cliente com qualquer pesagem no
histórico não pode ser excluído — só inativado**. Mesma regra na balança e no site.

### D8 — Deduplicação só depois de centralizar

Deduplicar antes de tirar os SQLites secundários é jogar trabalho fora: a máquina que ainda não
sincronizou pode subir o duplicado de novo. A ordem é: centralizar → confirmar que nada ficou
preso em fila → deduplicar. E o Pedro tem razão num ponto: nem toda repetição é erro (cliente
com um cadastro por região). Por isso a deduplicação é **por planilha revisada por gente**, não
automática.

## 4. As etapas

Cada etapa tem um "pronto quando" objetivo. Nenhuma etapa seguinte começa antes da anterior
fechar. A operação não para em nenhum momento: até a Etapa 4, nada muda para quem usa a balança.

### Etapa 0 — Estabilizar o que está rodando (esta semana, risco zero)

Motivo: o Pedro viu no painel que **várias balanças estão desatualizadas**. A correção de "cadastro
editado que nunca chega na outra máquina" (`cloud_synced_at`, migração `202609150001`) e o envio
imediato de cadastro só valem na versão atual. Parte dos bugs relatados pode ser só isso.

- [ ] Atualizar **todas** as balanças para a versão estável atual (painel → Atualizações).
- [ ] Conferir no painel a coluna **Saúde**: nenhuma máquina com fila parada ou envio bloqueado.
- [ ] Conferir se a migração `202609150001_cadastro_cloud_arrival` está aplicada em produção
      (`list_migrations`) — migrations são manuais e podem ter ficado para trás.
- [ ] Inventário: quem usa qual computador, para quê (ver Perguntas, item 2).
- [ ] Congelar mudanças no sync entre desktops: a partir daqui, esforço vai para o site.
- [ ] Implementar D7 (exclusão só sem histórico) na balança — pequeno e independente.

**Pronto quando:** todas as balanças na mesma versão, Saúde verde, inventário preenchido.

### Etapa 1 — Fundações na nuvem (sem tocar a balança)

- [ ] Migration: `user_profiles.role` aceita `gestor`; políticas RLS de **leitura** para
      `comercial`/`gestor` nas tabelas de cadastro e de operações da própria empresa.
- [ ] Migration: dispositivo virtual "Web — Comercial" por empresa (`device_registrations`,
      `is_price_master = true`, sem token de balança). **Ainda não marcar como principal em
      produção** — só criar a linha inativa; a virada é na Etapa 4.
- [ ] Edge Function `web-api` (mesmo padrão de `admin-api`), autenticada pelo JWT do Supabase
      Auth, com as ações: `upsert_customer`, `set_customer_commercial`, `upsert_vehicle`,
      `upsert_driver`, `upsert_carrier`, `upsert_price` (padrão / especial / tabela / frete),
      `deactivate_customer`. Cada ação reaproveita o `_shared` que o `desktop-sync` já usa.
- [ ] Testes em `_shared` para as regras que a `web-api` passa a exercer.
- [ ] Empresa de **teste** no banco de produção ("Pedreira Teste"), com uma balança virtual: é
      onde o site vai ser testado com dados reais de estrutura sem encostar na pedreira. O sistema
      já é multiempresa; isso não exige nada novo.

**Pronto quando:** `web-api` deployada, migrations aplicadas, empresa de teste criada, um
cliente e um preço gravados pela `web-api` aparecem numa balança virtual da empresa de teste.

### Etapa 2 — Construir o site (em paralelo, sem risco para produção)

Ordem das telas, da que resolve mais dor para a que resolve menos:

1. **Clientes** — lista, busca, cadastro/edição, inativar, bloco comercial/crédito (só `gestor`).
2. **Preços** — preço padrão por produto, preço especial por cliente, tabelas e vínculos, frete.
3. **Veículos, motoristas, transportadoras** e seus vínculos.
4. **Relatórios** — os mesmos da balança (diário, mensal, por cliente, por produto, vendas),
   lendo da nuvem. É o que a Fernanda usa; é o que hoje diverge entre máquinas.
5. **Fechamento de faturas, carteira, crédito** (leitura primeiro; baixa de carteira depois).
6. **Usuários** — o admin da Kybernan já cria; falta a pedreira poder gerir os próprios.

Cada tela sai com teste automatizado das regras de tela (como as views do desktop já têm).

**Pronto quando:** telas 1–4 funcionando na Pedreira Teste; Bruno e Pedro usaram uma semana.

### Etapa 3 — Homologação com uma pessoa real, sem tirar nada

- [ ] Criar o acesso web da **Fernanda** (relatórios) na pedreira real. Ela continua com o
      desktop; passa a conferir os relatórios no site. Relatório é leitura: risco zero.
- [ ] Comparar por uma semana: relatório do site × relatório do PC principal. Divergência aqui é
      dado preso em alguma fila — resolver antes de seguir.
- [ ] Criar acesso da **Rafaela** (comercial) na Pedreira Teste para ela avaliar as telas de
      cadastro. Ainda **não** na pedreira real: duas pessoas editando o mesmo cliente por dois
      caminhos é o problema que estamos eliminando.

**Pronto quando:** relatórios batem por uma semana; Rafaela aprovou as telas.

### Etapa 4 — Virada, uma máquina por vez

Ordem: primeiro quem **só lê** (Fernanda), depois quem **cadastra** (Rafaela), depois o resto.
Para cada máquina, nesta ordem e sem pular:

1. No painel, confirmar **Saúde verde**: fila vazia, nenhum envio esperando clique.
2. Na máquina, forçar a **varredura completa** de cadastro e esperar terminar.
3. **Copiar o arquivo SQLite** e a pasta `backups` para um lugar seguro (é a rede de segurança;
   nunca desinstalar antes disso).
4. No painel, **desativar** o dispositivo (`is_active = false`). A partir daqui o desktop dessa
   máquina não fala mais com a nuvem.
5. Entregar o acesso web.
6. Desinstalar o desktop.
7. Uma semana de observação antes da próxima máquina.

Na virada da **última** máquina secundária: marcar o dispositivo virtual "Web — Comercial" como
principal de preços (D2). Todas as balanças passam a secundárias no próximo heartbeat (5 s).

**Pronto quando:** só os PCs de balança têm desktop; o site é o único lugar de cadastro; o
dispositivo virtual é o único principal.

### Etapa 5 — Balança seguidora (nova versão do desktop)

Agora sim mexer no desktop, com o problema já resolvido do lado de fora:

- [ ] Modo seguidor para **todo** cadastro comercial, independente do painel (D1).
- [ ] Puxar cadastro da nuvem **ao abrir** cliente/veículo/motorista quando há internet.
- [ ] Manter cadastro rápido (cliente, placa, motorista) com envio imediato.
- [ ] Esconder da balança as telas de preço/bloco comercial em modo edição (viram consulta).
- [ ] Publicar no anel **teste** primeiro (canal `beta`, uma balança), depois produção.

**Pronto quando:** balança na versão nova por duas semanas sem divergência de cadastro.

### Etapa 6 — Limpeza (só depois de tudo acima)

- [ ] Deduplicação de clientes por planilha: script gera relatório por `documentKey` com quantas
      pesagens, último uso, condição de pagamento e `omie_customer_id` de cada repetição; gente
      decide o sobrevivente; script **reaponta** pesagens, preços, veículos e vínculos para o
      sobrevivente e **inativa** os outros (nunca exclui — D7). Duplicatas legítimas por região
      ficam.
- [ ] Índice único por `documentKey` + empresa nos clientes ativos, para não nascer duplicado de
      novo.
- [ ] Remover do desktop o código de eleição de principal entre balanças (não precisa mais).
- [ ] `VACUUM FULL` no Supabase para devolver espaço.

## 5. O que NÃO vamos fazer (para não errar por pressa)

- Não transformar a pesagem em "nuvem primeiro". Pesagem é local, sempre.
- Não desinstalar nenhum desktop sem cópia do SQLite e Saúde verde.
- Não deduplicar antes de centralizar.
- Não excluir cliente com histórico; inativar.
- Não gravar tabela direto do navegador; sempre via Edge Function.
- Não manter duas pessoas editando o mesmo cadastro por dois caminhos (desktop e web) na
  pedreira real, nem por "um dia só".
- Não aplicar migration em produção sem conferir `list_migrations` antes e depois.

## 6. Riscos e como tratamos

| Risco                                                       | Tratamento                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Internet da pedreira cai e o comercial para                 | Aceito na reunião. Sugestão prática: link 4G/Starlink de contingência só para o escritório.  |
| Dado preso no SQLite de uma máquina que vai ser desligada   | Passos 1–3 da Etapa 4 são obrigatórios; a cópia do SQLite permite recuperar depois.          |
| Site grava cadastro fora das regras (CNPJ com letra, preço) | D3: escrita só via `web-api`, que reusa `_shared`.                                           |
| Migration esquecida em produção                             | Checklist de `list_migrations` em cada etapa. (Automatizar fica para depois desta migração.) |
| Virada do "principal" derruba preço                         | Feita por último, com uma balança no anel de teste primeiro.                                 |
| Deduplicação apaga cadastro legítimo                        | Planilha revisada; só inativa; nada é excluído.                                              |

## 7. Perguntas para fechar antes da Etapa 1

1. **Repositório:** dentro do monorepo (recomendado) ou `Kyberrock-Web` separado? (D4)
2. **Inventário de máquinas:** quem usa cada computador hoje e para quê? Pelo que entendi da
   reunião: PC principal (balança), Rafaela (comercial: clientes e preços), Fernanda (relatórios),
   Igor (?). Tem mais alguma? Tem mais de uma balança física?
3. **Perfis:** `comercial` e `gestor` bastam? Quem pode alterar preço — só gestor, ou comercial
   com a senha de preço?
4. **Hospedagem:** manter a VPS/Docker atual ou Hostinger? (D6 — só importa se for repositório
   separado)
5. **Fechamento de faturas e carteira:** precisam estar no site já na primeira virada, ou podem
   continuar na balança por enquanto?
6. **Quem faz o quê:** proposta — Pedro nas telas do site (Etapa 2); Fable nas fundações da nuvem
   (Etapa 1), na `web-api`, na balança seguidora (Etapa 5) e nos scripts de deduplicação
   (Etapa 6); Bruno na homologação e na virada com a pedreira (Etapas 3 e 4).

## 8. Documentos relacionados

- `docs/ARCHITECTURE.md` — desenho atual e regras de dono de dado.
- `docs/preco-balanca-principal.md` — como funciona a principal de preços hoje (base da D2).
- `docs/phase-1/sync-strategy.md` — filas, cursores e conflitos.
- `AGENTS.md` — "SQL migrations" (manual), "Cadastro de uma maquina chega nas outras",
  "Coluna Saúde da aba Balanças".
