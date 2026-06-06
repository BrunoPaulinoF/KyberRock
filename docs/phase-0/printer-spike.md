# Spike De Impressao Windows

## Objetivo

Validar impressao local pelo Windows usando impressoras instaladas. O KyberRock deve permitir escolher e configurar diferentes impressoras, mantendo o cupom termico de 80 mm como perfil operacional principal para assinatura do motorista.

## Resultado Atual

Status: parcial.

Impressoras foram listadas no ambiente atual. O cupom teste ainda precisa ser impresso. A implementacao nao deve depender de um modelo especifico de impressora.

## Impressora Candidata No Ambiente Atual

| Campo | Valor |
| --- | --- |
| Nome no Windows | ELGIN L42PRO FULL |
| Porta | `192.168.0.35` |
| Compartilhada | Sim |
| Confirmada como termica 80 mm | Pendente |
| Teste de impressao | Pendente |

## Decisoes De Produto

- O sistema deve listar impressoras instaladas no Windows.
- A impressora de cupom deve ser selecionavel por unidade/dispositivo.
- Diferentes modelos devem ser aceitos desde que estejam instalados no Windows.
- O layout deve usar perfil de impressao configuravel, nao hard-code por modelo.
- A primeira necessidade operacional e cupom termico 80 mm.
- Relatorios A4 devem usar outro perfil de impressao, tambem baseado em impressoras instaladas.

## Perfil De Impressao Previsto

Campos minimos:

- nome da impressora no Windows;
- tipo de documento: cupom 80 mm ou relatorio A4;
- largura do papel;
- margens;
- tamanho de fonte;
- quantidade de copias;
- cortar papel quando suportado;
- abrir gaveta quando suportado, se algum dia aplicavel;
- ativo/inativo.

## Cupom De Teste

Conteudo minimo para validacao:

```text
KYBERROCK - TESTE DE CUPOM
Data: 2026-06-06

Placa: ABC1D23
Cliente: CLIENTE TESTE
Produto: BRITA TESTE

Peso entrada: 10.000 kg
Peso saida:   25.000 kg
Peso liquido: 15.000 kg

Assinatura motorista:

____________________________
```

## Testes Minimos

- Confirmar nome exato da impressora termica no Windows.
- Confirmar que a aplicacao consegue listar impressoras instaladas.
- Confirmar que a impressora pode ser selecionada por configuracao.
- Confirmar largura real do papel.
- Imprimir cupom de teste.
- Validar margem esquerda/direita.
- Validar tamanho de fonte e legibilidade.
- Validar corte automatico, se existir.
- Validar acentuacao, caso usada em textos finais.
- Validar impressao depois de reiniciar o Windows.
- Validar comportamento quando impressora esta offline.

## Decisao Tecnica Esperada

Definir se a primeira implementacao vai imprimir via:

- API nativa de impressao do Electron/Chromium;
- spooler do Windows;
- ESC/POS direto, somente se necessario;
- PDF intermediario, somente se necessario.

## Criterio De Aceite

O desenho da Fase 0 e aceito quando a estrategia de impressoras Windows configuraveis estiver documentada. A validacao fisica fica pendente ate existir acesso a impressora real; nesse momento, o aceite exige cupom 80 mm impresso e considerado legivel, ou impedimento tecnico documentado.
