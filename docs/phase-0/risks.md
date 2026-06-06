# Riscos Da Fase 0

| Risco                                                 | Impacto | Status     | Mitigacao Inicial                                                          |
| ----------------------------------------------------- | ------- | ---------- | -------------------------------------------------------------------------- |
| Diversidade de modelos e protocolos de balanca        | Alto    | Aberto     | Usar arquitetura de adapters configuraveis e validar cada modelo em campo  |
| Ambiente atual nao e o PC da balanca                  | Medio   | Confirmado | Coletar inventario e executar spikes no PC real da balanca                 |
| Diversidade de impressoras Windows                    | Medio   | Parcial    | Listar impressoras instaladas e usar perfis de impressao configuraveis     |
| Credenciais OMIE nao configuradas no ambiente         | Alto    | Aberto     | Usar variaveis locais seguras para spike                                   |
| Dados obrigatorios OMIE desconhecidos                 | Alto    | Aberto     | Consultar endpoints reais e registrar campos                               |
| Duplicidade de pedido/OS no OMIE                      | Alto    | Aberto     | Definir identificador externo/idempotencia antes da implementacao          |
| Formula final de frete ainda incompleta               | Medio   | Parcial    | Respostas iniciais registradas; definir formula exata por distancia e peso |
| Segredos no desktop Windows                           | Alto    | Aberto     | Definir armazenamento seguro na Fase 1                                     |
| Operacao offline com dados financeiros desatualizados | Alto    | Aberto     | Definir TTL/cache e politica de bloqueio                                   |
| Firewall/antivirus do PC da balanca                   | Medio   | Aberto     | Testar HTTPS, porta da balanca e impressao no ambiente real                |

## Regra De Avanco

Nao iniciar a implementacao principal sem uma decisao documentada para balanca, impressao e OMIE. Se algum spike nao puder ser concluido, registrar causa, responsavel e plano tecnico de destravamento.
