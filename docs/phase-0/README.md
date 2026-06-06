# Fase 0 - Preparacao, Spikes E Validacoes Tecnicas

Objetivo: validar cedo os pontos que podem inviabilizar ou alterar a arquitetura do KyberRock antes da implementacao principal.

## Status Atual

| Item | Status | Observacao |
| --- | --- | --- |
| Node.js | OK | `v24.13.0` no ambiente atual |
| npm | OK | `11.8.0` no ambiente atual |
| Git | OK | Repositorio inicializado em `main` |
| Inventario do PC da balanca | Parcial | Inventario atual registrado; validar se este e o PC real da balanca |
| Spike da balanca | Pendente | Requer acesso fisico/logico a Toledo 950 IDLCG 2 |
| Spike de impressao | Parcial | Impressoras listadas; cupom 80 mm ainda precisa ser testado |
| Spike OMIE | Parcial | Conectividade HTTPS com `api.omie.com.br:443` OK; autenticacao real pendente |
| Politica de segredos | Inicial | `.gitignore` criado e politica documentada |
| Pendencias de frete | Inicial | Perguntas comerciais registradas |
| Riscos restantes | Inicial | Lista inicial registrada |

## Arquivos Da Fase

- `environment-inventory.md`: inventario do ambiente atual e dados pendentes do PC da balanca.
- `scale-spike.md`: plano e registro do spike da balanca Toledo 950 IDLCG 2.
- `printer-spike.md`: plano e registro do spike de impressao no Windows.
- `omie-spike.md`: plano e registro do spike OMIE.
- `secrets-policy.md`: regra inicial para armazenamento de credenciais.
- `freight-pending-questions.md`: pendencias comerciais de frete.
- `risks.md`: riscos tecnicos e operacionais da Fase 0.
- `acceptance-checklist.md`: checklist dos criterios de aceite da Fase 0.

## Proximo Passo Pratico

Executar os spikes no computador real da balanca com acesso a:

- Toledo 950 IDLCG 2 conectada;
- impressora termica instalada no Windows;
- credenciais OMIE reais em ambiente seguro;
- permissao para testar leitura, impressao e chamadas controladas ao OMIE.
