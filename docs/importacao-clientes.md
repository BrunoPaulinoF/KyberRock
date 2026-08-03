# Importação de clientes por planilha

Traz clientes de planilha para o KyberRock e deixa tudo pronto para o OMIE receber no
próximo sync. São dois comandos:

1. **`conciliar`** — junta a planilha comercial (cliente + contato + preço por produto) com a
   planilha de nomes + CNPJ/CPF numa planilha única.
2. **`importar`** — grava essa planilha no banco local do KyberRock. Cliente que **já existe
   tem os dados substituídos** pelos da planilha; cliente que **ainda não existe é cadastrado**
   com todos os dados.

O envio ao OMIE **não** acontece aqui. A importação marca os cadastros como pendentes
(`needs_push`), e quem fala com o OMIE continua sendo o `omie-sync` do próprio app — com a
idempotência dele. É o mesmo caminho de um cadastro feito na tela.

## Antes de começar

```bash
npm install
npm run build -w @kyberrock/desktop
```

Os comandos abaixo rodam de dentro de `apps/desktop`:

```bash
cd apps/desktop
node dist/scripts/import-customers.js --ajuda
```

> **Feche o KyberRock antes de importar.** O script grava no mesmo arquivo SQLite que o app usa
> (`%ProgramData%\KyberRock\data\kyberrock.sqlite3`). Antes de gravar ele copia o banco para a
> pasta de backups automaticamente.

Formatos aceitos: `.xlsx`, `.xlsm`, `.csv`, `.tsv`. Não precisa converter nada — o `.xlsx` é lido
direto, e o CSV do Excel em português (separado por `;`, com vírgula decimal) também.

## Passo 1 — conciliar as duas planilhas

```bash
node dist/scripts/import-customers.js conciliar \
  --precos "C:\planilhas\clientes-e-precos.xlsx" \
  --documentos "C:\planilhas\nomes-e-cnpj.xlsx" \
  --saida clientes-conciliados.csv
```

O comando casa as duas listas **pelo nome do cliente**: primeiro nome igual (ignorando acento,
pontuação e sufixo societário — `Pedreira São João LTDA` = `PEDREIRA SAO JOAO`) e, no que sobrar,
por semelhança. Quando dois candidatos ficam empatados, o cliente fica **sem** CNPJ em vez de
receber um chute — a dupla vai para o relatório de pendências.

Saída:

- `clientes-conciliados.csv` — a planilha única, com CNPJ/CPF na frente e uma coluna
  `Preco <produto>` para cada produto.
- `clientes-conciliados-pendencias.csv` — quem ficou sem CNPJ/CPF (com o nome mais parecido que
  o script encontrou) e quais linhas da planilha de documentos não foram usadas.

O terminal também lista os casamentos aproximados (com a nota de semelhança) para conferência.

**Confira e corrija o CSV no Excel antes do passo 2.** Ele é lido de volta pelo próprio
importador, então dá para preencher o CNPJ que faltou, ajustar um nome ou apagar uma linha.

### Como as colunas são reconhecidas

Não é preciso renomear cabeçalho: o script reconhece os nomes usuais
(`Cliente`/`Nome fantasia`, `Razão social`, `CNPJ`/`CPF`, `Telefone`, `E-mail`, `CEP`,
`Endereço`, `Número`, `Complemento`, `Bairro`, `Cidade`, `UF`, `Limite de crédito`,
`Exige nota fiscal`, `Observações`).

Preço por produto funciona nos dois formatos:

- **uma coluna por produto** — `Preço Brita 1`, `Valor do Pó`, ou só `BRITA 1` e `PO DE PEDRA`
  (coluna desconhecida cujos valores são todos dinheiro vira preço daquele produto);
- **uma linha por produto** — colunas `Produto` e `Preço`, com o cliente repetido em várias linhas.

O comando imprime o que reconheceu — campos, produtos e colunas ignoradas. Se errar, corrija com
`--colunas-preco "Brita 1,Pó"` ou `--ignorar-colunas "Condição,Vendedor"`.

## Passo 2 — importar

Sempre rode primeiro em simulação:

```bash
node dist/scripts/import-customers.js importar --arquivo clientes-conciliados.csv --dry-run
```

O `--dry-run` executa tudo (inclusive as validações de CNPJ duplicado) e desfaz no fim: o
relatório sai igual ao da importação real, o banco fica intacto. Quando o relatório estiver bom:

```bash
node dist/scripts/import-customers.js importar \
  --arquivo clientes-conciliados.csv \
  --relatorio relatorio-importacao.csv
```

Dá para pular o passo 1 e mandar as duas planilhas de uma vez (concilia em memória e importa):

```bash
node dist/scripts/import-customers.js importar --precos A.xlsx --documentos B.xlsx --dry-run
```

### O que o comando faz em cada cliente

| Situação na planilha                      | O que acontece                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| CNPJ/CPF já existe no KyberRock           | Os campos da planilha **substituem** os do cadastro; célula vazia mantém o atual |
| Sem CNPJ/CPF, mas o nome bate             | Atualiza esse cliente (e avisa que o cadastro está sem documento)                |
| Sem CNPJ/CPF e o nome bate com 2 clientes | Erro **só nessa linha** — as outras seguem                                       |
| Não existe                                | Cria o cliente com todos os dados e os preços                                    |

Preços viram **preço especial do cliente** (o mesmo da aba "Preços" da tela de clientes). Produto
que não existe no KyberRock é listado no fim do relatório — cadastre ou sincronize com o OMIE e
rode de novo, ou use `--mapa-produtos`.

Cliente vindo do OMIE (`source = 'omie'`) passa a `hybrid` ao ser alterado, que é o que faz o sync
empurrar os campos de volta para o OMIE. Rodar a mesma planilha duas vezes não suja nada: o que
não mudou fica como **"sem alteração"** e não é reenviado.

### Opções

| Opção                    | Para quê                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| `--dry-run`              | Simula e mostra o relatório sem gravar                                            |
| `--relatorio <arquivo>`  | Grava o resultado linha a linha em CSV (ação, campos alterados, erro)             |
| `--limpar-vazios`        | Célula vazia **apaga** o valor atual (padrão: mantém)                             |
| `--substituir-precos`    | Apaga os preços especiais do cliente que não estão na planilha                    |
| `--somente-com-cnpj`     | Pula quem ficou sem CNPJ/CPF em vez de cadastrar                                  |
| `--mapa-produtos <json>` | `{ "AREIA MEDIA": "Areia média lavada" }` — nome na planilha → produto cadastrado |
| `--empresa <id>`         | Só é necessário se o banco tiver mais de uma empresa                              |
| `--db <caminho>`         | Usar outro arquivo SQLite (teste, cópia de backup)                                |
| `--aba <nome ou N>`      | Escolhe a aba da planilha (padrão: a primeira)                                    |
| `--sem-backup`           | Não copia o banco antes de gravar                                                 |

## Passo 3 — enviar ao OMIE

Nada a fazer além de abrir o KyberRock: os cadastros importados ficam com `needs_push = 1` e vão
no próximo sync (ou no botão de sincronizar). Clientes **sem CNPJ/CPF são recusados pelo OMIE** —
o relatório avisa quantos ficaram assim; complete o documento antes do sync.

## Se algo der errado

- **Backup automático**: antes de gravar, o banco é copiado para
  `%ProgramData%\KyberRock\backups\kyberrock-pre-import-<data>.sqlite3`. Para voltar atrás, feche o
  app e substitua `data\kyberrock.sqlite3` por essa cópia.
- **"Ja existe um cliente com este CNPJ/CPF"**: a planilha tem dois clientes com o mesmo documento,
  ou o documento já pertence a outro cadastro. A linha aparece no relatório com o nome do dono.
- **Coluna virou produto errado**: use `--ignorar-colunas`.
- **Nenhum preço foi lido**: confira o bloco "Colunas reconhecidas" no início da execução.

## Onde fica o código

| Arquivo                                 | Papel                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| `src/services/spreadsheet-read.ts`      | Lê `.xlsx` (ZIP + XML, sem dependência nova) e CSV/TSV             |
| `src/services/customer-import-sheet.ts` | Reconhece colunas, normaliza os dados e concilia as duas planilhas |
| `src/services/customer-import.ts`       | Aplica no SQLite (cria/atualiza cliente e preços)                  |
| `src/scripts/import-customers.ts`       | CLI (`conciliar` / `importar`)                                     |
