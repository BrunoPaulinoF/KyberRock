export const TIPS = {
  screens: {
    dashboard:
      "Tela inicial: status do turno, KPIs do dia e pendencias que precisam de atencao agora.",
    newWeighing:
      "Captura de entrada: selecione cliente, produto acabado, placa e motorista. O peso vem direto da balanca.",
    operations:
      "Fila de pesagens: abertas, canceladas e concluidas. Feche ou cancele aqui as entradas capturadas.",
    scale:
      "Diagnostico da balanca: porta serial, leitura ao vivo e calibracao. Use para conferir a conexao com o hardware.",
    registrations:
      "Cadastros: clientes, produtos, condicoes de pagamento e transporte.",
    printing:
      "Impressao: selecione a impressora Windows que recebera os cupons de 80 mm apos cada pesagem.",
    cloud:
      "Sincronizacao dos dados com a nuvem. Dispare envios manuais se precisar.",
    insights:
      "Insights: KPIs, graficos de peso por dia, top produtos e mix de operacoes no periodo.",
    reports: "Relatorios: cadastre destinatarios que receberao os relatorios automaticos por e-mail.",
    documentation: "Documentacao do produto (em breve)."
  },
  nav: {
    panel: "Painel inicial com KPIs e pendencias do turno. Atalho: F1.",
    newEntry: "Captura uma nova pesagem de entrada. Atalho: F2.",
    operations: "Veja, feche ou cancele pesagens abertas, canceladas e concluidas. Atalho: F3.",
    registrations: "Cadastros de clientes, produtos, precos e transporte. Atalho: F4.",
    insights: "KPIs, graficos e status de sincronizacao. Atalho: F5.",
    scale: "Diagnostico e leitura da balanca. Atalho: F6.",
    printing: "Configure a impressora de cupom de 80 mm. Atalho: F7.",
    cloud: "Sincronizacao de dados com a nuvem. Atalho: F8.",
    reports: "Destinatarios dos relatorios automaticos por e-mail.",
    documentation: "Documentacao do produto (em breve)."
  },
  header: {
    theme: "Alterna entre tema claro e escuro. Atalho: F11.",
    settings: "Abrir configuracoes: balanca, impressao, cloud, logs, backup e sair.",
    settingsScale: "Abrir a tela de diagnostico da balanca.",
    settingsPrinting: "Configurar a impressora de cupom 80 mm.",
    settingsCloud: "Abrir sincronizacao de dados com a nuvem.",
    settingsLogs: "Ver logs de erro e aviso capturados pelo aplicativo. Atalho: F10.",
    settingsExport: "Exportar um backup do banco local para um arquivo .sqlite3.",
    settingsRestore: "Restaurar um backup do banco local.",
    settingsLogout: "Sair da conta atual (exige novo codigo de ativacao para voltar).",
    syncNow: "Enviar dados pendentes para a nuvem agora.",
    connectivity: "Status de internet e sincronizacao. Clique em Sincronizar para enviar pendentes."
  },
  dashboard: {
    newEntry: "Iniciar uma nova pesagem de entrada (F2).",
    insights: "Abrir a tela de insights com KPIs e graficos (F5).",
    recent: "Ultimas pesagens. Clique para abrir a lista completa.",
    pending: "Pendencias que pedem atencao: pesagens paradas, faturamento pendente e logs."
  },
  insights: {
    period: "Muda o periodo de analise dos KPIs e graficos.",
    exportPdf: "Exporta um relatorio em PDF para o periodo selecionado.",
    exportExcel: "Exporta a planilha detalhada em Excel para o periodo selecionado.",
    syncCloud: "Envia dados pendentes para a nuvem.",
    syncOmie: "Atualiza clientes e produtos."
  },
  operations: {
    filterPeriod: "Filtra canceladas por periodo: hoje, 7 dias, mes atual ou todas.",
    filterProduct: "Filtra operacoes concluidas por produto.",
    clearCanceled: "Apaga da lista todas as operacoes canceladas (somente a lista, o historico fica).",
    close: "Fecha a pesagem: captura a saida e finaliza a operacao (fiscal ou interna).",
    cancel: "Cancela esta pesagem. O motivo fica registrado para auditoria.",
    retryOmie: "Reenvia o faturamento de uma operacao que falhou."
  },
  printing: {
    selectPrinter: "Escolha a impressora Windows que vai emitir os cupons de 80 mm.",
    saveProfile: "Salva a impressora selecionada como perfil padrao de cupom.",
    testPrint: "Imprime um cupom de exemplo para confirmar que a impressora esta pronta.",
    reprint: "Reemite uma segunda via do cupom para o cliente."
  },
  cloud: {
    syncNow: "Envia os dados pendentes para a nuvem.",
    syncOmie: "Atualiza pedidos, clientes e produtos.",
    omieLoop: "Busca todos os registros restantes ainda nao trazidos."
  },
  activation: {
    code: "Codigo de 6 digitos gerado pelo admin no painel web. Necessario no primeiro acesso.",
    deviceName: "Apelido do equipamento para identificar este desktop no admin.",
    retry: "Tenta validar o acesso novamente com a internet.",
    diagnostic: "Volta para a tela de ativacao para inserir um novo codigo.",
    export: "Exporta um backup do banco local antes de tentar novamente."
  },
  update: {
    available: "Ha uma nova versao do KyberRock Desktop. Recomenda-se atualizar para receber melhorias e correcoes.",
    now: "Baixa e instala a atualizacao agora (o app sera reiniciado).",
    later: "Continua usando esta versao; o app tentara novamente em 30 minutos."
  },
  logs: {
    clear: "Limpar os logs de erro e aviso capturados nesta sessao."
  },
  form: {
    start: "Captura o peso atual da balanca usando os criterios configurados e abre a operacao de entrada.",
    cancel: "Limpa o formulario e volta para a tela inicial.",
    operationType: "Tipo da operacao na saida: com nota fiscal ou interna (sem nota).",
    confirmClose: "Fecha a operacao conforme o tipo selecionado.",
    back: "Volta para a tela anterior sem fechar a operacao."
  },
  generic: {
    save: "Grava as alteracoes no banco local.",
    cancel: "Descarta as alteracoes e fecha.",
    delete: "Exclui este registro (pede confirmacao antes).",
    edit: "Edita este registro.",
    close: "Fecha esta janela ou modal."
  }
} as const;
