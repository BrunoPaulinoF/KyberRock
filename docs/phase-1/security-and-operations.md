# Security And Operations

Status: documento vivo. Descreve o modelo de seguranca e operacao em uso.

## Segredos

Nenhum segredo real deve ser versionado.

## Desenvolvimento

Permitido:

- variaveis de ambiente locais;
- `.env.local` ignorado pelo Git;
- Windows Credential Manager quando implementado;
- Secret Manager para cloud.

Proibido:

- segredos em `docs/`;
- segredos em codigo fonte;
- segredos em logs;
- service account JSON no repositorio;
- banco SQLite local versionado.

## Segredos Em Uso

Nenhum destes valores fica no banco, na tela ou no Git. Os nomes sao fixos no codigo; o valor vem
do ambiente.

| Secret                                                           | Onde vive             | Para que serve                                             |
| ---------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                                      | Edge Functions        | Unica chave com escrita ampla; nunca sai do lado servidor  |
| `KYBERROCK_ADMIN_USERNAME` / `_PASSWORD_HASH` / `_PASSWORD_SALT` | Edge Functions        | Login do painel administrativo                             |
| `KYBERROCK_ADMIN_SESSION_SECRET`                                 | Edge Functions        | Assinatura da sessao do painel                             |
| `KYBERROCK_CREDENTIAL_KEY`                                       | Edge Functions        | Cifra AES-GCM do cofre de senhas (minimo de 16 caracteres) |
| `CRON_SHARED_SECRET`                                             | Edge Functions        | Autentica as chamadas do pg_cron (`x-cron-secret`)         |
| `MERCADO_PAGO_ACCESS_TOKEN` / `MERCADO_PAGO_WEBHOOK_SECRET`      | Edge Functions        | Emissao e confirmacao dos boletos da plataforma            |
| `UAZAPI_INSTANCE_TOKEN` / `UAZAPI_WHATSAPP_URL`                  | Edge Functions        | Instancia global de WhatsApp da cobranca                   |
| `SMTP_*` / `DAILY_REPORT_SENDER`                                 | Edge Functions        | Envio dos relatorios agendados                             |
| `GH_RELEASES_TOKEN` / `_OWNER` / `_REPO`                         | Edge Functions        | Resolver o instalador mais recente no repositorio privado  |
| `GH_UPDATER_TOKEN`                                               | Secret do Actions     | Token somente-leitura injetado no build para o auto-update |
| App key/secret do OMIE                                           | Por empresa, servidor | Toda chamada OMIE sai da Edge Function                     |

O token do desktop e guardado como **SHA-256** em `device_registrations.token_hash` — o valor em
claro so existe na maquina ativada, e nao ha cofre para ele: a saida e gerar novo codigo de
ativacao. O `GH_UPDATER_TOKEN` viaja dentro do `.asar` e por isso e tratado como baixa-confianca:
escopo de um repositorio so, `Contents: read`, rotacionavel refazendo o build.

## Autenticacao E Autorizacao

| Ator              | Como autentica                                                | O que pode                                                        |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Balanca (desktop) | Codigo de ativacao -> token do dispositivo (SHA-256 na nuvem) | Escrita limitada a sua empresa/unidade, sempre por Edge Function  |
| Carregador        | Supabase Auth (usuario criado pelo painel)                    | Le as solicitacoes em aberto da sua unidade; nao escreve operacao |
| Administrador     | `admin-auth` (usuario/senha em secret, sessao assinada)       | Pedreiras, unidades, usuarios, frota, versoes e financeiro        |
| pg_cron           | `x-cron-secret`                                               | Dispara relatorios e a passada de cobranca                        |
| Mercado Pago      | Webhook + reconsulta a API                                    | Nunca e a fonte da verdade: o corpo da notificacao e so um aviso  |

Duas regras que o codigo mantem de proposito:

- **O escopo vem do registro do dispositivo, nunca do payload.** Empresa e unidade de tudo que uma
  balanca projeta saem de `device_registrations` (`_shared/device-scope.ts`). Uma copia local
  velha — balanca movida de pedreira pelo administrador — projetaria na unidade errada, e o
  carregador daquela pedreira nunca veria a operacao.
- **Ativar uma balanca nunca toca o registro de outra** (`_shared/device-registration.ts`):
  rotacionar o token alheio derrubaria a maquina que esta trabalhando.

### Credenciais no painel

- **Revelacao sob demanda** (`reveal_credentials`): mostra as credenciais de **um** cadastro, fora
  do `list` — segredo que viaja em todo carregamento de tela fica em cache de navegador e log de
  proxy. Cada consulta grava `credentials_revealed` em `audit_logs` **sem o valor**.
- **Cofre de senhas** (`user_password_vault`): o Supabase Auth guarda bcrypt, que nao volta, entao
  o painel captura a senha no momento em que a define e a guarda cifrada em AES-GCM. A chave fica
  fora do banco; dump da tabela sozinho nao abre nada. A gravacao e best-effort — cadastro nunca
  falha porque o cofre falhou.

## Desktop Windows

O desktop precisa armazenar configuracoes locais sem expor segredos.

Caminhos planejados:

| Uso                       | Caminho                                             |
| ------------------------- | --------------------------------------------------- |
| Banco                     | `%ProgramData%\\KyberRock\\data\\kyberrock.sqlite3` |
| Backups                   | `%ProgramData%\\KyberRock\\backups`                 |
| Logs                      | `%ProgramData%\\KyberRock\\logs`                    |
| Config local nao sensivel | `%ProgramData%\\KyberRock\\config`                  |

Credenciais sensiveis devem ir para mecanismo seguro, nao para JSON puro nesses diretorios.

## Dados Sensiveis

Classificacao inicial:

| Tipo                             | Tratamento                                     |
| -------------------------------- | ---------------------------------------------- |
| Credenciais OMIE/Supabase/e-mail | Nunca logar; Secret Manager/ambiente seguro    |
| Dados financeiros cliente        | Restringir no Supabase e UI do carregador      |
| CPF/CNPJ                         | Evitar no site do carregador se nao necessario |
| Pesos e valores                  | Exibir apenas a quem precisa                   |
| Logs tecnicos                    | Sanitizar payloads                             |

## Backup Local

Estrategia inicial:

- backup automatico diario do SQLite;
- backup antes de migration;
- reter janela minima configuravel;
- permitir exportacao manual;
- restauracao deve exigir confirmacao explicita;
- restauracao gera log tecnico e auditoria local.

Nome recomendado:

```text
kyberrock-{unitId}-{yyyyMMdd-HHmmss}.sqlite3
```

## Logs

### Audit Logs

Imutaveis do ponto de vista da aplicacao.

Eventos obrigatorios:

- captura de peso;
- fechamento de operacao;
- cancelamento;
- alteracao de frete depois da saida;
- reimpressao;
- sync manual;
- alteracao de configuracao de balanca/impressora.

### Technical Logs

Usados para suporte.

Devem registrar:

- falha de balanca;
- falha de impressora;
- falha Supabase;
- falha OMIE;
- migrations;
- backup/restauracao.

Nao devem registrar:

- app key;
- app secret;
- tokens Supabase;
- service accounts;
- payloads completos com dados pessoais/financeiros sem sanitizacao.

## Instalacao E Operacao

Requisitos para instalacao:

- Windows com permissao para instalar app;
- permissao para acessar porta/conexao da balanca;
- impressora instalada no Windows;
- internet para sync cloud/OMIE, mas operacao local deve continuar sem internet;
- pasta `%ProgramData%\\KyberRock` gravavel pelo usuario/app.

## Checklist De Hardening

Coberto por teste automatizado ou pelo desenho do codigo:

- carregador nao escreve dado operacional (so Edge Function escreve);
- dados de uma unidade nao aparecem em outra (escopo vem do registro do dispositivo);
- logs nao carregam app key, app secret nem token;
- backup/restauracao com `integrity_check` e confirmacao explicita;
- operacao continua sem internet, com a fila local acumulando;
- OMIE fora do ar ou bloqueado (HTTP 425) nao derruba a operacao nem perde item de fila;
- falha de impressora nao altera nem apaga a operacao fechada;
- balanca desconectada bloqueia a pesagem, sem campo de peso manual.

Pendente:

- assinatura de codigo Windows antes de distribuicao externa mais ampla;
- revisao periodica das politicas RLS com teste dedicado por tabela nova.
