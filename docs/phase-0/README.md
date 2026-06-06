# Fase 0 - Preparacao, Spikes E Validacoes Tecnicas

Objetivo: validar cedo os pontos que podem inviabilizar ou alterar a arquitetura do KyberRock antes da implementacao principal.

## Status Atual

| Item | Status | Observacao |
| --- | --- | --- |
| Node.js | OK | `v24.13.0` no ambiente atual |
| npm | OK | `11.8.0` no ambiente atual |
| Git | OK | Repositorio inicializado em `main` |
| Inventario do PC da balanca | Parcial | Inventario atual registrado; este ambiente nao e o PC real da balanca |
| Spike da balanca | Parcial | Estrategia de adapters configuraveis iniciada; leitura real pendente |
| Spike de impressao | Parcial | Estrategia de impressoras Windows configuraveis iniciada; cupom 80 mm ainda precisa ser testado |
| Spike OMIE | Parcial | Documentacao publica mapeada; autenticacao real pendente |
| Politica de segredos | Inicial | `.gitignore` criado e politica documentada |
| Pendencias de frete | Parcial | Respostas iniciais registradas; formula exata ainda pendente |
| Riscos restantes | Inicial | Lista inicial registrada |

## Arquivos Da Fase

- `environment-inventory.md`: inventario do ambiente atual e dados pendentes do PC da balanca.
- `scale-spike.md`: plano e registro do spike de balancas configuraveis por adapter.
- `printer-spike.md`: plano e registro do spike de impressao configuravel no Windows.
- `omie-spike.md`: plano e registro do spike OMIE.
- `secrets-policy.md`: regra inicial para armazenamento de credenciais.
- `freight-pending-questions.md`: pendencias comerciais de frete.
- `risks.md`: riscos tecnicos e operacionais da Fase 0.
- `acceptance-checklist.md`: checklist dos criterios de aceite da Fase 0.

## Proximo Passo Pratico

Executar os spikes no computador real da balanca, diferente do ambiente atual, com acesso a:

- uma balanca real conectada, sendo Toledo 950 IDLCG 2 o primeiro modelo conhecido;
- impressora termica instalada no Windows;
- credenciais OMIE reais em ambiente seguro;
- permissao para testar leitura, impressao e chamadas controladas ao OMIE.
