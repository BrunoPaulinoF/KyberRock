# Politica Inicial De Segredos

## Objetivo

Evitar vazamento de credenciais do OMIE, Firebase, e-mail, certificados, chaves privadas e qualquer segredo usado pelo KyberRock.

## Regra Geral

Nenhum segredo real deve ser commitado no repositorio.

## Locais Permitidos Em Desenvolvimento

- Variaveis de ambiente do usuario Windows.
- Arquivos `.env.local` ou `.env.development.local`, desde que ignorados pelo Git.
- Windows Credential Manager, quando houver implementacao para isso.
- Cofre/secret manager externo, quando definido.

## Locais Proibidos

- `PRD.md`, `PLAN.md` ou arquivos dentro de `docs/`.
- Codigo-fonte.
- Arquivos `.env` commitados.
- Prints, logs ou amostras contendo credenciais.
- Banco SQLite local versionado.

## Nomes Iniciais De Variaveis

| Variavel                | Uso                               |
| ----------------------- | --------------------------------- |
| `OMIE_APP_KEY`          | App key OMIE                      |
| `OMIE_APP_SECRET`       | App secret OMIE                   |
| `FIREBASE_PROJECT_ID`   | Projeto Firebase                  |
| `FIREBASE_CLIENT_EMAIL` | Service account, quando aplicavel |
| `FIREBASE_PRIVATE_KEY`  | Chave privada, quando aplicavel   |
| `SMTP_HOST`             | Servidor de e-mail                |
| `SMTP_USER`             | Usuario de e-mail                 |
| `SMTP_PASSWORD`         | Senha de e-mail                   |

## Arquivos Ignorados

O `.gitignore` inicial bloqueia:

- `.env` e `.env.*`, exceto `.env.example`;
- chaves e certificados comuns;
- service accounts Firebase;
- bancos SQLite locais;
- logs;
- `node_modules` e saidas de build.

## Pendencia Para Fase 1

Definir o mecanismo final de segredos para:

- aplicativo desktop instalado no Windows;
- Firebase Functions;
- ambiente de desenvolvimento;
- ambiente de producao;
- rotacao de credenciais.
