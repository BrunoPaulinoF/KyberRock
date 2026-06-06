# Checklist De Aceite - Fase 0

## Ambiente De Desenvolvimento

- [x] Node.js funcionando.
- [x] npm funcionando.
- [x] Repositorio Git criado em `main`.
- [x] `.gitignore` inicial criado para segredos, banco local, logs e builds.

## PC Da Balanca

- [ ] Confirmar se o ambiente atual e o PC real da balanca.
- [ ] Registrar versao do Windows do PC da balanca.
- [ ] Registrar usuario/permissoes.
- [ ] Registrar portas disponiveis.
- [ ] Registrar impressoras instaladas.
- [ ] Registrar conexao com internet.
- [ ] Confirmar caminho local para banco e logs.

## Balanca Toledo 950 IDLCG 2

- [ ] Identificar tipo de conexao.
- [ ] Identificar porta/host.
- [ ] Identificar parametros de comunicacao.
- [ ] Capturar amostra real de leitura.
- [ ] Registrar formato da mensagem de peso.
- [ ] Validar como identificar peso estavel.
- [ ] Documentar plano tecnico se leitura real nao for possivel agora.

## Impressao Windows

- [x] Listar impressoras instaladas no ambiente atual.
- [ ] Confirmar impressora termica real.
- [ ] Imprimir cupom teste 80 mm.
- [ ] Validar corte, margem, fonte e legibilidade.
- [ ] Documentar impedimento, se existir.

## OMIE

- [x] Validar conectividade HTTPS com OMIE.
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
- [x] Criar lista objetiva de pendencias de frete.
- [x] Criar lista inicial de riscos.
- [ ] Fechar riscos restantes antes da implementacao principal.
