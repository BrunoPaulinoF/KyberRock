# Plano: um banco só — comercial pela web, balança offline-first

Versão: 1.1 — 22/09/2026 (decisões fechadas: repositório separado, Hostinger; Etapa 1 no ar)
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
│                              │        │  (repositório Kyberrock-Web, │
│  Dona da PESAGEM             │        │   hospedado na Hostinger)    │
│  • pesa sem internet         │        │                              │
│  • fecha e imprime local     │        │  Dona do CADASTRO:           │
│  • envia quando volta a rede │        │  • clientes, preços, tabelas │
│                              │        │  • veículos, motoristas,     │
│  Cadastro: SEGUE a nuvem     │        │    transportadoras           │
│  (só cadastro rápido na fila)│        │  • relatórios, fechamentos   │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │  push/pull (já existe)                │  leitura RLS + escrita via `web-api`
               ▼                                       ▼
        ┌──────────────────────────────────────────────────────┐
        │  SUPABASE — o único banco de cadastro da pedreira    │
        │  Postgres + Edge Functions (omie-sync, web-api…)     │
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
  (desde 22/09 a nuvem **avisa** pelo Realtime — `cadastro_change_pings` — e a balança puxa em
  1 a 3 s; o tique de 15 s continua como rede de segurança);
- cadastro **rápido** continua permitido na balança (placa nova, motorista, cliente que chegou
  sem cadastro), com o envio imediato que já existe (`triggerCadastroCloudPush`).

### D2 — O site é o "principal de preços"

Hoje o dono do preço é uma balança marcada no painel (`device_registrations.is_price_master`).
No desenho final **nenhuma balança** é principal: o site é. Para não reescrever o mecanismo, o
site entra na nuvem como um **dispositivo virtual** ("Web — Comercial", id `web-<company_id>`,
`_shared/web-device.ts`). Ele nasce sozinho na primeira gravação do site, **sem** a marca de
principal; marcar `is_price_master = true` nele é a virada da Etapa 4 — todas as balanças viram
secundárias no próximo heartbeat (5 s), sem mexer no desktop. O mesmo dispositivo é como o site
fala com o OMIE (`omie-sync` autentica por dispositivo; o token é derivado da chave de serviço e
nunca fica gravado).

### D3 — O site nunca escreve direto nas tabelas

Leitura: direto do Postgres com RLS, como o site do carregador já faz.
Escrita: por **Edge Function** (`web-api`), autenticada com o login do usuário.
**Contrato completo em `docs/web-api.md`.**

Motivo: as regras que evitam os problemas atuais vivem em `supabase/functions/_shared/` —
CNPJ alfanumérico (`document.ts`), documento único por empresa, `commercial_published_at`,
uma linha viva por chave natural de preço. Se o site gravar direto, ou essas regras são copiadas
(e divergem), ou são puladas (e o problema volta). Além disso, várias tabelas hoje têm a
política `no direct client access`, de propósito.

### D4 — Onde fica o código do site — DECIDIDO: repositório separado

`Dev-PedroMarcelino/Kyberrock-Web`, separado do monorepo. Motivo do Bruno: cada merge sobe
sozinho para produção, e o site precisa subir separado da balança e das Edge Functions.

Custo aceito: login, perfis e listagens que já existem em `apps/loader-web` serão refeitos lá.
Para o custo parar aí, três regras inegociáveis:

1. **Migrations só no repositório principal** (`supabase/migrations`). O site nunca cria tabela,
   coluna ou política.
2. **O site escreve só via `web-api`** (D3). Tipos das tabelas vêm de `supabase gen types`,
   nunca à mão.
3. **Regra de negócio nova nasce em `_shared/` do repositório principal**, não no site. O site é
   tela.

O que continua no monorepo: `apps/loader-web` (site do carregador e painel `/admin`), até o
dia em que o site novo absorver o carregador.

### D5 — Perfis de acesso no site

`user_profiles.role` aceita `loader`, `comercial` e `gestor` (migração `202609220003`).

| Perfil       | Vê                                                | Edita                                            |
| ------------ | ------------------------------------------------- | ------------------------------------------------ |
| `carregador` | Solicitações abertas da unidade (já existe)       | Nada                                             |
| `comercial`  | Tudo do cadastro + relatórios                     | Clientes, veículos, motoristas, transportadoras  |
| `gestor`     | Tudo do comercial + fechamento, carteira, crédito | Tudo do comercial + **preços** e bloco comercial |

O painel `/admin` já cria os dois (seção Comercial, campo Perfil). Alterar preço pelo site é
só do gestor; a senha de alteração de preço da balança continua valendo na balança.

### D6 — Hospedagem — DECIDIDO: Hostinger, com deploy automático do GitHub

O site novo sobe na Hostinger a partir do repositório (merge na branch de produção = deploy).
A VPS atual (Docker/nginx do `loader-web`) será desligada quando o carregador e o painel
também estiverem lá. Vercel descartada, como combinado.

Ponto de atenção para o Pedro na Hostinger: é um SPA — toda rota precisa cair em `index.html`
(regra de reescrita no `.htaccess`), e as variáveis `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY` entram no build.

### D7 — Exclusão de cliente — FEITO (main, 22/09)

Excluir cliente exige cadastro **sem histórico nenhum** (`historyCount` em
`findCustomerDeletionBlock`); quem tem carga ou crédito usa Inativar ou Unificar. A `web-api`
nem tem ação de excluir: só `set_customer_active`.

### D8 — Deduplicação — por DOCUMENTO já feita (main, 22/09); por NOME é manual

A migração `202609220002_customer_tombstone_and_merge` unificou os duplicados de mesmo
CNPJ/CPF na nuvem (99 grupos / 202 linhas na Ibiúna) e a mesma regra roda em cada balança na
abertura. A regra de quem fica (código OMIE → mais antigo → menor id) é a mesma nos dois lados
de propósito. Duplicado por **nome** (matriz e filial) não é unificado sozinho: fica para o
painel "Cadastros repetidos" da tela de clientes, com gente decidindo.

## 4. As etapas

Cada etapa tem um "pronto quando" objetivo. Nenhuma etapa seguinte começa antes da anterior
fechar. A operação não para em nenhum momento: até a Etapa 4, nada muda para quem usa a balança.

### Etapa 0 — Estabilizar o que está rodando — quase fechada

Estado em 22/09 (lido direto do banco de produção):

- [x] Balanças ativas na versão atual (0.8.244): PC PRINCIPAL, RAFAELA COMERCIAL, fernanda,
      pc hellen, suporte, Desktop balanca.
- [ ] Duas máquinas paradas: **"PC pedro kyber"** (0.8.240, visto em 09/09) e **"Lg gram"**
      (nunca reportou versão, visto em 04/08). Se não estão em uso, **desativar no painel** —
      máquina parada com SQLite é uma fonte de divergência esperando para voltar.
- [x] Migrations aplicadas em produção até `202609220002` (`list_migrations` conferido).
- [x] Inventário (8 máquinas, 1 unidade): principais de preço hoje são **PC PRINCIPAL**,
      **RAFAELA COMERCIAL** e **fernanda**; as outras são secundárias.
- [x] D7 (exclusão só sem histórico) — entrou na main em 22/09.
- [x] Sincronização instantânea de cadastro entre balanças (Realtime) — main, 22/09.
- [ ] Congelar mudanças no sync entre desktops: a partir daqui, esforço vai para o site.

**Pronto quando:** as duas máquinas paradas estiverem desativadas (ou confirmadas em uso e
atualizadas).

### Etapa 1 — Fundações na nuvem (sem tocar a balança) — código pronto, falta aplicar

- [x] Migration `202609220003_web_access_roles`: perfil `gestor`; leitura RLS para
      comercial/gestor no cadastro e nas operações da própria empresa. **Falta aplicar em
      produção** (migrations são manuais — `apply_migration`).
- [x] Dispositivo virtual "Web — Comercial" (`_shared/web-device.ts`): nasce sozinho na primeira
      gravação do site, sem marca de principal.
- [x] Edge Function **`web-api`** (`supabase/functions/web-api`): sessão por login do Supabase,
      `company_id` sempre da sessão, ações de cliente, bloco comercial, transportadora,
      motorista, veículo, vínculos e preços; envio ao OMIE pelo mesmo caminho da balança. Sobe
      sozinha no merge (`edge-functions-deploy.yml`).
- [x] Painel `/admin` cria usuário `gestor`.
- [x] Testes: `_shared/web-session`, `web-device`, `web-cadastro` e `web-api/handler`
      (58 casos), `deno check` da função, build/lint/test do monorepo verdes.
- [ ] Empresa de **teste** no banco de produção ("Pedreira Teste"), com uma balança virtual e
      um usuário `gestor` e um `comercial`: é onde o site vai ser testado com dados reais de
      estrutura sem encostar na Ibiúna.
- [ ] Contrato entregue ao Pedro: `docs/web-api.md`.

**Pronto quando:** migration aplicada, `web-api` no ar, empresa de teste criada e um cliente
gravado pelo `curl`/site aparecendo numa balança virtual da empresa de teste.

### Etapa 2 — Construir o site (repositório `Kyberrock-Web`, Pedro)

Ordem das telas, da que resolve mais dor para a que resolve menos:

1. **Login e perfil** (`me`).
2. **Clientes** — lista, busca, cadastro/edição, inativar, bloco comercial/crédito (só `gestor`).
3. **Preços** — preço padrão por produto, preço especial por cliente, tabelas e vínculos.
4. **Veículos, motoristas, transportadoras** e seus vínculos.
5. **Relatórios** — os mesmos da balança (diário, mensal, por cliente, por produto, vendas),
   lendo da nuvem. É o que a Fernanda usa; é o que hoje diverge entre máquinas.
6. **Fechamento de faturas, carteira, crédito** (leitura primeiro; baixa de carteira depois —
   precisa de novas ações na `web-api`).
7. **Usuários** — o admin da Kybernan já cria; falta a pedreira poder gerir os próprios.

Cada tela sai com teste automatizado das regras de tela. Deploy automático na Hostinger.

**Pronto quando:** telas 1–5 funcionando na Pedreira Teste; Bruno e Pedro usaram uma semana.

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

Ordem: primeiro quem **só lê** (fernanda), depois quem **cadastra** (RAFAELA COMERCIAL),
depois o resto (pc hellen, suporte). Para cada máquina, nesta ordem e sem pular:

1. No painel, confirmar **Saúde verde**: fila vazia, nenhum envio esperando clique.
2. Na máquina, forçar a **varredura completa** de cadastro e esperar terminar.
3. **Copiar o arquivo SQLite** e a pasta `backups` para um lugar seguro (é a rede de segurança;
   nunca desinstalar antes disso).
4. No painel, **desativar** o dispositivo (`is_active = false`). A partir daqui o desktop dessa
   máquina não fala mais com a nuvem.
5. Entregar o acesso web.
6. Desinstalar o desktop.
7. Uma semana de observação antes da próxima máquina.

Na virada da **última** máquina secundária: marcar o dispositivo virtual `web-<company_id>`
como principal de preços (painel → Balanças → Preços, ou
`update device_registrations set is_price_master = true where id = 'web-<company_id>'`) e
**desmarcar** as balanças. Todas passam a secundárias no próximo heartbeat.

**Pronto quando:** só o PC PRINCIPAL (e a balança física, se for outra máquina) tem desktop; o
site é o único lugar de cadastro; o dispositivo virtual é o único principal.

### Etapa 5 — Balança seguidora (nova versão do desktop)

Agora sim mexer no desktop, com o problema já resolvido do lado de fora:

- [ ] Modo seguidor para **todo** cadastro comercial, independente do painel (D1).
- [ ] Manter cadastro rápido (cliente, placa, motorista) com envio imediato.
- [ ] Esconder da balança as telas de preço/bloco comercial em modo edição (viram consulta).
- [ ] Publicar no anel **teste** primeiro (canal `beta`, uma balança), depois produção.

**Pronto quando:** balança na versão nova por duas semanas sem divergência de cadastro.

### Etapa 6 — Limpeza (só depois de tudo acima)

- [x] Deduplicação por documento — feita em 22/09 (D8).
- [ ] Duplicados por **nome**: passar pelo painel "Cadastros repetidos" com a Rafaela.
- [ ] Índice único por documento + empresa nos clientes vivos, para não nascer duplicado de
      novo (a `web-api` já recusa; o índice é a garantia no banco).
- [ ] Remover do desktop o código de eleição de principal entre balanças (não precisa mais).
- [ ] Desligar a VPS quando carregador e painel estiverem na Hostinger.
- [ ] `VACUUM FULL` no Supabase para devolver espaço.

## 5. O que NÃO vamos fazer (para não errar por pressa)

- Não transformar a pesagem em "nuvem primeiro". Pesagem é local, sempre.
- Não desinstalar nenhum desktop sem cópia do SQLite e Saúde verde.
- Não excluir cliente com histórico; inativar.
- Não gravar tabela direto do navegador; sempre via `web-api`.
- Não criar migration fora do repositório principal.
- Não manter duas pessoas editando o mesmo cadastro por dois caminhos (desktop e web) na
  pedreira real, nem por "um dia só".
- Não aplicar migration em produção sem conferir `list_migrations` antes e depois.

## 6. Riscos e como tratamos

| Risco                                                        | Tratamento                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Internet da pedreira cai e o comercial para                  | Aceito na reunião. Sugestão prática: link 4G/Starlink de contingência só para o escritório.  |
| Dado preso no SQLite de uma máquina que vai ser desligada    | Passos 1–3 da Etapa 4 são obrigatórios; a cópia do SQLite permite recuperar depois.          |
| Site grava cadastro fora das regras (CNPJ com letra, preço)  | D3: escrita só via `web-api`, que reusa `_shared`.                                           |
| Regra de negócio copiada no repositório do site e divergindo | D4: regra nasce em `_shared/`; o site é tela.                                                |
| Migration esquecida em produção                              | Checklist de `list_migrations` em cada etapa. (Automatizar fica para depois desta migração.) |
| Virada do "principal" derruba preço                          | Feita por último, com uma balança no anel de teste primeiro.                                 |
| Deduplicação apaga cadastro legítimo                         | Por documento é certeza (mesmo CNPJ); por nome é manual e só inativa.                        |

## 7. Decisões já tomadas (respostas do Bruno, 22/09)

1. **Repositório:** separado (`Kyberrock-Web`). Motivo: merge e deploy independentes.
2. **Hospedagem:** Hostinger com deploy automático do GitHub; VPS será desligada.
3. **Perfis:** `comercial` e `gestor`; preço só do gestor.
4. **Divisão:** Pedro nas telas do site; Fable nas fundações da nuvem (`web-api`, migrations),
   na balança seguidora e nos scripts; Bruno na homologação e na virada com a pedreira.

Ainda em aberto: fechamento de faturas e carteira precisam estar no site na primeira virada, ou
podem continuar na balança por enquanto? (Afeta a Etapa 2, item 6.)

## 8. Documentos relacionados

- `docs/web-api.md` — contrato do site com a nuvem (o que o Pedro precisa).
- `docs/ARCHITECTURE.md` — desenho atual e regras de dono de dado.
- `docs/preco-balanca-principal.md` — como funciona a principal de preços hoje (base da D2).
- `docs/phase-1/sync-strategy.md` — filas, cursores e conflitos.
- `AGENTS.md` — "SQL migrations" (manual), "Cadastro de uma maquina chega nas outras",
  "Cadastro duplicado", "Coluna Saúde da aba Balanças".
