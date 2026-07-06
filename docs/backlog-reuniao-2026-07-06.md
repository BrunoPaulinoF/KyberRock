# Backlog — Reunião com Igor (06/07/2026)

Lista de tarefas extraída da transcrição da reunião de acompanhamento do projeto KyberRock.
Organizada por área. Legenda de prioridade sugerida: **P0** bloqueia operação/fechamento
financeiro · **P1** essencial para o piloto · **P2** melhoria/escalabilidade.

> Notas de terminologia (a transcrição é automática e tem ruído): "OMIE" aparece como
> MIE/MEA/OME/ONG/Riel; "KyberRock" como Kiber/Carver/Ibro Rock/XR; "brita" como "grita";
> "Home Cash" é o banco digital usado para boleto; "GetNet" é a maquininha de débito.

---

## 1. Crédito do cliente (fiado) e fechamento de fatura

- [ ] **P0** Ao selecionar **"crédito do cliente"**, exibir automaticamente os campos de fechamento
      e ocultar o campo de condição de pagamento padrão — sem botão manual de "habilitar crédito".
      Ao desmarcar, voltar a exibir as demais formas de pagamento.
- [ ] **P0** Campo **dia de fechamento** + **dias para vencimento do boleto**: no dia de fechamento
      o sistema gera uma fatura que entra no OMIE como *contas a receber* com vencimento em
      `data_fechamento + X dias`.
- [ ] **P1** Suportar periodicidades de fechamento configuráveis: **semanal** (toda segunda/terça/…),
      **quinzenal** (1ª quinzena = dia 1→15; 2ª quinzena = dia 16→último dia do mês) e **mensal**,
      além de "1ª/2ª/3ª/4ª semana". Cada período soma "mais X dias" para a data de vencimento.
- [ ] **P1** Disponibilizar a fatura gerada para **download/envio** (para o cliente poder receber).
- [ ] **P1** Testar de ponta a ponta a geração da fatura e sua entrada no OMIE como contas a receber.
- [ ] **P2** Decidir/avaliar o uso do **limite de crédito do OMIE** ("uso do crédito"): pré-pago vs. não.
- [ ] **P1** Pré-configurar no cadastro do cliente: **exige nota fiscal** e **bloquear faturamento**
      (bloqueio de cliente / "NX10"), para o operador apertar o mínimo de botões.

## 2. Formas e condições de pagamento (integração OMIE)

- [ ] **P0** Sincronizar do OMIE os **meios/formas de pagamento** (cada um com seu código OMIE) e as
      **condições de pagamento** (nº de parcelas, à vista, prazos: 7/14/21 etc.).
- [ ] **P0** Entender e documentar **o que o OMIE exige de forma de pagamento** ao criar o pedido de
      venda, antes de amarrar a lógica de envio.
- [ ] **P1** Botão **ativar/desativar** por forma de pagamento (algumas do OMIE são só para
      transferência interna e não devem aparecer).
- [ ] **P1** Permitir **apelido (alias)** por forma de pagamento — o apelido é o que aparece na UI
      (os nomes vindos do OMIE ficam "bugados").
- [ ] **P0** **Vincular forma de pagamento → conta** no cadastro (dinheiro→caixinha; boleto/PIX→Home
      Cash; débito→GetNet), para o pedido de venda já sair com a conta correta.
- [ ] **P0** **Boleto bancário deve usar obrigatoriamente a conta Home Cash** (banco digital) — o boleto
      é faturado lá para ter conciliação automática no retorno.
- [ ] **P1** Deixar a **condição de pagamento pré-cadastrada no cliente**, mas **editável na hora** da
      operação (ex.: padrão 7/14/21, mas hoje o patrão liberou 7/14/21/28).
- [ ] **P1** Definir a conta padrão por forma de pagamento (dinheiro→caixinha, débito→GetNet,
      boleto/PIX→Home Cash) e permitir alteração posterior **apenas no OMIE**.

### Travas / validações de pagamento

- [x] **P0** Impedir combinações inválidas: **dinheiro (à vista) não pode ter parcelamento** 7/14/21/28.
      *(Implementado: validador puro `payment-method-condition-guard` + trava no submit da Nova Entrada.)*
- [ ] **P0** Dinheiro/crédito precisam assumir a condição específica correspondente (regra de crédito/fiado pendente).
- [ ] **P0** Fiado sem forma definida sobe o pedido de venda ao OMIE com **conta caixinha** (ainda não se
      sabe como o cliente vai pagar); se sair já com boleto, usa Home Cash.

## 3. Fechamento financeiro e conciliação

- [ ] **P0** Implementar **fechamento do dia** espelhando **faturamento × formas de recebimento**
      (conciliação de caixa/banco), análogo ao fechamento de caixa.
- [ ] **P1** Tratar **permuta** como forma de pagamento no fechamento (ex.: faturou 70 mil, 20 mil em
      permuta → só 50 mil em dinheiro).
- [ ] **P1** Relatório de fechamento por conta (caixinha, Home Cash, GetNet).

## 4. Frete: modalidades FOB/CIF e cálculo

- [ ] **P0** Modelar as **modalidades de frete** no cadastro do cliente e no pedido:
  - **FOB** — cliente busca; cobra-se só a pedra.
  - **CIF embutido** — envia valor cheio ao OMIE (ex.: R$70 de pedra), mas **difere** internamente no
    KyberRock (R$40 pedra + R$30 frete).
  - **CIF a faturar** — frete cobrado depois por **fechamento** (ex.: quinzenal), separado da pedra;
    no OMIE a pedra entra por R$40 e o frete vira **nota fiscal de serviço** no fechamento.
- [ ] **P1** **CIF a faturar** só disponível quando a forma de pagamento for **crédito** (fiado).
- [ ] **P1** Vincular a modalidade de frete ao **cliente**, de modo que a tela de operação só precise
      **conferir** (não digitar).
- [ ] **P1** **Cadastro de frete por cliente e por produto**: frete fixo (mesmo valor p/ todos os
      produtos) **ou** frete específico por produto.
- [ ] **P1** **Formas de cálculo do frete**: por tonelada · por tonelada + quilometragem · valor fixo.
- [ ] **P1** Relatório/fechamento de **frete por cliente** (quantidade × valor) para a modalidade
      CIF a faturar, permitindo diferenciar frete × pedra.
- [ ] **P2** Investigar/definir o **"spread"** do frete: como funciona hoje, como deve entrar no pedido
      de venda do OMIE e nos relatórios.

## 5. Preços e tabela por cliente

- [ ] **P0** **Preço de item por cliente** (não é tabela padrão nem 3 tabelas fixas — é preço por
      cliente/produto): definir preço específico que já vem pré-configurado na operação.
- [ ] **P1** Exibir **preço base (padrão) × preço especial do cliente** e a **"economia"** do cliente.
- [ ] **P2** Ao alterar preço/formas, **abrir um modal** em vez de edição inline (UI mais organizada).
- [ ] **P2** Precificação por **tonelada** como unidade base.

## 6. Transportadora, placa e motorista

- [ ] **P0 — BUG** Na tela de operação, ao clicar em **transportadora não puxa a lista** de
      transportadoras cadastradas/vinculadas ao cliente (nem digitando aparece). Corrigir o filtro.
- [ ] **P1** **Vincular transportadoras ao cliente**; na operação, filtrar exibindo só as vinculadas,
      com opção de **trocar na hora**.
- [ ] **P1** Cadastrar transportadora nova direto na operação (→ envia ao OMIE); se já existir mas não
      estiver vinculada, permitir vincular no cadastro do cliente.
- [ ] **P1** **Cadastro de placa + motorista** por transportadora (uma transportadora pode ter várias
      placas e vários motoristas).
- [ ] **P2** **Leitura de placa por câmera (OCR)** — ainda não implementado.
- [ ] **P2** **Reconhecimento facial do motorista** — identificar automaticamente na chegada.

## 7. Tela de operação / "Nova entrada"

- [ ] **P1** Remover o botão "habilitar crédito do cliente" (passa a ser automático) e o botão de
      parcelamento redundante (já é a condição de pagamento).
- [ ] **P1** Trazer automaticamente do cliente: forma de pagamento, condição, modalidade de frete e
      transportadoras vinculadas — deixando para o operador digitar basicamente **cliente e produto**.
- [ ] **P1** Produto **não** fica vinculado ao cliente (pode mudar a cada operação).
- [ ] **P1** Unificar as telas duplicadas de teste/operação (uma delas — a da balança virtual — deve
      sumir na integração com a balança real).

## 8. Troca de produto durante a operação (carregador)

- [ ] **P1** Permitir **alterar o produto/material durante a operação** (fila/qualidade da pedra muda) —
      ao trocar, **recalcular o preço** automaticamente. *(parcialmente implementado)*
- [ ] **P0** O **carregador NÃO pode alterar o produto** (risco de fraude) — só a operadora altera; o
      carregador apenas confirma ("carregado/OK"), afirmando o produto efetivamente carregado.

## 9. Operações abertas e pendências

- [ ] **P1** **Alerta de pesagens abertas há muito tempo** (caminhão abriu o peso de entrada e não
      fechou) e página/aba de **pendências**.
- [ ] **P1** Regra para "já existe operação aberta para esta placa".

## 10. Tempo de permanência

- [ ] **P1** Calcular e exibir o **tempo de permanência** (saída − entrada) por operação (ex.: 68h30).
- [ ] **P1** **Painel + relatório de tempo de permanência** com filtros por **placa**, **tipo de pedra**
      e **período**, incluindo **tempo médio** e exportação em **PDF**.

## 11. Cupom e impressão

- [ ] **P1** Personalizar o cupom com o **modelo do cliente** (layout já enviado) e o **logo** deles.
- [ ] **P1** Incluir no cupom: **data/hora de chegada**, **data/hora de saída** e **tempo total** do
      caminhão.
- [ ] **P1** **Teste de impressão real** (80 mm) para validar o layout de saída.
- [ ] **P2** Tema **claro** por padrão no cupom (mantendo a opção de trocar).
- [ ] **P2** Validar os múltiplos destinos de impressão já previstos (fila do Windows, Wi-Fi/rede, IP).

## 12. Balança e peso manual

- [ ] **P1** Suportar recepção de peso por **IP**, **virtual/simulada** e **manual**; a balança do
      cliente já estabiliza e envia o valor (sem necessidade de config de estabilização).
- [ ] **P1** **Peso manual protegido por senha** (contingência quando a balança falha), com uma **senha
      distinta** da senha de administrador, para pessoa de confiança liberar.

## 13. Site do carregador — feedback visual

- [ ] **P2** Animação/transição ao **concluir carregamento** (bolinha verde, caminhão saindo) para não
      parecer que "subiu do nada".
- [ ] **P2** Indicador visual de atraso (ex.: caminhão "com raiva"/fumaça) quando a operação demora
      demais ou tenta sair com peso menor.

## 14. Relatórios e dashboard

- [ ] **P1** Dashboard com **ticket médio, faturamento, mix de operação, produtos mais vendidos por
      peso, peso líquido vendido por dia**, com filtros (hoje, 7, 30 dias, personalizado) e export PDF.
- [ ] **P1** Relatório de **última venda por cliente/produto**.
- [ ] **P1** **Envio de relatório por WhatsApp** — já testado; consolidar a configuração de envio
      **dentro de cada relatório** (rotina diária, filtros, destinatários).
- [ ] **P1** Corrigir a lentidão de exportação (a dor do sistema atual deles: Excel leva ~10 min) —
      garantir geração rápida de PDF/relatórios.

## 15. Cadastro de cliente e migração de dados

- [ ] **P0** **Migração**: importar o **banco de dados do sistema atual** deles (clientes + vínculos:
      transportadoras, preços especiais, frete, forma/condição de pagamento) para o KyberRock e então
      subir para o OMIE.
- [ ] **P1** Cadastro **bidirecional** cliente ↔ OMIE (cadastra no KyberRock → vai ao OMIE; cadastra no
      OMIE → vem ao KyberRock). **Produto** só é cadastrado no OMIE.
- [ ] **P1** Preferir cadastrar **cliente no KyberRock** (mais flexibilidade de campos) e enviar ao OMIE.
- [ ] **P1** Cadastro de cliente com abas: **dados cadastrais**, **financeiro** (conta, fechamento,
      protestar, dias etc.) e **venda/informações gerais**.
- [ ] **P2** Coletar do cliente as informações necessárias para a migração: transportadoras por cliente,
      preços especiais por produto, frete, forma de pagamento, última venda por cliente/produto.

## 16. Relatório diário automático

- [ ] **P1** Relatório diário automático no fim do dia (resumo do que foi feito) enviado por e-mail
      ao responsável. *(mencionado como já em andamento — validar/consolidar)*

---

### Bugs / pendências imediatas (resumo)

- [ ] **BUG** Transportadora não puxa lista na tela de operação (item 6).
- [ ] Alerta de pesagens abertas antigas (item 9).
- [ ] Teste real de impressão do cupom com data/hora e tempo de permanência (itens 10, 11).
- [ ] Testar geração de fatura de crédito e sua entrada no OMIE (item 1).

### Próximos passos combinados na reunião

- [ ] Pedir ao cliente (via Roger) o **áudio e o resumo** da reunião.
- [ ] Levantar com o cliente os **dados e vínculos** para popular os cadastros.
- [ ] Seguir com os **testes** das telas atuais enquanto os dados são coletados.
