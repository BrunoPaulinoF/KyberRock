# PLAN - KyberRock

Versao: 1.1  
Data: 2026-06-06  
Base: `PRD.md`  
Objetivo: organizar a construcao do KyberRock por fases executaveis, cobrindo o PRD completo, os riscos tecnicos principais e os criterios de aceite para iniciar, validar, pilotar e colocar o sistema em producao.

## 1. Decisoes Iniciais Confirmadas

- O gerenciador de pacotes sera `npm`.
- O projeto Firebase ainda nao existe e sera criado em fase propria.
- As credenciais do OMIE ainda nao estao configuradas no projeto; serao informadas depois em local seguro.
- Nao ha acesso ao computador real da balanca neste momento; o spike fisico fica pendente.
- A Toledo 950 IDLCG 2 e o primeiro modelo conhecido, mas o sistema deve aceitar diferentes balancas por adapter configuravel.
- A impressora termica ja existe, mas o modelo ainda nao foi identificado.
- A impressao deve usar impressoras instaladas no Windows, com selecao e perfil configuravel por unidade/dispositivo.
- A integracao OMIE pode ser desenhada pela documentacao publica enquanto as credenciais reais ficam pendentes.
- O sistema principal sera desktop Windows.
- O desktop deve funcionar offline.
- O site do carregador sera web, online, com login proprio e somente leitura.
- O carregador nao confirma carregamento, apenas visualiza solicitacoes em aberto.
- O desktop nao tera divisao por perfis, mas deve ter identificacao/configuracao segura do dispositivo para sincronizacao.
- O sistema deve nascer com suporte estrutural para multiplas empresas, pedreiras e unidades.

## 2. Estrategia Geral

O projeto deve ser construido de forma incremental, com validacoes tecnicas antecipadas. Os maiores riscos nao podem ficar para o final.

Riscos que devem ser atacados cedo:

- leitura automatica de balancas por adapters configuraveis, com Toledo 950 IDLCG 2 como primeiro alvo conhecido;
- operacao offline com banco local;
- fila de sincronizacao confiavel;
- integracao OMIE sem duplicidade;
- bloqueio financeiro baseado em OMIE;
- impressao no Windows usando impressoras instaladas e perfis configuraveis, incluindo cupom termico 80 mm;
- sincronizacao Firebase para o site do carregador;
- seguranca de credenciais, dados financeiros e segregacao multiunidade;
- backup/restauracao do banco local.

Principio de execucao:

- Primeiro validar riscos tecnicos.
- Depois modelar dados e contratos.
- Depois criar fundacao do monorepo.
- Depois construir o fluxo operacional simulado.
- Depois substituir mocks por integracoes reais.
- Depois pilotar em ambiente real.

## 3. Arquitetura Planejada

Estrutura recomendada do repositorio:

```text
KyberRock/
  apps/
    desktop/
    loader-web/
  packages/
    shared/
    scale-adapters/
    omie-client/
    print-templates/
  functions/
  docs/
  PRD.md
  PLAN.md
```

Stack planejada:

| Area               | Tecnologia                     | Observacao                                                                       |
| ------------------ | ------------------------------ | -------------------------------------------------------------------------------- |
| Package manager    | npm workspaces                 | Confirmado para o projeto                                                        |
| Desktop            | Electron + React + TypeScript  | Aplicativo Windows offline-first                                                 |
| Banco local        | SQLite                         | Operacao mesmo sem internet                                                      |
| Site carregador    | React + TypeScript             | Web, online, somente leitura                                                     |
| Cloud              | Firebase                       | Auth, Firestore, Hosting e Functions                                             |
| Backend serverless | Firebase Functions             | OMIE, e-mails e tarefas agendadas                                                |
| Integracao OMIE    | TypeScript client proprio      | Com fila, logs e idempotencia                                                    |
| Balanca            | Adapters locais configuraveis  | Serial, USB serial, TCP/IP, HTTP/API local, arquivo/driver ou adapter especifico |
| Impressao          | Impressoras Windows instaladas | Perfis configuraveis para cupom 80 mm e relatorios A4                            |
| Testes             | Vitest                         | Recomendado para pacotes TypeScript e regras de dominio                          |
| Build desktop      | electron-builder               | Instalador Windows                                                               |

## 4. Fase 0 - Preparacao, Spikes E Validacoes Tecnicas

### Objetivo

Validar cedo os pontos que podem inviabilizar ou alterar a arquitetura: balanca, impressora, OMIE, ambiente Windows e seguranca de credenciais.

### Entregaveis

- Confirmacao do ambiente de desenvolvimento local.
- Confirmacao da versao do Node.js e npm.
- Criacao ou preparacao do repositorio Git, caso ainda nao exista.
- Inventario do PC da balanca:
- versao do Windows;
- portas disponiveis;
- usuario/permissoes;
- impressoras instaladas;
- conexao de rede/internet;
- caminho recomendado para banco local e logs.
- Spike de balancas configuraveis:
- definir contrato de adapter de balanca;
- mapear tipos de conexao suportados: serial RS-232, USB serial, TCP/IP, HTTP/API local, arquivo/driver intermediario ou adapter especifico;
- tratar Toledo 950 IDLCG 2 como primeiro modelo conhecido, nao como unica opcao;
- identificar protocolo de comunicacao quando houver acesso ao equipamento real;
- identificar porta, baud rate ou configuracao TCP/USB/API/arquivo quando aplicavel;
- capturar amostra real de leitura;
- registrar formato da mensagem de peso;
- validar como identificar peso estavel.
- Spike da impressao Windows configuravel:
- listar impressoras instaladas;
- definir selecao de impressora por unidade/dispositivo;
- definir perfis de impressao para cupom 80 mm e relatorio A4;
- imprimir cupom teste em 80 mm;
- validar corte, margem, fonte e legibilidade.
- Spike OMIE:
- mapear APIs pela documentacao publica `https://developer.omie.com.br/service-list/` enquanto as credenciais ficam pendentes;
- validar autenticacao com credenciais reais quando disponiveis;
- consultar cliente;
- consultar produto;
- consultar forma/condicao de recebimento;
- consultar contas a receber ou informacao financeira necessaria;
- validar endpoints de pedido de venda e ordem de servico em ambiente seguro/teste, se disponivel.
- Levantamento dos dados obrigatorios para pedido de venda e ordem de servico no OMIE.
- Definicao inicial de onde ficarao segredos em desenvolvimento, homologacao e producao.
- Lista objetiva de pendencias de frete que precisam de definicao comercial.

### Criterios De Aceite

- Node.js e npm funcionando.
- PC da balanca inventariado.
- Estrategia de adapters de balanca documentada e protocolo real identificado quando houver acesso ao equipamento.
- Pelo menos uma leitura real ou diagnostico tecnico documentado da balanca.
- Estrategia de impressoras Windows configuraveis documentada e cupom teste impresso quando houver acesso a impressora real, ou impedimento registrado.
- OMIE mapeado pela documentacao publica e autenticado com sucesso quando as credenciais estiverem disponiveis, ou erro real documentado.
- Credenciais OMIE disponiveis em local seguro, sem serem commitadas.
- Riscos restantes documentados antes de iniciar implementacao principal.

### Dependencias

- Acesso ao PC da balanca para validacao fisica final.
- Acesso ao Windows onde a impressora real esta instalada.
- Credenciais OMIE para validacao real.

## 5. Fase 1 - Design Tecnico E Modelo De Dados

### Objetivo

Definir contratos, entidades, status, sincronizacao, multiunidade e regras de conflito antes de criar tabelas e colecoes definitivas.

### Entregaveis

- Documento tecnico em `docs/ARCHITECTURE.md`.
- Modelo de dados SQLite.
- Modelo de dados Firestore.
- Contratos TypeScript compartilhados.
- Definicao de identificadores globais e locais.
- Definicao de empresa, pedreira, unidade e dispositivo desde o inicio.
- Definicao dos status de operacao.
- Definicao da fila local de sincronizacao.
- Definicao de idempotencia para Firebase e OMIE.
- Definicao da estrategia de conflito:
- campos do OMIE vencem em dados de origem OMIE;
- campos do KyberRock vencem quando forem exclusivos locais;
- alteracoes criticas geram auditoria.
- Definicao da estrategia de cancelamento antes e depois de envio ao OMIE.
- Definicao da estrategia de backup e restauracao local.
- Definicao da estrategia de logs locais e logs cloud.
- Definicao da estrategia de seguranca:
- segredos fora do Git;
- regras Firestore;
- permissao somente leitura do carregador;
- autenticacao do desktop/dispositivo;
- segregacao por unidade.
- Definicao inicial de frete no modelo, mesmo sem regra comercial fechada.

### Criterios De Aceite

- Modelo suporta multiunidade desde o primeiro schema.
- Modelo suporta operacao offline e sincronizacao posterior.
- Modelo suporta fila idempotente para OMIE.
- Modelo suporta solicitacoes em aberto para o site do carregador.
- Modelo suporta cupom sequencial por unidade.
- Modelo suporta auditoria e cancelamentos.
- Modelo suporta frete como estrutura extensivel, mesmo sem regra final.
- Documento tecnico revisado antes da implementacao das migrations.

### Dependencias

- Fase 0 concluida ou com riscos tecnicos documentados.

## 6. Fase 2 - Fundacao Do Monorepo

### Objetivo

Criar a base tecnica do projeto para desenvolvimento organizado do desktop, site, funcoes cloud e pacotes compartilhados.

### Entregaveis

- `package.json` raiz com npm workspaces.
- Estrutura inicial de pastas.
- Configuracao TypeScript compartilhada.
- Configuracao de lint.
- Configuracao de formatacao.
- Configuracao de testes com Vitest.
- Pacote `packages/shared` para tipos e regras comuns.
- Pacote `packages/scale-adapters` para contrato e adapters de balancas.
- Pacote `packages/omie-client` para OMIE.
- Pacote `packages/print-templates` para cupom e relatorios.
- Scripts raiz:
- `npm run build`;
- `npm run lint`;
- `npm test`.
- Documentacao inicial de comandos do projeto.
- `.gitignore` cobrindo `node_modules`, builds, banco local, logs e arquivos de ambiente.

### Criterios De Aceite

- `npm install` funciona na raiz.
- `npm run build` funciona para a estrutura inicial.
- `npm run lint` funciona para a estrutura inicial.
- `npm test` funciona para a estrutura inicial.
- Nenhum segredo ou arquivo local sensivel e commitado.
- O repositorio tem estrutura pronta para crescimento.

### Dependencias

- Fase 1 aprovada.

## 7. Fase 3 - Desktop Base Offline-First

Status: concluida. Desktop base offline-first criado com SQLite local, migrations, bootstrap de identidade local, fila de sincronizacao, backup/exportacao/restauracao, shell Electron, interface React inicial e indicadores visuais.

### Objetivo

Criar o aplicativo desktop Windows com banco local, migrations, backup e capacidade real de operar sem internet.

### Entregaveis

- App Electron inicial.
- Interface React inicial.
- Banco SQLite local.
- Sistema de migrations.
- Servico local de persistencia.
- Configuracao inicial de empresa, unidade e dispositivo.
- Tabelas iniciais:
- empresas;
- unidades;
- dispositivos;
- clientes;
- produtos;
- veiculos;
- motoristas;
- transportadoras;
- tabelas de preco;
- formas e condicoes de recebimento;
- operacoes de pesagem;
- solicitacoes de carregamento;
- cupons;
- fila de sincronizacao;
- logs de auditoria;
- logs tecnicos;
- configuracoes locais.
- Indicadores visuais de status:
- internet;
- balanca;
- Firebase;
- OMIE;
- fila pendente;
- ultimo backup.
- Backup local automatico.
- Exportacao manual de backup.
- Restauracao local controlada.
- Protecao contra corrupcao basica do banco local.

### Criterios De Aceite

- O desktop abre no Windows.
- O banco local e criado automaticamente.
- Dados locais persistem ao fechar e abrir o aplicativo.
- O app funciona sem internet.
- Empresa/unidade/dispositivo existem desde o inicio.
- Existe fila local para futuras sincronizacoes.
- Existe backup local automatico.
- Existe exportacao manual de backup.
- Existem testes para banco local, migrations, fila e backup.

### Dependencias

- Fase 2 concluida.

## 7.1. Fase 3.1 - Instalador E Atualizacoes Do Desktop

Status: base implementada. O app tem configuracao de instalador Windows e fluxo de update manual com botao. A publicacao real de updates depende de definir a URL HTTPS final na VPS/EasyPanel e publicar os artefatos nesse endpoint.

### Objetivo

Permitir instalar o desktop no Windows e preparar atualizacoes acionadas pelo operador, sem update automatico silencioso.

### Entregaveis

- Configuracao `electron-builder` para instalador Windows NSIS.
- Script `npm run dist:win --workspace @kyberrock/desktop`.
- Configuracao `electron-updater` com `autoDownload = false`.
- Botao no desktop para verificar atualizacao.
- Botao para baixar e instalar somente quando houver update disponivel.
- Provider generico HTTPS para publicar updates fora do app, sem token embutido.
- Documentacao do fluxo de publicacao e atualizacao.

### Criterios De Aceite

- Build do desktop continua funcionando.
- Instalador Windows pode ser gerado localmente.
- O app nao instala atualizacao sozinho.
- O operador precisa clicar para baixar/instalar.
- Nenhum token do GitHub privado fica dentro do app.

## 8. Fase 4 - Fluxo De Pesagem Com Balanca Simulada

Status: concluida. Fluxo de pesagem com balanca simulada criado com telas internas, entrada/saida simuladas, tipo de operacao, condicao de recebimento, tabela de preco simulada, calculo financeiro, cancelamento com motivo, loading request local, auditoria e testes.

### Objetivo

Construir o fluxo operacional principal usando balanca simulada antes da integracao real definitiva.

### Entregaveis

- Adapter de balanca mock.
- Tela de painel operacional.
- Tela de nova entrada.
- Tela de operacoes em aberto.
- Tela de fechamento de saida.
- Cadastro rapido de cliente, veiculo e motorista.
- Selecao de produto.
- Selecao de operacao com nota ou operacao interna.
- Selecao de forma/condicao de recebimento.
- Captura simulada de peso de entrada.
- Captura simulada de peso de saida.
- Calculo de peso liquido.
- Calculo de valor conforme tabela de preco.
- Criacao de solicitacao de carregamento em aberto.
- Fechamento local da operacao.
- Cancelamento com motivo obrigatorio.
- Logs de auditoria das etapas principais.

### Criterios De Aceite

- Operador consegue abrir uma pesagem completa com balanca simulada.
- Operador consegue fechar a pesagem com peso de saida simulado.
- Sistema calcula peso liquido corretamente.
- Sistema bloqueia peso de saida menor ou igual ao peso de entrada.
- Sistema nao possui campo de peso manual.
- Operacao fechada fica salva localmente.
- Operacao cancelada exige motivo e preserva historico.
- Solicitacao em aberto fica disponivel no modelo local para futura sincronizacao.
- Existem testes para peso liquido, status da operacao, cancelamento e validacoes principais.

### Dependencias

- Fase 3 concluida.

## 9. Fase 5 - Impressao Local No Windows

Status: implementada com validacao fisica pendente. O desktop lista impressoras do Windows, salva perfil de cupom 80 mm, imprime automaticamente apos fechamento, registra falhas sem perder a operacao e permite reimpressao auditada como segunda via. Teste fisico depende do PC com impressora instalada.

### Objetivo

Implementar e validar a impressao do cupom termico de 80 mm usando impressora instalada no Windows.

### Entregaveis

- Listagem ou selecao da impressora instalada no Windows.
- Configuracao de impressora por perfil no desktop.
- Template inicial do cupom 80 mm.
- Impressao do cupom apos fechamento da pesagem.
- Reimpressao com marcacao de segunda via.
- Auditoria de reimpressao.
- Tratamento de erro de impressora.

### Criterios De Aceite

- Cupom imprime na impressora selecionada entre as instaladas no Windows.
- Cupom contem dados da pedreira, cliente, produto, pesos, valor, veiculo e motorista.
- Cupom tem espaco para assinatura.
- Reimpressao gera segunda via.
- Reimpressao fica auditada.
- Falha de impressora nao apaga nem perde a operacao fechada.

### Dependencias

- Fase 4 concluida.
- Impressora disponivel no Windows.

## 10. Fase 6 - Integracao Real Com A Balanca

### Objetivo

Substituir a balanca simulada por um adapter real configuravel. A Toledo 950 IDLCG 2 e o primeiro alvo conhecido, mas a implementacao deve preservar suporte a outros modelos e conexoes.

### Entregaveis

- Adapter real para comunicacao com a balanca instalada.
- Configuracao local da conexao da balanca por unidade/dispositivo.
- Leitura automatica do peso.
- Validacao de peso estavel.
- Tratamento de falha de comunicacao.
- Logs tecnicos da leitura.
- Tela de diagnostico da balanca.
- Modo de teste tecnico de leitura sem abrir venda real.

### Criterios De Aceite

- Sistema le peso real da balanca.
- Sistema so permite capturar peso estavel.
- Sistema bloqueia pesagem quando a balanca esta indisponivel.
- Sistema continua sem permitir peso manual.
- Teste real no PC da balanca aprovado para o adapter configurado.
- Logs permitem diagnosticar falha de comunicacao.

### Dependencias

- Fase 0 com estrategia de adapters concluida e spike fisico da balanca executado quando houver acesso.
- Fase 4 concluida.
- Acesso ao PC da balanca.

## 10. Fase 7.1 - Portal De Administracao

Status: implementada. Portal admin em `/admin` no mesmo site do carregador. Login exclusivo com Google para `kybernantech@gmail.com`. Admin consegue criar, editar e excluir pedreiras e usuarios carregadores. Carregadores nao podem se cadastrar sozinhos.

### Objetivo

Criar um portal de administracao escalavel para gerenciar multiplas pedreiras/unidades e seus usuarios carregadores, com controle de acesso rigido e separacao de dados.

### Entregaveis

- Portal admin em `/admin` separado do site do carregador.
- Login com Google restrito ao email admin.
- Dashboard com lista de empresas/pedreiras.
- Formulario para criar/editar empresa.
- Formulario para criar/editar unidade.
- Formulario para criar/editar usuario carregador.
- Ativar/desativar acesso de usuarios.
- Regras Firestore com separacao admin/carregador.
- Escalavel para novas pedreiras.

### Criterios De Aceite

- Somente o email admin consegue acessar `/admin`.
- Admin pode criar novas pedreiras.
- Admin pode criar usuarios carregadores vinculados a uma unidade.
- Carregadores nao podem criar conta propria.
- Dados de uma pedreira sao inacessiveis para outra.
- Existe separacao clara entre admin e carregador no Firestore.

### Dependencias

- Fase 7 concluida.

## 11. Fase 7 - Firebase Base E Sincronizacao Cloud

### Objetivo

Criar o projeto Firebase e implementar a sincronizacao cloud necessaria para o site do carregador, backup operacional cloud e crescimento multiunidade.

### Entregaveis

- Projeto Firebase criado.
- Ambientes definidos, no minimo desenvolvimento e producao.
- Firebase Auth configurado.
- Firestore configurado.
- Firebase Hosting preparado.
- Firebase Functions preparado.
- Regras de seguranca iniciais.
- Autenticacao do desktop/dispositivo para sincronizacao.
- Sincronizacao desktop -> Firebase para operacoes em aberto.
- Sincronizacao desktop -> Firebase para operacoes fechadas/canceladas.
- Sincronizacao incremental.
- Status de sincronizacao no desktop.
- Fila de reenvio em caso de queda de internet.
- Logs resumidos de sincronizacao.
- Testes ou validacao das regras Firestore.

### Criterios De Aceite

- Desktop opera offline e sincroniza quando volta a internet.
- Operacoes em aberto aparecem no Firestore.
- Operacoes fechadas deixam de aparecer como abertas.
- Reenvio nao duplica operacoes.
- Dados ficam segregados por empresa/unidade.
- Regras do Firebase impedem escrita indevida por usuarios do carregador.
- Existem testes para fila, idempotencia local e regras criticas de seguranca.

### Dependencias

- Fase 3 concluida.
- Projeto Firebase criado nesta fase.

## 12. Fase 8 - Site Do Carregador

### Objetivo

Criar o site online para o carregador visualizar solicitacoes de carregamento em aberto.

### Entregaveis

- App web `loader-web`.
- Login do carregador via Firebase Auth.
- Vinculo do carregador com empresa/unidade.
- Tela de lista de carregamentos em aberto.
- Tela ou painel de detalhe do carregamento.
- Visualizacao de placa, cliente, motorista, veiculo e produto.
- Filtro por unidade/pedreira.
- Permissao somente leitura.
- Deploy no Firebase Hosting.

### Criterios De Aceite

- Carregador consegue fazer login.
- Carregador ve apenas operacoes em aberto da unidade dele.
- Carregador nao consegue alterar dados.
- Quando uma operacao e fechada no desktop e sincronizada, ela some da lista de abertos.
- Site funciona bem em tablet/celular.

### Dependencias

- Fase 7 concluida.

## 13. Fase 9 - Integracao OMIE: Cadastros E Sincronizacao

### Objetivo

Implementar a primeira parte da integracao OMIE, focada em cadastros e dados financeiros necessarios para bloquear ou liberar carregamentos.

### Entregaveis

- Cliente TypeScript para API OMIE.
- Configuracao segura de credenciais.
- Sincronizacao manual por botao no desktop.
- Sincronizacao automatica a cada 30 minutos.
- Busca de clientes.
- Busca de produtos.
- Busca de formas e condicoes de recebimento.
- Busca de limite de credito.
- Busca de contas a receber em aberto.
- Marcacao de origem do cadastro: OMIE ou KyberRock.
- Bloqueio de campos vindos do OMIE.
- Envio ao OMIE de clientes criados localmente.
- Logs de tentativa, erro e sucesso.
- Tela de pendencias e erros de sincronizacao OMIE.

### Criterios De Aceite

- Desktop consegue sincronizar clientes do OMIE.
- Desktop consegue sincronizar produtos do OMIE.
- Desktop consegue sincronizar formas/condicoes de recebimento.
- Desktop consegue buscar dados financeiros necessarios ao bloqueio.
- Campos vindos do OMIE nao podem ser alterados localmente.
- Cliente criado offline entra em fila e sincroniza depois.
- Erros OMIE aparecem no desktop com mensagem clara.
- Credenciais OMIE nao sao commitadas.

### Dependencias

- Spike OMIE da Fase 0 concluido.
- Fase 3 concluida.
- Credenciais OMIE.

## 14. Fase 10 - Regras Comerciais, Precos E Bloqueio Financeiro

### Objetivo

Implementar as regras comerciais que determinam preco, condicao de pagamento e bloqueio antes de liberar a entrada do caminhao.

### Entregaveis

- Cadastro de tabelas de preco.
- Vinculo de tabela de preco ao cliente.
- Precificacao por produto e unidade.
- Validacao de forma/condicao de recebimento do cliente.
- Regra de fechamento por periodo.
- Suporte a regra 1 a 15 vence dia 30 e 16 ao fim do mes vence dia 15 do mes seguinte.
- Calculo de saldo disponivel conforme limite OMIE e contas a receber.
- Consideracao de operacoes locais ainda nao sincronizadas no saldo disponivel.
- Bloqueio antes de liberar carregamento.
- Mensagem clara de bloqueio ao operador.

### Criterios De Aceite

- Sistema calcula valor da venda pela tabela vinculada ao cliente.
- Sistema nao usa preco da ultima venda.
- Sistema bloqueia cliente sem limite disponivel quando limite existir.
- Sistema desconsidera bloqueio quando limite estiver vazio ou zero.
- Sistema nao permite liberacao manual de excecao.
- Sistema considera operacoes locais pendentes no saldo disponivel.
- Existem testes para precificacao, vencimento e bloqueio financeiro.

### Dependencias

- Fase 9 concluida.
- Cadastros basicos disponiveis.

## 15. Fase 11 - Integracao OMIE: Pedido, Operacao Interna E Cancelamentos

### Objetivo

Enviar operacoes fechadas ao OMIE no formato correto e tratar cancelamentos/alteracoes conforme o status da integracao.

### Entregaveis

- Geracao de pedido de venda no OMIE para operacao com nota.
- Geracao de ordem de servico no OMIE para operacao interna.
- Armazenamento do ID retornado pelo OMIE.
- Fila de envio de operacoes pendentes.
- Reenvio automatico.
- Idempotencia para evitar duplicidade.
- Tela de pendencias OMIE.
- Logs de envio, erro e sucesso.
- Regra de cancelamento antes de enviar ao OMIE.
- Regra de cancelamento depois de enviar ao OMIE.
- Regra de alteracao depois de enviar ao OMIE.
- Tratamento de erro quando OMIE nao permitir cancelamento/alteracao.

### Criterios De Aceite

- Operacao com nota gera pedido de venda no OMIE.
- Operacao interna gera ordem de servico no OMIE.
- Falha de internet deixa envio pendente.
- Reenvio nao duplica pedido/ordem no OMIE.
- Operador consegue ver pendencias e erros.
- Cancelamento antes do envio nao cria pedido/ordem no OMIE.
- Cancelamento apos envio respeita retorno/regra do OMIE.
- Existem testes para fila, idempotencia e cancelamentos.

### Dependencias

- Fase 9 concluida.
- Fase 10 concluida.

## 16. Fase 12 - Relatorios E Fechamento Diario

### Objetivo

Implementar relatorios operacionais e gerenciais conforme PRD.

### Entregaveis

- Relatorio diario.
- Relatorio do mes atual.
- Relatorio do mes anterior.
- Relatorio do ano corrente.
- Relatorio por produto.
- Relatorio por cliente.
- Estrutura para relatorio por frete quando regras forem fechadas.
- Metricas de tonelagem, faturamento de produto, frete, total, carregamentos e preco medio.
- Exportacao PDF.
- Exportacao Excel.
- Impressao A4 pelo Windows.
- Cadastro de destinatarios.
- Configuracao de provedor de e-mail.
- Envio automatico do fechamento diario por e-mail as 20h.
- Log de envio do fechamento diario.

### Criterios De Aceite

- Relatorios batem com dados das operacoes fechadas.
- PDF e Excel sao gerados corretamente.
- Impressao A4 funciona no Windows.
- Fechamento diario e enviado por e-mail ao dono cadastrado.
- Falha no envio de e-mail fica registrada.
- Existem testes para agregacoes principais.

### Dependencias

- Fase 4 concluida.
- Fase 7 concluida para envio cloud/agendado.

## 17. Fase 13 - Fretes

### Objetivo

Implementar o modulo de fretes com base nas decisoes comerciais iniciais, mantendo pontos pendentes parametrizaveis.

### Entregaveis Planejados

- Frete por conta do cliente, da pedreira ou de terceiro.
- Cadastro de modalidades de frete.
- Transportadoras vindas do OMIE.
- Configuracao de frete por cliente, destino, transportadora ou regra futura.
- Calculo de frete separado do produto.
- Calculo de frete considerando distancia e peso.
- Exibicao de produto, frete e total.
- Cupom incluindo frete quando aplicavel.
- Relatorios separando faturamento de produto, frete e total.
- Integracao OMIE conforme regra fiscal definida.
- Permitir alteracao de frete depois da saida com auditoria padrao da operacao.

### Criterios De Aceite

- Sistema calcula frete conforme regra definida.
- Relatorios separam produto, frete e total.
- Cupom apresenta frete corretamente quando aplicavel.
- OMIE recebe dados de frete no formato correto.
- Existem testes para regras de frete.

### Dependencias

- Formula exata de calculo de frete definida.
- Formato OMIE para envio de frete confirmado.
- Fase 11 concluida.

## 18. Fase 14 - Seguranca, Backup, Observabilidade E Hardening

### Objetivo

Reforcar seguranca, confiabilidade, diagnostico e suporte antes do piloto real.

### Entregaveis

- Revisao de segredos e variaveis de ambiente.
- Validacao de que credenciais OMIE/Firebase nao estao no Git.
- Regras Firestore revisadas.
- Permissao do carregador somente leitura validada.
- Segregacao completa por empresa/unidade validada.
- Backup local revisado.
- Restauracao de backup testada.
- Logs tecnicos revisados.
- Logs de auditoria revisados.
- Tela de diagnostico do sistema.
- Monitoramento basico de sincronizacao.
- Rotina de exportacao de logs para suporte.
- Revisao de performance em base maior.
- Revisao de tratamento de dados sensiveis em logs e relatorios.

### Criterios De Aceite

- Dados de uma unidade nao aparecem para outra indevidamente.
- Carregador nao consegue escrever dados.
- Backup local pode ser restaurado em ambiente controlado.
- Sistema informa problemas de sync, balanca e OMIE de forma clara.
- Logs ajudam diagnostico sem expor segredos.
- Testes de seguranca/regras criticas passam.

### Dependencias

- Fases principais de operacao concluidas.

## 19. Fase 15 - Instalador, Atualizacao E Operacao Local

### Objetivo

Preparar o desktop para instalacao real no Windows da pedreira, com configuracao, atualizacao e recuperacao operacional.

### Entregaveis

- Build de producao do desktop.
- Instalador Windows com electron-builder.
- Definicao da pasta de dados local.
- Definicao da pasta de logs local.
- Configuracao inicial guiada.
- Configuracao de unidade/dispositivo.
- Configuracao da balanca por adapter.
- Configuracao da impressora por perfil Windows.
- Configuracao de Firebase.
- Configuracao de OMIE sem expor segredo no repositorio.
- Plano de atualizacao de versao.
- Plano de rollback manual.
- Checklist de instalacao.

### Criterios De Aceite

- Instalador gera app funcional no Windows.
- App instalado encontra banco local e configuracoes.
- App instalado imprime usando impressora Windows.
- App instalado le balanca no PC real por adapter configurado.
- Atualizacao de versao nao perde banco local.
- Checklist de instalacao pode ser seguido por suporte/desenvolvedor.

### Dependencias

- Fase 14 concluida.

## 20. Fase 16 - Operacao Assistida E Piloto Na Pedreira

### Objetivo

Rodar o KyberRock em ambiente real controlado antes da substituicao total do sistema antigo.

### Entregaveis

- Instalacao no PC da balanca.
- Configuracao da impressora.
- Configuracao Firebase.
- Configuracao OMIE.
- Usuarios do site do carregador.
- Testes reais de entrada, carregamento, saida e impressao.
- Testes reais de envio OMIE.
- Validacao dos relatorios.
- Periodo curto de conferencia contra a operacao atual ou conferencia manual.
- Lista de ajustes do piloto.
- Plano de corte para substituir o sistema antigo.

### Criterios De Aceite

- Operacao real consegue abrir e fechar pesagens.
- Cupom real imprime corretamente.
- Dados chegam ao OMIE.
- Site do carregador mostra operacoes abertas.
- Relatorio diario bate com a operacao.
- Falhas encontradas sao registradas e priorizadas.
- Dono/operacao aprovam corte para producao.

### Dependencias

- Fase 15 concluida.

## 21. Fase 17 - Entrada Em Producao

### Objetivo

Substituir totalmente o sistema antigo pelo KyberRock.

### Entregaveis

- Versao estavel instalada.
- Dados essenciais cadastrados/sincronizados.
- Operadores orientados.
- Carregador com acesso ao site.
- Rotina de suporte inicial.
- Checklist de contingencia.
- Monitoramento dos primeiros dias.
- Validacao diaria de sincronizacao OMIE e Firebase.
- Validacao diaria de backups.

### Criterios De Aceite

- Sistema antigo pode ser desligado da operacao principal.
- KyberRock opera pesagens reais de ponta a ponta.
- OMIE recebe operacoes corretamente.
- Relatorios sao usados como fonte operacional.
- Nenhuma venda e perdida em queda de internet.
- Backup local esta ativo.
- Suporte consegue diagnosticar falhas por logs/telas do sistema.

### Dependencias

- Piloto aprovado.

## 22. Ordem Recomendada De Execucao

1. Fase 0 - Preparacao, Spikes E Validacoes Tecnicas.
2. Fase 1 - Design Tecnico E Modelo De Dados.
3. Fase 2 - Fundacao Do Monorepo.
4. Fase 3 - Desktop Base Offline-First.
5. Fase 4 - Fluxo De Pesagem Com Balanca Simulada.
6. Fase 5 - Impressao Local No Windows.
7. Fase 6 - Integracao Real Com A Balanca.
8. Fase 7 - Firebase Base E Sincronizacao Cloud.
9. Fase 8 - Site Do Carregador.
10. Fase 9 - Integracao OMIE: Cadastros E Sincronizacao.
11. Fase 10 - Regras Comerciais, Precos E Bloqueio Financeiro.
12. Fase 11 - Integracao OMIE: Pedido, Operacao Interna E Cancelamentos.
13. Fase 12 - Relatorios E Fechamento Diario.
14. Fase 13 - Fretes.
15. Fase 14 - Seguranca, Backup, Observabilidade E Hardening.
16. Fase 15 - Instalador, Atualizacao E Operacao Local.
17. Fase 16 - Operacao Assistida E Piloto Na Pedreira.
18. Fase 17 - Entrada Em Producao.

## 23. Marcos Tecnicos

### Marco 0 - Riscos Tecnicos Validados

- Estrategia de adapters de balanca documentada.
- PC da balanca inventariado quando houver acesso.
- Balanca com protocolo identificado ou diagnostico documentado quando houver acesso ao equipamento.
- Estrategia de impressoras Windows configuraveis documentada.
- Impressora testada no Windows quando houver acesso ao equipamento real.
- OMIE mapeado pela documentacao publica e autenticado quando credenciais estiverem disponiveis.
- Riscos restantes documentados.

### Marco 1 - Espinha Dorsal Local

- Monorepo criado.
- Desktop abrindo no Windows.
- SQLite funcionando.
- Empresa/unidade/dispositivo modelados.
- Backup local funcionando.
- Operacao de pesagem simulada funcionando.
- Peso liquido calculado.
- Operacao salva localmente.
- Fila de sincronizacao criada.
- Testes das regras principais passando.

### Marco 2 - Operacao Real Integrada

- Balanca real lendo peso estavel.
- Cupom termico imprimindo.
- Firebase sincronizando operacoes em aberto.
- Site do carregador exibindo fila real.
- OMIE sincronizando cadastros.

### Marco 3 - Fechamento Comercial Completo

- Bloqueio financeiro funcionando.
- Pedido de venda OMIE funcionando.
- Operacao interna OMIE funcionando.
- Relatorios principais funcionando.
- Cancelamentos auditados e tratados.

### Marco 4 - Producao Segura

- Backup/restauracao testados.
- Instalador Windows pronto.
- Seguranca revisada.
- Piloto aprovado.
- Sistema antigo substituido.

## 24. Checklist De Execucao Por Fase

- [ ] Fase 0 - Preparacao, Spikes E Validacoes Tecnicas
- [x] Fase 1 - Design Tecnico E Modelo De Dados
- [x] Fase 2 - Fundacao Do Monorepo
- [ ] Fase 3 - Desktop Base Offline-First
- [ ] Fase 4 - Fluxo De Pesagem Com Balanca Simulada
- [ ] Fase 5 - Impressao Local No Windows
- [ ] Fase 6 - Integracao Real Com A Balanca
- [ ] Fase 7 - Firebase Base E Sincronizacao Cloud
- [ ] Fase 8 - Site Do Carregador
- [x] Fase 9 - Integracao OMIE: Cadastros E Sincronizacao
- [ ] Fase 10 - Regras Comerciais, Precos E Bloqueio Financeiro
- [x] Fase 11 - Integracao OMIE: Pedido, Operacao Interna E Cancelamentos
- [ ] Fase 12 - Relatorios E Fechamento Diario
- [ ] Fase 13 - Fretes
- [ ] Fase 14 - Seguranca, Backup, Observabilidade E Hardening
- [ ] Fase 15 - Instalador, Atualizacao E Operacao Local
- [ ] Fase 16 - Operacao Assistida E Piloto Na Pedreira
- [ ] Fase 17 - Entrada Em Producao

## 25. Definition Of Done Geral

Uma fase so deve ser considerada concluida quando:

- entregaveis foram implementados ou documentados;
- criterios de aceite foram validados;
- testes relevantes foram criados ou atualizados;
- `npm run build` passa quando existir script;
- `npm run lint` passa quando existir script;
- `npm test` passa quando existir script;
- documentacao necessaria foi atualizada;
- riscos pendentes foram registrados;
- nenhum segredo foi commitado.

## 26. Observacoes Importantes

- Credenciais OMIE, Firebase e qualquer segredo devem ficar fora do Git.
- A integracao com balanca deve ser isolada em adapters configuraveis para facilitar troca de protocolo, modelo e tipo de conexao.
- O desktop deve sempre salvar localmente antes de tentar sincronizar.
- Operacoes enviadas ao OMIE precisam de idempotencia para evitar duplicidade.
- O site do carregador deve ser somente leitura desde a primeira versao.
- Empresa, unidade e dispositivo devem existir desde o primeiro schema.
- O banco local precisa de backup e restauracao desde cedo.
- O projeto deve ter testes desde a fundacao, principalmente para regras de pesagem, precificacao, bloqueio financeiro, sincronizacao, cancelamento e seguranca.
