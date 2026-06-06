# Security And Operations - Fase 1

Status: draft inicial.

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

## Firebase Security Draft

Regras pretendidas:

- carregador autentica via Firebase Auth;
- carregador le somente `loadingRequests` da unidade vinculada;
- carregador nao escreve nada operacional;
- desktop/dispositivo tem permissao de escrita limitada a sua empresa/unidade;
- funcoes cloud executam operacoes sensiveis com credenciais protegidas.

Modelo de claims esperado:

```json
{
  "companyId": "...",
  "unitIds": ["..."],
  "role": "loader"
}
```

Roles iniciais:

| Role             | Uso                                 |
| ---------------- | ----------------------------------- |
| `loader`         | Site do carregador, somente leitura |
| `desktop_device` | Escrita controlada do desktop       |
| `admin`          | Configuracao e suporte futuro       |

## Dados Sensiveis

Classificacao inicial:

| Tipo                             | Tratamento                                     |
| -------------------------------- | ---------------------------------------------- |
| Credenciais OMIE/Firebase/e-mail | Nunca logar; Secret Manager/ambiente seguro    |
| Dados financeiros cliente        | Restringir no Firebase e UI do carregador      |
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
- falha Firebase;
- falha OMIE;
- migrations;
- backup/restauracao.

Nao devem registrar:

- app key;
- app secret;
- tokens Firebase;
- service accounts;
- payloads completos com dados pessoais/financeiros sem sanitizacao.

## Instalacao E Operacao

Requisitos para instalacao futura:

- Windows com permissao para instalar app;
- permissao para acessar porta/conexao da balanca;
- impressora instalada no Windows;
- internet para sync Firebase/OMIE, mas operacao local deve continuar sem internet;
- pasta `%ProgramData%\\KyberRock` gravavel pelo usuario/app.

## Checklist De Hardening Futuro

- Validar regras Firestore com testes.
- Validar que carregador nao escreve dados.
- Validar que dados de uma unidade nao aparecem em outra.
- Validar que logs nao contem segredos.
- Validar backup/restauracao antes do piloto.
- Validar comportamento sem internet.
- Validar comportamento com OMIE fora do ar.
- Validar falha de impressora sem perda da operacao.
- Validar balanca desconectada bloqueando pesagem.
