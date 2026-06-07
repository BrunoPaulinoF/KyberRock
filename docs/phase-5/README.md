# Fase 5 - Impressao Local No Windows

Status: implementada com validacao fisica pendente.

## Entregue

- Listagem de impressoras instaladas no Windows via Electron;
- configuracao de perfil ativo para cupom 80 mm;
- template inicial de cupom termico em `packages/print-templates`;
- impressao automatica do cupom apos fechamento da pesagem;
- reimpressao auditada como segunda via;
- persistencia de cada tentativa em `print_receipts`;
- sequencial de cupom por unidade;
- auditoria local de impressao e reimpressao;
- enfileiramento local para futura sincronizacao Firebase;
- tratamento de falha de impressora sem alterar nem perder a operacao fechada;
- adapter de impressao testavel e impressao real por `webContents.print` no Electron.

## Limites Da Fase

- A validacao fisica em impressora termica 80 mm ainda depende do PC real da balanca/impressora.
- Ajustes finos de margem, corte de papel e densidade podem mudar apos o teste fisico.
- A sincronizacao remota dos cupons ainda sera implementada nas fases de Firebase.

## Validacao

```bash
npm run build
npm run lint
npm test
```
