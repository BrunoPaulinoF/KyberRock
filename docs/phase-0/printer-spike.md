# Spike De Impressao Windows

## Objetivo

Validar impressao local pelo Windows, usando impressora instalada, com cupom termico de 80 mm legivel para assinatura do motorista.

## Resultado Atual

Status: parcial.

Impressoras foram listadas no ambiente atual. O cupom teste ainda precisa ser impresso.

## Impressora Candidata

| Campo | Valor |
| --- | --- |
| Nome no Windows | ELGIN L42PRO FULL |
| Porta | `192.168.0.35` |
| Compartilhada | Sim |
| Confirmada como termica 80 mm | Pendente |
| Teste de impressao | Pendente |

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

O spike e aceito quando um cupom 80 mm for impresso e considerado legivel, ou quando houver impedimento tecnico documentado.
