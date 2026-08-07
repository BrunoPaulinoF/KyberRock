import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Banknote,
  Cloud,
  FileText,
  HandCoins,
  Laptop,
  ListChecks,
  Printer,
  Receipt,
  Route,
  Scale,
  ShieldCheck,
  Truck,
  Users,
  Wallet
} from "lucide-react";

// ---------------------------------------------------------------------------
// Conteudo da central de ajuda.
//
// Este modulo e so DADOS: nenhuma renderizacao, nenhum estado. Ele existe
// separado da tela por dois motivos: (1) a busca e o assistente precisam
// varrer o mesmo corpo de texto sem montar React, e (2) o texto e o produto
// aqui — quem for corrigir uma duvida operacional mexe num arquivo de
// conteudo, nao num componente de 2 mil linhas.
//
// Convencao de escrita (mantida do arquivo original): portugues SEM acentos.
// A busca normaliza acentos dos dois lados, entao o operador pode digitar
// "sincronização" e achar "sincronizacao" — mas manter o fonte sem acento
// evita que a mesma palavra apareca escrita de duas formas no corpus.
//
// Toda entrada carrega `keywords` com as PALAVRAS e as FRASES que o operador
// digita de verdade ("nao consigo faturar", "cliente bloqueado"), nao os
// termos que o desenvolvedor usaria. E isso que faz a barra de pesquisa
// responder a frase inteira, e nao so a palavra solta.
// ---------------------------------------------------------------------------

export type DocumentationTabId =
  | "start"
  | "guides"
  | "faq"
  | "troubleshoot"
  | "glossary"
  | "support";

export interface DocumentationSection {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  icon: LucideIcon;
  steps: string[];
  details: string[];
  keywords: string[];
}

export type DocumentationFaqCategory =
  | "operacao"
  | "balanca"
  | "impressao"
  | "cloud"
  | "omie"
  | "financeiro"
  | "seguranca";

export interface DocumentationFaq {
  question: string;
  answer: string;
  category: DocumentationFaqCategory;
  keywords: string[];
  /** Guia que aprofunda o assunto (usado pela busca e pelo assistente). */
  sectionId?: string;
}

export interface QuickStartTask {
  id: string;
  label: string;
  description: string;
  sectionId: string;
}

export interface OperationFlowStage {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  sectionId: string;
}

export interface TroubleshootingFlow {
  id: string;
  title: string;
  symptom: string;
  icon: LucideIcon;
  checks: string[];
  escalation: string;
  keywords: string[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  keywords: string[];
  sectionId?: string;
}

// ---------------------------------------------------------------------------
// Guias
// ---------------------------------------------------------------------------

export const documentationSections: DocumentationSection[] = [
  {
    id: "overview",
    title: "Como o KyberRock funciona",
    eyebrow: "Visao geral",
    summary:
      "O KyberRock controla a operacao da balanca: registra a entrada do caminhao, acompanha o carregamento, fecha a saida com o peso da balanca, imprime o cupom, sincroniza com a nuvem e envia o pedido ao OMIE.",
    icon: Laptop,
    steps: [
      "Ative o desktop com o codigo de 6 digitos da empresa/unidade na primeira abertura.",
      "Configure balanca, impressora e nuvem pela engrenagem no rodape da barra lateral.",
      "Confira os cadastros: clientes, produtos, condicoes de pagamento, veiculos, motoristas, transportadoras e precos.",
      "Registre a entrada do caminhao em Nova entrada (F2).",
      "Acompanhe o carregamento em Operacoes (F3) e feche a saida com o peso capturado da balanca.",
      "Confira pendencias no Painel (F1), em Insights (F5) e na tela Cloud (F8)."
    ],
    details: [
      "O desktop e offline-first: toda operacao nasce e fecha no banco local, e a sincronizacao vem depois. Ficar sem internet nao para a balanca.",
      "A nuvem e uma projecao do que ja aconteceu aqui. Ela nunca e a origem da operacao viva — se a nuvem e o desktop divergirem, o desktop e quem manda.",
      "O peso sempre vem da balanca configurada. O sistema nao foi desenhado para digitar peso na mao.",
      "Atalhos: F1 Painel, F2 Nova entrada, F3 Operacoes, F4 Cadastros, F5 Insights, F6 Balanca, F7 Impressao, F8 Cloud, F9 OMIE sync, F10 Logs, F11 tema claro/escuro, Esc volta, Ctrl+Enter confirma.",
      "Cada acao importante deixa rastro: entrada, saida, edicao, cancelamento, reimpressao e sincronizacao ficam registrados para auditoria.",
      "Varios computadores podem operar na mesma pedreira ao mesmo tempo. Cada um tem sua ativacao e seu numero de dispositivo; as listas se atualizam entre eles a cada 15 segundos."
    ],
    keywords: [
      "inicio",
      "primeiros passos",
      "como funciona o kyberrock",
      "visao geral",
      "desktop",
      "offline",
      "sem internet",
      "auditoria",
      "atalhos",
      "teclas de atalho",
      "f1 f2 f3",
      "multiplos computadores",
      "duas balancas"
    ]
  },
  {
    id: "weighing",
    title: "Fluxo de pesagem: entrada, carregamento e saida",
    eyebrow: "Operacao diaria",
    summary:
      "Nova entrada abre a operacao com o caminhao vazio, o carregador carrega no patio e o fechamento da saida calcula o peso liquido, o valor e o cupom.",
    icon: Truck,
    steps: [
      "Em Nova entrada, escolha o tipo da saida: com nota fiscal (pedido de venda no OMIE) ou interna (ordem de servico, sem nota).",
      "Informe placa, cliente, motorista, produto, forma e condicao de pagamento e a tabela de preco quando houver.",
      "Defina o frete quando existir: por conta do cliente, da pedreira ou de terceiro, e se ele aparece no cupom.",
      "Aguarde o peso estabilizar e capture a entrada. O sistema so aceita a captura com a balanca estavel.",
      "Depois do carregamento, abra Operacoes, busque pela placa e use Fechar para capturar a saida.",
      "Confira peso liquido, valor, credito, frete e transporte antes de confirmar. Ao confirmar, o cupom sai e o pedido vai para a fila do OMIE."
    ],
    details: [
      "O peso liquido e a diferenca entre a saida e a entrada. Saida menor ou igual a entrada e erro: corrija antes de fechar.",
      "Na fila de operacoes abertas, as cargas ja concluidas pelo carregador sobem para o topo, na ordem em que ele concluiu.",
      "Se a mesma placa ja estiver aberta, o sistema avisa para evitar duplicidade — confirme se nao e a mesma viagem.",
      "Duplo clique na linha (ou o botao de ficha) abre a operacao inteira. Com a operacao em andamento, Editar operacao libera cliente, produto, preco por tonelada, frete, placa, motorista, transportadora, forma e condicao de pagamento e o tipo de fechamento.",
      "Alterar o preco pede a senha de 4 digitos definida pela empresa. Depois de fechada, a ficha continua abrindo, mas so para consulta.",
      "Cancelar exige motivo. O cancelamento e auditado, estorna credito quando aplicavel e cancela o pedido no OMIE se ele ja tiver subido — desde que ainda nao esteja faturado.",
      "A busca das operacoes concluidas aceita cliente, CNPJ/CPF com ou sem pontuacao, produto, placa ou motorista."
    ],
    keywords: [
      "pesagem",
      "entrada",
      "saida",
      "fechar operacao",
      "como fechar a pesagem",
      "peso liquido",
      "tara",
      "placa",
      "caminhao",
      "cancelar pesagem",
      "editar operacao",
      "corrigir operacao",
      "duplo clique",
      "operacao interna",
      "com nota fiscal",
      "sem nota"
    ]
  },
  {
    id: "omie-billing",
    title: "Faturar e emitir a nota no OMIE",
    eyebrow: "Guia do OMIE",
    summary:
      'O KyberRock fecha a pesagem e envia o pedido para o OMIE ja na etapa "Faturar". A emissao da NF-e acontece dentro do OMIE, em poucos cliques — este guia mostra o caminho completo.',
    icon: Receipt,
    steps: [
      'Feche a operacao no KyberRock. Na operacao fiscal ele cria um PEDIDO DE VENDA no OMIE na etapa "Faturar"; na operacao interna ele cria uma ORDEM DE SERVICO, tambem na etapa "Faturar".',
      "Confira na tela Cloud (F8) ou no Painel se o envio saiu da fila. Sem internet o pedido fica aguardando e sobe sozinho quando a conexao voltar.",
      'No OMIE, abra Vendas > Pedidos de Venda (para operacao interna: Servicos > Ordens de Servico) e va ate a coluna/etapa "Faturar".',
      "Abra o pedido e confira cliente, produto, quantidade em toneladas, valor unitario, frete, condicao de pagamento e a categoria/conta corrente.",
      'Clique em Faturar. O OMIE gera a NF-e, envia para a SEFAZ e move o pedido para a etapa "Faturado".',
      "Depois de autorizada, imprima ou envie o DANFE ao cliente. O OMIE envia a NF-e automaticamente para os e-mails cadastrados na aba Fiscal do cliente.",
      "Confira em Financeiro > Contas a Receber se as parcelas nasceram com o vencimento e a forma de recebimento corretos."
    ],
    details: [
      "Divisao de responsabilidade: o KyberRock e dono da pesagem, do preco, do cupom, do frete e dos veiculos/motoristas. O OMIE e dono do cadastro de clientes, produtos, condicoes de pagamento e de tudo que e fiscal e financeiro. Campos controlados pelo OMIE ficam bloqueados aqui para nao divergirem.",
      'Para a NF-e sair, o cadastro do cliente no OMIE precisa de CNPJ/CPF, NUMERO DO ENDERECO e E-MAIL. Sao esses dois ultimos que mais travam o faturamento: sem eles o OMIE recusa e a operacao fica com o aviso "Cadastro incompleto".',
      "Cada envio ao OMIE carrega uma chave de idempotencia propria da operacao. Reenviar NUNCA duplica o pedido: o OMIE reconhece a chave e devolve o pedido que ja existe.",
      "A operacao interna nao emite NF-e. Ela vira ordem de servico para o controle interno e para o financeiro; se a pedreira quiser nota de servico, ela e emitida no proprio OMIE a partir da OS.",
      "O valor do frete cobrado pela pedreira vai no bloco de frete do pedido de venda. Na ordem de servico, como nao existe bloco de frete, ele entra como uma segunda linha de servico.",
      'A forma de pagamento escolhida na entrada define o comportamento no OMIE: dinheiro, PIX, cartoes e boleto geram cobranca normal; "Em carteira" e "Bonificacao" sobem como "99 - outros" e sem boleto, entao a nota sai mas nenhuma cobranca nasce dela.',
      "Se o pedido ja foi faturado e a NF emitida, o KyberRock nao consegue mais cancelar sozinho: o estorno tem que ser feito no OMIE (cancelamento da NF-e dentro do prazo legal ou nota de devolucao).",
      'Botao "Reenviar/Refaturar" na operacao concluida: ele reprocessa o envio pendente da operacao. Na operacao fiscal ele recria e fatura o pedido; na interna ele reenvia a ordem de servico. Use depois de corrigir o cadastro do cliente.'
    ],
    keywords: [
      "omie",
      "faturar",
      "faturamento",
      "como faturar no omie",
      "emitir nota fiscal",
      "como emitir nota",
      "nfe",
      "nf-e",
      "nota fiscal eletronica",
      "danfe",
      "pedido de venda",
      "ordem de servico",
      "etapa faturar",
      "sefaz",
      "contas a receber",
      "cadastro incompleto",
      "numero do endereco",
      "email da nota",
      "refaturar",
      "reenviar ao omie",
      "cancelar nota"
    ]
  },
  {
    id: "payments",
    title: "Formas e condicoes de pagamento",
    eyebrow: "Como o cliente paga",
    summary:
      "A forma de pagamento diz COMO o cliente paga; a condicao diz QUANDO. As duas descem juntas para o pedido do OMIE e definem as parcelas em Contas a Receber.",
    icon: Banknote,
    steps: [
      "Na entrada, escolha a forma de pagamento do cliente: dinheiro, PIX, cartao de credito, cartao de debito, boleto, credito do cliente (fiado), em carteira ou bonificacao.",
      "Escolha a condicao de pagamento: a vista ou parcelada (por exemplo 9/18/27 dias). As condicoes sincronizadas do OMIE aparecem na lista.",
      "Se a condicao exata nao existir, use o parcelamento manual e digite os dias de vencimento separados por barra.",
      "Confira na ficha da operacao se as parcelas ficaram como o combinado antes de fechar.",
      "Depois do faturamento, confira as parcelas em Financeiro > Contas a Receber no OMIE."
    ],
    details: [
      "Dinheiro, PIX, cartoes e boleto viram cobranca normal no OMIE, cada um na conta corrente vinculada a forma (por exemplo dinheiro na Caixinha, PIX e boleto na conta principal, cartoes na conta da adquirente).",
      "Boleto: o OMIE so gera o boleto na parcela. Por isso, em boleto o KyberRock sempre manda os vencimentos digitados na operacao, mesmo quando ha condicao vinculada.",
      '"Credito do cliente" (fiado) consome o saldo/limite do cliente no ato — veja o guia de credito.',
      '"Em carteira" fecha a venda sem definir o recebimento: a nota sai, nenhuma cobranca nasce ainda e a venda espera na tela Carteira ate voce fechar com o cliente.',
      '"Bonificacao" emite a nota da mercadoria bonificada e nao gera cobranca nenhuma. Ela e lancada na conta BONIFICACAO para nao se misturar com a receita.',
      "Meios de pagamento e contas correntes vem do OMIE. Localmente so da para ativar/desativar, dar um apelido e escolher a conta vinculada a forma."
    ],
    keywords: [
      "forma de pagamento",
      "condicao de pagamento",
      "parcelamento",
      "parcelas",
      "a vista",
      "prazo",
      "9/18/27",
      "dinheiro",
      "pix",
      "cartao",
      "boleto",
      "bonificacao",
      "vencimento",
      "conta corrente",
      "como parcelar"
    ]
  },
  {
    id: "credit",
    title: "Credito do cliente (fiado) e bloqueio financeiro",
    eyebrow: "Financeiro",
    summary:
      'A forma "Credito do cliente" e a venda fiado: ela consome saldo ou limite do cliente no fechamento e volta em caso de cancelamento.',
    icon: HandCoins,
    steps: [
      "Confira o saldo e o limite do cliente no cadastro antes de liberar a carga.",
      'Na entrada, escolha a forma "Credito do cliente" para vender no fiado.',
      "Feche a operacao normalmente: o valor e debitado do credito no fechamento.",
      "Para clientes pre-pagos, confira se ha adiantamento suficiente lancado no OMIE antes de carregar.",
      "Se o sistema bloquear, confira limite, titulos em aberto no OMIE e operacoes locais ainda nao sincronizadas."
    ],
    details: [
      "O bloqueio financeiro soma tres coisas: os titulos em aberto no OMIE, o limite de credito do cadastro e as operacoes fechadas AQUI que ainda nao subiram. Por isso um cliente pode bloquear mesmo com o OMIE aparentemente limpo — sao as cargas de hoje que ainda nao sincronizaram.",
      "Adiantamentos lancados no OMIE viram saldo de credito aqui quando a sincronizacao roda. Se o adiantamento acabou de ser lancado, sincronize antes de tentar de novo.",
      "Cancelar uma operacao paga com credito estorna o valor para o cliente.",
      'Cliente que pagou adiantado e vai retirando aos poucos nao precisa ser pre-pago: venda "Em carteira" e marque "Abater do adiantamento do cliente" na entrada — veja o guia da carteira.',
      "Liberar credito e decisao do financeiro, nao da balanca: ajuste o limite ou de baixa nos titulos no OMIE e sincronize.",
      "Frete pode ser descontado do credito do cliente quando a operacao estiver configurada assim."
    ],
    keywords: [
      "credito",
      "fiado",
      "limite de credito",
      "cliente bloqueado",
      "bloqueio financeiro",
      "saldo",
      "adiantamento",
      "pre-pago",
      "contas a receber",
      "inadimplente",
      "nao consigo carregar o cliente",
      "estorno"
    ]
  },
  {
    id: "wallet",
    title: "Vendas em carteira",
    eyebrow: "Recebimento definido depois",
    summary:
      'A forma "Em carteira" fecha a venda sem dizer como o cliente vai pagar: ela fica na tela Carteira ate o fechamento, quando voce escolhe a forma e o vencimento.',
    icon: Wallet,
    steps: [
      'Na entrada, escolha "Em carteira" quando o pagamento ficar para um acerto futuro.',
      'Se o cliente ja pagou adiantado, marque tambem "Abater do adiantamento do cliente" — a tela mostra quanto ele ainda tem depositado.',
      "Feche a operacao normalmente: a nota sai, mas o OMIE nao gera cobranca ainda.",
      "Abra Carteira na barra lateral para ver as vendas em aberto agrupadas por cliente.",
      "Selecione as vendas do cliente, escolha a forma de recebimento e o vencimento combinado e clique em Fechar.",
      'Use "Reabrir fechamento" se a forma tiver sido lancada errada.'
    ],
    details: [
      'A venda em carteira vai ao OMIE como meio "99 - outros" e com o boleto desativado: a cobranca so nasce depois do fechamento.',
      "Diferente do credito do cliente (fiado), a carteira nao consome limite nem saldo do cadastro, e o fechamento e manual.",
      "A forma 'Em carteira' e compartilhada entre as balancas, mas o fechamento fica no computador que o registrou.",
      "Use a carteira para o cliente que compra varias cargas na semana e acerta tudo de uma vez.",
      'Cliente que pagou adiantado: com "Abater do adiantamento" marcado, o fechamento desconta a compra do que ele tem depositado e baixa esse valor no OMIE, na conta de adiantamento de clientes.',
      "Com a caixa marcada, o adiantamento daquele cliente e conferido no OMIE na hora de capturar o peso (na entrada e na saida) — nao e preciso sincronizar a mao antes de carregar. Sem internet a pesagem acontece do mesmo jeito, usando o saldo ja espelhado.",
      "Se a compra passar do adiantamento, o sistema abate o que da e deixa a diferenca em carteira, esperando o fechamento normal; se o adiantamento cobrir tudo, a venda ja sai quitada.",
      'Na tela Carteira, a coluna "Adiantamento" mostra quanto saiu do deposito do cliente e a coluna "A receber" mostra o que ainda falta cobrar.',
      "Venda quitada pelo adiantamento nao pode ser reaberta: para desfazer, cancele a operacao — o adiantamento volta para o saldo do cliente."
    ],
    keywords: [
      "carteira",
      "em carteira",
      "fechamento de carteira",
      "acerto",
      "recebimento",
      "cobranca depois",
      "reabrir fechamento",
      "venda em aberto",
      "adiantamento",
      "pagou adiantado",
      "abater do adiantamento",
      "pagamento antecipado",
      "deixou pago"
    ]
  },
  {
    id: "freight",
    title: "Frete: quem paga e como cobrar",
    eyebrow: "Transporte",
    summary:
      "O frete define quem paga o transporte e, quando a pedreira cobra, quanto entra no valor da operacao e na nota.",
    icon: Route,
    steps: [
      "Na entrada, escolha a modalidade: por conta do cliente, por conta da pedreira ou por conta de terceiro.",
      "Marque se a pedreira lanca valor de frete nesta operacao — isso habilita os campos de valor.",
      "Escolha o tipo de calculo: por tonelada, por tonelada/km ou fixo mais tonelada, e informe distancia e destino quando usar km.",
      "Decida se o valor do frete aparece no cupom do motorista.",
      "Confira o total antes de fechar: o frete entra no pedido do OMIE junto com a mercadoria."
    ],
    details: [
      "Regras de frete por cliente e produto podem ser cadastradas para nao redigitar valor a cada carga.",
      "No pedido de venda o frete vai no bloco de frete da nota, com a placa, a UF de emplacamento e a transportadora.",
      "Na operacao interna nao existe bloco de frete na ordem de servico: o valor entra como uma segunda linha de servico, com a descricao do frete.",
      "O frete pode ser descontado do credito do cliente quando a operacao estiver marcada assim.",
      "Veiculo proprio do cliente, transportadora contratada e terceiro mudam o que sai na nota — confira o vinculo do veiculo com a transportadora no cadastro."
    ],
    keywords: [
      "frete",
      "transporte",
      "quem paga o frete",
      "frete por conta do cliente",
      "cif",
      "fob",
      "frete por tonelada",
      "km",
      "distancia",
      "transportadora",
      "valor do frete no cupom"
    ]
  },
  {
    id: "scale",
    title: "Integrar e diagnosticar a balanca",
    eyebrow: "Hardware",
    summary:
      "A balanca e configurada em Configuracoes > Balanca (F6). Escolha o tipo de conexao — Rede/IP, USB, Serial (COM) ou Virtual — e informe apenas os dados dessa conexao.",
    icon: Scale,
    steps: [
      "Abra a engrenagem no rodape da barra lateral e escolha Balanca (ou tecle F6).",
      "Escolha o tipo de conexao: Rede (IP), USB, Serial (COM) ou Virtual (somente teste).",
      'Rede (IP): informe o IP e a porta do indicador, ou use "Procurar balanca na rede".',
      'USB ou Serial (COM): selecione a porta na lista (use "Atualizar portas" se ela nao aparecer) e a velocidade — o padrao e 9600.',
      'Clique em Conectar e use "Testar captura de peso" antes de operar.',
      "Confira na leitura ao vivo se o peso do sistema bate com o do visor do indicador."
    ],
    details: [
      "Ao capturar, o sistema espera a balanca estabilizar e grava o valor exibido naquele momento. Nao ha media nem calculo em cima da leitura.",
      "Peso instavel quase sempre e caminhao ainda em movimento, vento, vibracao, plataforma encostando na estrutura ou cabo/rede com falha.",
      "Nenhum outro programa pode estar conectado na mesma porta serial: dois programas na mesma COM derrubam a leitura.",
      "A balanca Virtual existe para treinamento e teste. Nunca use em operacao real — os pesos sao digitados, nao lidos.",
      "Se a balanca falhar, pare a operacao e corrija a conexao. Nao existe caminho para lancar peso manualmente."
    ],
    keywords: [
      "balanca",
      "indicador",
      "toledo",
      "nao conecta",
      "peso oscilando",
      "peso nao estabiliza",
      "tcp",
      "ip",
      "porta",
      "usb",
      "serial",
      "com1",
      "baud rate",
      "9600",
      "captura de peso",
      "balanca virtual",
      "teste"
    ]
  },
  {
    id: "printing",
    title: "Impressao do cupom e dos relatorios",
    eyebrow: "Cupom 80 mm e A4",
    summary:
      "Configure a impressora em Configuracoes > Impressao (F7) para emitir o cupom termico de 80 mm da pesagem e os relatorios em A4.",
    icon: Printer,
    steps: [
      "Instale a impressora no Windows e confirme que ela imprime uma pagina de teste pelo proprio Windows.",
      "No KyberRock, abra a engrenagem e escolha Impressao (ou tecle F7).",
      "Selecione a impressora e salve o perfil de cupom.",
      "Use o teste de impressao para validar papel, margem e tamanho antes da primeira carga.",
      "Ao fechar a pesagem, o cupom sai sozinho e vai para o motorista.",
      "Precisa de outra via? Use a reimpressao: o cupom sai marcado como copia."
    ],
    details: [
      "Falha de impressao NAO desfaz a operacao. A pesagem fechada continua salva; corrija a impressora e reimprima.",
      "O cupom traz o codigo da operacao (COD), dados da pedreira, cliente, produto, pesos de entrada, saida e liquido, valor, frete, veiculo, motorista e assinatura.",
      'A linha "COD" e o codigo da operacao; "COPIA NRO" conta quantas vias ja sairam. Nao confunda os dois.',
      "A logo do cupom e convertida para preto e branco na impressao. Logo muito clara pode sumir no papel — o sistema avisa quando detecta isso.",
      "Para relatorios em A4, confira a impressora padrao do Windows: eles usam o caminho de impressao normal, nao a termica."
    ],
    keywords: [
      "impressora",
      "impressao",
      "cupom",
      "80mm",
      "termica",
      "nao imprime",
      "segunda via",
      "reimprimir",
      "reimpressao",
      "copia",
      "papel",
      "driver",
      "a4",
      "logo do cupom"
    ]
  },
  {
    id: "cloud",
    title: "Nuvem, fila de sincronizacao e ativacao",
    eyebrow: "Sincronizacao",
    summary:
      "A nuvem recebe as operacoes fechadas, alimenta o site do carregador e faz a ponte com o OMIE. Tudo que nao sobe na hora fica numa fila local e sobe depois.",
    icon: Cloud,
    steps: [
      "Ative o desktop com o codigo de 6 digitos da unidade (o admin gera no painel web).",
      "Abra a engrenagem e escolha Cloud (F8) para ver status, fila e pendencias.",
      'Use "Sincronizar agora" quando houver pendencia ou logo depois da internet voltar.',
      "Acompanhe a fila do OMIE na mesma tela: da para enviar um item agora, corrigir o cadastro que travou o envio ou excluir o item da fila.",
      "Monitore erros em Cloud, no Painel e nos Logs (F10)."
    ],
    details: [
      "A fila reenvia sozinha, com espera crescente entre as tentativas (de 1 minuto ate 15). Ela nao fica martelando o OMIE quando ele esta fora do ar.",
      "Falha que depende de correcao humana (cadastro incompleto, por exemplo) NAO gasta tentativa: o item fica parado esperando a correcao, com o motivo na tela.",
      "O desktop tem um periodo de tolerancia offline apos a ultima validacao online. Passado esse prazo ele pede internet para revalidar a licenca.",
      "Sobem para a nuvem: operacoes abertas, fechadas e canceladas, cupons, cadastros locais e os pedidos destinados ao OMIE.",
      "As credenciais do OMIE ficam SOMENTE no painel administrativo/nuvem. Nunca configure App Key e App Secret no computador da balanca.",
      "Excluir um item da fila cancela o envio ao OMIE, mas nao apaga a operacao local — ela continua nos relatorios daqui."
    ],
    keywords: [
      "cloud",
      "nuvem",
      "sincronizacao",
      "sincronizar agora",
      "fila",
      "pendente",
      "nao sincroniza",
      "offline",
      "sem internet",
      "ativacao",
      "codigo de 6 digitos",
      "licenca",
      "app key",
      "app secret"
    ]
  },
  {
    id: "registrations",
    title: "Cadastros, precos e tabelas",
    eyebrow: "Dados mestres",
    summary:
      "A tela Cadastros (F4) reune clientes, produtos, condicoes de pagamento, veiculos, motoristas, transportadoras e as tabelas de preco usadas na operacao.",
    icon: Users,
    steps: [
      "Abra Cadastros pela barra lateral (F4).",
      "Revise os clientes que vieram do OMIE e crie clientes locais quando a venda nao puder esperar o cadastro no OMIE.",
      "Confira produtos e condicoes de pagamento — os dois vem do OMIE.",
      "Cadastre veiculos, motoristas e transportadoras e faca os vinculos (veiculo x transportadora, motorista x transportadora, cliente x transportadora).",
      "Configure o preco padrao por produto e, quando houver, o preco especial por cliente ou a tabela de preco vinculada.",
      "Antes de operar, confirme documento, telefone, e-mail da nota, numero do endereco e situacao financeira do cliente."
    ],
    details: [
      "Campos controlados pelo OMIE ficam bloqueados para edicao local. Quando a correcao e urgente e o envio esta travado, o sistema permite sobrescrever e empurra a correcao ao OMIE na proxima sincronizacao.",
      "Cliente novo criado aqui sobe para o OMIE na sincronizacao. Ele nao e criado duas vezes: o sistema guarda o codigo do OMIE assim que ele responde.",
      "A ordem de preco e: preco especial do cliente, depois tabela de preco vinculada, depois preco padrao do produto.",
      "Alterar preco na operacao pede a senha de 4 digitos da empresa.",
      "A busca de CNPJ preenche razao social, endereco e telefone a partir da base publica. O e-mail quase nunca vem — preencha na mao, porque ele e obrigatorio para a NF-e.",
      "Existe importacao de clientes por planilha para a carga inicial; peca ao suporte quando for migrar de outro sistema."
    ],
    keywords: [
      "cadastro",
      "cliente",
      "novo cliente",
      "produto",
      "preco",
      "tabela de preco",
      "preco especial",
      "veiculo",
      "placa",
      "motorista",
      "transportadora",
      "cnpj",
      "cpf",
      "senha do preco",
      "importar clientes"
    ]
  },
  {
    id: "loader",
    title: "Site do carregador",
    eyebrow: "Operacao de patio",
    summary:
      "O carregador usa um site simples para ver os carregamentos em aberto da unidade e marcar o que ja carregou, sem mexer em peso nem em valor.",
    icon: ListChecks,
    steps: [
      "O administrador cria o usuario do carregador vinculado a unidade correta.",
      "O carregador acessa o site, entra com o login autorizado e ve somente a sua unidade.",
      "A lista mostra placa, cliente, motorista, veiculo e produto das operacoes em aberto.",
      "Ao concluir a carga, o carregador marca no site e a operacao sobe para o topo da fila do desktop.",
      "Se uma operacao nao aparecer, confira internet, unidade vinculada e a fila de sincronizacao do desktop."
    ],
    details: [
      "O carregador nao altera peso, preco nem dado financeiro: o acesso e de leitura, com a marcacao de carga concluida.",
      "Os dados sao segregados por empresa e unidade — um carregador nunca ve outra pedreira.",
      "Carregadores nao se cadastram sozinhos: o acesso e controlado pelo administrador.",
      "A tela do carregador depende da nuvem. Se o desktop estiver offline, a operacao so aparece la depois da sincronizacao."
    ],
    keywords: [
      "carregador",
      "loader",
      "site do carregador",
      "patio",
      "pa carregadeira",
      "nao aparece no site",
      "login do carregador",
      "carga concluida"
    ]
  },
  {
    id: "reports",
    title: "Painel, insights e relatorios",
    eyebrow: "Gestao",
    summary:
      "Painel, Insights, Controle de caminhoes, Relatorio por cliente e Relatorios cobrem o acompanhamento do dia e o fechamento por e-mail.",
    icon: FileText,
    steps: [
      "Abra o Painel (F1) para o status do turno, os KPIs do dia e as pendencias que precisam de atencao agora.",
      "Use Insights (F5) para peso por dia, top produtos, mix de operacoes e exportacao em PDF ou Excel do periodo.",
      "Use Controle de caminhoes para acompanhar as viagens do periodo.",
      "Use Relatorio por cliente para gerar o relatorio simplificado e/ou completo de um cliente em PDF e/ou Excel.",
      "Em Relatorios, cadastre quem recebe o fechamento diario por e-mail e, no card do relatorio financeiro (OMIE), quem recebe o resumo financeiro e em que horario."
    ],
    details: [
      "O fechamento diario e montado e enviado pela nuvem, entao ele nao depende do computador da balanca estar ligado no horario.",
      "O relatorio financeiro do OMIE tem horario proprio, separado do fechamento operacional.",
      "Relatorios usam os dados locais e os ja sincronizados. Pendencia de sincronizacao pode atrasar a consolidacao externa.",
      "Operacoes canceladas saem dos insights e dos relatorios, mas continuam auditaveis com motivo e horario.",
      "Limpar concluidas apaga da lista e dos relatorios as operacoes ate ontem — as de hoje ficam. Isso nao mexe no pedido do OMIE."
    ],
    keywords: [
      "relatorio",
      "insights",
      "painel",
      "kpi",
      "fechamento diario",
      "email",
      "pdf",
      "excel",
      "exportar",
      "controle de caminhoes",
      "relatorio por cliente",
      "grafico",
      "producao do dia"
    ]
  },
  {
    id: "security",
    title: "Backup, atualizacao, acesso e seguranca",
    eyebrow: "Confiabilidade",
    summary:
      "O banco fica no computador da balanca, o backup roda sozinho todo dia e a atualizacao chega pela internet e instala quando voce fecha o app.",
    icon: ShieldCheck,
    steps: [
      "Mantenha o computador da balanca com usuario Windows restrito e energia estavel (de preferencia com nobreak).",
      "Use Configuracoes > Exportar para gerar um backup manual antes de manutencao, troca de computador ou reinstalacao.",
      "Use Configuracoes > Restaurar somente com orientacao do suporte: restaurar substitui o banco atual.",
      "Confira a versao instalada e use Verificar atualizacao quando o suporte pedir.",
      "Consulte os Logs (F10) sempre que algo falhar, antes de acionar o suporte."
    ],
    details: [
      "O backup automatico roda diariamente e mantem os backups mais recentes por pedreira. A limpeza acontece depois do backup, entao nada e podado antes de estar salvo.",
      "A atualizacao e baixada em segundo plano e instalada quando o operador fecha o aplicativo — nunca no meio de uma pesagem.",
      "O banco local fica em ProgramData e deve ser protegido contra copia indevida: ele tem dados de clientes e de faturamento.",
      "Nunca envie chaves do OMIE, senhas ou o arquivo do banco por WhatsApp, e-mail comum ou pendrive sem controle.",
      "O aplicativo roda com isolamento de contexto e sem acesso direto do sistema a arquivos pela tela.",
      "Sair da conta exige um novo codigo de ativacao para voltar. Nao saia sem ter o codigo em maos."
    ],
    keywords: [
      "backup",
      "restaurar",
      "exportar banco",
      "atualizacao",
      "atualizar o sistema",
      "nova versao",
      "seguranca",
      "logs",
      "trocar de computador",
      "reinstalar",
      "sair da conta",
      "programdata"
    ]
  }
];

// ---------------------------------------------------------------------------
// Duvidas frequentes
// ---------------------------------------------------------------------------

export const documentationFaqs: DocumentationFaq[] = [
  // --- Operacao -----------------------------------------------------------
  {
    question: "Posso digitar o peso manualmente?",
    answer:
      "Nao. O fluxo foi desenhado para capturar o peso direto da balanca configurada, o que reduz erro e fraude. Se a balanca falhar, corrija a conexao em Configuracoes > Balanca antes de operar. A balanca Virtual existe apenas para teste e treinamento, nunca para operacao real.",
    category: "operacao",
    sectionId: "scale",
    keywords: ["peso manual", "digitar peso", "lancar peso na mao", "sem balanca", "peso fixo"]
  },
  {
    question: "Como fecho uma pesagem?",
    answer:
      "Abra Operacoes (F3), localize o caminhao pela placa na fila de abertas e clique em Fechar. Escolha o tipo de saida (com nota fiscal ou interna), aguarde a captura do peso de saida e confira peso liquido, valor, frete e transporte antes de confirmar. Ao confirmar, o cupom sai e o pedido vai para a fila do OMIE.",
    category: "operacao",
    sectionId: "weighing",
    keywords: ["fechar pesagem", "fechar operacao", "finalizar carga", "saida", "como fechar"]
  },
  {
    question: "Como vejo ou corrijo todos os dados de uma operacao?",
    answer:
      "Em Operacoes, de duplo clique na linha (ou use o botao de ficha) para abrir a operacao inteira: pesos, precos, frete, pagamento, transporte e situacao no OMIE. Enquanto a operacao estiver em andamento, o botao Editar operacao libera a correcao completa — cliente, produto, preco por tonelada, valor e regra de frete, placa, motorista, transportadora, forma e condicao de pagamento e o tipo de fechamento. Alterar o preco pede a senha de 4 digitos. Depois de fechada, a ficha continua abrindo, mas so para consulta.",
    category: "operacao",
    sectionId: "weighing",
    keywords: [
      "editar operacao",
      "corrigir operacao",
      "alterar preco",
      "trocar cliente",
      "trocar produto",
      "detalhes da operacao",
      "duplo clique",
      "ficha"
    ]
  },
  {
    question: "Como cancelo uma pesagem?",
    answer:
      "Abra Operacoes, localize a operacao e use a acao de cancelamento. Informe um motivo claro: o cancelamento e auditado, estorna o credito quando aplicavel e cancela o pedido no OMIE caso ele ja tenha subido. Se o pedido ja estiver faturado com NF-e emitida, o cancelamento tem que ser feito no OMIE.",
    category: "operacao",
    sectionId: "weighing",
    keywords: ["cancelar", "cancelamento", "estornar", "motivo do cancelamento", "venda cancelada"]
  },
  {
    question: "O peso de saida ficou menor que o de entrada. O que faco?",
    answer:
      "O peso liquido e a diferenca entre a saida e a entrada, entao saida menor ou igual a entrada e sempre erro. Confira se o caminhao subiu na balanca certo, se a captura de entrada nao pegou o caminhao ja carregado e se a balanca esta estavel. Corrija a captura antes de fechar.",
    category: "operacao",
    sectionId: "weighing",
    keywords: [
      "peso negativo",
      "saida menor que entrada",
      "peso liquido errado",
      "peso liquido zero",
      "tara errada"
    ]
  },
  {
    question: "A mesma placa ja esta aberta. E problema?",
    answer:
      "O sistema avisa para evitar duplicidade. Confira se nao e a mesma viagem registrada duas vezes. Se for, cancele a duplicada com o motivo. Se forem viagens diferentes de verdade (por exemplo, o caminhao voltou), pode seguir.",
    category: "operacao",
    sectionId: "weighing",
    keywords: ["placa duplicada", "placa repetida", "operacao duplicada", "mesmo caminhao"]
  },
  {
    question: "Qual a diferenca entre operacao com nota fiscal e operacao interna?",
    answer:
      "A operacao com nota fiscal cria um pedido de venda no OMIE, pronto para virar NF-e. A operacao interna cria uma ordem de servico, sem NF-e — ela serve para movimentacao interna, consumo proprio e controles que nao geram nota de venda. As duas pesam e imprimem cupom igual.",
    category: "operacao",
    sectionId: "omie-billing",
    keywords: [
      "operacao interna",
      "sem nota",
      "com nota",
      "diferenca",
      "ordem de servico",
      "pedido de venda"
    ]
  },
  {
    question: "Como busco uma operacao antiga?",
    answer:
      "Na aba de concluidas, a busca aceita cliente, CNPJ/CPF com ou sem pontuacao, produto, placa ou motorista. Nas canceladas, use o filtro de periodo (hoje, 7 dias, mes atual ou todas). Nas abertas, a busca e pela placa, com ou sem hifen.",
    category: "operacao",
    sectionId: "weighing",
    keywords: [
      "buscar operacao",
      "procurar pesagem",
      "historico",
      "operacao antiga",
      "filtrar concluidas"
    ]
  },
  {
    question: "Duas balancas na mesma pedreira: como isso funciona?",
    answer:
      "Cada computador tem sua propria ativacao e seu numero de dispositivo, que aparece no cupom. As listas de operacoes se atualizam entre os computadores a cada 15 segundos pela nuvem, entao um pode abrir a entrada e o outro fechar a saida. O fechamento de carteira e a excecao: ele fica no computador que o registrou.",
    category: "operacao",
    sectionId: "overview",
    keywords: [
      "duas balancas",
      "dois computadores",
      "multi desktop",
      "mesma pedreira",
      "numero do dispositivo"
    ]
  },
  {
    question: "Quais sao os atalhos de teclado?",
    answer:
      "F1 Painel, F2 Nova entrada, F3 Operacoes, F4 Cadastros, F5 Insights, F6 Balanca, F7 Impressao, F8 Cloud, F9 sincronizacao OMIE, F10 Logs e F11 alterna tema claro/escuro. Esc volta e Ctrl+Enter confirma o formulario aberto.",
    category: "operacao",
    sectionId: "overview",
    keywords: ["atalho", "atalhos", "teclas", "tecla de atalho", "f2", "f3", "esc", "ctrl enter"]
  },

  // --- Balanca ------------------------------------------------------------
  {
    question: "A balanca nao conecta. O que verificar?",
    answer:
      'Na conexao por rede, confira o IP e a porta do indicador e se o cabo de rede esta firme dos dois lados. Na conexao USB ou Serial (COM), confira o cabo, use "Atualizar portas" para reencontrar a porta e verifique se nenhum outro programa esta usando a mesma COM. Depois volte em Configuracoes > Balanca e teste novamente.',
    category: "balanca",
    sectionId: "scale",
    keywords: [
      "balanca nao conecta",
      "sem comunicacao",
      "erro de conexao",
      "ip",
      "porta",
      "com1",
      "usb",
      "cabo"
    ]
  },
  {
    question: "O peso fica oscilando e nao estabiliza.",
    answer:
      "Confirme que o caminhao parou totalmente sobre a plataforma e que ninguem esta em cima dela. Observe vento forte, vibracao de maquinas proximas e se a plataforma esta encostando na estrutura. Olhe o visor do indicador: se o peso oscila la tambem, o problema e da balanca, nao do sistema. Mudar os parametros de estabilidade so com a equipe tecnica.",
    category: "balanca",
    sectionId: "scale",
    keywords: [
      "peso oscilando",
      "peso instavel",
      "nao estabiliza",
      "nao captura",
      "estabilidade",
      "variacao"
    ]
  },
  {
    question: "O peso do sistema esta diferente do visor da balanca.",
    answer:
      "O sistema grava o valor exibido no momento em que a balanca estabiliza — nao ha media nem calculo. Diferenca constante aponta para calibracao ou configuracao do indicador (casas decimais, unidade, divisao). Acione a empresa de manutencao da balanca e confira a data da ultima afericao do INMETRO.",
    category: "balanca",
    sectionId: "scale",
    keywords: [
      "peso diferente",
      "peso errado",
      "calibracao",
      "aferir",
      "inmetro",
      "divergencia de peso"
    ]
  },
  {
    question: "Posso usar a balanca Virtual no dia a dia?",
    answer:
      "Nao. A Virtual e para treinamento e teste: o peso e digitado, nao lido. Usar em operacao real gera pesagem sem lastro fisico, o que compromete a nota, o faturamento e a auditoria.",
    category: "balanca",
    sectionId: "scale",
    keywords: ["balanca virtual", "simulador", "teste", "treinamento"]
  },

  // --- Impressao ----------------------------------------------------------
  {
    question: "A impressora nao aparece na lista.",
    answer:
      "Instale ou reinstale a impressora no Windows e imprima uma pagina de teste pelo proprio Windows. So depois reabra Configuracoes > Impressao. Se for impressora de rede, confirme o nome compartilhado e a permissao do usuario do Windows.",
    category: "impressao",
    sectionId: "printing",
    keywords: ["impressora nao aparece", "lista vazia", "driver", "instalar impressora", "rede"]
  },
  {
    question: "A impressao falhou depois de fechar a operacao. Perdi a pesagem?",
    answer:
      "Nao. A operacao fechada continua salva e ja foi para a fila do OMIE. Corrija papel, energia, driver ou perfil de impressao e use a reimpressao. A segunda via sai marcada como copia e fica registrada.",
    category: "impressao",
    sectionId: "printing",
    keywords: [
      "impressao falhou",
      "nao imprimiu",
      "perdi a pesagem",
      "reimprimir",
      "segunda via",
      "cupom nao saiu"
    ]
  },
  {
    question: "Como tiro uma segunda via do cupom?",
    answer:
      "Use a reimpressao a partir da operacao ou da lista de cupons. A via sai marcada como copia e o contador de vias aumenta, o que mantem a rastreabilidade.",
    category: "impressao",
    sectionId: "printing",
    keywords: ["segunda via", "reimprimir cupom", "copia", "duplicata do cupom", "via extra"]
  },
  {
    question: "A logo sumiu no cupom impresso, mas aparece na tela.",
    answer:
      "A impressora termica imprime em preto e branco puro. Logo em cor clara pode virar papel em branco na conversao. O sistema detecta esse caso e avisa: use uma versao da logo com mais contraste, de preferencia em tracos escuros sobre fundo claro.",
    category: "impressao",
    sectionId: "printing",
    keywords: ["logo", "logotipo", "logo nao imprime", "logo apagada", "cupom sem logo"]
  },
  {
    question: "O que significa COD e COPIA NRO no cupom?",
    answer:
      "COD e o codigo sequencial da operacao — e por ele que voce localiza a pesagem. COPIA NRO conta quantas vias daquele cupom ja foram impressas. Sao coisas diferentes: o COD nao muda quando voce reimprime.",
    category: "impressao",
    sectionId: "printing",
    keywords: ["cod", "copia nro", "numero do cupom", "codigo da operacao", "entender o cupom"]
  },

  // --- Nuvem --------------------------------------------------------------
  {
    question: "Estou sem internet. Posso continuar operando?",
    answer:
      "Sim. O desktop e offline-first: a pesagem abre, fecha e imprime normalmente, e tudo entra numa fila local que sobe quando a internet voltar. O unico limite e o periodo de tolerancia da licenca — passado esse prazo sem nenhuma validacao online, o app pede internet para revalidar.",
    category: "cloud",
    sectionId: "cloud",
    keywords: [
      "sem internet",
      "offline",
      "internet caiu",
      "posso operar",
      "fila local",
      "tolerancia"
    ]
  },
  {
    question: "Por que uma operacao ficou pendente de nuvem ou de OMIE?",
    answer:
      "As causas mais comuns sao: internet instavel, cadastro do cliente incompleto para NF-e, dependencia ainda nao sincronizada (cliente ou produto novo) ou indisponibilidade momentanea do OMIE. Abra a tela Cloud e leia a mensagem do item na fila — ela diz o motivo. Corrija a causa e sincronize de novo.",
    category: "cloud",
    sectionId: "cloud",
    keywords: [
      "pendente",
      "nao sincronizou",
      "fila parada",
      "erro de sincronizacao",
      "aguardando envio",
      "nao subiu"
    ]
  },
  {
    question: "Cliquei em Sincronizar agora e nada mudou.",
    answer:
      "Confira primeiro se o computador tem internet abrindo qualquer site. Depois veja a mensagem do item parado na fila: se for cadastro incompleto, nenhuma tentativa vai resolver ate o cadastro ser corrigido. Itens com falha temporaria voltam sozinhos, com espera crescente entre as tentativas.",
    category: "cloud",
    sectionId: "cloud",
    keywords: [
      "sincronizar agora",
      "nao adianta sincronizar",
      "fila nao anda",
      "reenviar",
      "travado"
    ]
  },
  {
    question: "Preciso configurar as chaves do OMIE no computador da balanca?",
    answer:
      "Nao, e nao deve. App Key e App Secret ficam apenas no painel administrativo/nuvem. O desktop nunca fala direto com o OMIE: ele passa pela nuvem, que guarda as credenciais em ambiente protegido.",
    category: "cloud",
    sectionId: "cloud",
    keywords: [
      "app key",
      "app secret",
      "credencial omie",
      "chave do omie",
      "configurar omie",
      "onde coloco a chave"
    ]
  },
  {
    question: "O carregador nao ve a operacao no site.",
    answer:
      "Confira, nesta ordem: (1) o desktop esta com internet e a operacao ja subiu (tela Cloud sem pendencia dela); (2) o usuario do carregador esta vinculado a MESMA unidade da operacao; (3) o carregador atualizou a pagina e tem internet. Se a operacao subiu e mesmo assim nao aparece, e caso de suporte.",
    category: "cloud",
    sectionId: "loader",
    keywords: [
      "carregador nao ve",
      "site do carregador vazio",
      "nao aparece para o carregador",
      "loader",
      "patio"
    ]
  },

  // --- OMIE ---------------------------------------------------------------
  {
    question: "Como emito a nota fiscal da pesagem?",
    answer:
      'A emissao acontece dentro do OMIE. Quando voce fecha a operacao fiscal, o KyberRock cria o pedido de venda no OMIE ja na etapa "Faturar". No OMIE, abra Vendas > Pedidos de Venda, va a etapa "Faturar", abra o pedido, confira os dados e clique em Faturar. O OMIE gera a NF-e, envia para a SEFAZ e disponibiliza o DANFE.',
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "emitir nota",
      "como emitir nota fiscal",
      "nfe",
      "faturar",
      "etapa faturar",
      "danfe",
      "sefaz",
      "gerar nota"
    ]
  },
  {
    question: 'A operacao ficou com "cadastro incompleto". O que falta?',
    answer:
      "Para emitir NF-e, o cadastro do cliente precisa de CNPJ/CPF, NUMERO DO ENDERECO e E-MAIL. Esses dois ultimos sao os que mais faltam, porque a consulta publica de CNPJ nao traz e-mail. Use o botao de corrigir cadastro na propria operacao (ou na fila da tela Cloud), preencha o que falta e reenvie. Nao e preciso refazer a pesagem.",
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "cadastro incompleto",
      "falta email",
      "falta numero do endereco",
      "nao faturou",
      "recusado pelo omie",
      "corrigir cadastro"
    ]
  },
  {
    question: "Reenviar ao OMIE pode duplicar o pedido?",
    answer:
      "Nao. Cada operacao carrega uma chave de idempotencia propria. Se o pedido ja existir no OMIE, ele e reconhecido e devolvido em vez de criado de novo. Pode reenviar sem medo depois de corrigir o cadastro.",
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "duplicar pedido",
      "pedido duplicado",
      "reenviar",
      "refaturar",
      "duas notas",
      "idempotencia"
    ]
  },
  {
    question: "Onde encontro o pedido desta pesagem no OMIE?",
    answer:
      'Na operacao fiscal, em Vendas > Pedidos de Venda — o pedido chega na etapa "Faturar". Na operacao interna, em Servicos > Ordens de Servico, tambem na etapa "Faturar". A ficha da operacao no KyberRock mostra o numero do pedido/OS assim que o OMIE responde.',
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "onde esta o pedido",
      "achar pedido no omie",
      "numero do pedido",
      "kanban",
      "ordem de servico",
      "etapa"
    ]
  },
  {
    question: "A operacao interna tambem emite nota?",
    answer:
      'Nao emite NF-e. Ela cria uma ordem de servico no OMIE na etapa "Faturar", para controle interno e financeiro. Se a pedreira precisar de nota de servico, ela e emitida no proprio OMIE a partir dessa OS.',
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "operacao interna",
      "sem nota",
      "ordem de servico",
      "nfse",
      "nota de servico",
      "os no omie"
    ]
  },
  {
    question: "Preciso cancelar uma nota ja emitida. Da para fazer pelo KyberRock?",
    answer:
      "Nao. Depois de faturado, com a NF-e autorizada, o cancelamento e feito no OMIE — cancelamento da NF-e dentro do prazo legal da SEFAZ ou, passado o prazo, nota de devolucao. Cancele tambem a operacao aqui para ela sair dos relatorios, com o motivo registrado.",
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "cancelar nota",
      "cancelar nfe",
      "nota emitida errada",
      "devolucao",
      "estornar nota",
      "prazo de cancelamento"
    ]
  },
  {
    question: "O cliente nao recebeu a nota por e-mail.",
    answer:
      "O OMIE envia a NF-e para os e-mails da aba Fiscal do cadastro do cliente. Confira se o e-mail esta preenchido e correto la, e confira a caixa de spam do cliente. No KyberRock, o e-mail do cliente tambem alimenta esse envio — mantenha os dois iguais.",
    category: "omie",
    sectionId: "omie-billing",
    keywords: [
      "cliente nao recebeu a nota",
      "email da nota",
      "enviar danfe",
      "nfe por email",
      "spam"
    ]
  },
  {
    question: "As parcelas sairam erradas no OMIE.",
    answer:
      "As parcelas vem da condicao de pagamento escolhida na entrada. Se a condicao vinculada do OMIE nao bate com o combinado, use o parcelamento manual e digite os dias de vencimento (por exemplo 9/18/27). Em boleto, o sistema sempre manda os vencimentos digitados, porque o boleto so nasce na parcela.",
    category: "omie",
    sectionId: "payments",
    keywords: [
      "parcelas erradas",
      "vencimento errado",
      "a vista sendo que era a prazo",
      "condicao de pagamento",
      "parcelamento manual",
      "9/18/27"
    ]
  },
  {
    question: "Por que a venda saiu sem boleto no OMIE?",
    answer:
      'As formas "Em carteira" e "Bonificacao" sobem como "99 - outros" e com a geracao de boleto desativada de proposito: a nota sai, mas nenhuma cobranca nasce dela. Na carteira, a cobranca aparece depois do fechamento na tela Carteira. Na bonificacao, nao ha o que cobrar.',
    category: "omie",
    sectionId: "payments",
    keywords: [
      "sem boleto",
      "boleto nao gerou",
      "99 outros",
      "em carteira",
      "bonificacao",
      "nao gerou cobranca"
    ]
  },
  {
    question: "Criei o cliente aqui. Ele vai para o OMIE?",
    answer:
      "Vai, na proxima sincronizacao. O sistema guarda o codigo devolvido pelo OMIE, entao o cliente nao e criado duas vezes. Enquanto ele nao subir, a operacao desse cliente fica aguardando na fila — e normal.",
    category: "omie",
    sectionId: "registrations",
    keywords: [
      "cliente novo",
      "cliente nao esta no omie",
      "criar cliente",
      "sobe para o omie",
      "cadastro local"
    ]
  },

  // --- Financeiro ---------------------------------------------------------
  {
    question: "O cliente esta bloqueado por credito. Como libero?",
    answer:
      "Confira limite de credito, titulos em aberto no OMIE, saldo pre-pago e — importante — as operacoes fechadas aqui que ainda nao sincronizaram, porque elas tambem consomem limite. Liberar credito e decisao do financeiro: ajuste o limite ou de baixa nos titulos no OMIE e sincronize.",
    category: "financeiro",
    sectionId: "credit",
    keywords: [
      "cliente bloqueado",
      "bloqueio de credito",
      "liberar cliente",
      "limite estourado",
      "nao deixa carregar",
      "inadimplente"
    ]
  },
  {
    question: 'Qual a diferenca entre "Credito do cliente" e "Em carteira"?',
    answer:
      "Credito do cliente e o fiado: consome saldo/limite do cadastro no fechamento e volta em caso de cancelamento. Em carteira nao mexe em limite nem em saldo — a venda fica esperando o acerto, e voce escolhe a forma de recebimento e o vencimento depois, na tela Carteira.",
    category: "financeiro",
    sectionId: "wallet",
    keywords: [
      "credito x carteira",
      "diferenca fiado carteira",
      "fiado",
      "em carteira",
      "qual escolher"
    ]
  },
  {
    question: "O adiantamento do cliente nao apareceu como saldo.",
    answer:
      "Adiantamentos lancados no OMIE viram saldo aqui quando a sincronizacao roda. Se o lancamento e recente, rode a sincronizacao do OMIE (F9) e confira de novo. Confira tambem se o adiantamento foi lancado na categoria e conta que a empresa configurou para adiantamento.",
    category: "financeiro",
    sectionId: "credit",
    keywords: [
      "adiantamento",
      "pre-pago",
      "saldo nao aparece",
      "cliente pagou adiantado",
      "credito nao entrou"
    ]
  },
  {
    question: "Como fecho a carteira de um cliente?",
    answer:
      "Abra Carteira na barra lateral, escolha o cliente, selecione as vendas que entram no acerto, informe a forma de recebimento e o vencimento combinado e clique em Fechar. Se lancar errado, use Reabrir fechamento e refaca.",
    category: "financeiro",
    sectionId: "wallet",
    keywords: [
      "fechar carteira",
      "acerto do cliente",
      "reabrir fechamento",
      "receber carteira",
      "juntar vendas"
    ]
  },
  {
    question: "Como cobro o frete do cliente?",
    answer:
      "Na entrada, escolha a modalidade do frete, marque que a pedreira lanca valor e escolha o tipo de calculo (por tonelada, por tonelada/km ou fixo mais tonelada). O valor entra no pedido do OMIE junto com a mercadoria e pode aparecer ou nao no cupom, conforme voce marcar. Regras de frete por cliente e produto evitam redigitar a cada carga.",
    category: "financeiro",
    sectionId: "freight",
    keywords: [
      "cobrar frete",
      "valor do frete",
      "frete por tonelada",
      "frete por km",
      "frete no cupom",
      "quem paga o frete"
    ]
  },
  {
    question: "Quem define o preco da tonelada?",
    answer:
      "A ordem e: preco especial do cliente, depois a tabela de preco vinculada a ele, depois o preco padrao do produto. Se nenhum estiver cadastrado, o preco vem em branco e precisa ser digitado. Alterar o preco na operacao pede a senha de 4 digitos da empresa.",
    category: "financeiro",
    sectionId: "registrations",
    keywords: [
      "preco",
      "preco da tonelada",
      "tabela de preco",
      "preco especial",
      "senha do preco",
      "preco errado",
      "de onde vem o preco"
    ]
  },

  // --- Seguranca ----------------------------------------------------------
  {
    question: "Onde encontro os logs tecnicos?",
    answer:
      "Use a engrenagem no rodape da barra lateral e escolha Logs (F10) para ver os erros e avisos recentes. Quando o desktop nem abre, o arquivo startup.log fica em AppData Local, na pasta do KyberRock Desktop — envie o conteudo ao suporte.",
    category: "seguranca",
    sectionId: "security",
    keywords: ["logs", "log de erro", "startup.log", "erro tecnico", "onde vejo o erro"]
  },
  {
    question: "O sistema faz backup sozinho?",
    answer:
      "Sim, diariamente, e mantem os backups mais recentes por pedreira. Ainda assim, antes de manutencao, troca de computador ou reinstalacao, gere um backup manual em Configuracoes > Exportar e guarde o arquivo fora do computador da balanca.",
    category: "seguranca",
    sectionId: "security",
    keywords: [
      "backup",
      "backup automatico",
      "exportar banco",
      "salvar dados",
      "onde fica o backup"
    ]
  },
  {
    question: "O que fazer antes de trocar o computador da balanca?",
    answer:
      "Faca backup do banco local, confirme que a nuvem esta sem pendencia de sincronizacao, anote a versao instalada e tenha em maos o codigo de ativacao da unidade. So depois instale no computador novo e ative. Nao desinstale nada antes de confirmar que a fila esta vazia.",
    category: "seguranca",
    sectionId: "security",
    keywords: [
      "trocar computador",
      "computador novo",
      "migrar",
      "reinstalar",
      "formatar",
      "codigo de ativacao"
    ]
  },
  {
    question: "Como atualizo o sistema?",
    answer:
      "A atualizacao e automatica: o app verifica periodicamente, baixa em segundo plano e instala quando voce fecha o aplicativo — nunca no meio de uma pesagem. Se precisar antecipar, use Verificar atualizacao no menu da engrenagem.",
    category: "seguranca",
    sectionId: "security",
    keywords: [
      "atualizar",
      "atualizacao",
      "nova versao",
      "update",
      "versao instalada",
      "como atualizo"
    ]
  },
  {
    question: "O app pediu ativacao de novo ou mostrou tela de bloqueio.",
    answer:
      "Isso acontece quando a licenca precisa ser revalidada e o computador esta ha muito tempo sem internet, ou quando alguem saiu da conta. Conecte a internet e tente novamente. Se aparecer a tela de ativacao, use o codigo de 6 digitos da unidade fornecido pelo administrador. Nao reinstale antes de fazer backup.",
    category: "seguranca",
    sectionId: "cloud",
    keywords: [
      "pede ativacao",
      "tela de bloqueio",
      "bloqueado",
      "licenca",
      "codigo de ativacao",
      "nao entra"
    ]
  },
  {
    question: "Posso enviar o arquivo do banco de dados para o suporte?",
    answer:
      "So por canal combinado com o suporte. O banco contem dados de clientes e de faturamento. Nunca envie por WhatsApp, e-mail comum ou pendrive sem controle, e nunca envie chaves do OMIE ou senhas junto.",
    category: "seguranca",
    sectionId: "security",
    keywords: [
      "enviar banco",
      "mandar arquivo",
      "sqlite",
      "dados sensiveis",
      "lgpd",
      "seguranca dos dados"
    ]
  }
];

export const documentationFaqCategories: Array<{
  id: DocumentationFaqCategory | "all";
  label: string;
}> = [
  { id: "all", label: "Todas" },
  { id: "operacao", label: "Operacao" },
  { id: "balanca", label: "Balanca" },
  { id: "impressao", label: "Impressao" },
  { id: "cloud", label: "Nuvem" },
  { id: "omie", label: "OMIE e nota fiscal" },
  { id: "financeiro", label: "Financeiro" },
  { id: "seguranca", label: "Acesso e seguranca" }
];

// ---------------------------------------------------------------------------
// Preparacao da unidade
// ---------------------------------------------------------------------------

export const quickStartTasks: QuickStartTask[] = [
  {
    id: "activate",
    label: "Ativar o desktop",
    description: "Use o codigo de 6 digitos da empresa/unidade na primeira abertura.",
    sectionId: "overview"
  },
  {
    id: "scale",
    label: "Configurar e testar a balanca",
    description: "Escolha o tipo de conexao, conecte e valide com a captura de teste.",
    sectionId: "scale"
  },
  {
    id: "printer",
    label: "Configurar a impressora",
    description: "Selecione a impressora do Windows, salve o perfil e imprima um cupom de teste.",
    sectionId: "printing"
  },
  {
    id: "cloud",
    label: "Conectar a nuvem",
    description: "Confira o status na tela Cloud e rode a primeira sincronizacao completa.",
    sectionId: "cloud"
  },
  {
    id: "registrations",
    label: "Revisar cadastros e precos",
    description: "Confirme clientes, produtos, condicoes de pagamento e tabelas de preco.",
    sectionId: "registrations"
  },
  {
    id: "customer-fiscal",
    label: "Completar o cadastro fiscal dos clientes",
    description: "CNPJ/CPF, numero do endereco e e-mail — sem eles a NF-e nao sai.",
    sectionId: "omie-billing"
  },
  {
    id: "transport",
    label: "Cadastrar veiculos, motoristas e transportadoras",
    description: "Inclua as placas e faca os vinculos de transporte usados no dia a dia.",
    sectionId: "registrations"
  },
  {
    id: "test-weighing",
    label: "Fazer uma pesagem de teste",
    description: "Registre entrada, feche a saida e imprima o cupom para validar o ciclo completo.",
    sectionId: "weighing"
  },
  {
    id: "omie-billing",
    label: "Faturar a primeira operacao no OMIE",
    description: 'Abra o pedido na etapa "Faturar" do OMIE e emita a NF-e.',
    sectionId: "omie-billing"
  },
  {
    id: "reports",
    label: "Configurar o fechamento diario",
    description: "Cadastre os destinatarios do relatorio por e-mail na tela Relatorios.",
    sectionId: "reports"
  }
];

export const operationFlowStages: OperationFlowStage[] = [
  {
    id: "entry",
    title: "Entrada",
    description:
      "Caminhao vazio sobe na balanca. Registre placa, cliente, produto e pagamento em Nova entrada.",
    icon: Truck,
    sectionId: "weighing"
  },
  {
    id: "loading",
    title: "Carregamento",
    description: "O carregador ve a operacao em aberto no site e carrega o caminhao no patio.",
    icon: ListChecks,
    sectionId: "loader"
  },
  {
    id: "exit",
    title: "Saida",
    description: "Caminhao carregado volta a balanca. Feche a saida e confira o peso liquido.",
    icon: Scale,
    sectionId: "weighing"
  },
  {
    id: "coupon",
    title: "Cupom",
    description: "O cupom com pesos, valores e frete e impresso e entregue ao motorista.",
    icon: Printer,
    sectionId: "printing"
  },
  {
    id: "sync",
    title: "Sincronizacao",
    description: "A operacao fechada entra na fila local e sobe para a nuvem e para o OMIE.",
    icon: Cloud,
    sectionId: "cloud"
  },
  {
    id: "invoice",
    title: "Faturamento",
    description: 'No OMIE, o pedido chega na etapa "Faturar" e vira NF-e em poucos cliques.',
    icon: Receipt,
    sectionId: "omie-billing"
  }
];

// ---------------------------------------------------------------------------
// Diagnostico guiado
// ---------------------------------------------------------------------------

export const troubleshootingFlows: TroubleshootingFlow[] = [
  {
    id: "scale-connection",
    title: "Balanca nao conecta",
    symptom: "O sistema nao le peso ou mostra erro de conexao com a balanca.",
    icon: Scale,
    checks: [
      "Confirme que o indicador da balanca esta ligado e sem mensagem de erro no visor.",
      "Verifique o cabo entre o indicador e o computador e se os conectores estao firmes dos dois lados.",
      "Abra Configuracoes > Balanca (F6) e confira o tipo de conexao e os dados: IP e porta na rede, ou porta COM e velocidade no serial/USB.",
      'No serial/USB, use "Atualizar portas" e confirme que nenhum outro programa esta usando a mesma porta.',
      "Salve a configuracao e use o teste de captura da propria tela."
    ],
    escalation:
      "Se seguir sem conexao, anote o modelo do indicador, o tipo de conexao, IP/porta ou COM e o texto exato do erro antes de acionar o suporte.",
    keywords: [
      "balanca nao conecta",
      "sem leitura",
      "erro de conexao",
      "indicador",
      "ip",
      "porta",
      "com"
    ]
  },
  {
    id: "scale-unstable",
    title: "Peso nao estabiliza",
    symptom: "O peso fica oscilando na tela e a captura nunca conclui.",
    icon: AlertTriangle,
    checks: [
      "Confirme que o caminhao parou totalmente sobre a plataforma e que ninguem esta sobre ela.",
      "Observe vento forte, vibracao de maquinas proximas ou plataforma encostando na estrutura.",
      "Veja se o peso oscila tambem no indicador fisico: se oscilar la, o problema e da balanca, nao do sistema.",
      "Confira se ha sujeira, pedra ou agua acumulada sob a plataforma.",
      "Revise com a equipe tecnica os parametros de estabilidade (tempo minimo estavel e variacao maxima)."
    ],
    escalation:
      "Se o indicador fisico estiver estavel e o sistema nao, registre o comportamento e acione o suporte com os parametros configurados.",
    keywords: ["peso instavel", "oscilando", "nao captura", "estabilidade", "vento", "vibracao"]
  },
  {
    id: "printer",
    title: "Impressora nao imprime",
    symptom: "O cupom ou o relatorio nao sai, ou a impressora nao aparece na lista.",
    icon: Printer,
    checks: [
      "Confira papel, tampa fechada e luz de erro na propria impressora.",
      "Imprima uma pagina de teste pelo Windows para isolar se o problema e do sistema ou do driver.",
      "Se a impressora nao aparece na lista, reinstale o driver no Windows e reabra Configuracoes > Impressao.",
      "Confirme que o perfil de impressao correto esta salvo para o documento (cupom 80 mm ou A4).",
      "Se a operacao ja foi fechada, use a reimpressao: a falha de impressao nao desfaz a pesagem."
    ],
    escalation:
      "Persistindo, anote o modelo da impressora, se e USB ou de rede, e o resultado do teste do Windows antes de chamar o suporte.",
    keywords: ["nao imprime", "cupom", "driver", "papel", "reimpressao", "impressora sumiu"]
  },
  {
    id: "sync-pending",
    title: "Operacao pendente de nuvem ou de OMIE",
    symptom: "Operacoes fechadas aparecem como pendentes de sincronizacao ha muito tempo.",
    icon: Cloud,
    checks: [
      "Confira a internet do computador da balanca abrindo qualquer site.",
      "Abra a tela Cloud (F8) e leia a mensagem de erro do item parado na fila.",
      'Use "Sincronizar agora" e acompanhe se a pendencia diminui.',
      "Se a mensagem falar em cadastro, corrija o cliente pelo botao de correcao e reenvie o item.",
      "Consulte os Logs (F10) para o texto tecnico completo do erro."
    ],
    escalation:
      "A operacao local esta salva e nao se perde. Se a pendencia persistir com a internet estavel, envie ao suporte o texto do erro dos Logs e o codigo (COD) da operacao.",
    keywords: ["pendente", "nao sincroniza", "fila", "erro de envio", "nao sobe", "travado"]
  },
  {
    id: "omie-cadastro",
    title: "OMIE recusou o faturamento",
    symptom: 'A operacao concluida mostra "cadastro incompleto" ou recusa do OMIE e nao vira nota.',
    icon: Receipt,
    checks: [
      "Abra a operacao concluida e leia o motivo exibido: ele nomeia o campo que falta.",
      "Confira no cadastro do cliente: CNPJ/CPF, NUMERO DO ENDERECO e E-MAIL sao obrigatorios para NF-e.",
      "Use o botao de corrigir cadastro na propria operacao (ou na fila da tela Cloud) e preencha o que falta.",
      "Salve e reenvie a operacao. Reenviar nao duplica o pedido: a chave de idempotencia protege isso.",
      "Se o cliente veio do OMIE e o campo estiver bloqueado, corrija tambem no portal do OMIE para nao voltar errado na proxima sincronizacao."
    ],
    escalation:
      "Se o cadastro estiver completo e o OMIE continuar recusando, copie a mensagem de erro exata do OMIE e envie ao suporte com o codigo (COD) da operacao e o CNPJ do cliente.",
    keywords: [
      "cadastro incompleto",
      "omie recusou",
      "nao fatura",
      "erro do omie",
      "falta email",
      "numero do endereco"
    ]
  },
  {
    id: "invoice-missing",
    title: "Pedido nao aparece no OMIE",
    symptom: "A operacao foi fechada, mas nao ha pedido nem OS no OMIE.",
    icon: FileText,
    checks: [
      "Confira na tela Cloud se o item ainda esta na fila aguardando envio — sem internet ele espera.",
      'No OMIE, procure na etapa "Faturar" de Vendas > Pedidos de Venda (operacao fiscal) ou de Servicos > Ordens de Servico (operacao interna).',
      "Confirme que voce esta na EMPRESA certa dentro do OMIE: contas com mais de uma empresa mostram pedidos separados.",
      "Confira se a operacao nao foi cancelada aqui: operacao cancelada tem o envio ao OMIE neutralizado de proposito.",
      "Se o item saiu da fila sem erro e o pedido nao esta la, use o reenvio da operacao concluida."
    ],
    escalation:
      "Envie ao suporte o codigo (COD) da operacao, a data e a hora do fechamento e o nome do cliente.",
    keywords: [
      "pedido nao aparece",
      "sumiu no omie",
      "nao achei o pedido",
      "empresa errada",
      "kanban"
    ]
  },
  {
    id: "credit-blocked",
    title: "Cliente bloqueado por credito",
    symptom: "O sistema impede a entrada ou o fechamento por bloqueio financeiro do cliente.",
    icon: Users,
    checks: [
      "Abra o cadastro do cliente e confira o limite de credito e a situacao financeira.",
      "Verifique os titulos em aberto no OMIE.",
      "Considere as operacoes locais fechadas e ainda nao sincronizadas: elas tambem consomem limite.",
      "Para clientes pre-pagos, confira o saldo de adiantamento e rode a sincronizacao do OMIE (F9) se o lancamento for recente."
    ],
    escalation:
      "Liberar credito e decisao do financeiro: ajuste o limite ou de baixa nos titulos no OMIE e sincronize. Se o valor nao bater, envie ao suporte o CNPJ do cliente e o valor que o sistema esta somando.",
    keywords: ["credito", "bloqueado", "limite", "financeiro", "nao deixa carregar", "fiado"]
  },
  {
    id: "loader-missing",
    title: "Carregador nao ve a operacao",
    symptom: "A operacao aberta no desktop nao aparece no site do carregador.",
    icon: ListChecks,
    checks: [
      "Confirme que o desktop esta com internet e que a operacao ja subiu (tela Cloud sem pendencia dela).",
      "Verifique se o usuario do carregador esta vinculado a MESMA unidade da operacao.",
      "Peca ao carregador para atualizar a pagina e conferir a propria internet.",
      "Confira pendencias de sincronizacao na tela Cloud do desktop."
    ],
    escalation:
      "Se a operacao sincronizou e mesmo assim nao aparece, informe ao suporte o usuario do carregador, a unidade e a placa da operacao.",
    keywords: ["carregador", "loader", "site", "patio", "unidade", "nao aparece"]
  },
  {
    id: "app-blocked",
    title: "Desktop nao abre ou pede ativacao",
    symptom: "O aplicativo nao inicia, trava na abertura ou exibe tela de bloqueio/ativacao.",
    icon: Laptop,
    checks: [
      "Reinicie o computador da balanca e abra o KyberRock novamente.",
      "Se aparecer a tela de ativacao, use o codigo de 6 digitos da unidade fornecido pelo administrador.",
      "Se houver bloqueio por validacao, conecte o computador a internet para revalidar a licenca.",
      "Quando o desktop nem abre, consulte o startup.log em AppData Local, na pasta do KyberRock Desktop."
    ],
    escalation:
      "Envie ao suporte o conteudo do startup.log e a versao instalada. Nao reinstale antes de fazer backup do banco local.",
    keywords: ["nao abre", "trava", "ativacao", "bloqueio", "startup", "licenca", "tela branca"]
  },
  {
    id: "price-wrong",
    title: "Preco ou valor saiu errado",
    symptom: "O valor da operacao nao bate com o combinado com o cliente.",
    icon: FileText,
    checks: [
      "Abra a ficha da operacao e confira o preco por tonelada aplicado e a origem dele.",
      "Confira, nesta ordem: preco especial do cliente, tabela de preco vinculada e preco padrao do produto.",
      "Confira se o frete esta somando ao valor e se era para somar nesta operacao.",
      "Com a operacao ainda em andamento, use Editar operacao para corrigir — alterar preco pede a senha de 4 digitos.",
      "Se a operacao ja fechou, cancele com o motivo e refaca, ou corrija o pedido dentro do OMIE antes de faturar."
    ],
    escalation:
      "Se o preco correto estiver cadastrado e mesmo assim vier outro, envie ao suporte o cliente, o produto e o preco esperado.",
    keywords: [
      "preco errado",
      "valor errado",
      "nao bate",
      "tabela de preco",
      "senha do preco",
      "frete somando"
    ]
  },
  {
    id: "weight-mismatch",
    title: "Peso do sistema diferente do visor",
    symptom: "O peso registrado nao confere com o que o indicador mostra.",
    icon: Scale,
    checks: [
      "Compare a leitura ao vivo da tela da balanca com o visor no mesmo instante.",
      "Confira a unidade e as casas decimais configuradas no indicador.",
      "Verifique a data da ultima afericao do INMETRO e se ha lacre violado.",
      "Teste com um peso conhecido, se a pedreira tiver padrao de conferencia."
    ],
    escalation:
      "Diferenca constante e caso de manutencao da balanca, nao do sistema. Acione a empresa que faz a manutencao do equipamento e informe ao suporte para acompanhar.",
    keywords: ["peso diferente", "peso errado", "calibracao", "aferir", "inmetro", "divergencia"]
  },
  {
    id: "slow",
    title: "Sistema lento ou travando",
    symptom: "As telas demoram para abrir ou o aplicativo trava durante a operacao.",
    icon: Laptop,
    checks: [
      "Confira o espaco livre em disco do computador da balanca.",
      'Use "Limpar concluidas" para reduzir a lista de operacoes antigas — isso nao afeta o pedido no OMIE nem o historico auditavel.',
      "Feche programas pesados abertos junto (navegador com muitas abas, antivirus em varredura).",
      "Reinicie o aplicativo e, se persistir, reinicie o computador.",
      "Consulte os Logs (F10) para erros repetidos."
    ],
    escalation:
      "Se a lentidao continuar, informe ao suporte ha quanto tempo comecou, quantas operacoes existem na lista e a configuracao do computador.",
    keywords: ["lento", "travando", "demora", "pesado", "trava", "lentidao"]
  }
];

// ---------------------------------------------------------------------------
// Glossario
// ---------------------------------------------------------------------------

export const documentationGlossary: GlossaryEntry[] = [
  {
    term: "Operacao",
    definition:
      "Uma pesagem completa: entrada do caminhao vazio, carregamento e saida carregado. E a unidade basica do sistema e tem um codigo (COD) proprio.",
    keywords: ["operacao", "pesagem", "cod", "codigo da operacao"],
    sectionId: "weighing"
  },
  {
    term: "Peso liquido",
    definition:
      "Diferenca entre o peso de saida (carregado) e o peso de entrada (vazio). E o peso do material vendido.",
    keywords: ["peso liquido", "liquido", "tara", "peso do material"],
    sectionId: "weighing"
  },
  {
    term: "Operacao fiscal",
    definition: "Saida com nota fiscal. Gera um pedido de venda no OMIE, pronto para virar NF-e.",
    keywords: ["fiscal", "com nota", "pedido de venda"],
    sectionId: "omie-billing"
  },
  {
    term: "Operacao interna",
    definition:
      "Saida sem nota fiscal. Gera uma ordem de servico no OMIE, para controle interno e financeiro.",
    keywords: ["interna", "sem nota", "ordem de servico", "os"],
    sectionId: "omie-billing"
  },
  {
    term: 'Etapa "Faturar"',
    definition:
      "Coluna do fluxo de vendas do OMIE onde os pedidos chegam prontos para virar nota. E ali que a NF-e e emitida.",
    keywords: ["etapa faturar", "kanban", "coluna faturar", "etapa 50"],
    sectionId: "omie-billing"
  },
  {
    term: "NF-e",
    definition:
      "Nota Fiscal Eletronica de mercadoria. Emitida no OMIE e autorizada pela SEFAZ; o comprovante impresso dela e o DANFE.",
    keywords: ["nfe", "nota fiscal", "sefaz"],
    sectionId: "omie-billing"
  },
  {
    term: "DANFE",
    definition:
      "Documento Auxiliar da NF-e: o papel que acompanha a carga. Nao e a nota em si, e a representacao impressa dela.",
    keywords: ["danfe", "papel da nota", "documento da carga"],
    sectionId: "omie-billing"
  },
  {
    term: "Idempotencia",
    definition:
      "Marca unica que cada envio ao OMIE carrega. E ela que garante que reenviar uma operacao nunca cria um segundo pedido.",
    keywords: ["idempotencia", "nao duplica", "chave unica", "reenviar"],
    sectionId: "omie-billing"
  },
  {
    term: "Fila de sincronizacao",
    definition:
      "Lista local do que ainda precisa subir para a nuvem ou para o OMIE. Ela reenvia sozinha e nao perde nada quando falta internet.",
    keywords: ["fila", "sincronizacao", "pendente", "aguardando envio"],
    sectionId: "cloud"
  },
  {
    term: "Offline-first",
    definition:
      "Desenho do sistema em que a operacao nasce e fecha no computador da balanca, e a nuvem so recebe depois. E o que permite operar sem internet.",
    keywords: ["offline", "offline-first", "sem internet", "local"],
    sectionId: "overview"
  },
  {
    term: "Credito do cliente (fiado)",
    definition:
      "Forma de pagamento que consome saldo ou limite do cliente no fechamento e volta em caso de cancelamento.",
    keywords: ["credito", "fiado", "limite", "saldo"],
    sectionId: "credit"
  },
  {
    term: "Em carteira",
    definition:
      "Forma de pagamento que fecha a venda sem definir o recebimento. A venda espera na tela Carteira ate o acerto com o cliente.",
    keywords: ["carteira", "em carteira", "acerto"],
    sectionId: "wallet"
  },
  {
    term: "Bonificacao",
    definition:
      "Mercadoria entregue sem cobranca. A nota e emitida, mas nenhuma cobranca nasce dela; o lancamento vai para a conta BONIFICACAO.",
    keywords: ["bonificacao", "brinde", "sem cobranca", "cortesia"],
    sectionId: "payments"
  },
  {
    term: "Condicao de pagamento",
    definition:
      "Quando o cliente paga: a vista ou parcelado, com os dias de vencimento (por exemplo 9/18/27). Define as parcelas no OMIE.",
    keywords: ["condicao", "parcelamento", "prazo", "vencimento"],
    sectionId: "payments"
  },
  {
    term: "Forma de pagamento",
    definition:
      "Como o cliente paga: dinheiro, PIX, cartao, boleto, credito do cliente, em carteira ou bonificacao.",
    keywords: ["forma de pagamento", "meio de pagamento", "como paga"],
    sectionId: "payments"
  },
  {
    term: "Tabela de preco",
    definition:
      "Conjunto de precos por produto que pode ser vinculado a um ou mais clientes, evitando digitar preco a cada carga.",
    keywords: ["tabela de preco", "preco", "lista de preco"],
    sectionId: "registrations"
  },
  {
    term: "Modalidade de frete",
    definition:
      "Quem responde pelo transporte: por conta do cliente, da pedreira ou de terceiro. Vai para o bloco de frete da nota.",
    keywords: ["frete", "modalidade", "cif", "fob", "quem paga"],
    sectionId: "freight"
  },
  {
    term: "Cupom",
    definition:
      "Comprovante de 80 mm impresso no fechamento, com pesos, valores, frete, veiculo e motorista. Nao substitui a nota fiscal.",
    keywords: ["cupom", "ticket", "comprovante", "80mm"],
    sectionId: "printing"
  },
  {
    term: "Unidade",
    definition:
      "A pedreira. Cada unidade tem seu codigo de ativacao, seus usuarios e seus dados separados das demais.",
    keywords: ["unidade", "pedreira", "filial"],
    sectionId: "cloud"
  },
  {
    term: "Ativacao",
    definition:
      "Vinculo do computador com a empresa e a unidade, feito com um codigo de 6 digitos gerado pelo administrador.",
    keywords: ["ativacao", "codigo de 6 digitos", "licenca", "vincular computador"],
    sectionId: "cloud"
  },
  {
    term: "Carregador",
    definition:
      "Operador do patio que ve os carregamentos em aberto no site e marca a carga como concluida. Nao altera peso nem valor.",
    keywords: ["carregador", "loader", "patio", "pa carregadeira"],
    sectionId: "loader"
  },
  {
    term: "Contas a Receber",
    definition:
      "Modulo financeiro do OMIE onde as parcelas geradas pelo faturamento aparecem para cobranca e baixa.",
    keywords: ["contas a receber", "financeiro", "parcelas", "cobranca"],
    sectionId: "omie-billing"
  }
];

// ---------------------------------------------------------------------------
// Suporte
// ---------------------------------------------------------------------------

export const supportChecklist: string[] = [
  "Nome da empresa, unidade (pedreira) e qual computador da balanca.",
  "Data e horario aproximado do problema, e o codigo (COD) ou a placa da operacao envolvida.",
  "Print ou texto exato do erro exibido no KyberRock (ou no OMIE, quando for faturamento).",
  "Status no Painel: internet, nuvem, OMIE, balanca e impressora.",
  "Ultima acao feita antes da falha: entrada, saida, impressao, faturamento ou sincronizacao.",
  "Mudancas recentes: queda de energia, troca de cabo, troca de impressora, alteracao de rede ou atualizacao."
];

export function buildSupportClipboardText(): string {
  return [
    "CHAMADO DE SUPORTE - KYBERROCK",
    "",
    "Empresa / unidade: ",
    "Computador da balanca: ",
    "Data e horario do problema: ",
    "Codigo (COD) ou placa da operacao: ",
    "Erro exibido (texto ou print): ",
    "Status no Painel (internet / nuvem / OMIE / balanca / impressora): ",
    "Ultima acao antes da falha: ",
    "Mudancas recentes (energia, cabos, impressora, rede, atualizacao): "
  ].join("\n");
}
