# PRD - KyberRock

Versão: 1.0  
Data: 2026-06-05  
Produto: KyberRock  
Tipo: Sistema operacional para pedreiras com integração de balança rodoviária, OMIE, Firebase, impressão e portal do carregador.

## 1. Visão Geral

O KyberRock é um sistema para substituir totalmente o sistema atual usado na operação da pedreira. O objetivo é controlar a entrada e saída de caminhões na balança, registrar vendas por pesagem, integrar com o OMIE, sincronizar dados com Firebase, permitir operação mesmo sem internet e disponibilizar para o carregador uma tela online de consulta dos carregamentos em aberto.

O sistema nasce para uma pedreira, mas precisa ser desenhado desde a primeira versão para suportar crescimento para outras pedreiras, unidades e empresas. A arquitetura, os cadastros, as integrações e os relatórios devem ser multiunidade e escaláveis.

## 2. Problema A Ser Resolvido

A operação atual depende de um sistema amador, com banco de dados ruim, baixa confiabilidade e dificuldade para extrair informações. O controle de pesagem, venda, cliente, veículo, produto, frete, financeiro e relatórios precisa ficar sob domínio da empresa, com rastreabilidade, integração com ERP e disponibilidade operacional.

Principais dores:

- Dificuldade para extrair dados confiáveis.
- Dependência do fornecedor antigo do sistema.
- Processo operacional solto entre balança, cliente, motorista, produto e carregamento.
- Necessidade de integrar pesagem com geração de pedido ou operação interna no OMIE.
- Necessidade de trabalhar mesmo sem internet.
- Necessidade de relatórios diários e gerenciais confiáveis.
- Necessidade de controlar bloqueio de clientes por limite financeiro vindo do OMIE.

## 3. Objetivos Do Produto

- Substituir totalmente o sistema atual da pedreira.
- Capturar automaticamente os pesos da balança rodoviária.
- Impedir lançamento manual de peso.
- Controlar o fluxo completo de entrada, carregamento, saída e fechamento da venda.
- Sincronizar cadastros, pedidos, operações e status com Firebase.
- Integrar obrigatoriamente com OMIE na primeira versão.
- Funcionar com ou sem internet no computador instalado na balança.
- Enviar pedidos e cadastros pendentes ao OMIE quando a internet voltar.
- Disponibilizar site simples para o carregador visualizar carregamentos em aberto.
- Imprimir cupom térmico de 80 mm no final da pesagem de saída para assinatura do motorista.
- Gerar relatórios diários, mensais, anuais e por dimensões gerenciais.
- Enviar fechamento diário automaticamente por e-mail ao dono cadastrado.
- Preparar o produto para suportar múltiplas pedreiras/unidades.

## 4. Escopo Da Primeira Versão

Tudo que foi discutido na transcrição é considerado obrigatório para a primeira versão, exceto câmera/OCR de placa e contratos por tonelagem, que não entram no PRD atual.

Escopo obrigatório:

- Aplicativo desktop Windows para operação principal.
- Leitura automática da balança Toledo 950 IDLCG 2.
- Registro de entrada e saída do caminhão na mesma balança.
- Cálculo automático do peso líquido.
- Cadastro rápido local quando necessário.
- Sincronização com Firebase a cada poucos minutos.
- Integração com OMIE a cada 30 minutos e por botão manual.
- Geração de pedido de venda no OMIE para operação com nota.
- Geração de ordem de serviço no OMIE para operação interna.
- Sincronização de clientes, produtos e formas/condições de recebimento com OMIE.
- Envio ao OMIE de cadastros criados no KyberRock quando a internet voltar.
- Controle de cliente bloqueado por limite de crédito e contas a receber vindos do OMIE.
- Tabelas de preço vinculadas a clientes.
- Cadastros de veículos, motoristas, transportadoras, produtos, clientes, formas de recebimento, tabelas de preço e configurações.
- Site do carregador com login próprio e visualização das solicitações em aberto.
- Impressão de cupom térmico de 80 mm no fechamento da pesagem.
- Relatórios com exportação PDF/Excel e impressão A4.
- Fechamento diário por e-mail às 20h.
- Auditoria de alterações e cancelamentos.

## 5. Fora Do Escopo Atual

- Integração com câmera.
- OCR ou leitura automática de placa.
- Confirmação de carregamento pelo carregador.
- Contratos por tonelagem.
- Geração de boleto pelo KyberRock.
- Emissão de nota fiscal pelo KyberRock.
- Divisão de perfis de acesso no aplicativo desktop.
- Lançamento manual de peso.

## 6. Usuários E Superfícies Do Sistema

### 6.1 Aplicativo Desktop Windows

O aplicativo desktop é a superfície principal do sistema. Ele será instalado no computador da operação da balança e terá acesso a todas as funcionalidades do KyberRock.

Regras:

- Não haverá divisão por perfis no desktop.
- O desktop deve operar mesmo sem internet.
- O desktop deve se comunicar diretamente com a balança.
- O desktop deve manter banco local para operação offline.
- O desktop deve sincronizar com Firebase a cada poucos minutos.
- O desktop deve integrar com OMIE quando houver internet.
- O desktop deve permitir alteração e cancelamento de pesagens, sempre com auditoria.
- O desktop deve permitir sincronização manual com OMIE por botão.
- O desktop deve exibir status de conexão com balança, Firebase e OMIE.

### 6.2 Site Do Carregador

O site do carregador será uma aplicação web separada, acessada com login próprio, para consulta dos carregamentos em aberto.

Regras:

- O carregador só visualiza informações.
- O carregador não confirma, altera, cancela ou finaliza nada.
- O carregador precisa estar online para acessar.
- A tela deve listar solicitações de carregamento em aberto.
- Cada solicitação deve exibir placa, cliente, motorista, veículo, produto e dados necessários para saber o que carregar.
- Não precisa exibir quantidade prevista.
- A atualização deve ser em tempo quase real, usando dados sincronizados no Firebase.

### 6.3 Dono/Responsável

O dono ou responsável cadastrado recebe o fechamento diário por e-mail.

Regras:

- Deve existir cadastro de destinatários do fechamento diário.
- O envio padrão deve ocorrer às 20h.
- O relatório enviado deve consolidar as vendas do dia.

## 7. Fluxo Operacional Principal

### 7.1 Entrada Do Caminhão

1. O caminhão chega à balança.
2. O operador identifica ou cadastra rapidamente o cliente.
3. O operador identifica ou cadastra rapidamente o veículo pela placa.
4. O operador identifica ou cadastra rapidamente o motorista.
5. O operador seleciona o produto a ser carregado.
6. O operador seleciona se a operação será com nota ou operação interna.
7. O operador seleciona forma/condição de recebimento conforme cadastro sincronizado.
8. O sistema valida limite de crédito e contas a receber do cliente conforme dados do OMIE.
9. Se o cliente estiver bloqueado, o sistema não libera a entrada para carregamento.
10. Se o cliente estiver liberado, o sistema captura automaticamente o peso de entrada da balança.
11. O sistema cria uma solicitação de carregamento em aberto.
12. A solicitação aparece no site do carregador.

### 7.2 Carregamento

1. O carregador acessa o site.
2. O carregador vê os carregamentos em aberto.
3. O carregador identifica o caminhão pela placa.
4. O carregador vê qual produto deve carregar.
5. O carregador realiza o carregamento fisicamente.
6. O carregador não precisa confirmar nada no sistema.

### 7.3 Saída Do Caminhão

1. O caminhão carregado volta para a mesma balança.
2. O operador localiza a operação em aberto pela placa, cliente ou lista de pendências.
3. O sistema captura automaticamente o peso de saída da balança.
4. O sistema calcula o peso líquido.
5. O sistema aplica a tabela de preço vinculada ao cliente e produto.
6. O sistema calcula valor de produto, frete quando aplicável e total da venda.
7. O sistema fecha a operação localmente.
8. O sistema imprime cupom térmico de 80 mm para assinatura do motorista.
9. O sistema sincroniza a operação com Firebase.
10. O sistema envia a operação ao OMIE ou deixa em fila para envio quando houver internet.

## 8. Regras De Pesagem

- A balança da primeira versão é uma balança rodoviária Toledo 950 IDLCG 2.
- A mesma balança é usada para entrada e saída.
- A captura de peso deve ser automática.
- Não pode existir campo para lançamento manual de peso.
- Se a integração com a balança falhar, não será possível abrir ou fechar a pesagem.
- O sistema deve ler apenas peso estável.
- O critério de estabilidade deve ser configurável tecnicamente, por exemplo, mesma leitura por alguns segundos.
- O peso de entrada representa a tara ou peso inicial do caminhão.
- O peso de saída representa o caminhão carregado.
- O peso líquido da venda deve ser calculado como peso de saída menos peso de entrada.
- Se o peso de saída for menor ou igual ao peso de entrada, o sistema deve bloquear o fechamento e exibir erro.
- Se existir operação em aberto para a mesma placa, o sistema deve alertar e impedir duplicidade acidental.
- Uma operação em aberto pode ser cancelada no desktop com motivo obrigatório.
- Cancelamentos não podem apagar o histórico.
- Alterações após a captura de entrada devem gerar auditoria.
- Alterações após envio ao OMIE devem respeitar regra de cancelamento/estorno do OMIE.
- Caminhão que entra e não carrega deve permanecer pendente até fechamento ou cancelamento justificado.

## 9. Tratamento De Falhas Operacionais

### 9.1 Falha Na Balança

Comportamento esperado:

- Bloquear abertura ou fechamento de pesagem.
- Exibir status claro de falha na balança.
- Registrar log técnico do erro.
- Permitir nova tentativa quando a balança voltar.
- Não permitir peso manual como contingência.

### 9.2 Queda De Internet

Comportamento esperado:

- O desktop continua operando localmente.
- Pesagens continuam sendo abertas e fechadas.
- Cadastros rápidos continuam funcionando.
- Operações ficam em fila de sincronização.
- O site do carregador só mostra dados que já chegaram ao Firebase antes da queda.
- O OMIE não recebe novos dados até a internet voltar.
- Quando a internet voltar, o sistema sincroniza automaticamente pendências.

### 9.3 Falha No OMIE

Comportamento esperado:

- A operação local não deve ser perdida.
- A operação fica pendente de envio ao OMIE.
- O sistema deve exibir status de pendência.
- O sistema deve tentar reenviar automaticamente.
- O operador pode acionar sincronização manual.
- Erros retornados pelo OMIE devem ser visíveis para correção.

### 9.4 Conflito De Dados

Comportamento esperado:

- Campos vindos do OMIE não podem ser alterados localmente.
- Campos específicos do KyberRock podem ser alterados localmente.
- Quando houver conflito em campo do OMIE, o OMIE vence.
- Quando houver conflito em campo exclusivo do KyberRock, o valor local mais recente vence, com auditoria.
- Cadastros criados offline no KyberRock devem ser marcados como pendentes até sincronização com OMIE.

## 10. Cadastros

### 10.1 Cliente

Origem:

- Pode vir do OMIE.
- Pode ser criado rapidamente no KyberRock quando necessário.
- Se criado no KyberRock, deve sincronizar para o OMIE quando houver internet.

Campos mínimos recomendados:

| Campo | Obrigatório | Origem | Observação |
| --- | --- | --- | --- |
| Código interno | Sim | KyberRock | Gerado localmente |
| Código OMIE | Não | OMIE | Preenchido após sincronização |
| Nome/Razão social | Sim | OMIE ou KyberRock | Campo do OMIE fica bloqueado após vínculo |
| Nome fantasia | Não | OMIE ou KyberRock | Quando disponível |
| CPF/CNPJ | Sim | OMIE ou KyberRock | Validar formato |
| Telefone/celular | Não | OMIE ou KyberRock | Usado no cupom quando houver |
| E-mail | Não | OMIE ou KyberRock | Usado em relatórios se necessário |
| Endereço | Não | OMIE ou KyberRock | Inclui cidade/UF/CEP |
| Tabela de preço | Sim | KyberRock | Vinculada localmente |
| Forma/condição de recebimento | Sim | OMIE | Sincronizada do OMIE |
| Limite de crédito | Não | OMIE | Zero ou vazio desconsidera bloqueio |
| Valor em aberto no contas a receber | Não | OMIE | Usado no bloqueio |
| Status financeiro/bloqueio | Não | OMIE | Usado para liberar ou bloquear carga |
| Origem do cadastro | Sim | KyberRock | OMIE ou KyberRock |
| Status de sincronização | Sim | KyberRock | Sincronizado, pendente ou erro |

### 10.2 Produto

Origem:

- Produtos serão cadastrados no OMIE.
- O KyberRock sincroniza os produtos do OMIE.
- Campos vindos do OMIE não podem ser alterados no KyberRock.

Campos mínimos recomendados:

| Campo | Obrigatório | Origem | Observação |
| --- | --- | --- | --- |
| Código OMIE | Sim | OMIE | Identificador principal para integração |
| Código interno | Sim | KyberRock | Espelho local |
| Descrição | Sim | OMIE | Exemplo: pedra 2, brita 1, pó de pedra |
| Unidade de medida | Sim | OMIE | Exemplo: tonelada, m³, unidade |
| Ativo/inativo | Sim | OMIE | Apenas ativos aparecem na operação |
| Dados fiscais | Conforme OMIE | OMIE | Usados pelo ERP |

### 10.3 Tabela De Preço

Regras:

- O preço será baseado em tabela de preço.
- Cada cliente deve ter uma tabela de preço vinculada.
- A regra antiga de preço baseado na última venda não será usada.
- A tabela deve permitir preço por produto.
- A unidade de cálculo deve respeitar a unidade do produto.
- Para produtos vendidos por tonelada, o valor será calculado por tonelada.
- Alterações em dados do produto devem ser feitas no OMIE quando o campo for do produto.
- A tabela de preço é informação operacional do KyberRock, vinculada aos produtos sincronizados do OMIE.

Campos mínimos recomendados:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| Nome da tabela | Sim | Exemplo: Tabela Cliente A |
| Produto | Sim | Produto vindo do OMIE |
| Preço unitário | Sim | Valor por unidade do produto |
| Vigência inicial | Não | Para histórico de preço |
| Vigência final | Não | Para histórico de preço |
| Ativa | Sim | Controla uso na operação |

### 10.4 Veículo

Regras:

- Um veículo pode atender vários clientes.
- O mesmo veículo pode carregar para clientes diferentes.
- A placa é o principal identificador operacional.
- O cadastro pode ser feito rapidamente no desktop.

Campos mínimos recomendados:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| Placa | Sim | Identificação principal |
| Tipo de veículo | Não | Caminhão, carreta, etc. |
| Transportadora | Não | Quando houver |
| Clientes vinculados | Não | Pode ter mais de um |
| Ativo/inativo | Sim | Controla uso operacional |
| Origem do cadastro | Sim | OMIE ou KyberRock quando aplicável |
| Status de sincronização | Sim | Local, pendente, sincronizado ou erro |

### 10.5 Motorista

Campos mínimos recomendados:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| Nome | Sim | Usado no cupom |
| CPF | Não | Recomendado quando disponível |
| Telefone | Não | Opcional |
| CNH | Não | Opcional |
| Ativo/inativo | Sim | Controla uso operacional |
| Veículos vinculados | Não | Facilita seleção |

### 10.6 Transportadora

Campos mínimos recomendados:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| Nome/Razão social | Sim | Identificação da transportadora |
| CPF/CNPJ | Não | Quando aplicável |
| Telefone | Não | Opcional |
| Veículos vinculados | Não | Pode atender vários clientes |
| Ativo/inativo | Sim | Controla uso operacional |

### 10.7 Forma E Condição De Recebimento

Origem:

- O cadastro principal deve vir do OMIE.
- O KyberRock deve sincronizar formas e condições de recebimento.
- A condição deve ficar vinculada ao cliente conforme cadastro do OMIE.

Regras:

- Deve suportar boleto, cheque, à vista, fechamento quinzenal, fechamento mensal e outras formas cadastradas.
- Deve suportar regras como: vendas do dia 1 ao 15 vencem dia 30, vendas do dia 16 ao fim do mês vencem dia 15 do mês seguinte.
- Deve suportar fechamento juntando vários pedidos em uma única parcela quando a condição exigir.
- O KyberRock não gera boleto.
- O financeiro definitivo é gerado no OMIE.

### 10.8 Destinatários De Relatório

Campos mínimos recomendados:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| Nome | Sim | Dono ou responsável |
| E-mail | Sim | Recebe fechamento diário |
| Ativo/inativo | Sim | Controla envio |

## 11. Integração Com OMIE

### 11.1 Objetivo

A integração com OMIE é obrigatória na primeira versão. O OMIE será a origem principal para clientes, produtos, formas/condições de recebimento, limite de crédito e contas a receber. O KyberRock será responsável pela operação de balança e enviará ao OMIE os pedidos, operações internas e cadastros criados localmente.

### 11.2 Dados Buscados Do OMIE

- Clientes.
- Produtos.
- Formas de recebimento.
- Condições de pagamento.
- Limite de crédito do cliente.
- Status de bloqueio financeiro do cliente quando disponível.
- Contas a receber em aberto por cliente.
- Dados necessários para geração de pedido de venda.
- Dados necessários para geração de ordem de serviço.

### 11.3 Dados Enviados Ao OMIE

- Clientes criados no KyberRock.
- Pedidos de venda para operações com nota.
- Ordens de serviço para operações internas.
- Dados de quantidade/peso líquido, produto, cliente, valor e condição de recebimento.

### 11.4 Operação Com Nota

Quando a venda for com nota, o KyberRock deve gerar um pedido de venda no OMIE.

Regras:

- O pedido de venda deve ser criado após fechamento da pesagem de saída.
- O faturamento e a emissão da nota serão feitos no OMIE por outra pessoa/equipe.
- O KyberRock deve armazenar o identificador do pedido criado no OMIE.
- Se o OMIE estiver indisponível, o pedido fica pendente em fila.

### 11.5 Operação Interna

Quando a venda for sem nota, o KyberRock deve tratar como operação interna e gerar uma ordem de serviço no OMIE.

Regras:

- O termo usado no KyberRock será operação interna.
- A ordem de serviço deve ser criada após fechamento da pesagem de saída.
- O KyberRock deve armazenar o identificador da ordem de serviço criada no OMIE.
- Se o OMIE estiver indisponível, a ordem fica pendente em fila.

### 11.6 Frequência De Sincronização

- Sincronização automática com OMIE a cada 30 minutos.
- Botão de sincronização manual no desktop.
- Reenvio automático de pendências quando houver internet.
- Sincronização com Firebase a cada poucos minutos.

### 11.7 Regra De Bloqueio Financeiro

O KyberRock deve bloquear novas cargas antes de liberar a entrada do caminhão quando o cliente estiver sem limite disponível ou bloqueado conforme dados vindos do OMIE.

Regras:

- O sistema deve consultar dados sincronizados do OMIE.
- O sistema deve considerar limite de crédito do cliente.
- O sistema deve considerar contas a receber em aberto do cliente.
- Se o limite estiver vazio ou igual a zero, o bloqueio por limite deve ser desconsiderado.
- Se houver limite informado, o sistema deve calcular saldo disponível.
- Saldo disponível recomendado: limite de crédito menos contas a receber em aberto menos operações locais ainda não sincronizadas.
- Se o saldo disponível for insuficiente para nova carga, o sistema deve bloquear a entrada.
- Se o OMIE indicar cliente bloqueado para faturamento, o sistema deve bloquear a entrada.
- Ninguém poderá liberar exceção manualmente.
- A regra deve ser totalmente baseada no cadastro e dados sincronizados.

### 11.8 Idempotência E Reenvio

Toda integração com OMIE deve ser idempotente.

Regras:

- Cada operação KyberRock deve ter identificador único.
- O identificador único deve ser enviado como referência ao OMIE quando possível.
- Reenvios não podem criar pedidos duplicados.
- O sistema deve registrar tentativa, sucesso, erro e próxima tentativa.
- O operador deve ver pendências de sincronização.

## 12. Integração Com Firebase

### 12.1 Objetivo

O Firebase será usado como banco em nuvem para sincronização, consulta pelo site do carregador, backup operacional em nuvem e suporte a crescimento multiunidade.

### 12.2 Regras Gerais

- O desktop deve sincronizar com Firebase a cada poucos minutos.
- O desktop deve operar com banco local mesmo sem internet.
- O site do carregador lê dados do Firebase.
- A sincronização deve ser incremental.
- O sistema deve enviar para Firebase operações abertas, fechadas, canceladas e pendentes.
- O sistema deve receber do Firebase atualizações relevantes quando aplicável.
- Dados devem ser segregados por empresa/pedreira/unidade.

### 12.3 Dados Necessários No Firebase

- Empresas/pedreiras/unidades.
- Usuários do site do carregador.
- Solicitações de carregamento em aberto.
- Status das pesagens.
- Clientes, produtos e cadastros necessários para visualização.
- Logs resumidos de sincronização.
- Relatórios ou dados consolidados quando necessário.

### 12.4 Site Do Carregador No Firebase

Regras:

- O carregador autentica com login próprio.
- O carregador acessa somente dados da unidade vinculada.
- O carregador só lê carregamentos em aberto.
- O carregador não escreve dados operacionais.
- Regras de segurança do Firebase devem impedir alteração pelo carregador.

## 13. Operação Offline-First

O desktop precisa funcionar com ou sem internet. A internet não pode ser pré-requisito para pesar, abrir venda, fechar venda ou imprimir cupom.

Arquitetura funcional:

- Banco local no computador da balança.
- Fila local de sincronização com Firebase.
- Fila local de sincronização com OMIE.
- Status visual de online/offline.
- Reenvio automático quando a conexão voltar.
- Logs locais para diagnóstico.

Regras:

- Cadastros rápidos feitos offline ficam marcados como pendentes.
- Operações feitas offline ficam marcadas como pendentes de Firebase e OMIE.
- A operação local deve sempre preservar dados antes de tentar sincronizar.
- Nenhuma venda pode ser perdida por falha de internet.
- Ao reconectar, o sistema deve sincronizar em ordem segura.
- Cadastros necessários devem ser enviados antes dos pedidos que dependem deles.

## 14. Impressão De Cupom Térmico

### 14.1 Quando Imprimir

O cupom deve ser impresso somente no final da operação, após a pesagem de saída e fechamento da venda.

### 14.2 Finalidade

O cupom será impresso em impressora térmica de 80 mm para o motorista assinar fisicamente.

### 14.3 Conteúdo Mínimo Do Cupom

- Nome da pedreira.
- Dados da unidade, quando cadastrados.
- Data e hora.
- Número do cupom/operação.
- Cliente.
- CPF/CNPJ do cliente quando disponível.
- Endereço do cliente quando disponível.
- Telefone/celular quando disponível.
- Código do produto.
- Descrição do produto.
- Quantidade/peso líquido.
- Valor unitário.
- Valor total do item.
- Total da venda.
- Condição de pagamento.
- Peso de entrada/tara em toneladas.
- Peso de saída/carregado em toneladas.
- Vencimento e valor financeiro quando aplicável.
- Linha para assinatura do motorista ou recebimento.
- Placa do veículo.
- Nome do motorista.
- Mensagem final configurável.

### 14.4 Regras De Impressão

- A impressão deve usar impressora térmica de 80 mm instalada no Windows.
- O layout deve ser compacto e legível.
- O número do cupom deve ser sequencial por unidade.
- O sistema deve permitir reimpressão com marcação de segunda via.
- A reimpressão deve gerar auditoria.

## 15. Relatórios

### 15.1 Fechamento Diário

O sistema deve gerar fechamento diário automaticamente às 20h e enviar por e-mail ao dono/responsáveis cadastrados.

Conteúdo mínimo:

- Data do fechamento.
- Produtos vendidos no dia.
- Tonelagem por produto.
- Faturamento de produto.
- Valor de frete quando aplicável.
- Valor total.
- Número de carregamentos.
- Preço médio de venda.
- Consolidado geral do dia.

### 15.2 Relatórios Gerenciais

Relatórios obrigatórios:

- Diário.
- Mês atual.
- Mês anterior.
- Ano corrente.
- Por produto.
- Por cliente.
- Por frete quando o módulo estiver parametrizado.

Relatório por forma de pagamento não é obrigatório na primeira versão.

### 15.3 Métricas Obrigatórias

- Tonelagem.
- Faturamento de produto.
- Faturamento de frete quando aplicável.
- Valor total.
- Quantidade de carregamentos.
- Preço médio de venda.

### 15.4 Exportação E Impressão

- Exportar PDF.
- Exportar Excel.
- Botão de impressão rápida em A4.
- Impressão em impressora instalada no Windows.

## 16. Fretes

A parte de fretes foi discutida na reunião, mas as regras finais ainda serão definidas. O sistema deve ser preparado para suportar o módulo de frete sem hard-code e sem travar a evolução.

Requisitos já identificados:

- Deve existir estrutura para indicar se a operação tem frete ou não.
- Deve existir estrutura para modalidades como FOB, CIF, frete próprio e frete de terceiro, caso confirmadas.
- Deve existir estrutura para valor de frete separado do valor do produto.
- Relatórios devem conseguir separar faturamento de produto, frete e total.
- Deve ser possível associar frete a cliente, transportadora, destino ou regra futura.
- Deve ser possível calcular frete por tonelagem quando essa regra for confirmada.
- A integração com OMIE deve permitir enviar valor de frete no formato definido futuramente.

Pendências de definição:

- Modalidades finais de frete.
- Se o frete entra no mesmo pedido do produto ou em documento separado.
- Se haverá empresa terceira responsável por nota/fechamento de frete.
- Se o valor será sempre calculado por tonelada.
- Se haverá tabela de frete por cliente, destino, transportadora ou produto.

## 17. Regras De Pagamento E Fechamento Financeiro

O KyberRock não será um sistema financeiro completo. Ele usará informações do OMIE e enviará operações para que o OMIE gere o financeiro.

Regras:

- Formas e condições de recebimento devem vir do OMIE.
- A condição deve estar vinculada ao cliente.
- O operador seleciona ou confirma a condição na operação.
- O KyberRock deve suportar regras de fechamento por período.
- O KyberRock deve suportar agrupamento de vários pedidos em uma única parcela quando a regra exigir.
- O boleto ou título financeiro será gerado pelo OMIE.
- O fechamento diário do KyberRock é relatório, não fechamento de caixa definitivo.

Exemplo de regra suportada:

| Período de venda | Vencimento |
| --- | --- |
| Dia 1 ao dia 15 | Dia 30 do mesmo mês |
| Dia 16 ao último dia do mês | Dia 15 do mês seguinte |

## 18. Status Das Operações

Status recomendados:

| Status | Significado |
| --- | --- |
| Rascunho | Operação iniciada antes da captura de entrada |
| Entrada registrada | Peso de entrada capturado |
| Aguardando carregamento | Solicitação aberta para o carregador visualizar |
| Aguardando saída | Caminhão carregado deve retornar à balança |
| Fechada localmente | Peso de saída capturado e venda calculada |
| Pendente Firebase | Ainda não sincronizada com Firebase |
| Pendente OMIE | Ainda não enviada ao OMIE |
| Sincronizada | Enviada e confirmada nos sistemas necessários |
| Erro de sincronização | Falha no envio ao Firebase ou OMIE |
| Cancelada | Cancelada no desktop com motivo obrigatório |

## 19. Auditoria

O sistema deve registrar histórico das ações críticas.

Ações auditáveis:

- Criação de operação.
- Captura de peso de entrada.
- Captura de peso de saída.
- Alteração de cliente, veículo, motorista, produto, condição ou preço.
- Cancelamento de operação.
- Reimpressão de cupom.
- Sincronização manual com OMIE.
- Erros de sincronização.
- Alteração de tabela de preço.
- Alteração de configurações.

Dados mínimos de auditoria:

- Data e hora.
- Dispositivo/instalação.
- Usuário quando houver identificação.
- Ação realizada.
- Valor anterior.
- Valor novo.
- Motivo quando obrigatório.

## 20. Requisitos Não Funcionais

### 20.1 Disponibilidade

- O desktop deve continuar operando sem internet.
- A falha de internet não pode parar pesagem.
- A falha de OMIE não pode perder venda.
- A falha de Firebase não pode perder venda.
- A falha de balança deve bloquear pesagem por não haver peso manual.

### 20.2 Performance

- A tela de operação deve abrir rapidamente em computador Windows comum.
- A busca por cliente, placa, motorista e produto deve responder em poucos segundos.
- A captura de peso deve ter resposta operacional imediata após estabilidade da balança.
- O site do carregador deve atualizar a lista em tempo quase real quando online.

### 20.3 Segurança

- Credenciais do OMIE não devem ficar expostas no front-end do site.
- A integração OMIE deve preferencialmente passar por backend seguro ou função cloud.
- O site do carregador deve ter autenticação.
- O carregador deve ter permissão somente leitura.
- Dados devem ser segregados por empresa/pedreira/unidade.
- A comunicação com Firebase e serviços cloud deve usar HTTPS/TLS.
- O banco local deve proteger dados sensíveis conforme viabilidade técnica.

### 20.4 Confiabilidade De Dados

- Toda operação deve ter identificador único.
- Operações não podem ser duplicadas no OMIE por falha de reenvio.
- Sincronização deve ser resiliente a queda de conexão.
- Toda operação fechada localmente deve permanecer registrada até sincronizar.
- Cancelamentos devem manter histórico.

### 20.5 Escalabilidade

- O sistema deve suportar múltiplas pedreiras/unidades.
- Dados devem possuir identificador de empresa e unidade.
- Numeração de cupons deve ser por unidade.
- Relatórios devem filtrar por unidade.
- Usuários do carregador devem estar vinculados a unidade.

## 21. Arquitetura E Stack Técnica Recomendada

### 21.1 Visão Arquitetural

Arquitetura recomendada:

- Aplicativo desktop Windows offline-first.
- Banco local no desktop.
- Firebase como sincronização cloud e base para o site do carregador.
- Backend serverless para integrações sensíveis e automações.
- Site web separado para carregador.
- Integração por adaptador com balança.
- Integração idempotente com OMIE.

### 21.2 Desktop Windows

Stack recomendada:

| Camada | Tecnologia Recomendada | Motivo |
| --- | --- | --- |
| Aplicativo desktop | Electron + TypeScript | Bom suporte a Windows, impressão, Node.js e integrações locais |
| Interface | React + TypeScript | Produtividade e manutenção |
| Banco local | SQLite | Offline-first, simples, confiável e local |
| Acesso SQLite | better-sqlite3 ou Prisma | Consistência de queries e migrations |
| Comunicação com balança | Node.js com adapters Serial/TCP/USB | Flexível enquanto protocolo final não estiver confirmado |
| Impressão térmica | Impressão nativa Windows ou biblioteca ESC/POS | Compatível com impressora 80 mm instalada |
| Build/instalador | electron-builder | Geração de instalador Windows |

Justificativa:

- Electron permite acessar recursos locais necessários para balança, impressora, arquivos, banco local e fila de sincronização.
- Um app web puro não atende bem leitura local de balança e impressão operacional.
- SQLite garante operação mesmo sem internet.

### 21.3 Site Do Carregador

Stack recomendada:

| Camada | Tecnologia Recomendada | Motivo |
| --- | --- | --- |
| Front-end web | React + TypeScript | Interface simples e consistente com desktop |
| Build web | Vite ou Next.js | Vite se for SPA simples, Next.js se precisar SSR no futuro |
| Autenticação | Firebase Authentication | Login próprio do carregador |
| Banco cloud | Cloud Firestore | Atualização quase em tempo real |
| Hospedagem | Firebase Hosting | Integração direta com Firebase |

Recomendação prática:

- Usar Vite + React para o site do carregador se ele permanecer somente consulta.
- Usar Next.js apenas se houver necessidade futura de rotas server-side, painéis públicos ou renderização avançada.

### 21.4 Backend E Integrações

Stack recomendada:

| Camada | Tecnologia Recomendada | Motivo |
| --- | --- | --- |
| Backend serverless | Firebase Cloud Functions em TypeScript | Integração nativa com Firebase e jobs agendados |
| Agendamentos | Cloud Scheduler ou funções agendadas | Envio do fechamento diário e rotinas de sync |
| Segredos | Google Secret Manager | Proteger credenciais OMIE |
| E-mail | SendGrid, Resend ou provedor SMTP transacional | Envio confiável do fechamento diário |
| Logs cloud | Firebase/Google Cloud Logging | Diagnóstico de sync e integrações |

Recomendação de segurança:

- Evitar expor credenciais do OMIE no site do carregador.
- Preferir que chamadas sensíveis ao OMIE passem por Cloud Functions.
- O desktop pode enfileirar dados localmente e enviá-los para uma função segura quando estiver online.

### 21.5 Firebase

Serviços recomendados:

- Firebase Authentication para login do carregador e autenticação do desktop/dispositivo.
- Cloud Firestore para dados sincronizados e leitura do site do carregador.
- Firebase Hosting para site do carregador.
- Cloud Functions para OMIE, envio de e-mail e regras server-side.
- Cloud Storage somente se futuramente houver arquivos, PDFs ou anexos.

### 21.6 Estrutura De Repositório Recomendada

Estrutura sugerida:

```text
kyberrock/
  apps/
    desktop/
    loader-web/
  packages/
    shared/
    omie-client/
    scale-adapters/
    print-templates/
  functions/
  docs/
```

Objetivo:

- Compartilhar tipos entre desktop, site e funções.
- Isolar integração OMIE.
- Isolar adaptadores de balança.
- Isolar templates de impressão.

## 22. Modelo De Dados Conceitual

Entidades principais:

| Entidade | Descrição |
| --- | --- |
| Empresa | Organização proprietária das pedreiras |
| Unidade/Pedreira | Local físico de operação |
| Dispositivo | Computador instalado na balança |
| Cliente | Comprador do material |
| Produto | Produto sincronizado do OMIE |
| TabelaPreco | Preços por produto usados por cliente |
| Veiculo | Caminhão identificado por placa |
| Motorista | Pessoa que conduz o veículo |
| Transportadora | Empresa ou terceiro vinculado ao transporte |
| FormaRecebimento | Forma/condição sincronizada do OMIE |
| PesagemOperacao | Registro completo da entrada, saída e venda |
| SolicitacaoCarregamento | Visão em aberto para o carregador |
| Cupom | Dados de impressão e reimpressão |
| SyncQueue | Fila local de sincronização |
| AuditLog | Histórico de ações críticas |
| RelatorioFechamento | Consolidação diária/mensal/anual |

## 23. Telas Principais

### 23.1 Desktop

Telas obrigatórias:

- Painel operacional da balança.
- Nova entrada de caminhão.
- Operações em aberto.
- Fechamento de saída.
- Consulta de operações.
- Cadastros rápidos.
- Clientes.
- Veículos.
- Motoristas.
- Transportadoras.
- Tabelas de preço.
- Formas/condições de recebimento.
- Produtos sincronizados.
- Sincronização OMIE.
- Sincronização Firebase.
- Relatórios.
- Configurações da balança.
- Configurações de impressora.
- Configurações da unidade.
- Destinatários de e-mail.
- Logs/auditoria.

### 23.2 Site Do Carregador

Telas obrigatórias:

- Login.
- Lista de carregamentos em aberto.
- Detalhe simples do carregamento.

## 24. Critérios De Aceite

### 24.1 Balança

- O sistema captura peso automaticamente da balança.
- O sistema não permite digitação manual de peso.
- O sistema bloqueia operação se a balança estiver indisponível.
- O sistema calcula peso líquido corretamente.

### 24.2 Operação Offline

- O desktop abre entrada sem internet.
- O desktop fecha saída sem internet.
- O desktop imprime cupom sem internet.
- O desktop enfileira sincronizações pendentes.
- O desktop sincroniza automaticamente quando a internet volta.

### 24.3 OMIE

- O sistema sincroniza clientes do OMIE.
- O sistema sincroniza produtos do OMIE.
- O sistema sincroniza formas/condições de recebimento do OMIE.
- O sistema envia cliente criado localmente para o OMIE.
- O sistema gera pedido de venda no OMIE para operação com nota.
- O sistema gera ordem de serviço no OMIE para operação interna.
- O sistema não duplica pedidos em reenvios.
- O sistema bloqueia cliente sem limite disponível quando houver limite configurado.

### 24.4 Firebase E Site Do Carregador

- O desktop sincroniza solicitações em aberto com Firebase.
- O carregador faz login no site.
- O carregador vê apenas solicitações em aberto da unidade.
- O carregador não consegue alterar dados.

### 24.5 Cupom

- O sistema imprime cupom térmico de 80 mm no fechamento da saída.
- O cupom contém cliente, produto, pesos, valor, veículo e motorista.
- O cupom possui espaço para assinatura.
- O sistema permite reimpressão como segunda via.

### 24.6 Relatórios

- O sistema gera relatório diário.
- O sistema envia fechamento diário por e-mail às 20h.
- O sistema gera relatórios de mês atual, mês anterior e ano corrente.
- O sistema exporta PDF e Excel.
- O sistema imprime relatórios em A4.

## 25. Pendências Externas Para Desenvolvimento

As pendências abaixo não bloqueiam o PRD, mas precisam ser resolvidas antes ou durante a implementação técnica.

- Confirmar protocolo de comunicação da balança Toledo 950 IDLCG 2.
- Confirmar se a balança será acessada por serial, USB, TCP/rede, arquivo ou outro método.
- Definir regras finais de frete.
- Confirmar provedor de e-mail transacional.
- Confirmar dados fiscais mínimos exigidos pelo OMIE para pedido de venda e ordem de serviço.
- Confirmar modelo exato da impressora térmica de 80 mm.
- Confirmar layout final do cupom com a pedreira.
- Confirmar periodicidade exata de sincronização com Firebase, caso “poucos minutos” precise virar valor fixo.

## 26. Riscos E Mitigações

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Protocolo da balança desconhecido | Pode atrasar integração | Criar camada de adapter e validar com equipamento real cedo |
| OMIE retornar erros inesperados | Pode atrasar pedidos | Implementar fila, logs e tela de correção |
| Internet instável | Pode afetar site e OMIE | Desktop offline-first com SQLite e filas |
| Duplicidade no OMIE | Pode gerar faturamento errado | Idempotência por identificador único |
| Frete sem regra definida | Pode afetar valor total | Modelagem flexível e parametrização antes de ativar cálculo final |
| Operador cancelar operação incorretamente | Pode afetar auditoria | Motivo obrigatório e histórico imutável |
| Site do carregador alterar dados indevidamente | Pode afetar operação | Regras Firebase read-only para carregador |

## 27. Decisões Confirmadas

- O nome do sistema será KyberRock.
- O sistema atual será substituído totalmente.
- A primeira versão deve contemplar tudo que foi discutido, com exceções registradas neste PRD.
- O produto precisa ser escalável para outras pedreiras.
- O desktop Windows é a operação principal.
- O desktop não terá divisão por perfis.
- O carregador terá site com login próprio apenas para visualização.
- O carregador não confirma carregamento.
- A balança deve ser lida automaticamente.
- Peso manual não será permitido.
- A balança é Toledo 950 IDLCG 2.
- Haverá apenas uma balança na primeira versão.
- O cupom será impresso em impressora térmica de 80 mm na saída.
- Produtos vêm do OMIE.
- Formas/condições de recebimento vêm do OMIE.
- Clientes podem vir do OMIE ou ser criados no KyberRock.
- Cadastros criados no KyberRock devem sincronizar para o OMIE.
- Campos vindos do OMIE não podem ser alterados localmente.
- A precificação será por tabela de preço vinculada ao cliente.
- A regra de preço pela última venda não será usada.
- O KyberRock não gera boleto.
- O financeiro será gerado pelo OMIE.
- Operação com nota gera pedido de venda no OMIE.
- Operação interna gera ordem de serviço no OMIE.
- O KyberRock deve bloquear carregamento por limite/contas a receber vindos do OMIE.
- Se limite estiver vazio ou zero, o bloqueio por limite é desconsiderado.
- Não haverá liberação manual de exceção.
- Sincronização OMIE automática a cada 30 minutos.
- Sincronização manual com OMIE por botão.
- Sincronização com Firebase a cada poucos minutos.
- Fechamento diário por e-mail às 20h.
- Relatórios exportam PDF e Excel e imprimem A4.
- Câmera/OCR não entra no PRD atual.
- Contratos por tonelagem não entram no PRD atual.
