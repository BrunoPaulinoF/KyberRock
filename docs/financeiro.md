# Backoffice financeiro (cobrança da plataforma)

Cobrança da **Kybernan para cada pedreira** que usa o KyberRock: mensalidade
acertada caso a caso, fatura no fechamento, boleto do Mercado Pago, envio por
WhatsApp e bloqueio automático por inadimplência.

> Não confundir com o financeiro **das operações da balança** (venda, pedido,
> contas a receber do cliente da pedreira). Aquele vive no OMIE e no relatório
> de vendas do loader-web. Este documento é só a mensalidade do sistema — por
> isso a tela fica em uma aba separada dos cadastros.

## Onde fica cada coisa

| Camada                        | Arquivo                                                     | Papel                                                                               |
| ----------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Regras de ciclo               | `supabase/functions/_shared/billing-cycle.ts`               | Virada, fechamento, vencimento, rateio, inadimplência. **Puro e testado.**          |
| Textos e cadastro de cobrança | `supabase/functions/_shared/billing-invoice.ts`             | Descrição do boleto, mensagem de WhatsApp, campos obrigatórios. **Puro e testado.** |
| Mercado Pago                  | `supabase/functions/_shared/mercado-pago.ts`                | Criar/consultar/cancelar boleto. **`fetch` injetável, testado.**                    |
| Fatura em PDF                 | `supabase/functions/_shared/billing-pdf.ts`                 | Demonstrativo A4 via `pdf.ts` (pdf-lib).                                            |
| Motor                         | `supabase/functions/_shared/billing-engine.ts`              | Orquestra tudo. Compartilhado entre painel e cron.                                  |
| API do painel                 | `supabase/functions/admin-billing/`                         | Ações do backoffice (mesma sessão do `admin-api`).                                  |
| Passada automática            | `supabase/functions/billing-run/`                           | Chamada pelo pg_cron 2×/dia.                                                        |
| Notificação de pagamento      | `supabase/functions/billing-webhook/`                       | IPN/webhook do Mercado Pago.                                                        |
| Tela                          | `apps/loader-web/src/pages/FinancialBackoffice.tsx`         | Aba **Financeiro** do painel admin.                                                 |
| Schema                        | `supabase/migrations/202608120001_financial_backoffice.sql` | Colunas de cobrança + `billing_settings` / `billing_invoices` / `billing_events`.   |
| Agendamento                   | `supabase/migrations/202608120002_billing_run_cron.sql`     | Job `kyberrock_billing_run`.                                                        |
| Segredos                      | `supabase/functions/_shared/billing-secrets.ts`             | Nome fixo de cada credencial + leitura do secret. **Puro e testado.**               |

O painel e o cron chamam **o mesmo motor**: "gerar agora" e "gerar sozinho"
produzem exatamente a mesma fatura.

## O ciclo

Três datas por pedreira, no cadastro dela (aba Financeiro → Cobrança por pedreira):

- **Data de virada do sistema** (`billing_start_date`) — primeiro dia de uso
  cobrado. É daqui que sai o rateio da primeira fatura.
- **Dia do fechamento** (`billing_closing_day`) — quando o ciclo fecha e a
  fatura é gerada. Mês curto fecha no último dia (dia 31 → 28/02).
- **Dia do vencimento** (`billing_due_day`) — vencimento do boleto. Dia maior
  que o do fechamento vence no mesmo mês ("fecha 5, vence 20"); menor ou igual
  vence no mês seguinte ("fecha 25, vence 5").

Um ciclo é o intervalo `(fechamento anterior, fechamento]`. Com fechamento no
dia 25 e virada em 05/08:

```
1ª fatura:  05/08 → 25/08   21 de 31 dias   →  rateio (21/31 do valor acertado)
2ª fatura:  26/08 → 25/09   31 de 31 dias   →  valor cheio
```

O rateio é por dia corrido: `valor × dias_cobrados / dias_do_ciclo_cheio`.

Vazios caem no padrão global de `billing_settings` (fechamento, vencimento e
carência). O **valor acertado** não tem padrão: sem ele a pedreira não fatura.

## Fechamento → boleto → WhatsApp

No fechamento (`runBillingCycle`), para cada pedreira com `billing_enabled`:

1. **Fatura** (`billing_invoices`) com o período, o valor rateado e o vencimento.
2. **Boleto** no Mercado Pago (`payment_method_id: bolbradesco`), com
   `external_reference` = id da fatura e `notification_url` apontando para o
   `billing-webhook`.
3. **WhatsApp** pela instância UAZAPI **global** da Kybernan (configurada no
   painel, não por pedreira): texto com valor, vencimento, link e linha
   digitável, e o PDF da fatura como anexo.

O anexo é best-effort de propósito — o texto já leva tudo que o cliente precisa
para pagar, então PDF que falha não invalida o envio.

A passada é **idempotente**: fatura por ciclo é protegida por índice único
(`company_id, period_end` entre as não canceladas), boleto só sai quando não há
`boleto_payment_id` e o WhatsApp só sai quando `whatsapp_sent_at` está vazio.
Um ciclo pulado (motor parado, pedreira cadastrada com atraso) é recuperado:
`pendingBillingPeriods` devolve **todos** os fechamentos pendentes, não só o
último.

## Bloqueio por inadimplência

"Depois de X dias de inadimplência, bloqueio automático." X é
`billing_grace_days` da pedreira ou `default_grace_days` do painel.

- Vencimento 05/09 com carência 5 → bloqueia em **11/09** (10/09 ainda é o
  quinto dia tolerado).
- O bloqueio grava `companies.payment_blocked = true` — a mesma coluna que o
  `desktop-status` já consulta, então a balança cai na tela de bloqueio sem
  nenhuma mudança no desktop.
- Pagou (webhook, reconsulta ou baixa manual) e não sobrou nada vencido além da
  carência → **libera sozinho**.

A liberação é conservadora: o motor só desbloqueia quem **ele** bloqueou (alguma
fatura com `blocked_at`). Bloqueio manual do administrador não é desfeito pela
passada da madrugada. Pelo mesmo motivo, liberar manualmente limpa os
`blocked_at` — senão a passada seguinte bloquearia de novo no mesmo dia.

`billing_block_exempt` isenta uma pedreira do bloqueio (piloto, cortesia, acordo
em andamento) sem desligar a cobrança.

## Configuração (aba Financeiro → Configurações)

- **Credenciais** — somente leitura; ver "Onde moram os segredos" abaixo.
- **Segredo de assinatura do webhook** — opcional. Sem ele, o `billing-webhook`
  ainda confirma o pagamento **consultando a API** do Mercado Pago, que é a
  fonte da verdade; a assinatura só evita a consulta desnecessária de um POST
  forjado.
- **WhatsApp** — URL e nome da instância UAZAPI da Kybernan ficam na tabela (não
  são credencial); o token vem do secret. É diferente de
  `report_channel_settings`, que é a instância de cada pedreira para os
  relatórios dela.
- **Padrões do ciclo** e as quatro chaves gerais: fechar, emitir boleto, enviar
  por WhatsApp e bloquear automaticamente.
- **Emitente e textos** — cabeçalho do PDF, descrição do boleto e mensagem do
  WhatsApp, com marcadores (`{pedreira}`, `{valor}`, `{vencimento}`, `{boleto}`,
  `{linha_digitavel}`, `{pix}`, …). Marcador desconhecido fica visível no texto
  em vez de sumir — o erro aparece no boleto de teste.

## Onde moram os segredos

Nenhuma credencial do financeiro fica no banco, no repositório ou no navegador.
O nome de cada variável é **fixo no código** (`_shared/billing-secrets.ts`) e o
valor vive no secret do Supabase, lido pela Edge Function com `Deno.env.get()`.

| Segredo                          | Variável                      | Sem ele                                                    |
| -------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Access token do Mercado Pago     | `MERCADO_PAGO_ACCESS_TOKEN`   | Nenhum boleto é emitido.                                   |
| Segredo de assinatura do webhook | `MERCADO_PAGO_WEBHOOK_SECRET` | A baixa continua funcionando (o webhook reconsulta a API). |
| Token da instância de WhatsApp   | `UAZAPI_INSTANCE_TOKEN`       | A fatura é gerada mas não enviada.                         |

Para gravar o valor: **Supabase → Edge Functions → Secrets**, ou
`supabase secrets set MERCADO_PAGO_ACCESS_TOKEN=...`.

**A tela não tem campo de segredo** — nem para o valor, nem para o nome da
variável. Ela só exibe, por credencial, o nome da variável, um selo
Configurado/Pendente e os quatro últimos caracteres, o bastante para reconhecer
qual credencial está ativa. Campo que não existe é campo onde ninguém cola um
token por engano; e `admin-billing` nem aceita esses campos no payload.

Trocar uma credencial é trocar o secret no Supabase: sem deploy, sem SQL e sem
nenhum ponto onde o token possa vazar por descuido. As chaves do próprio
Supabase seguem a regra de sempre — `SUPABASE_SERVICE_ROLE_KEY` só existe dentro
da Edge Function, e o loader-web carrega apenas a _publishable key_.

### Webhook no painel do Mercado Pago

Aponte para `https://<projeto>.supabase.co/functions/v1/billing-webhook`, evento
**Pagamentos**. O `notification_url` também vai em cada boleto emitido, então na
prática as notificações chegam mesmo sem essa configuração — ela cobre eventos
posteriores à emissão.

## Idempotência do boleto

Mesma convenção do OMIE:

```
kyberrock:{companyId}:{invoiceId}:create_boleto        (1ª emissão)
kyberrock:{companyId}:{invoiceId}:create_boleto:{n}    (reemissão n)
```

Reenvio depois de falha de rede não duplica cobrança; reemissão deliberada
(boleto cancelado, vencimento novo) precisa de chave nova — senão o Mercado Pago
devolveria o boleto velho.

Ajustar valor ou vencimento de uma fatura **já emitida** não muda o papel que o
cliente recebeu: a fatura passa a exibir "reemita o boleto" e o botão de
reemissão cancela o anterior antes de criar o novo.

## A tela

Três abas — **Faturas**, **Cobrança por pedreira** e **Configurações** — e, acima
delas, o que precisa existir para a cobrança rodar.

**Para a cobrança funcionar** (`buildActivationChecklist`, em
`apps/loader-web/src/lib/billing.ts`) lista, com o nome exato do campo, o que
ainda falta: secret do Mercado Pago, secret + URL + nome da instância de
WhatsApp, emitente, e as pedreiras cujo cadastro não fecha ciclo. `pending`
impede a cobrança; `warn` é recomendação (assinatura do webhook, sandbox
selecionado, emitente incompleto). O painel só aparece nas outras abas enquanto
houver pendência, e fica permanente em Configurações. Ele existe porque a
cobrança depende de coisas guardadas em quatro lugares diferentes e, faltando
qualquer uma, o sintoma só apareceria no fechamento — fatura sem boleto, boleto
sem envio, ciclo que não fecha.

**Faturar** abre a prévia (`preview_invoice`) antes de cobrar: ciclos já
fechados com período, rateio e valor, o total, o que falta no cadastro para o
boleto e para o envio, e duas opções — emitir boleto e enviar por WhatsApp — que
podem ser desmarcadas para gerar só a fatura e conferir o valor. É de lá que sai
também o **Antecipar fechamento** (`force`), para a pedreira que entrou fora do
calendário. Antes, o clique em "Faturar" criava a fatura, emitia o boleto e
disparava o WhatsApp de uma vez, sem nenhuma tela dizendo o valor.

O **detalhe da fatura** mostra a trilha do `billing_events` (`invoice_events`),
carregada só ao abrir. A aba **Configurações** exibe a URL do `billing-webhook`
desta instalação, pronta para colar no painel do Mercado Pago.

## Operação

- **Rodar cobrança agora** (topo da aba) executa a passada completa na hora.
- **Faturar** fecha os ciclos já vencidos de uma pedreira; **Antecipar
  fechamento** força o próximo ciclo (pedreira que entrou fora do calendário).
- Fatura **paga** não pode ser excluída — é o registro do dinheiro que entrou.
  Para desfazer, cancele.
- `billing_events` guarda a trilha (criada, boleto emitido/falhou, enviada,
  paga, bloqueou, liberou). O registro é best-effort: perder um log é barato,
  perder o boleto não.

## Deploy

1. **Aplique as migrações antes de usar a tela.** Migrações não são automáticas
   (ver AGENTS.md § "SQL migrations"): use `apply_migration` ou a CLI.
   `202608120003` move os segredos para os secrets do Supabase e `202608120004`
   fixa o nome de cada variável — as duas **removem** colunas de
   `billing_settings`, de propósito: coluna morta perto de credencial vira, com
   o tempo, coluna com credencial.
2. As Edge Functions saem no push para `main` pelo
   `.github/workflows/edge-functions-deploy.yml`. As três novas já estão em
   `supabase/config.toml` com `verify_jwt = false` — função sem bloco lá é
   implantada com verificação ligada e responde 401 ao painel.
3. O job `kyberrock_billing_run` é criado pela migração
   `202608120002_billing_run_cron.sql` e reaproveita o segredo
   `cron_shared_secret` do Vault, o mesmo do agendador de relatórios.
