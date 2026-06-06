# Spike Da Balanca Toledo 950 IDLCG 2

## Objetivo

Identificar e validar a comunicacao real com a balanca Toledo 950 IDLCG 2, garantindo que o KyberRock leia o peso automaticamente e sem lancamento manual.

## Resultado Atual

Status: pendente.

Motivo: nenhuma porta serial foi detectada no ambiente atual e ainda falta executar o teste no PC conectado a balanca.

## Dados A Coletar

| Campo | Valor |
| --- | --- |
| Local/unidade | Pendente |
| Modelo exato do indicador | Toledo 950 IDLCG 2 |
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

Ao final do spike, escolher o adaptador inicial:

- serial RS-232/USB serial;
- TCP/IP;
- arquivo/driver intermediario;
- outro caminho tecnico documentado.

## Criterio De Aceite

O spike e aceito quando houver uma leitura real registrada ou um diagnostico tecnico claro explicando o bloqueio e o plano para destravar.
