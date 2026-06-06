# Checklist De Aceite - Fase 0

## Ambiente De Desenvolvimento

- [x] Node.js funcionando.
- [x] npm funcionando.
- [x] Repositorio Git criado em `main`.
- [x] `.gitignore` inicial criado para segredos, banco local, logs e builds.

## PC Da Balanca

- [x] Confirmar se o ambiente atual e o PC real da balanca. Resultado: nao e o PC da balanca.
- [ ] Registrar versao do Windows do PC da balanca.
- [ ] Registrar usuario/permissoes.
- [ ] Registrar portas disponiveis.
- [ ] Registrar impressoras instaladas.
- [ ] Registrar conexao com internet.
- [ ] Confirmar caminho local para banco e logs.

## Balancas E Adapters De Leitura

- [x] Definir que a leitura de balanca sera configuravel por adapter.
- [x] Definir tipos de conexao previstos: serial, USB serial, TCP/IP, HTTP/API local, arquivo/driver e adapter especifico.
- [ ] Identificar tipo de conexao.
- [ ] Identificar porta/host.
- [ ] Identificar parametros de comunicacao.
- [ ] Capturar amostra real de leitura.
- [ ] Registrar formato da mensagem de peso.
- [ ] Validar como identificar peso estavel.
- [ ] Documentar plano tecnico se leitura real nao for possivel agora.

## Impressao Windows

- [x] Listar impressoras instaladas no ambiente atual.
- [x] Definir que a impressora sera selecionada entre impressoras instaladas no Windows.
- [x] Definir perfil configuravel para cupom 80 mm e relatorio A4.
- [ ] Confirmar impressora termica real.
- [ ] Imprimir cupom teste 80 mm.
- [ ] Validar corte, margem, fonte e legibilidade.
- [ ] Documentar impedimento, se existir.

## OMIE

- [x] Validar conectividade HTTPS com OMIE.
- [x] Registrar documentacao publica OMIE como base temporaria da integracao.
- [ ] Configurar credenciais OMIE em local seguro.
- [ ] Validar autenticacao real.
- [ ] Consultar cliente.
- [ ] Consultar produto.
- [ ] Consultar forma/condicao de recebimento.
- [ ] Consultar dados financeiros necessarios.
- [ ] Levantar campos obrigatorios para pedido de venda.
- [ ] Levantar campos obrigatorios para ordem de servico.
- [ ] Validar estrategia de idempotencia.

## Seguranca E Pendencias

- [x] Definir politica inicial de segredos.
- [x] Registrar respostas iniciais sobre frete.
- [x] Criar lista inicial de riscos.
- [ ] Fechar riscos restantes antes da implementacao principal.
