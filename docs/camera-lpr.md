# Camera LPR — Leitura Automatica De Placas Na Pedreira

## Objetivo

Ler a placa do caminhao automaticamente na balanca e alimentar o KyberRock com ela, eliminando
a digitacao/selecao manual da placa na abertura da pesagem e acelerando o reconhecimento do
caminhao na saida.

Status: proposta tecnica. Nenhum codigo de camera existe hoje no repositorio.

## Resumo Da Recomendacao

- **Camera**: Intelbras **VIP 5460 LPR IA** (4 MP, LPR embarcado, IP67/IK10, PoE, IR 30 m,
  baixa velocidade ate 60 km/h, placas Mercosul e antigas). Faixa de preco de varejo observada:
  R$ 5.300 a R$ 6.800 por unidade.
- **Quantidade no piloto**: 1 camera, apenas na entrada da balanca. Expandir para a saida
  somente depois de medir a taxa de acerto real com poeira, chuva e noite.
- **Ligacao**: camera na mesma LAN do PC da balanca (a pedreira usa `192.168.0.x`, ver
  `apps/desktop/src/services/scale-discovery.ts`), IP fixo, PoE, protetor de surto.
- **Integracao**: novo package `packages/lpr-adapters` com o mesmo contrato plugavel de
  `packages/scale-adapters`, consumido por servicos no processo main do Electron.
- **Regra de produto**: a camera **sugere** a placa; o operador confirma. Camera offline ou
  leitura de baixa confianca nunca bloqueia a pesagem — a selecao manual continua valendo.

## Por Que Este Cenario E O Caso Facil Do LPR

O que costuma derrubar LPR e velocidade, angulo variavel e distancia variavel. Na balanca nao
existe nenhum dos tres:

- o caminhao para (ou anda a menos de 5 km/h);
- a posicao de parada e sempre a mesma (a plataforma da balanca);
- a distancia camera/placa e fixa;
- da para instalar iluminacao dedicada.

Nessas condicoes uma camera LPR de baixa velocidade entrega taxa de acerto alta. O risco real na
pedreira nao e o algoritmo, e o **ambiente**: poeira de britagem na lente, placa suja de barro,
placa amassada e caminhoes fora de padrao.

## Modelos Avaliados

| Modelo                                | Faixa           | Velocidade alvo | Observacao para a pedreira                                              |
| ------------------------------------- | --------------- | --------------- | ----------------------------------------------------------------------- |
| Intelbras VIP 5460 LPR IA             | ~R$ 5,3-6,8 mil | ate 60 km/h     | **Recomendada.** Suficiente e sobrando; suporte/garantia no Brasil      |
| Intelbras VIP 7260 LPR IA FT G2       | superior        | ate 60 km/h     | Linha 7, mais recursos de fiscalizacao que nao sao usados aqui          |
| Intelbras VIP 74120 / 94180 LPR IA FT | superior        | 120-180 km/h    | Superdimensionadas: sao para via expressa, nao para balanca             |
| Dahua ITC (serie ANPR)                | equivalente     | varia           | Mesma base tecnologica da linha VIP; suporte local pior                 |
| Hikvision iDS-TCG / DS-TCG405         | equivalente     | varia           | Boa API (ISAPI), mas o push de evento LPR e historicamente problematico |

Criterios que pesaram na escolha: LPR **embarcado** (a camera devolve o texto da placa, nao so
video), suporte a placa Mercosul e modelo antigo, IP67, PoE, IR proprio para placa (obturador
curto), entrada/saida de alarme, assistencia no Brasil e disponibilidade em distribuidor.

### Alternativa: Camera Comum + ALPR Em Software

Camera IP comum (R$ 400-900) + reconhecimento em software rodando no PC da pedreira
(Plate Recognizer Snapshot on-premise em Docker, ou modelo aberto de OCR de placas).

- **A favor**: hardware barato; o mesmo software atende varias cameras.
- **Contra**: exige CPU/GPU sobrando no PC da balanca, assinatura recorrente por camera ou por
  consulta, mais uma peca para manter, e uma camera sem IR otimizado para placa erra muito a
  noite (a placa refletiva "estoura" no IR comum).

Nao vale no primeiro ciclo. A camera com LPR embarcado resolve tudo dentro do proprio
equipamento e nao gera custo recorrente. Reavaliar apenas se a pedreira quiser 4+ pontos de
leitura.

## Instalacao Fisica

### Posicionamento

| Item                        | Alvo                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ |
| Distancia camera/placa      | 4 a 7 m                                                                        |
| Altura de montagem          | 1,2 a 1,8 m (placa dianteira de caminhao fica alta — nao montar em poste alto) |
| Angulo horizontal (azimute) | ate 20 graus                                                                   |
| Angulo vertical (tilt)      | ate 25 graus                                                                   |
| Largura de cena             | uma faixa apenas; enquadrar a placa ocupando ~10% da largura da imagem         |
| Ponto de leitura            | o ponto onde o caminhao para para pesar, nao a entrada do patio                |

Regra pratica: quanto mais a camera estiver de frente para a placa, melhor. Angulo alto e a
causa numero um de leitura errada.

### Ambiente De Pedreira

- **Poeira**: instalar com viseira/capa de protecao e prever limpeza da lente na rotina de
  manutencao (semanal, ou diaria em periodo seco). Lente suja derruba a leitura antes de
  qualquer outra coisa.
- **Posicao vs. plumas de poeira**: evitar linha direta com britador, peneira e trafego de pa
  carregadeira.
- **Vibracao**: fixar em estrutura rigida. Detonacao e trafego pesado desalinham suporte fraco;
  camera desalinhada = angulo fora do especificado = leitura degradada.
- **Energia**: PoE a partir de switch/injetor no abrigo da balanca; nobreak junto com o PC.
- **Rede**: IP fixo na mesma faixa do PC da balanca, fora da faixa de DHCP.
- **Protecao eletrica**: protetor de surto na linha Ethernet e aterramento do suporte.

### Placa Dianteira Ou Traseira

Caminhao/carreta tem placa no cavalo e na carreta. O KyberRock cadastra o veiculo por placa
(`apps/desktop/src/services/vehicles.ts`), e a placa usada na operacao e a que vai para o frete
do pedido no OMIE. **Definir com a operacao qual placa e a oficial** e apontar a camera para ela
— na duvida, a dianteira do cavalo, que e a que o operador ja digita hoje. Uma segunda camera
para a carreta so faz sentido se a operacao precisar do par cavalo+carreta.

## Como A Placa Entra No KyberRock

A arquitetura ja tem o molde pronto: a balanca. A camera segue exatamente o mesmo caminho —
adapter plugavel no package, servico no main, IPC para o renderer.

```
Camera LPR (LAN)
  --> packages/lpr-adapters (adapter por fabricante)
  --> apps/desktop/src/services/lpr-capture.ts        (politica: confianca, recencia, dedupe)
  --> ipcMain "desktop:lpr-*" + webContents.send("desktop:lpr-plate")
  --> renderer: sugere a placa no formulario de entrada / destaca a operacao aberta na saida
  --> operador confirma  -->  fluxo normal de pesagem (startWeighing)
```

### 1. `packages/lpr-adapters` (novo)

Espelha `packages/scale-adapters/src/scale-adapter.ts`:

```ts
export interface PlateReading {
  plate: string; // normalizada por normalizePlate de @kyberrock/shared
  confidence: number; // 0..1
  capturedAt: string; // horario informado pela camera
  receivedAt: string; // horario em que o desktop recebeu
  imagePath?: string; // snapshot salvo em disco local (opcional)
  deviceId?: string;
  adapterName?: string;
}

export interface LprAdapter {
  connect: () => Promise<void>;
  disconnect: () => void;
  onPlate: (listener: (reading: PlateReading) => void) => void;
  readLast: () => Promise<PlateReading | null>;
}
```

Implementacoes previstas:

- `VirtualLprAdapter` — placas simuladas, para desenvolver e testar sem hardware (mesmo papel do
  `virtual-scale-adapter`, que e o que permite `npm test` rodar sem balanca).
- `IntelbrasLprAdapter` — Intelbras/Dahua: assinatura do stream de eventos por HTTP Digest em
  `/cgi-bin/snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events=[TrafficJunction]`, que
  devolve um multipart continuo com os dados do evento (placa, faixa, timestamp) e o JPEG.
  Alternativa de fallback no mesmo adapter: consulta do ultimo registro por CGI.
- `HikvisionLprAdapter` — apenas se a pedreira ja tiver Hikvision instalada (ISAPI).

O adapter e o unico lugar que conhece o fabricante. Trocar de camera nao pode tocar em servico,
IPC ou tela — mesma regra que vale para a balanca.

### 2. Servicos no processo main

- `apps/desktop/src/services/lpr-configs.ts` — espelha `scale-configs.ts`: `adapterType`
  (`intelbras` | `hikvision` | `virtual`), `host`, `port`, `username`, `password`, `autoConnect`,
  `position` (`entry` | `exit`), guardado em `local_settings`/tabela propria via
  `readLocalSetting`/`writeLocalSetting`.
- `apps/desktop/src/services/lpr-capture.ts` — espelha `scale-capture.ts`, com politica fixa:

  | Parametro         | Valor inicial     | Motivo                                                        |
  | ----------------- | ----------------- | ------------------------------------------------------------- |
  | `minConfidence`   | 0.80              | abaixo disso a leitura vira sugestao fraca, nao preenchimento |
  | `maxReadingAgeMs` | 30.000            | leitura velha nao pode preencher o caminhao seguinte          |
  | `dedupeWindowMs`  | 60.000            | a camera repete a mesma placa varias vezes no mesmo evento    |
  | `plateFormat`     | Mercosul + antigo | valida com `InputValidator.validatePlate` antes de sugerir    |

- `apps/desktop/src/services/lpr-discovery.ts` (opcional) — varredura da sub-rede local nas
  portas 80/443/8000, reaproveitando `localSubnets()` de `scale-discovery.ts`.

### 3. IPC e preload

Mesmo padrao de `desktop:scale-*` em `apps/desktop/src/main/main.ts`:

```
desktop:lpr-connect | lpr-disconnect | lpr-get-status | lpr-get-config | lpr-save-config | lpr-read-last
evento: mainWindow.webContents.send("desktop:lpr-plate", reading)
```

Assinaturas em `apps/desktop/src/preload/preload.ts` e `api-types.ts`. O renderer continua sem
tocar em Node — a camera fica inteiramente do lado do main.

### 4. Renderer

**Entrada** (formulario de nova pesagem, `App.tsx`, campo "Placa" via `CacheSelect`):

1. chega `desktop:lpr-plate`;
2. o renderer chama `desktopApi.vehiclesFindOrCreate(plate)` (handler ja existente:
   `desktop:vehicles-find-or-create`);
3. exibe um aviso do tipo `Camera leu ABC1D23 (94%) — usar?` com botao **Usar** e **Ignorar**;
4. ao confirmar, faz `setForm({ ...prev, vehicleId })` — dai em diante o fluxo e o de hoje.

Nao preencher silenciosamente e nao submeter automatico: placa errada em pesagem vira nota
fiscal errada no OMIE. Se a placa lida nao existir no cadastro, o comportamento e o mesmo do
`find-or-create` atual, com o veiculo aparecendo para o operador conferir.

**Saida**: a leitura casa com a operacao aberta daquela placa e a destaca/pre-seleciona na fila
de operacoes. E aqui que o ganho de tempo aparece: hoje o operador procura o caminhao na lista.

### 5. Modelo de dados

Nova tabela local, criada em `apps/desktop/src/database/migrations.ts`:

```sql
CREATE TABLE lpr_readings (
  id TEXT PRIMARY KEY,              -- UUID global, conforme docs/ARCHITECTURE.md
  company_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  device_id TEXT,
  plate TEXT NOT NULL,
  confidence REAL NOT NULL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  image_path TEXT,
  operation_id TEXT,                -- preenchido quando a leitura vira uma operacao
  created_at TEXT NOT NULL
);
```

E uma coluna `plate_source` (`manual` | `camera`) em `weighing_operations`, para conseguir medir
depois quantas operacoes de fato nasceram da camera.

O `device_type` da tabela `devices` hoje aceita so `desktop_scale`; se a camera virar um device
proprio da unidade, o CHECK precisa incluir `lpr_camera`.

A leitura nasce local, como toda operacao (regra de `docs/ARCHITECTURE.md`). A projecao para o
Supabase, se for feita, entra pela fila de sync existente e e sempre downstream. **Imagens nao
sobem para a nuvem** no primeiro ciclo: ficam em disco local com expurgo por idade.

### 6. Seguranca

Usuario e senha da camera sao credenciais de equipamento: ficam apenas no banco local do PC
(`local_settings`), nunca no Git, nunca no repositorio de configuracao da nuvem, e nao aparecem
em log. Vale a regra de segredos de `AGENTS.md`. Criar um usuario dedicado somente-leitura na
camera para o KyberRock, em vez de usar o `admin`.

## Gatilho: Usar A Balanca, Nao So A Camera

A camera consegue disparar sozinha por deteccao de veiculo, mas o gatilho mais confiavel na
pedreira e o peso: **quando a balanca acusa peso acima do minimo, pegue a ultima placa lida
dentro da janela de recencia**. Isso descarta leitura de caminhao que apenas passou ao lado e
amarra a placa ao veiculo que esta de fato sobre a plataforma.

O `ScaleCaptureService` ja tem esse conceito de leitura "atual" (`maxReadingAgeMs`); o
`LprCaptureService` usa a mesma ideia com janela maior.

## Regras De Produto

- A camera **nunca** bloqueia a pesagem. Camera offline, lente suja ou placa ilegivel apenas
  fazem o sistema voltar ao fluxo manual de hoje.
- O operador sempre confirma a placa sugerida. Nenhuma operacao e aberta sozinha.
- Leitura abaixo da confianca minima nao preenche nada — no maximo aparece como sugestao fraca.
- Placa lida que nao bate com nenhum veiculo ativo segue o `find-or-create` atual, com conferencia
  do operador.
- Divergencia entre placa lida e placa escolhida fica registrada em `lpr_readings` para auditoria.

## Plano De Implantacao

| Fase | Entrega                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Comprar 1 camera, instalar na entrada, configurar rede/IP fixo/PoE e conferir leitura pela propria interface da camera durante 1 semana |
| 2    | `packages/lpr-adapters` com `VirtualLprAdapter` + testes; nada de hardware ainda                                                        |
| 3    | `IntelbrasLprAdapter` validado contra a camera real da pedreira                                                                         |
| 4    | Servicos `lpr-configs` / `lpr-capture`, IPC e tela de configuracao (ao lado da configuracao da balanca)                                 |
| 5    | Sugestao de placa na entrada + registro em `lpr_readings`                                                                               |
| 6    | Medir taxa de acerto por 2 semanas; so entao decidir a segunda camera (saida)                                                           |

A fase 1 e a mais importante e nao depende de codigo nenhum: se a camera nao ler bem no local
com poeira e a noite, nada do resto importa.

## Dados A Coletar No Piloto

| Campo                                         | Valor    |
| --------------------------------------------- | -------- |
| Modelo instalado                              | Pendente |
| IP fixo / porta                               | Pendente |
| Distancia e altura reais de montagem          | Pendente |
| Angulo horizontal / vertical medidos          | Pendente |
| Taxa de acerto de dia                         | Pendente |
| Taxa de acerto a noite                        | Pendente |
| Taxa de acerto com placa suja de barro        | Pendente |
| Frequencia necessaria de limpeza da lente     | Pendente |
| Formato exato do evento devolvido pela camera | Pendente |
| Latencia entre parada do caminhao e evento    | Pendente |

## Riscos

| Risco                                           | Mitigacao                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Poeira na lente derruba a leitura               | Viseira, posicionamento fora da pluma, rotina de limpeza             |
| Placa de caminhao suja/amassada                 | Confirmacao do operador; fluxo manual sempre disponivel              |
| Placa errada gerando nota fiscal errada no OMIE | Nunca preencher e submeter automaticamente; sempre confirmar         |
| Firmware da camera muda o formato do evento     | Formato isolado no adapter; teste de contrato no package             |
| Camera indisponivel trava o operador            | Timeout curto no adapter; leitura da camera e sempre opcional        |
| Credencial da camera vazando                    | Usuario somente-leitura, guardado apenas no banco local, fora do Git |

## Referencias

- [Intelbras VIP 5460 LPR IA](https://www.intelbras.com/pt-br/camera-ip-com-leitura-automatica-de-placas-vip-5460-lpr-ia)
- [Intelbras VIP 7260 LPR IA FT G2](https://www.intelbras.com/pt-br/camera-ip-com-leitura-automatica-de-placas-vip-7260-lpr-ia-ft)
- [Intelbras VIP 74120 LPR IA FT](https://www.intelbras.com/pt-br/camera-ip-com-leitura-automatica-de-placas-vip-74120-lpr-ia-ft)
- [Dahua HTTP API — evento TrafficJunction / snapManager.cgi](https://ipcamtalk.com/threads/get-trafficjunction-event-information-from-offline-dahua-camera.68075/)
- [Hikvision — guia rapido de ANPR via ISAPI](https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/02-Solutioins%20of%20Hikvision%20product%20integration/Fast%20guide%20for%20ANPR%20of%20TCG%20camera%20via%20ISAPI.pdf)
- [Plate Recognizer Snapshot on-premise (alternativa em software)](https://platerecognizer.com/snapshot/)
- `docs/phase-0/scale-spike.md` — o mesmo exercicio, feito para a balanca
- `docs/ARCHITECTURE.md` — identificadores, offline-first e propriedade de dados
