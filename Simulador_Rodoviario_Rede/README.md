# Simulador de Balanca Rodoviaria TCP

Aplicacao independente para simular uma balanca rodoviaria de pedreira com interface web e conexao TCP. O servidor TCP emite leituras no formato simples aceito pelo adaptador Toledo 950i/TLC-G2 do desktop KyberRock.

## Requisitos

- Node.js 20 ou superior.
- Uma porta TCP livre para integracao. Padrao: `4001`.
- Uma porta HTTP livre para a tela. Padrao: `8080`.

## Como rodar

```bash
npm install
npm run dev
```

Abra a tela em:

```text
http://localhost:8080
```

Para rodar a versao compilada:

```bash
npm run build
npm start
```

## Configuracao por ambiente

```bash
HTTP_PORT=8080 TCP_HOST=0.0.0.0 TCP_PORT=4001 FRAME_INTERVAL_MS=1000 npm run dev
```

No Windows PowerShell:

```powershell
$env:HTTP_PORT="8080"; $env:TCP_PORT="4001"; npm run dev
```

## Integracao TCP Toledo

O servidor TCP escuta em `TCP_PORT` e envia um frame automaticamente a cada `FRAME_INTERVAL_MS`. Qualquer cliente TCP pode conectar e receber o peso.

Frame exemplo:

```text
    T N  000042000kg<CRLF>
```

Formato:

- 8 caracteres de status Toledo.
- 1 espaco separador.
- Peso absoluto com 9 digitos, em kg.
- Unidade `kg`.
- Final `CRLF`.

Status Toledo por posicao:

- `0`: `O` fora de alcance / sobrecarga.
- `1`: `M` peso negativo.
- `2`: `C` centro de zero.
- `3`: `I` em movimento / instavel.
- `4`: `T` tara ativa.
- `5`: `G` peso bruto.
- `6`: `N` peso liquido.
- `7`: reservado.

Para configurar o desktop KyberRock, conecte a balanca TCP no host da maquina do simulador e porta `4001`.

Comandos aceitos pelo TCP:

```text
PING
READ
ZERO
TARE
NEW
LOAD
LEAVE
AUTO ON
AUTO OFF
SET WEIGHT=42000;TARE=15000;PLATE=ABC1D23;MATERIAL=Brita 1
SET WEIGHT=42000;STABLE=false;OVERLOAD=true
SET OVERLOAD=auto;STABLE=auto
```

## API HTTP

- `GET /api/state`: estado completo da simulacao.
- `GET /api/frame`: ultimo frame TCP em texto puro.
- `POST /api/action`: executa uma acao.

Exemplo:

```bash
curl -X POST http://localhost:8080/api/action -H "Content-Type: application/json" -d '{"type":"manualSet","data":{"target":42000,"tare":15000,"plate":"ABC1D23"}}'
```

## Validacao

```bash
npm run lint
npm run test
npm run build
```
