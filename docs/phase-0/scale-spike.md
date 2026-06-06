# Spike De Balancas E Adapters De Leitura

## Objetivo

Definir a estrategia configuravel de leitura de balancas e validar, quando houver acesso ao equipamento real, a comunicacao com a balanca instalada. O KyberRock deve ler o peso automaticamente, sem lancamento manual, mesmo que cada cliente use modelos e conexoes diferentes.

## Resultado Atual

Status: design iniciado; leitura real pendente.

Motivo: o ambiente atual nao e o PC da balanca. Ainda falta executar teste no PC conectado a uma balanca real. A Toledo 950 IDLCG 2 e o primeiro modelo conhecido, mas nao pode ser hard-coded como unica opcao.

## Decisoes De Produto

- O sistema deve suportar diferentes fabricantes e modelos de balanca.
- A balanca deve ser configurada por unidade/dispositivo.
- A leitura de peso deve passar por adapters plugaveis.
- O operador nao pode digitar peso manualmente.
- Uma instalacao sem adapter funcional deve bloquear abertura e fechamento de pesagem.
- A Toledo 950 IDLCG 2 sera tratada como primeiro alvo real conhecido, nao como unica balanca suportada.

## Tipos De Conexao A Suportar No Desenho

| Tipo | Uso Esperado | Status |
| --- | --- | --- |
| Serial RS-232 | Muito comum em indicadores de balanca | Planejado |
| USB serial | Adaptador USB/COM no Windows | Planejado |
| TCP/IP socket | Indicadores ou conversores seriais em rede | Planejado |
| HTTP/API local | Gateway/driver de fabricante, quando existir | Planejado |
| Arquivo/driver intermediario | Integracoes legadas que gravam leitura em arquivo | Planejado como fallback tecnico |
| Outro adapter especifico | Conforme modelo encontrado em campo | Permitido pela arquitetura |

## Contrato Funcional Do Adapter

Cada adapter deve ser capaz de:

- testar conexao;
- informar status operacional;
- ler peso bruto recebido;
- normalizar peso em kg;
- indicar se o peso esta estavel;
- indicar erro, desconexao ou leitura invalida;
- registrar logs tecnicos sem expor dados sensiveis;
- funcionar em modo diagnostico sem abrir uma venda real.

## Configuracao Por Dispositivo

Campos minimos previstos:

- `adapterType`;
- fabricante;
- modelo;
- tipo de conexao;
- porta serial, host ou caminho, conforme conexao;
- baud rate, data bits, stop bits, parity e handshake, quando serial;
- timeout de leitura;
- regra de estabilidade;
- unidade do peso recebido;
- fator de conversao para kg;
- parser/formato da mensagem;
- ativo/inativo.

## Dados A Coletar

| Campo | Valor |
| --- | --- |
| Local/unidade | Pendente |
| Fabricante/modelo do indicador | Pendente; primeiro alvo conhecido: Toledo 950 IDLCG 2 |
| Tipo de conexao | Pendente |
| Porta/host | Pendente |
| Baud rate | Pendente |
| Data bits | Pendente |
| Stop bits | Pendente |
| Parity | Pendente |
| Handshake | Pendente |
| Modo de envio | Pendente: continuo, por comando, tecla, estabilidade ou outro |
| Formato bruto da mensagem | Pendente |
| Formato normalizado do peso | Pendente |
| Como identificar peso estavel | Pendente |
| Como identificar zero/tara/erro | Pendente |

## Amostras Reais

Registrar aqui mensagens brutas capturadas diretamente da balanca.

```text
Pendente.
```

## Testes Minimos

- Detectar porta/conexao usada pela balanca.
- Capturar pelo menos 10 leituras com peso parado.
- Capturar leituras durante alteracao de peso.
- Capturar leitura com balanca vazia.
- Identificar mensagem de peso estavel.
- Identificar mensagem de instabilidade, erro ou sem leitura, se existir.
- Confirmar se a balanca envia dados automaticamente ou se precisa de comando.
- Confirmar comportamento quando o cabo e desconectado.
- Confirmar que nao existe necessidade de digitacao manual de peso.

## Decisao Tecnica Esperada

Ao final do spike documental, definir o contrato de adapter e a estrutura de configuracao. Ao final do spike real em campo, escolher ou implementar o adapter inicial da balanca instalada:

- serial RS-232/USB serial;
- TCP/IP;
- arquivo/driver intermediario;
- outro caminho tecnico documentado.

## Criterio De Aceite

O desenho da Fase 0 e aceito quando a estrategia de adapters configuraveis estiver documentada. A validacao fisica do adapter real continua pendente ate existir acesso ao PC da balanca; nesse momento, o aceite exige leitura real registrada ou diagnostico tecnico claro explicando o bloqueio e o plano para destravar.
