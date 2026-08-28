# Fase 0 - Preparacao, Spikes E Validacoes Tecnicas

Objetivo: validar cedo os pontos que podem inviabilizar ou alterar a arquitetura do KyberRock antes da implementacao principal.

## Status Atual

> **Registro historico.** Esta fase existiu para destravar decisoes de arquitetura antes da
> implementacao. Os spikes que estavam pendentes foram resolvidos pelo produto em producao — a
> tabela abaixo registra onde cada um parou.

| Item                        | Status    | Onde ficou                                                                   |
| --------------------------- | --------- | ---------------------------------------------------------------------------- |
| Node.js / npm / Git         | OK        | Ambiente de desenvolvimento                                                  |
| Inventario do PC da balanca | Resolvido | Balancas reais em operacao                                                   |
| Spike da balanca            | Resolvido | Adapters Toledo serial e TCP em `packages/scale-adapters`                    |
| Spike de impressao          | Resolvido | Impressao Windows e ESC-POS bruto em `apps/desktop/src/services`             |
| Spike OMIE                  | Resolvido | Integracao completa na Edge Function `omie-sync`                             |
| Politica de segredos        | Em uso    | `docs/phase-1/security-and-operations.md`                                    |
| Pendencias de frete         | Parcial   | Quatro modalidades implementadas; formula por distancia segue parametrizavel |
| Riscos restantes            | Historico | `risks.md`                                                                   |

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

Concluido. O sistema roda em pedreira real, com balanca Toledo conectada, impressora termica
instalada e credenciais OMIE em ambiente seguro. O estado atual do sistema esta em
`docs/ARCHITECTURE.md`.
