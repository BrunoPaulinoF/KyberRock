import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Copy,
  FileText,
  HelpCircle,
  Laptop,
  LifeBuoy,
  ListChecks,
  Printer,
  Rocket,
  RotateCcw,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wrench
} from "lucide-react";
import { MountainOutline } from "./MountainOutline";

// ---------------------------------------------------------------------------
// Central de ajuda do KyberRock.
// A tela e organizada em cinco areas navegaveis (Comecar, Guias, Duvidas,
// Diagnostico e Suporte) com busca global. O progresso do usuario (checklist
// de preparacao e passos dos guias) persiste em localStorage para funcionar
// como material de treinamento, nao apenas leitura.
// ---------------------------------------------------------------------------

export type DocumentationTabId = "start" | "guides" | "faq" | "troubleshoot" | "support";

interface DocumentationSection {
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
  | "seguranca";

interface DocumentationFaq {
  question: string;
  answer: string;
  category: DocumentationFaqCategory;
  keywords: string[];
}

interface QuickStartTask {
  id: string;
  label: string;
  description: string;
  sectionId: string;
}

interface OperationFlowStage {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  sectionId: string;
}

interface TroubleshootingFlow {
  id: string;
  title: string;
  symptom: string;
  icon: LucideIcon;
  checks: string[];
  escalation: string;
  keywords: string[];
}

export const documentationSections: DocumentationSection[] = [
  {
    id: "overview",
    title: "Como o KyberRock funciona",
    eyebrow: "Visao geral",
    summary:
      "O sistema controla a operacao da balanca, registra entradas e saidas, imprime cupons, sincroniza com a cloud e envia dados ao OMIE quando configurado.",
    icon: Laptop,
    steps: [
      "Ative o desktop com o codigo da empresa/unidade.",
      "Configure balanca, impressora e cloud no botao de engrenagem do topo.",
      "Cadastre ou sincronize clientes, produtos, veiculos, motoristas, transportadoras e precos.",
      "Registre a entrada do caminhao em Nova entrada.",
      "Acompanhe o carregamento em Operacoes e feche a saida com peso capturado da balanca.",
      "Confira pendencias de sincronizacao no Painel, Insights ou Cloud."
    ],
    details: [
      "O desktop e offline-first: a operacao continua localmente mesmo sem internet e sincroniza depois.",
      "Pesos devem vir da balanca configurada. O sistema nao foi desenhado para lancamento manual de peso.",
      "Cada acao importante deixa rastro de auditoria: entrada, saida, cancelamento, reimpressao e sincronizacao."
    ],
    keywords: ["inicio", "primeiros passos", "desktop", "operacao", "offline", "auditoria"]
  },
  {
    id: "weighing",
    title: "Fluxo de pesagem",
    eyebrow: "Entrada, carregamento e saida",
    summary:
      "Use Nova entrada para abrir a operacao, Operacoes para acompanhar os carregamentos e o fechamento de saida para calcular o peso liquido.",
    icon: Truck,
    steps: [
      "Em Nova entrada, escolha o tipo da operacao: com nota fiscal ou interna.",
      "Selecione placa, cliente, motorista, produto, condicao de pagamento e tabela de preco quando aplicavel.",
      "Defina frete quando houver: por conta do cliente, da pedreira ou de terceiro.",
      "Aguarde o peso estabilizar e capture a entrada.",
      "Depois do carregamento, abra Operacoes, localize a placa e feche a saida.",
      "Confira peso liquido, valores, credito, frete e impressao antes de finalizar."
    ],
    details: [
      "O peso liquido e calculado pela diferenca entre saida e entrada. Saida menor ou igual a entrada deve ser corrigida antes do fechamento.",
      "Se a mesma placa ja estiver em aberto, o sistema alerta para evitar duplicidade.",
      "Cancelamentos exigem motivo e ficam registrados para auditoria."
    ],
    keywords: ["pesagem", "entrada", "saida", "placa", "frete", "peso liquido", "cancelar"]
  },
  {
    id: "scale",
    title: "Integrar balancas",
    eyebrow: "Configuracao de hardware",
    summary:
      "A balanca e configurada em Configuracoes > Balanca. Informe modelo, conexao, porta e regras de estabilidade para capturar pesos automaticamente.",
    icon: Scale,
    steps: [
      "Clique na engrenagem do topo e escolha Balanca.",
      "Selecione o adaptador/modelo disponivel para a sua unidade.",
      "Preencha host/IP, porta, timeout e intervalo de leitura conforme a instalacao da balanca.",
      "Ajuste estabilidade: tempo minimo estavel, variacao maxima, peso minimo e tentativas de reconexao.",
      "Salve a configuracao e teste a leitura antes de operar.",
      "Se precisar simular, use o adaptador virtual somente em ambiente de teste."
    ],
    details: [
      "O modelo Toledo TCP e o primeiro fluxo suportado pela arquitetura atual; novos modelos podem ser adicionados por adaptadores.",
      "Peso instavel normalmente indica oscilacao fisica, cabo/rede ruim, porta errada ou parametro de estabilidade muito sensivel.",
      "Quando a balanca falha, pare a operacao e corrija a conexao antes de capturar pesos."
    ],
    keywords: ["balanca", "toledo", "tcp", "porta", "ip", "host", "estabilidade", "peso"]
  },
  {
    id: "printing",
    title: "Integrar impressoras",
    eyebrow: "Cupons e relatorios",
    summary:
      "Configure impressoras do Windows em Configuracoes > Impressao para emitir cupom termico de 80 mm e relatorios A4.",
    icon: Printer,
    steps: [
      "Instale a impressora no Windows e confirme que ela aparece na lista do sistema.",
      "No KyberRock, clique na engrenagem do topo e escolha Impressao.",
      "Selecione a impressora desejada e crie/ative o perfil do documento.",
      "Use o teste de impressao para validar papel, margem e tamanho.",
      "Ao fechar uma pesagem, imprima o cupom e entregue ao motorista/cliente.",
      "Use reimpressao quando necessario; o cupom fica marcado como segunda via."
    ],
    details: [
      "Falha de impressao nao apaga nem desfaz a operacao fechada.",
      "O cupom mostra dados da pedreira, cliente, produto, pesos, valor, frete, veiculo, motorista e assinatura.",
      "Para relatorios, use os perfis A4 e confira a impressora padrao do Windows."
    ],
    keywords: ["impressora", "impressao", "cupom", "segunda via", "reimpressao", "a4", "80mm"]
  },
  {
    id: "cloud",
    title: "Integrar cloud e OMIE",
    eyebrow: "Sincronizacao",
    summary:
      "A cloud sincroniza operacoes e dados de referencia. O OMIE fica protegido nas Edge Functions e nunca deve ser configurado diretamente no desktop.",
    icon: Cloud,
    steps: [
      "Ative o desktop usando o codigo de 6 digitos da unidade.",
      "Clique na engrenagem do topo e abra Cloud para ver status, fila e sincronizacao.",
      "Use Sincronizar agora quando houver pendencias ou apos voltar a internet.",
      "Para OMIE, cadastre App Key e App Secret no painel administrativo/cloud, nao no computador da balanca.",
      "Aguarde a importacao de clientes, produtos, condicoes, transportadoras e financeiro.",
      "Monitore erros em Cloud, Insights e Logs do topo."
    ],
    details: [
      "A fila local reenvia automaticamente sem duplicar pedidos quando a chave de idempotencia e preservada.",
      "O desktop tem periodo de tolerancia offline para continuar operando apos uma validacao recente.",
      "Dados enviados: operacoes abertas, fechadas, canceladas, cupons, cadastros locais e pedidos para OMIE quando aplicavel."
    ],
    keywords: [
      "cloud",
      "supabase",
      "omie",
      "sincronizacao",
      "fila",
      "pendente",
      "offline",
      "ativacao"
    ]
  },
  {
    id: "registrations",
    title: "Cadastros e precos",
    eyebrow: "Dados mestres",
    summary:
      "A tela Cadastros centraliza clientes, produtos, condicoes, transporte, tabelas de preco e dados usados na operacao diaria.",
    icon: Users,
    steps: [
      "Abra Cadastros pela sidebar.",
      "Revise clientes sincronizados do OMIE ou crie clientes locais quando permitido.",
      "Confira produtos e condicoes de pagamento vindos do OMIE.",
      "Cadastre veiculos, motoristas, transportadoras e vinculos de transporte.",
      "Configure precos por cliente/produto para reduzir erro na entrada.",
      "Antes de operar, confirme documento, telefone, limite de credito e status financeiro do cliente."
    ],
    details: [
      "Campos controlados pelo OMIE podem ficar bloqueados para edicao local para evitar divergencia.",
      "O bloqueio financeiro considera limite, contas a receber e operacoes locais ainda nao sincronizadas.",
      "Credito pre-pago pode ser debitado no fechamento e estornado em cancelamentos quando aplicavel."
    ],
    keywords: [
      "cadastro",
      "cliente",
      "produto",
      "preco",
      "veiculo",
      "motorista",
      "transportadora",
      "credito"
    ]
  },
  {
    id: "loader",
    title: "Site do carregador",
    eyebrow: "Operacao de patio",
    summary:
      "O carregador usa a aplicacao web para ver os carregamentos em aberto da unidade, sem alterar pesos ou dados financeiros.",
    icon: ListChecks,
    steps: [
      "O administrador cria o usuario carregador vinculado a unidade correta.",
      "O carregador acessa o site, entra com login autorizado e ve somente sua unidade.",
      "A lista mostra placa, cliente, motorista, veiculo e produto em aberto.",
      "Quando o desktop atualiza a operacao, a tela do carregador reflete a mudanca pela cloud.",
      "Se uma operacao nao aparecer, confira internet, unidade vinculada e status de sincronizacao do desktop."
    ],
    details: [
      "O carregador tem acesso somente leitura.",
      "Dados sao segregados por empresa e unidade.",
      "Carregadores nao se cadastram sozinhos; o acesso e controlado pelo admin."
    ],
    keywords: ["carregador", "loader", "site", "web", "patio", "unidade", "login"]
  },
  {
    id: "reports",
    title: "Relatorios, insights e fechamento diario",
    eyebrow: "Gestao",
    summary:
      "Use Painel, Insights e Relatorios para acompanhar producao, faturamento, mix de produtos, operacoes canceladas e e-mails de fechamento.",
    icon: FileText,
    steps: [
      "Abra Painel para status operacional, pendencias e alertas rapidos.",
      "Use Insights para acompanhar indicadores e acionar sincronizacoes quando necessario.",
      "Abra Relatorios para cadastrar destinatarios do fechamento diario por e-mail.",
      "Exporte ou imprima relatorios quando o perfil de impressao estiver configurado.",
      "Compare dia, mes, ano, cliente, produto e operacoes internas/fiscais conforme a necessidade."
    ],
    details: [
      "O fechamento diario pode ser enviado automaticamente pela cloud aos destinatarios ativos.",
      "Relatorios dependem dos dados locais e sincronizados; pendencias podem atrasar consolidacoes externas.",
      "Operacoes canceladas devem ser analisadas com motivo e horario para controle interno."
    ],
    keywords: ["relatorio", "insight", "fechamento", "email", "pdf", "excel", "csv", "indicador"]
  },
  {
    id: "security",
    title: "Backup, acesso e seguranca",
    eyebrow: "Confiabilidade",
    summary:
      "O KyberRock protege credenciais, restringe acesso por unidade e mantem dados locais para operacao offline.",
    icon: ShieldCheck,
    steps: [
      "Mantenha o computador da balanca com usuario Windows restrito e energia estavel.",
      "Nao salve chaves OMIE, service role ou senhas em arquivos fora do painel correto.",
      "Confira logs quando houver erro de abertura, sincronizacao ou hardware.",
      "Use backup local antes de manutencoes, troca de computador ou reinstalacao.",
      "Atualize o desktop somente por pacote oficial e valide a versao apos instalar."
    ],
    details: [
      "O banco local fica em ProgramData e deve ser protegido contra copia indevida.",
      "O desktop usa ativacao por dispositivo e validacao periodica online.",
      "Electron roda com isolamento de contexto, sandbox e sem Node no renderer."
    ],
    keywords: ["backup", "seguranca", "acesso", "ativacao", "logs", "atualizacao", "banco"]
  }
];

export const documentationFaqs: DocumentationFaq[] = [
  {
    question: "A balanca nao conecta. O que verificar?",
    answer:
      "Confira se o IP/host e a porta estao corretos, se o cabo/rede esta funcionando, se o indicador aceita conexao TCP e se outro programa nao esta usando a mesma porta. Depois volte em Configuracoes > Balanca e teste novamente.",
    category: "balanca",
    keywords: ["balanca", "tcp", "ip", "porta", "conexao", "host"]
  },
  {
    question: "O peso fica oscilando e nao estabiliza.",
    answer:
      "Verifique a balanca fisicamente, vento/vibracao, caminhao ainda em movimento e parametros de estabilidade. Aumente o tempo minimo estavel ou a tolerancia de variacao somente se a equipe tecnica validar.",
    category: "balanca",
    keywords: ["peso", "estavel", "estabilidade", "oscilando", "captura"]
  },
  {
    question: "A impressora nao aparece na lista.",
    answer:
      "Instale ou reinstale a impressora no Windows, imprima uma pagina de teste pelo proprio Windows e reabra a tela Configuracoes > Impressao. Se for impressora de rede, confirme permissao e nome compartilhado.",
    category: "impressao",
    keywords: ["impressora", "windows", "lista", "driver", "rede"]
  },
  {
    question: "A impressao falhou depois de fechar a operacao.",
    answer:
      "A operacao continua salva. Corrija papel, energia, driver ou perfil de impressao e use reimpressao. A segunda via fica registrada para auditoria.",
    category: "impressao",
    keywords: ["impressora", "impressao", "cupom", "falhou", "reimpressao", "segunda via"]
  },
  {
    question: "Estou sem internet. Posso continuar operando?",
    answer:
      "Sim, se o desktop foi validado recentemente e estiver dentro do periodo de tolerancia offline. As operacoes ficam na fila local e sincronizam quando a internet voltar.",
    category: "cloud",
    keywords: ["internet", "offline", "cloud", "fila", "sincronizacao"]
  },
  {
    question: "Por que uma operacao ficou pendente de cloud ou OMIE?",
    answer:
      "Pode haver internet instavel, credenciais OMIE ausentes, erro de validacao, dependencia nao sincronizada ou falha temporaria da API. Abra Cloud ou Logs, corrija a causa e tente sincronizar novamente.",
    category: "cloud",
    keywords: ["pendente", "cloud", "omie", "sincronizar", "erro", "fila"]
  },
  {
    question: "Posso digitar peso manualmente?",
    answer:
      "Nao. O fluxo operacional foi desenhado para capturar peso direto da balanca configurada, reduzindo erro e fraude. Se a balanca falhar, corrija a integracao antes de operar.",
    category: "operacao",
    keywords: ["manual", "peso", "digitar", "balanca"]
  },
  {
    question: "Como cancelar uma pesagem?",
    answer:
      "Abra Operacoes, localize a operacao e use a acao de cancelamento. Informe um motivo claro. O cancelamento e auditado e pode estornar credito quando aplicavel.",
    category: "operacao",
    keywords: ["cancelar", "cancelamento", "motivo", "auditoria", "credito"]
  },
  {
    question: "O cliente esta bloqueado por credito.",
    answer:
      "Confira limite, contas a receber no OMIE, operacoes locais ainda pendentes e saldo pre-pago. Se o limite estiver zerado ou sem regra de bloqueio, revise o cadastro no OMIE/painel correto.",
    category: "operacao",
    keywords: ["credito", "financeiro", "cliente", "bloqueado", "omie"]
  },
  {
    question: "O carregador nao ve a operacao no site.",
    answer:
      "Verifique se a operacao foi enviada para a cloud, se o carregador esta vinculado a unidade correta e se a internet esta ativa. Depois atualize o site do carregador.",
    category: "cloud",
    keywords: ["carregador", "loader", "site", "unidade", "cloud"]
  },
  {
    question: "Onde encontro os logs tecnicos?",
    answer:
      "Use o botao de configuracoes/logs no topo para erros recentes. Quando o desktop nao abrir, confira o startup.log em AppData Local do KyberRock Desktop.",
    category: "seguranca",
    keywords: ["logs", "erro", "startup", "suporte", "desktop"]
  },
  {
    question: "O que fazer antes de trocar o computador da balanca?",
    answer:
      "Faca backup do banco local, confirme que a cloud esta sincronizada, registre a versao instalada e depois ative o novo dispositivo com o codigo da unidade.",
    category: "seguranca",
    keywords: ["backup", "computador", "troca", "ativacao", "banco"]
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
  { id: "cloud", label: "Cloud e OMIE" },
  { id: "seguranca", label: "Acesso e seguranca" }
];

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
    description: "Informe modelo, IP/host, porta e regras de estabilidade; teste a leitura.",
    sectionId: "scale"
  },
  {
    id: "printer",
    label: "Configurar a impressora",
    description: "Selecione a impressora do Windows, ative o perfil e faca um teste de impressao.",
    sectionId: "printing"
  },
  {
    id: "cloud",
    label: "Conectar a cloud",
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
    id: "transport",
    label: "Cadastrar veiculos e motoristas",
    description: "Cadastre placas, motoristas, transportadoras e vinculos de transporte.",
    sectionId: "registrations"
  },
  {
    id: "test-weighing",
    label: "Fazer uma pesagem de teste",
    description: "Registre entrada, feche a saida e imprima o cupom para validar o ciclo completo.",
    sectionId: "weighing"
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
    description: "Caminhao vazio sobe na balanca. Registre placa, cliente e produto em Nova entrada.",
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
    description: "Imprima o cupom com pesos, valores e frete e entregue ao motorista.",
    icon: Printer,
    sectionId: "printing"
  },
  {
    id: "sync",
    title: "Sincronizacao",
    description: "A operacao fechada vai para a fila local e sobe para cloud e OMIE.",
    icon: Cloud,
    sectionId: "cloud"
  }
];

export const troubleshootingFlows: TroubleshootingFlow[] = [
  {
    id: "scale-connection",
    title: "Balanca nao conecta",
    symptom: "O sistema nao le peso ou mostra erro de conexao com a balanca.",
    icon: Scale,
    checks: [
      "Confirme que o indicador da balanca esta ligado e sem mensagem de erro no visor.",
      "Verifique o cabo de rede entre o indicador e o computador e se os conectores estao firmes.",
      "Abra Configuracoes > Balanca e confira IP/host e porta exatamente como na instalacao original.",
      "Garanta que nenhum outro programa esta conectado na mesma porta da balanca.",
      "Salve a configuracao novamente e use o teste de leitura da propria tela."
    ],
    escalation:
      "Se seguir sem conexao, anote o modelo do indicador, IP, porta e o texto do erro exibido antes de acionar o suporte.",
    keywords: ["balanca", "conexao", "tcp", "ip", "porta", "erro", "nao conecta"]
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
      "Revise com a equipe tecnica os parametros de estabilidade (tempo minimo estavel e variacao maxima)."
    ],
    escalation:
      "Se o indicador fisico estiver estavel e o sistema nao, registre o comportamento e acione o suporte com os parametros configurados.",
    keywords: ["peso", "instavel", "oscilando", "estabilidade", "captura"]
  },
  {
    id: "printer",
    title: "Impressora nao imprime",
    symptom: "O cupom ou relatorio nao sai, ou a impressora nao aparece na lista.",
    icon: Printer,
    checks: [
      "Confira papel, tampa e luz de erro na propria impressora.",
      "Imprima uma pagina de teste pelo Windows para isolar se o problema e do sistema ou do driver.",
      "Se a impressora nao aparece na lista, reinstale o driver no Windows e reabra Configuracoes > Impressao.",
      "Confirme que o perfil de impressao correto esta ativo para o documento (cupom 80 mm ou A4).",
      "Se a operacao ja foi fechada, use a reimpressao: a falha de impressao nao desfaz a pesagem."
    ],
    escalation:
      "Persistindo, anote modelo da impressora, se e USB ou rede, e o comportamento do teste do Windows antes de chamar o suporte.",
    keywords: ["impressora", "cupom", "driver", "windows", "reimpressao", "nao imprime"]
  },
  {
    id: "sync-pending",
    title: "Operacao pendente de cloud ou OMIE",
    symptom: "Operacoes fechadas aparecem como pendentes de sincronizacao ha muito tempo.",
    icon: Cloud,
    checks: [
      "Confira a internet do computador da balanca abrindo qualquer site.",
      "Abra a tela Cloud e veja o status da fila e a mensagem de erro da pendencia.",
      "Use Sincronizar agora e acompanhe se a pendencia diminui.",
      "Para pendencias de OMIE, confirme com o administrador se as credenciais estao validas no painel.",
      "Consulte os Logs do topo para identificar a causa exata do erro."
    ],
    escalation:
      "A operacao local esta salva e nao se perde. Se a pendencia persistir apos a internet voltar, envie o texto do erro dos Logs ao suporte.",
    keywords: ["pendente", "sincronizacao", "cloud", "omie", "fila", "erro"]
  },
  {
    id: "credit-blocked",
    title: "Cliente bloqueado por credito",
    symptom: "O sistema impede a entrada ou o fechamento por bloqueio financeiro do cliente.",
    icon: Users,
    checks: [
      "Abra o cadastro do cliente e confira limite de credito e status financeiro.",
      "Verifique contas a receber em aberto no OMIE.",
      "Considere operacoes locais fechadas e ainda nao sincronizadas: elas tambem consomem limite.",
      "Para clientes pre-pagos, confira o saldo disponivel antes da operacao."
    ],
    escalation:
      "Liberacao de credito e uma decisao do financeiro: ajuste limite ou baixa de titulos no OMIE/painel e sincronize novamente.",
    keywords: ["credito", "bloqueado", "financeiro", "limite", "cliente"]
  },
  {
    id: "loader-missing",
    title: "Carregador nao ve a operacao",
    symptom: "A operacao aberta no desktop nao aparece no site do carregador.",
    icon: ListChecks,
    checks: [
      "Confirme que o desktop esta com internet e que a operacao foi enviada para a cloud.",
      "Verifique se o usuario carregador esta vinculado a mesma unidade da operacao.",
      "Peca ao carregador para atualizar a pagina e conferir a propria internet.",
      "Confira pendencias de sincronizacao na tela Cloud do desktop."
    ],
    escalation:
      "Se a operacao sincronizou e mesmo assim nao aparece, informe ao suporte o usuario do carregador e a placa da operacao.",
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
      "Quando o desktop nem abre, consulte o startup.log em AppData Local do KyberRock Desktop."
    ],
    escalation:
      "Envie ao suporte o conteudo do startup.log e a versao instalada. Nao reinstale antes de fazer backup do banco local.",
    keywords: ["desktop", "nao abre", "ativacao", "bloqueio", "startup", "licenca"]
  }
];

export const supportChecklist: string[] = [
  "Nome da empresa, unidade e computador da balanca.",
  "Horario aproximado do problema e placa da operacao, se existir.",
  "Print ou texto do erro exibido no KyberRock.",
  "Status de internet, cloud, OMIE, balanca e impressora no Painel.",
  "Ultima acao feita antes da falha: entrada, saida, impressao ou sincronizacao.",
  "Se houve queda de energia, troca de cabo, troca de impressora ou alteracao de rede."
];

// ---------------------------------------------------------------------------
// Busca e helpers puros (testaveis sem renderizar)
// ---------------------------------------------------------------------------

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sectionSearchText(section: DocumentationSection): string {
  return [
    section.title,
    section.eyebrow,
    section.summary,
    ...section.steps,
    ...section.details,
    ...section.keywords
  ].join(" ");
}

function faqSearchText(faq: DocumentationFaq): string {
  return [faq.question, faq.answer, ...faq.keywords].join(" ");
}

function flowSearchText(flow: TroubleshootingFlow): string {
  return [flow.title, flow.symptom, ...flow.checks, flow.escalation, ...flow.keywords].join(" ");
}

function matchesSearchQuery(searchText: string, query: string): boolean {
  const normalizedText = normalizeSearchText(searchText);
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

  return terms.every((term) => normalizedText.includes(term));
}

export function filterDocumentationContent(query: string): {
  sections: DocumentationSection[];
  faqs: DocumentationFaq[];
} {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return { sections: documentationSections, faqs: documentationFaqs };
  }

  return {
    sections: documentationSections.filter((section) =>
      matchesSearchQuery(sectionSearchText(section), normalizedQuery)
    ),
    faqs: documentationFaqs.filter((faq) => matchesSearchQuery(faqSearchText(faq), normalizedQuery))
  };
}

export function filterTroubleshootingFlows(query: string): TroubleshootingFlow[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return troubleshootingFlows;
  }

  return troubleshootingFlows.filter((flow) =>
    matchesSearchQuery(flowSearchText(flow), normalizedQuery)
  );
}

export function filterFaqsByCategory(
  category: DocumentationFaqCategory | "all"
): DocumentationFaq[] {
  if (category === "all") {
    return documentationFaqs;
  }

  return documentationFaqs.filter((faq) => faq.category === category);
}

export function buildSupportClipboardText(): string {
  return [
    "CHAMADO DE SUPORTE - KYBERROCK",
    "",
    "Empresa / unidade: ",
    "Computador da balanca: ",
    "Data e horario do problema: ",
    "Placa da operacao (se houver): ",
    "Erro exibido (texto ou print): ",
    "Status no Painel (internet / cloud / OMIE / balanca / impressora): ",
    "Ultima acao antes da falha: ",
    "Mudancas recentes (energia, cabos, impressora, rede): "
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Persistencia local do progresso (treinamento)
// ---------------------------------------------------------------------------

const QUICK_START_STORAGE_KEY = "kyberrock.docs.quickstart.v1";
const GUIDE_STEPS_STORAGE_KEY = "kyberrock.docs.guide-steps.v1";

function loadStoredJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function loadStoredStringArray(key: string): string[] {
  const stored = loadStoredJson(key);
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
}

function loadStoredNumberArrayRecord(key: string): Record<string, number[]> {
  const stored = loadStoredJson(key);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }

  const result: Record<string, number[]> = {};
  for (const [entryKey, entryValue] of Object.entries(stored)) {
    if (Array.isArray(entryValue)) {
      result[entryKey] = entryValue.filter((item): item is number => typeof item === "number");
    }
  }
  return result;
}

function storeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem localStorage (ou cheio): o progresso simplesmente nao persiste.
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

const documentationTabs: Array<{ id: DocumentationTabId; label: string; icon: LucideIcon }> = [
  { id: "start", label: "Comecar", icon: Rocket },
  { id: "guides", label: "Guias", icon: BookOpen },
  { id: "faq", label: "Duvidas", icon: HelpCircle },
  { id: "troubleshoot", label: "Diagnostico", icon: Wrench },
  { id: "support", label: "Suporte", icon: LifeBuoy }
];

export function DocumentationView() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [activeTab, setActiveTab] = useState<DocumentationTabId>("start");
  const [activeSectionId, setActiveSectionId] = useState(documentationSections[0]?.id ?? "");
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [faqCategory, setFaqCategory] = useState<DocumentationFaqCategory | "all">("all");
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);

  const [doneQuickStart, setDoneQuickStart] = useState<string[]>(() =>
    loadStoredStringArray(QUICK_START_STORAGE_KEY)
  );
  const [doneGuideSteps, setDoneGuideSteps] = useState<Record<string, number[]>>(() =>
    loadStoredNumberArrayRecord(GUIDE_STEPS_STORAGE_KEY)
  );

  useEffect(() => {
    storeJson(QUICK_START_STORAGE_KEY, doneQuickStart);
  }, [doneQuickStart]);

  useEffect(() => {
    storeJson(GUIDE_STEPS_STORAGE_KEY, doneGuideSteps);
  }, [doneGuideSteps]);

  const hasSearch = deferredSearch.trim().length > 0;
  const searchResults = useMemo(
    () => ({
      ...filterDocumentationContent(deferredSearch),
      flows: filterTroubleshootingFlows(deferredSearch)
    }),
    [deferredSearch]
  );
  const totalResults = hasSearch
    ? searchResults.sections.length + searchResults.faqs.length + searchResults.flows.length
    : 0;

  const openGuide = (sectionId: string) => {
    setActiveSectionId(sectionId);
    setActiveTab("guides");
    setSearch("");
  };

  const openFaq = (question: string) => {
    setFaqCategory("all");
    setExpandedFaq(question);
    setActiveTab("faq");
    setSearch("");
  };

  const openFlow = (flowId: string) => {
    setActiveFlowId(flowId);
    setActiveTab("troubleshoot");
    setSearch("");
  };

  const toggleQuickStartTask = (taskId: string) => {
    setDoneQuickStart((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  };

  const toggleGuideStep = (sectionId: string, stepIndex: number) => {
    setDoneGuideSteps((current) => {
      const done = current[sectionId] ?? [];
      const next = done.includes(stepIndex)
        ? done.filter((index) => index !== stepIndex)
        : [...done, stepIndex];
      return { ...current, [sectionId]: next };
    });
  };

  const resetGuideSteps = (sectionId: string) => {
    setDoneGuideSteps((current) => ({ ...current, [sectionId]: [] }));
  };

  return (
    <section style={styles.page} aria-labelledby="documentation-title">
      <style>{documentationCss}</style>

      <header style={styles.hero}>
        <MountainOutline
          opacity={0.3}
          style={{
            position: "absolute",
            left: "-6px",
            bottom: "-8px",
            width: "210px",
            height: "79px",
            pointerEvents: "none",
            zIndex: 0
          }}
        />
        <div style={styles.heroText}>
          <p style={styles.kicker}>Central de ajuda</p>
          <h1 id="documentation-title" style={styles.title}>
            Como operar o KyberRock
          </h1>
          <p style={styles.subtitle}>
            Guias passo a passo, respostas rapidas e diagnostico de problemas para operar a
            balanca com seguranca.
          </p>
        </div>
        <div style={styles.heroSearch}>
          <label style={styles.searchLabel} htmlFor="documentation-search">
            <Search size={15} />
            Qual e a sua duvida?
          </label>
          <div style={styles.searchRow}>
            <input
              id="documentation-search"
              className="krdoc-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ex.: balanca nao conecta, reimpressao, credito..."
              style={styles.searchInput}
            />
            {search ? (
              <button
                type="button"
                className="krdoc-ghost-btn"
                onClick={() => setSearch("")}
                style={styles.clearButton}
              >
                Limpar
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <nav aria-label="Areas da documentacao" style={styles.tabBar} role="tablist">
        {documentationTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = !hasSearch && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? "krdoc-tab krdoc-tab-active" : "krdoc-tab"}
              onClick={() => {
                setActiveTab(tab.id);
                setSearch("");
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {hasSearch ? (
        <SearchResultsPanel
          query={deferredSearch}
          totalResults={totalResults}
          sections={searchResults.sections}
          faqs={searchResults.faqs}
          flows={searchResults.flows}
          onOpenGuide={openGuide}
          onOpenFaq={openFaq}
          onOpenFlow={openFlow}
        />
      ) : (
        <>
          {activeTab === "start" ? (
            <StartTab
              doneTasks={doneQuickStart}
              onToggleTask={toggleQuickStartTask}
              onOpenGuide={openGuide}
            />
          ) : null}
          {activeTab === "guides" ? (
            <GuidesTab
              activeSectionId={activeSectionId}
              onSelectSection={setActiveSectionId}
              doneSteps={doneGuideSteps}
              onToggleStep={toggleGuideStep}
              onResetSteps={resetGuideSteps}
            />
          ) : null}
          {activeTab === "faq" ? (
            <FaqTab
              category={faqCategory}
              onSelectCategory={(next) => {
                setFaqCategory(next);
                setExpandedFaq(null);
              }}
              expandedQuestion={expandedFaq}
              onToggleQuestion={(question) =>
                setExpandedFaq((current) => (current === question ? null : question))
              }
            />
          ) : null}
          {activeTab === "troubleshoot" ? (
            <TroubleshootTab
              activeFlowId={activeFlowId}
              onSelectFlow={setActiveFlowId}
              onOpenSupport={() => setActiveTab("support")}
            />
          ) : null}
          {activeTab === "support" ? <SupportTab /> : null}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Busca global
// ---------------------------------------------------------------------------

function SearchResultsPanel({
  query,
  totalResults,
  sections,
  faqs,
  flows,
  onOpenGuide,
  onOpenFaq,
  onOpenFlow
}: {
  query: string;
  totalResults: number;
  sections: DocumentationSection[];
  faqs: DocumentationFaq[];
  flows: TroubleshootingFlow[];
  onOpenGuide: (sectionId: string) => void;
  onOpenFaq: (question: string) => void;
  onOpenFlow: (flowId: string) => void;
}) {
  if (totalResults === 0) {
    return (
      <div style={styles.emptyState}>
        <AlertTriangle size={24} />
        <strong>Nenhum resultado para &quot;{query}&quot;.</strong>
        <span>Tente termos mais simples, como balanca, impressora, cloud ou credito.</span>
      </div>
    );
  }

  return (
    <div style={styles.searchResults}>
      <p style={styles.searchHint}>
        {totalResults} resultado(s) para &quot;{query}&quot;. Clique para abrir.
      </p>

      {sections.length > 0 ? (
        <div style={styles.resultGroup}>
          <h2 style={styles.resultGroupTitle}>
            <BookOpen size={15} /> Guias
          </h2>
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                className="krdoc-result"
                onClick={() => onOpenGuide(section.id)}
              >
                <span style={styles.resultIcon}>
                  <Icon size={16} />
                </span>
                <span style={styles.resultText}>
                  <strong>{section.title}</strong>
                  <small>{section.summary}</small>
                </span>
                <ArrowRight size={15} style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      ) : null}

      {faqs.length > 0 ? (
        <div style={styles.resultGroup}>
          <h2 style={styles.resultGroupTitle}>
            <HelpCircle size={15} /> Duvidas
          </h2>
          {faqs.map((faq) => (
            <button
              key={faq.question}
              type="button"
              className="krdoc-result"
              onClick={() => onOpenFaq(faq.question)}
            >
              <span style={styles.resultIcon}>
                <HelpCircle size={16} />
              </span>
              <span style={styles.resultText}>
                <strong>{faq.question}</strong>
                <small>{faq.answer}</small>
              </span>
              <ArrowRight size={15} style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      ) : null}

      {flows.length > 0 ? (
        <div style={styles.resultGroup}>
          <h2 style={styles.resultGroupTitle}>
            <Wrench size={15} /> Diagnostico
          </h2>
          {flows.map((flow) => {
            const Icon = flow.icon;
            return (
              <button
                key={flow.id}
                type="button"
                className="krdoc-result"
                onClick={() => onOpenFlow(flow.id)}
              >
                <span style={styles.resultIcon}>
                  <Icon size={16} />
                </span>
                <span style={styles.resultText}>
                  <strong>{flow.title}</strong>
                  <small>{flow.symptom}</small>
                </span>
                <ArrowRight size={15} style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Comecar
// ---------------------------------------------------------------------------

function StartTab({
  doneTasks,
  onToggleTask,
  onOpenGuide
}: {
  doneTasks: string[];
  onToggleTask: (taskId: string) => void;
  onOpenGuide: (sectionId: string) => void;
}) {
  const doneCount = quickStartTasks.filter((task) => doneTasks.includes(task.id)).length;
  const progressPercent = Math.round((doneCount / quickStartTasks.length) * 100);

  return (
    <div style={styles.startGrid}>
      <section style={styles.panel} aria-labelledby="quickstart-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Rocket size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="quickstart-title" style={styles.panelTitle}>
              Preparacao da unidade
            </h2>
            <p style={styles.panelDescription}>
              Marque cada etapa concluida. O progresso fica salvo neste computador.
            </p>
          </div>
          <span style={styles.progressBadge}>
            {doneCount}/{quickStartTasks.length}
          </span>
        </div>
        <div
          style={styles.progressTrack}
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da preparacao"
        >
          <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
        </div>
        <ul style={styles.taskList}>
          {quickStartTasks.map((task) => {
            const done = doneTasks.includes(task.id);
            return (
              <li key={task.id}>
                <div className={done ? "krdoc-task krdoc-task-done" : "krdoc-task"}>
                  <label style={styles.taskLabel}>
                    <input
                      type="checkbox"
                      className="krdoc-check"
                      checked={done}
                      onChange={() => onToggleTask(task.id)}
                    />
                    <span style={styles.taskText}>
                      <strong style={done ? styles.taskTitleDone : styles.taskTitle}>
                        {task.label}
                      </strong>
                      <small style={styles.taskDescription}>{task.description}</small>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="krdoc-ghost-btn"
                    style={styles.taskGuideButton}
                    onClick={() => onOpenGuide(task.sectionId)}
                  >
                    Ver guia
                    <ArrowRight size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section style={styles.panel} aria-labelledby="flow-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Truck size={18} />
          </span>
          <div>
            <h2 id="flow-title" style={styles.panelTitle}>
              Ciclo de uma pesagem
            </h2>
            <p style={styles.panelDescription}>
              Toda operacao passa por estas etapas. Clique em uma etapa para abrir o guia.
            </p>
          </div>
        </div>
        <ol style={styles.flowList}>
          {operationFlowStages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.id} style={styles.flowItem}>
                <button
                  type="button"
                  className="krdoc-flow-stage"
                  onClick={() => onOpenGuide(stage.sectionId)}
                >
                  <span style={styles.flowStep}>{index + 1}</span>
                  <span style={styles.flowIcon}>
                    <Icon size={17} />
                  </span>
                  <span style={styles.flowText}>
                    <strong>{stage.title}</strong>
                    <small>{stage.description}</small>
                  </span>
                </button>
                {index < operationFlowStages.length - 1 ? (
                  <span style={styles.flowConnector} aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
        <div style={styles.startHintCard}>
          <CheckCircle2 size={16} />
          <span>
            Com problema agora? Abra a aba <strong>Diagnostico</strong> e siga as verificacoes
            guiadas antes de chamar o suporte.
          </span>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Guias
// ---------------------------------------------------------------------------

function GuidesTab({
  activeSectionId,
  onSelectSection,
  doneSteps,
  onToggleStep,
  onResetSteps
}: {
  activeSectionId: string;
  onSelectSection: (sectionId: string) => void;
  doneSteps: Record<string, number[]>;
  onToggleStep: (sectionId: string, stepIndex: number) => void;
  onResetSteps: (sectionId: string) => void;
}) {
  const activeIndex = Math.max(
    0,
    documentationSections.findIndex((section) => section.id === activeSectionId)
  );
  const activeSection = documentationSections[activeIndex];
  const previousSection = documentationSections[activeIndex - 1];
  const nextSection = documentationSections[activeIndex + 1];
  const sectionDone = doneSteps[activeSection.id] ?? [];
  const doneCount = activeSection.steps.filter((_, index) => sectionDone.includes(index)).length;
  const Icon = activeSection.icon;

  return (
    <div style={styles.guidesGrid}>
      <nav aria-label="Guias disponiveis" style={styles.guideNav}>
        {documentationSections.map((section) => {
          const SectionIcon = section.icon;
          const isActive = section.id === activeSection.id;
          const sectionSteps = doneSteps[section.id] ?? [];
          const completed =
            section.steps.filter((_, index) => sectionSteps.includes(index)).length ===
            section.steps.length;
          return (
            <button
              key={section.id}
              type="button"
              className={isActive ? "krdoc-nav-item krdoc-nav-item-active" : "krdoc-nav-item"}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelectSection(section.id)}
            >
              <span style={styles.navIcon}>
                <SectionIcon size={16} />
              </span>
              <span style={styles.navText}>
                <strong>{section.title}</strong>
                <small>{section.eyebrow}</small>
              </span>
              {completed ? (
                <CheckCircle2 size={15} style={{ color: "var(--kr-success)", flexShrink: 0 }} />
              ) : null}
            </button>
          );
        })}
      </nav>

      <article style={styles.guideContent} aria-labelledby={`guide-${activeSection.id}`}>
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Icon size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={styles.cardEyebrow}>{activeSection.eyebrow}</p>
            <h2 id={`guide-${activeSection.id}`} style={styles.panelTitle}>
              {activeSection.title}
            </h2>
            <p style={styles.panelDescription}>{activeSection.summary}</p>
          </div>
        </div>

        <div style={styles.guideStepsHeader}>
          <h3 style={styles.blockTitle}>Passo a passo</h3>
          <div style={styles.guideStepsMeta}>
            <span style={styles.guideStepsCount}>
              {doneCount} de {activeSection.steps.length} passos conferidos
            </span>
            {doneCount > 0 ? (
              <button
                type="button"
                className="krdoc-ghost-btn"
                style={styles.resetButton}
                onClick={() => onResetSteps(activeSection.id)}
              >
                <RotateCcw size={13} />
                Reiniciar
              </button>
            ) : null}
          </div>
        </div>

        <ol style={styles.guideStepList}>
          {activeSection.steps.map((step, index) => {
            const done = sectionDone.includes(index);
            return (
              <li key={step}>
                <label className={done ? "krdoc-step krdoc-step-done" : "krdoc-step"}>
                  <input
                    type="checkbox"
                    className="krdoc-check"
                    checked={done}
                    onChange={() => onToggleStep(activeSection.id, index)}
                  />
                  <span style={styles.stepNumber}>{index + 1}</span>
                  <span style={done ? styles.stepTextDone : styles.stepText}>{step}</span>
                </label>
              </li>
            );
          })}
        </ol>

        <div style={styles.detailBox}>
          <h3 style={styles.blockTitle}>Pontos importantes</h3>
          <ul style={styles.detailList}>
            {activeSection.details.map((detail) => (
              <li key={detail} style={styles.detailItem}>
                {detail}
              </li>
            ))}
          </ul>
        </div>

        <div style={styles.guidePager}>
          {previousSection ? (
            <button
              type="button"
              className="krdoc-ghost-btn"
              style={styles.pagerButton}
              onClick={() => onSelectSection(previousSection.id)}
            >
              <ArrowLeft size={14} />
              {previousSection.title}
            </button>
          ) : (
            <span />
          )}
          {nextSection ? (
            <button
              type="button"
              className="krdoc-ghost-btn"
              style={styles.pagerButton}
              onClick={() => onSelectSection(nextSection.id)}
            >
              {nextSection.title}
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Duvidas (FAQ)
// ---------------------------------------------------------------------------

function FaqTab({
  category,
  onSelectCategory,
  expandedQuestion,
  onToggleQuestion
}: {
  category: DocumentationFaqCategory | "all";
  onSelectCategory: (category: DocumentationFaqCategory | "all") => void;
  expandedQuestion: string | null;
  onToggleQuestion: (question: string) => void;
}) {
  const faqs = filterFaqsByCategory(category);

  return (
    <section style={styles.panel} aria-labelledby="faq-title">
      <div style={styles.panelHeader}>
        <span style={styles.headerIcon}>
          <HelpCircle size={18} />
        </span>
        <div>
          <h2 id="faq-title" style={styles.panelTitle}>
            Duvidas comuns
          </h2>
          <p style={styles.panelDescription}>
            Clique em uma pergunta para ver a resposta. Filtre por assunto para achar mais rapido.
          </p>
        </div>
      </div>

      <div style={styles.categoryRow} role="group" aria-label="Filtrar duvidas por assunto">
        {documentationFaqCategories.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === category ? "krdoc-chip krdoc-chip-active" : "krdoc-chip"}
            aria-pressed={option.id === category}
            onClick={() => onSelectCategory(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={styles.faqList}>
        {faqs.map((faq) => {
          const expanded = expandedQuestion === faq.question;
          return (
            <div key={faq.question} className="krdoc-faq-item">
              <button
                type="button"
                className="krdoc-faq-question"
                aria-expanded={expanded}
                onClick={() => onToggleQuestion(faq.question)}
              >
                <span style={styles.faqQuestionText}>{faq.question}</span>
                <ChevronDown
                  size={16}
                  style={{
                    flexShrink: 0,
                    transition: "transform 0.15s ease",
                    transform: expanded ? "rotate(180deg)" : "none"
                  }}
                />
              </button>
              {expanded ? <p style={styles.faqAnswer}>{faq.answer}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Diagnostico
// ---------------------------------------------------------------------------

function TroubleshootTab({
  activeFlowId,
  onSelectFlow,
  onOpenSupport
}: {
  activeFlowId: string | null;
  onSelectFlow: (flowId: string | null) => void;
  onOpenSupport: () => void;
}) {
  // As verificacoes do diagnostico sao por incidente, entao o estado e
  // proposital nao persistido: cada novo problema comeca do zero.
  const [doneChecks, setDoneChecks] = useState<Record<string, number[]>>({});
  const activeFlow = troubleshootingFlows.find((flow) => flow.id === activeFlowId) ?? null;

  if (!activeFlow) {
    return (
      <section style={styles.panel} aria-labelledby="troubleshoot-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Wrench size={18} />
          </span>
          <div>
            <h2 id="troubleshoot-title" style={styles.panelTitle}>
              Diagnostico guiado
            </h2>
            <p style={styles.panelDescription}>
              Escolha o problema que esta acontecendo para seguir as verificacoes na ordem certa.
            </p>
          </div>
        </div>
        <div style={styles.flowGrid}>
          {troubleshootingFlows.map((flow) => {
            const Icon = flow.icon;
            return (
              <button
                key={flow.id}
                type="button"
                className="krdoc-problem-card"
                onClick={() => onSelectFlow(flow.id)}
              >
                <span style={styles.resultIcon}>
                  <Icon size={17} />
                </span>
                <span style={styles.resultText}>
                  <strong>{flow.title}</strong>
                  <small>{flow.symptom}</small>
                </span>
                <ArrowRight size={15} style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const flowDone = doneChecks[activeFlow.id] ?? [];
  const FlowIcon = activeFlow.icon;

  const toggleCheck = (index: number) => {
    setDoneChecks((current) => {
      const done = current[activeFlow.id] ?? [];
      const next = done.includes(index)
        ? done.filter((item) => item !== index)
        : [...done, index];
      return { ...current, [activeFlow.id]: next };
    });
  };

  return (
    <section style={styles.panel} aria-labelledby="troubleshoot-flow-title">
      <button
        type="button"
        className="krdoc-ghost-btn"
        style={styles.backButton}
        onClick={() => onSelectFlow(null)}
      >
        <ArrowLeft size={14} />
        Todos os problemas
      </button>

      <div style={styles.panelHeader}>
        <span style={styles.headerIcon}>
          <FlowIcon size={18} />
        </span>
        <div>
          <h2 id="troubleshoot-flow-title" style={styles.panelTitle}>
            {activeFlow.title}
          </h2>
          <p style={styles.panelDescription}>{activeFlow.symptom}</p>
        </div>
      </div>

      <p style={styles.troubleshootHint}>
        Siga as verificacoes na ordem e marque as que ja fez. Teste o sistema apos cada passo.
      </p>

      <ol style={styles.guideStepList}>
        {activeFlow.checks.map((check, index) => {
          const done = flowDone.includes(index);
          return (
            <li key={check}>
              <label className={done ? "krdoc-step krdoc-step-done" : "krdoc-step"}>
                <input
                  type="checkbox"
                  className="krdoc-check"
                  checked={done}
                  onChange={() => toggleCheck(index)}
                />
                <span style={styles.stepNumber}>{index + 1}</span>
                <span style={done ? styles.stepTextDone : styles.stepText}>{check}</span>
              </label>
            </li>
          );
        })}
      </ol>

      <div style={styles.escalationBox}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={styles.escalationTitle}>Nao resolveu?</strong>
          <p style={styles.escalationText}>{activeFlow.escalation}</p>
          <button
            type="button"
            className="krdoc-ghost-btn"
            style={styles.pagerButton}
            onClick={onOpenSupport}
          >
            <LifeBuoy size={14} />
            Abrir checklist de suporte
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Suporte
// ---------------------------------------------------------------------------

function SupportTab() {
  const [copied, setCopied] = useState(false);

  const copyChecklist = async () => {
    const text = buildSupportClipboardText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para contextos sem a Clipboard API (ex.: janela sem foco).
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={styles.supportGrid}>
      <section style={styles.panel} aria-labelledby="support-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <LifeBuoy size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="support-title" style={styles.panelTitle}>
              Antes de chamar o suporte
            </h2>
            <p style={styles.panelDescription}>
              Colete estas informacoes para acelerar o diagnostico do problema.
            </p>
          </div>
          <button
            type="button"
            className="krdoc-ghost-btn"
            style={styles.copyButton}
            onClick={() => void copyChecklist()}
          >
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            {copied ? "Copiado!" : "Copiar modelo"}
          </button>
        </div>
        <div style={styles.checklistGrid}>
          {supportChecklist.map((item) => (
            <div key={item} style={styles.checklistItem}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p style={styles.supportFootnote}>
          O botao Copiar modelo gera um texto pronto para preencher e enviar ao suporte por
          e-mail ou mensagem.
        </p>
      </section>

      <section style={styles.panel} aria-labelledby="logs-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Settings size={18} />
          </span>
          <div>
            <h2 id="logs-title" style={styles.panelTitle}>
              Onde encontrar os logs
            </h2>
            <p style={styles.panelDescription}>
              Os logs ajudam o suporte a entender exatamente o que aconteceu.
            </p>
          </div>
        </div>
        <ul style={styles.detailList}>
          <li style={styles.detailItem}>
            <strong>Erros recentes:</strong> use o botao de logs no topo do aplicativo para ver
            falhas de sincronizacao, balanca e impressao.
          </li>
          <li style={styles.detailItem}>
            <strong>Desktop nao abre:</strong> consulte o arquivo startup.log em AppData Local do
            KyberRock Desktop no Windows.
          </li>
          <li style={styles.detailItem}>
            <strong>Antes de reinstalar:</strong> sempre faca backup do banco local. A operacao
            fechada nunca deve ser perdida.
          </li>
        </ul>
        <div style={styles.startHintCard}>
          <ShieldCheck size={16} />
          <span>
            Nunca envie chaves OMIE, senhas ou o arquivo do banco de dados por canais inseguros.
          </span>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

// Estados interativos (hover/focus) nao sao possiveis com style inline, entao
// os componentes clicaveis usam classes com o prefixo krdoc-.
const documentationCss = `
  .krdoc-input:focus {
    outline: none;
    border-color: var(--kr-accent);
    box-shadow: 0 0 0 3px var(--kr-focus-ring);
  }
  .krdoc-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-tab:hover {
    background: var(--kr-card-hover);
    color: var(--kr-text-strong);
  }
  .krdoc-tab-active,
  .krdoc-tab-active:hover {
    background: var(--kr-primary-strong);
    border-color: var(--kr-primary-strong);
    color: var(--kr-primary-text);
  }
  .krdoc-ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-text-strong);
    border-radius: 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-ghost-btn:hover {
    background: var(--kr-card-hover);
    border-color: var(--kr-accent);
  }
  .krdoc-check {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin: 2px 0 0 0;
    accent-color: var(--kr-accent);
    cursor: pointer;
  }
  .krdoc-task {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    transition: border-color 0.12s ease;
  }
  .krdoc-task:hover {
    border-color: var(--kr-accent);
  }
  .krdoc-task-done {
    border-color: var(--kr-success-border);
    background: var(--kr-success-soft);
  }
  .krdoc-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--kr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-nav-item:hover {
    background: var(--kr-card-hover);
  }
  .krdoc-nav-item-active,
  .krdoc-nav-item-active:hover {
    background: var(--kr-accent-soft);
    border-color: var(--kr-accent-border);
  }
  .krdoc-step {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    cursor: pointer;
    transition: border-color 0.12s ease;
  }
  .krdoc-step:hover {
    border-color: var(--kr-accent);
  }
  .krdoc-step-done {
    border-color: var(--kr-success-border);
    background: var(--kr-success-soft);
  }
  .krdoc-chip {
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-chip:hover {
    color: var(--kr-text-strong);
    border-color: var(--kr-accent);
  }
  .krdoc-chip-active,
  .krdoc-chip-active:hover {
    background: var(--kr-accent-soft);
    border-color: var(--kr-accent-border);
    color: var(--kr-info-text);
  }
  .krdoc-faq-item {
    border: 1px solid var(--kr-border);
    border-radius: 12px;
    background: var(--kr-surface-soft);
    overflow: hidden;
  }
  .krdoc-faq-question {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 11px 12px;
    border: none;
    background: transparent;
    color: var(--kr-text-strong);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }
  .krdoc-faq-question:hover {
    background: var(--kr-card-hover);
  }
  .krdoc-result,
  .krdoc-problem-card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 11px 12px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    color: var(--kr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .krdoc-result:hover,
  .krdoc-problem-card:hover {
    border-color: var(--kr-accent);
    background: var(--kr-card-hover);
  }
  .krdoc-flow-stage {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    color: var(--kr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease;
  }
  .krdoc-flow-stage:hover {
    border-color: var(--kr-accent);
  }
`;

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "12px",
    minHeight: 0,
    alignContent: "start"
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(240px, 360px)",
    gap: "14px",
    alignItems: "center",
    padding: "18px",
    borderRadius: "18px",
    background: "#1c1917",
    border: "1px solid #292524",
    color: "#ffffff",
    boxShadow: "0 18px 45px rgba(28, 25, 23, 0.2)"
  },
  heroText: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "6px"
  },
  kicker: {
    margin: 0,
    color: "#fde68a",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    fontSize: "26px",
    lineHeight: 1.05,
    color: "#ffffff"
  },
  subtitle: {
    margin: 0,
    color: "#e7e5e4",
    fontSize: "13px",
    lineHeight: 1.45,
    maxWidth: "620px"
  },
  heroSearch: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)"
  },
  searchLabel: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: "#fafaf9",
    fontWeight: 800,
    fontSize: "12px"
  },
  searchRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center"
  },
  searchInput: {
    flex: 1,
    minWidth: "160px",
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "9px 11px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  clearButton: {
    padding: "8px 11px"
  },
  tabBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px"
  },
  searchResults: {
    display: "grid",
    gap: "12px"
  },
  searchHint: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  resultGroup: {
    display: "grid",
    gap: "8px",
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  resultGroupTitle: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  resultIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "13px",
    lineHeight: 1.4
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    alignItems: "center",
    justifyContent: "center",
    padding: "26px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    color: "var(--kr-muted)",
    textAlign: "center"
  },
  startGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "12px",
    alignItems: "start"
  },
  panel: {
    display: "grid",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    alignContent: "start"
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px"
  },
  headerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    borderRadius: "12px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flex: "0 0 auto"
  },
  panelTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "16px"
  },
  panelDescription: {
    margin: "4px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.45
  },
  cardEyebrow: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase"
  },
  progressBadge: {
    flexShrink: 0,
    padding: "4px 10px",
    borderRadius: "999px",
    background: "var(--kr-accent-soft)",
    border: "1px solid var(--kr-accent-border)",
    color: "var(--kr-info-text)",
    fontSize: "12px",
    fontWeight: 900
  },
  progressTrack: {
    height: "8px",
    borderRadius: "999px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: "999px",
    background: "var(--kr-accent)",
    transition: "width 0.25s ease"
  },
  taskList: {
    display: "grid",
    gap: "8px",
    margin: 0,
    padding: 0,
    listStyle: "none"
  },
  taskLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    flex: 1,
    minWidth: 0,
    cursor: "pointer"
  },
  taskText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0
  },
  taskTitle: {
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  taskTitleDone: {
    color: "var(--kr-muted)",
    fontSize: "13px",
    textDecoration: "line-through"
  },
  taskDescription: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    lineHeight: 1.4
  },
  taskGuideButton: {
    padding: "6px 9px",
    flexShrink: 0,
    alignSelf: "center"
  },
  flowList: {
    display: "grid",
    gap: "4px",
    margin: 0,
    padding: 0,
    listStyle: "none"
  },
  flowItem: {
    display: "grid",
    gap: "4px"
  },
  flowStep: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    borderRadius: "999px",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    fontSize: "12px",
    fontWeight: 900,
    flexShrink: 0,
    marginTop: "4px"
  },
  flowIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  flowText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "13px",
    lineHeight: 1.4,
    minWidth: 0
  },
  flowConnector: {
    width: "2px",
    height: "10px",
    marginLeft: "20px",
    background: "var(--kr-border)"
  },
  startHintCard: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--kr-info-bg)",
    border: "1px solid var(--kr-info-border)",
    color: "var(--kr-info-text)",
    fontSize: "12px",
    lineHeight: 1.45
  },
  guidesGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
    gap: "12px",
    alignItems: "start"
  },
  guideNav: {
    position: "sticky",
    top: 0,
    display: "grid",
    gap: "4px",
    padding: "8px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  navIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  navText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    fontSize: "12px",
    lineHeight: 1.35
  },
  guideContent: {
    display: "grid",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    alignContent: "start",
    minWidth: 0
  },
  guideStepsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap"
  },
  guideStepsMeta: {
    display: "flex",
    alignItems: "center",
    gap: "8px"
  },
  guideStepsCount: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    fontWeight: 700
  },
  resetButton: {
    padding: "5px 9px"
  },
  guideStepList: {
    display: "grid",
    gap: "6px",
    margin: 0,
    padding: 0,
    listStyle: "none"
  },
  stepNumber: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "999px",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    fontSize: "11px",
    fontWeight: 900,
    flexShrink: 0,
    marginTop: "1px"
  },
  stepText: {
    flex: 1,
    minWidth: 0,
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.5
  },
  stepTextDone: {
    flex: 1,
    minWidth: 0,
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.5,
    textDecoration: "line-through"
  },
  blockTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  detailBox: {
    display: "grid",
    gap: "8px",
    padding: "12px",
    borderRadius: "14px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)"
  },
  detailList: {
    margin: 0,
    paddingLeft: "18px",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.55
  },
  detailItem: {
    marginBottom: "5px"
  },
  guidePager: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap"
  },
  pagerButton: {
    padding: "8px 11px"
  },
  categoryRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px"
  },
  faqList: {
    display: "grid",
    gap: "8px"
  },
  faqQuestionText: {
    flex: 1,
    minWidth: 0
  },
  faqAnswer: {
    margin: 0,
    padding: "0 12px 11px 12px",
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.5
  },
  flowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "8px"
  },
  backButton: {
    justifySelf: "start",
    padding: "7px 10px"
  },
  troubleshootHint: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  escalationBox: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "14px",
    background: "var(--kr-warning-soft)",
    border: "1px solid var(--kr-warning-border)",
    color: "var(--kr-warning)"
  },
  escalationTitle: {
    display: "block",
    fontSize: "13px"
  },
  escalationText: {
    margin: "4px 0 10px 0",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.5
  },
  supportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "12px",
    alignItems: "start"
  },
  copyButton: {
    padding: "8px 11px",
    flexShrink: 0
  },
  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "8px"
  },
  checklistItem: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    padding: "10px",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.4
  },
  supportFootnote: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "12px"
  }
};
