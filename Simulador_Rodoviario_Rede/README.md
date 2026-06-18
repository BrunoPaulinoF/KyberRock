# Simulador de Balanca Rodoviaria Toledo 950i

Simulador independente, sem licenca, de uma celula de carga rodoviaria Toledo 950i /
TLC-G2. Emite o frame Toledo simples (8 status + 9 digitos kg + unidade) na mesma
porta TCP que o adaptador Toledo do app desktop KyberRock escuta.

## Requisitos

- Node.js 20 ou superior.
- Porta TCP livre (padrao `4001`) para o frame Toledo.
- Porta HTTP livre (padrao `8080`) para a UI.

## Como rodar

```bash
npm install
npm run dev
```

Em seguida abra a UI em `http://localhost:8080`.

A primeira conexao TCP do app desktop recebe o frame Toledo atual e, depois, o
frame Toledo e reenviado periodicamente (`FRAME_INTERVAL_MS`, padrao 500ms).

Variaveis de ambiente:

| Variavel            | Padrao    | Descricao                                  |
| ------------------- | --------- | ------------------------------------------ |
| `HTTP_PORT`         | `8080`    | Porta da UI web                            |
| `TCP_PORT`          | `4001`    | Porta TCP do frame Toledo                  |
| `TCP_HOST`          | `0.0.0.0` | Host de bind do TCP                        |
| `FRAME_INTERVAL_MS` | `500`     | Intervalo de envio do frame Toledo         |
| `TICK_MS`           | `250`     | Intervalo do loop de movimentacao da carga |
| `CAPACITY_KG`       | `80000`   | Capacidade maxima da balanca               |
| `SAMPLE_WINDOW_MS`  | `5000`    | Janela padrao das medicoes de tara/bruto   |

## Fluxo de pesagem

A UI expoe o ciclo esperado pelo app desktop. Para cada pesagem, a UI:

1. **Entrada caminhao** - simula o caminhao vazio posicionado. `ARRIVE` no TCP.
2. **Tara (media 5s)** - tira a media de 5s e salva como tara. `TARE` no TCP.
3. **Carregar** - comeca a carregar o caminhao. `LOAD` no TCP.
4. **Bruto (media 5s)** - tira a media de 5s e salva como peso bruto. `GROSS` no TCP.
5. **Liberar saida** - tira o caminhao da plataforma. `EXIT`/`LEAVE` no TCP.

O frame Toledo e emitido durante todas as fases. O app desktop coleta o
`weightKg` e o converte em `entryWeightKg` (entrada) e `exitWeightKg` (saida),
calculando o peso liquido e disparando a impressao e o faturamento.

## Protocolo TCP

Frame simples, enviado em CRLF:

```
<8 status chars><1 espaco><9 digitos kg><2 unidade>\r\n
```

Exemplo de peso estavel em 42000 kg com tara ativa: `    T N  000042000kg\r\n`.

Posicoes do byte de status (Toledo 950i):

| Pos | Flag | Significado                  |
| --- | ---- | ---------------------------- |
| 0   | O    | Fora de alcance / sobrecarga |
| 1   | M    | Peso negativo                |
| 2   | C    | Centro de zero               |
| 3   | I    | Em movimento / instavel      |
| 4   | T    | Tara ativa                   |
| 5   | G    | Modo bruto                   |
| 6   | N    | Modo liquido                 |
| 7   | -    | Reservado                    |

Comandos aceitos por linha (CRLF):

- `PING` -> `OK PONG`
- `READ` / `PESO` / `WEIGHT` -> frame Toledo atual
- `ZERO` / `ZERAR` -> zera a balanca
- `ARRIVE` / `ENTRADA` -> simula entrada do caminhao vazio
- `TARE` / `TARA` -> inicia amostragem de tara (5s)
- `LOAD` / `CARREGAR` -> inicia carregamento
- `GROSS` / `BRUTO` -> inicia amostragem de bruto (5s)
- `EXIT` / `LEAVE` / `SAIR` -> libera saida do caminhao

## API HTTP

- `GET /api/state` - snapshot completo.
- `GET /api/frame` - frame Toledo atual em texto.
- `POST /api/action` - executa acao: `arriveEmpty`, `startTareSample`,
  `startLoading`, `startGrossSample`, `leave`, `zero`, `setWeight`,
  `setSampleWindowMs`.
- `GET /health` - status simples.

## Validacao

```bash
npm run build
npm run lint
npm test
```
