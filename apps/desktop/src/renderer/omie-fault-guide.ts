import { formatDocument } from "@kyberrock/shared";

/**
 * Guia "onde esta o problema / como resolver" das pesagens que nao chegaram ao OMIE.
 *
 * A mensagem que a tela mostrava era a recusa crua do OMIE ("OMIE HTTP 500 em IncluirPedido
 * ... ERROR: Cliente sem a informacao da UF no cadastro! - tag: [codigo_cliente]"). Ela e
 * precisa para o suporte e inutil para a operadora: em 05/11/2026 o cadastro do cliente
 * mostrava UF "SP" no KyberRock e ninguem sabia que a ficha que faltava era a do OMIE --
 * cliente que ja tem codigo la sobe no pedido so pelo codigo, e o OMIE confere a ficha DELE.
 *
 * Aqui a mensagem vira tres coisas: ONDE corrigir (no OMIE, no KyberRock, ou em lugar
 * nenhum porque o envio volta sozinho), O QUE aconteceu em portugues simples e o PASSO A
 * PASSO. Puro de proposito (sem React, sem banco): a tela so desenha, e os testes cobrem
 * cada mensagem conhecida.
 */

export type OmieFaultPlace =
  /** A ficha do cliente/produto dentro do OMIE: so se resolve la. */
  | "omie"
  /** O cadastro aqui no KyberRock (botao Editar itens ou tela Clientes). */
  | "kyberrock"
  /** Ninguem precisa fazer nada: o envio tenta de novo sozinho. */
  | "wait"
  /** Precisa do suporte (configuracao da integracao ou erro desconhecido). */
  | "support";

export interface OmieFaultGuide {
  /** Identificador estavel do caso (usado nos testes). */
  id: string;
  place: OmieFaultPlace;
  /** "Onde esta o problema", curto e direto. */
  where: string;
  /** O que aconteceu, em uma frase simples. */
  problem: string;
  /** Passo a passo, na ordem em que a pessoa faz. */
  steps: string[];
}

export interface OmieFaultContext {
  message: string | null | undefined;
  customerName?: string | null;
  customerDocument?: string | null;
  carrierName?: string | null;
  productDescription?: string | null;
  isOnline: boolean;
}

/** Rotulo curto do lugar, para o selo ao lado de "Onde esta o problema". */
export const OMIE_FAULT_PLACE_LABEL: Record<OmieFaultPlace, string> = {
  omie: "Corrigir no OMIE",
  kyberrock: "Corrigir no KyberRock",
  wait: "Nao precisa fazer nada",
  support: "Chamar o suporte"
};

/** Texto sem acento e em minusculas, para comparar com o que o OMIE devolve. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function customerLabel(context: OmieFaultContext): string {
  const name = context.customerName?.trim();
  const document = context.customerDocument?.trim();
  const who = name ? name : "o cliente desta pesagem";
  return document ? `${who} (${formatDocument(document)})` : who;
}

/** Os passos para chegar na ficha do cliente dentro do OMIE (iguais em todo caso "omie"). */
function openOmieCustomerSteps(context: OmieFaultContext, tab: string): string[] {
  return [
    "Abra o navegador e entre no OMIE (app.omie.com.br) com seu login e a empresa da pedreira.",
    'No menu, entre em "Vendas e NF-e" e clique em "Clientes". Se nao achar, digite "Clientes" na busca do topo da tela.',
    `Pesquise e abra o cadastro de ${customerLabel(context)}.`,
    `Clique na aba "${tab}".`
  ];
}

const WAIT_FOR_RETRY_STEP =
  "Volte ao KyberRock e aguarde alguns minutos: o envio tenta de novo sozinho e a pesagem sai desta lista quando o OMIE aceitar.";

const EDIT_ITEMS_STEP = 'Clique no botao "Editar itens" ao lado desta pesagem (aqui na lista).';

const RESEND_STEP =
  'Preencha o que falta, clique em "Salvar" e depois em "Reenviar". A pesagem sai desta lista quando o OMIE aceitar.';

const SUPPORT_STEP =
  "Se continuar aparecendo depois de 15 minutos, tire um print desta tela e mande para o suporte da Kybernan.";

interface FaultRule {
  matches: (text: string) => boolean;
  build: (context: OmieFaultContext) => OmieFaultGuide;
}

/** Recusa do cadastro gerada pelo edge (`CUSTOMER_REGISTRATION_FAULT_PREFIX`). */
const isCustomerRegistration = (text: string): boolean =>
  text.includes("cadastro do cliente recusado pelo omie") ||
  text.includes("sem dados de cadastro para criar no omie");

/**
 * Ordem importa: o especifico vem antes do generico. A recusa de UF chega como
 * "OMIE HTTP 500 ... (HTTP 400)", entao ela tem de ser reconhecida antes da regra de
 * "OMIE fora do ar" (5xx) -- senao a operadora seria mandada esperar algo que nunca vai
 * se resolver sozinho.
 */
const RULES: FaultRule[] = [
  {
    // Cliente sem UF no OMIE. Vem tanto no pedido ("Cliente sem a informacao da UF no
    // cadastro!") quanto no cadastro (tag [estado]).
    matches: (text) =>
      // `\buf\b`: a palavra UF sozinha. "uf" solto pegaria "insuficiente", e o
      // `uf_placa`/`placa_estado` do veiculo e outro assunto (o pedido sai sem a UF da placa).
      (/\buf\b/.test(text) && text.includes("cadastro")) || text.includes("[estado]"),
    build: (context) => ({
      id: "customer_state",
      place: "omie",
      where: "No cadastro do cliente, dentro do OMIE (campo Estado / UF).",
      problem:
        "A ficha do cliente no OMIE esta sem o Estado (UF). Mesmo que no KyberRock a UF esteja preenchida, o OMIE confere a ficha dele, e la o campo esta vazio.",
      steps: [
        ...openOmieCustomerSteps(context, "Endereco"),
        'Preencha o "Estado" (ex.: SP) e escolha a "Cidade" na lista. Se tiver o CEP, digite e clique na lupa: o OMIE completa o resto.',
        'Clique em "Salvar", no fim da tela.',
        WAIT_FOR_RETRY_STEP
      ]
    })
  },
  {
    // "Cidade nao encontrada" / tag [cidade]: nome da cidade diferente da lista do OMIE.
    matches: (text) =>
      text.includes("cidade nao encontrada") ||
      text.includes("[cidade]") ||
      text.includes("cidade_ibge"),
    build: (context) => ({
      id: "customer_city",
      place: "omie",
      where: "No cadastro do cliente, dentro do OMIE (campo Cidade).",
      problem:
        "O OMIE nao reconheceu a cidade do cliente. Normalmente o nome esta escrito diferente da lista de cidades dele, ou falta o Estado.",
      steps: [
        ...openOmieCustomerSteps(context, "Endereco"),
        'Confira o "Estado" e escolha a "Cidade" pela lista do OMIE (nao digite a mao). Se tiver o CEP, digite e clique na lupa.',
        'Clique em "Salvar", no fim da tela.',
        WAIT_FOR_RETRY_STEP
      ]
    })
  },
  {
    // Cliente bloqueado para faturamento no OMIE.
    matches: (text) =>
      text.includes("cliente bloqueado") ||
      text.includes("bloqueado para faturamento") ||
      text.includes("bloquear_faturamento"),
    build: (context) => ({
      id: "customer_blocked",
      place: "omie",
      where: "No cadastro do cliente, dentro do OMIE (bloqueio de faturamento).",
      problem:
        "O cliente esta bloqueado para faturamento no OMIE, entao ele nao aceita pedido novo para esse cliente.",
      steps: [
        ...openOmieCustomerSteps(context, "Recomendacoes"),
        'Confira com o financeiro se o cliente pode comprar. Se puder, desmarque "Bloquear faturamento" e clique em "Salvar".',
        WAIT_FOR_RETRY_STEP
      ]
    })
  },
  {
    // CPF/CNPJ faltando ou invalido: corrige-se no KyberRock, que sobe o cadastro.
    matches: (text) =>
      text.includes("[cnpj_cpf]") ||
      text.includes("sem cnpj/cpf") ||
      text.includes("cnpj/cpf invalido") ||
      text.includes("cpf/cnpj invalido") ||
      text.includes("documento invalido"),
    build: (context) => ({
      id: "customer_document",
      place: "kyberrock",
      where: "No cadastro do cliente, aqui no KyberRock (campo CPF/CNPJ).",
      problem: `O OMIE so aceita o cliente com CPF ou CNPJ valido, e o cadastro de ${customerLabel(context)} esta sem ele ou com numero errado.`,
      steps: [
        EDIT_ITEMS_STEP,
        "Digite o CPF ou CNPJ correto do cliente (confira no documento ou na nota anterior).",
        RESEND_STEP
      ]
    })
  },
  {
    matches: (text) => text.includes("[email]") || text.includes("e-mail invalido"),
    build: (context) => ({
      id: "customer_email",
      place: "kyberrock",
      where: "No cadastro do cliente, aqui no KyberRock (campo E-mail).",
      problem: `O OMIE precisa de um e-mail valido para ${customerLabel(context)} (e para onde vai a nota fiscal).`,
      steps: [
        EDIT_ITEMS_STEP,
        "Preencha o e-mail do cliente. Se ele nao tiver, use o e-mail que a pedreira usa para esses casos.",
        RESEND_STEP
      ]
    })
  },
  {
    matches: (text) => text.includes("[endereco_numero]") || text.includes("numero do endereco"),
    build: (context) => ({
      id: "customer_address_number",
      place: "kyberrock",
      where: "No cadastro do cliente, aqui no KyberRock (campo Numero do endereco).",
      problem: `Falta o numero do endereco de ${customerLabel(context)}, e sem ele a nota fiscal nao pode ser emitida.`,
      steps: [
        EDIT_ITEMS_STEP,
        'Preencha o "Numero". Se o endereco nao tiver numero, escreva S/N.',
        RESEND_STEP
      ]
    })
  },
  {
    // Recusa generica do cadastro (o edge ja lista o que falta em "Falta preencher").
    matches: isCustomerRegistration,
    build: (context) => ({
      id: "customer_registration",
      place: "kyberrock",
      where: "No cadastro do cliente, aqui no KyberRock.",
      problem: `O OMIE recusou o cadastro de ${customerLabel(context)} porque falta alguma informacao. A mensagem abaixo diz qual ("Falta preencher").`,
      steps: [
        EDIT_ITEMS_STEP,
        'Preencha os campos que aparecem em "Falta preencher" na mensagem do OMIE.',
        RESEND_STEP
      ]
    })
  },
  {
    // Codigo do cliente que nao existe mais no OMIE: o KyberRock refaz o vinculo sozinho.
    matches: (text) =>
      text.includes("codigo do cliente no omie nao existe mais") ||
      (text.includes("cliente nao cadastrado") && !text.includes("codigo_transportadora")),
    build: (context) => ({
      id: "customer_missing_in_omie",
      place: "wait",
      where: "Na ligacao do cliente com o OMIE (o KyberRock corrige sozinho).",
      problem: `O cliente ${customerLabel(context)} foi apagado ou trocado no OMIE. O KyberRock vai cadastra-lo de novo la e reenviar a pesagem.`,
      steps: [
        WAIT_FOR_RETRY_STEP,
        "Se nao sair em 15 minutos: no OMIE, confira se o cliente nao foi excluido ou inativado. Se foi, reative o cadastro la.",
        SUPPORT_STEP
      ]
    })
  },
  {
    matches: (text) =>
      text.includes("codigo_transportadora") || text.includes("transportadora nao cadastrada"),
    build: (context) => ({
      id: "carrier",
      place: "kyberrock",
      where: "No cadastro da transportadora desta pesagem.",
      problem: `O OMIE nao reconheceu a transportadora${context.carrierName ? ` ${context.carrierName}` : ""} (ela foi apagada ou nao existe no OMIE).`,
      steps: [
        'No KyberRock, abra a tela "Transportadoras" e confira se a transportadora tem CPF/CNPJ e endereco completos. Salve.',
        "No OMIE, confira se ela nao foi excluida ou inativada (busque pelo nome em Clientes e Fornecedores).",
        WAIT_FOR_RETRY_STEP,
        SUPPORT_STEP
      ]
    })
  },
  {
    // Produto: codigo, NCM, CFOP -- a ficha fiscal do produto vive no OMIE.
    matches: (text) =>
      text.includes("codigo_produto") ||
      text.includes("produto nao cadastrado") ||
      text.includes("[ncm]") ||
      text.includes(" ncm") ||
      text.includes("cfop"),
    build: (context) => ({
      id: "product",
      place: "omie",
      where: "No cadastro do produto, dentro do OMIE.",
      problem: `O OMIE recusou o produto${context.productDescription ? ` ${context.productDescription}` : ""} (codigo, NCM ou CFOP faltando ou invalido).`,
      steps: [
        'No OMIE, entre em "Vendas e NF-e" > "Produtos" e abra o produto.',
        "Confira se ele esta ativo e com NCM e CFOP preenchidos. Se nao souber o que colocar, peca ao contador.",
        'Clique em "Salvar".',
        WAIT_FOR_RETRY_STEP
      ]
    })
  },
  {
    matches: (text) => text.includes("codigo_parcela") || text.includes("condicao de pagamento"),
    build: () => ({
      id: "payment_term",
      place: "kyberrock",
      where: "Na condicao de pagamento desta pesagem.",
      problem: "O OMIE nao aceitou a condicao de pagamento (parcelas) escolhida.",
      steps: [
        EDIT_ITEMS_STEP,
        "Escolha outra condicao de pagamento que exista no OMIE (ex.: A vista).",
        RESEND_STEP,
        SUPPORT_STEP
      ]
    })
  },
  {
    // Configuracao da integracao: categoria, conta corrente, servico municipal.
    matches: (text) =>
      text.includes("codigo_categoria") ||
      text.includes("categoria") ||
      text.includes("codigo_conta_corrente") ||
      text.includes("conta corrente") ||
      text.includes("ccodservmun"),
    build: () => ({
      id: "integration_settings",
      place: "support",
      where: "Na configuracao da integracao com o OMIE (categoria, conta corrente ou servico).",
      problem:
        "Falta uma configuracao do OMIE que vale para todas as pesagens, nao so para este cliente.",
      steps: [
        'No KyberRock, abra "Configuracoes" > OMIE e confira se a categoria e a conta corrente estao escolhidas.',
        "Se estiverem, alguem pode ter apagado ou mudado essa categoria/conta no OMIE.",
        "Tire um print desta tela e mande para o suporte da Kybernan.",
        WAIT_FOR_RETRY_STEP
      ]
    })
  },
  {
    // O pedido/OS foi apagado ou cancelado direto no OMIE depois de enviado.
    matches: (text) =>
      text.includes("nao existe mais no omie") || text.includes("cancelado no omie"),
    build: () => ({
      id: "order_removed_in_omie",
      place: "kyberrock",
      where: "No pedido desta pesagem, que foi apagado ou cancelado direto no OMIE.",
      problem:
        "O pedido desta pesagem existia no OMIE, mas alguem apagou ou cancelou la. O KyberRock nao manda de novo sozinho para nao duplicar a venda.",
      steps: [
        "Pergunte a quem cuida do OMIE se o pedido foi cancelado de proposito.",
        'Se a venda vale: clique em "Editar itens" ao lado desta pesagem e depois em "Reenviar". Um pedido novo e criado no OMIE.',
        "Se a venda foi cancelada de verdade: cancele tambem esta pesagem no KyberRock.",
        SUPPORT_STEP
      ]
    })
  },
  {
    // Limite de chamadas do OMIE: passa sozinho.
    matches: (text) =>
      text.includes("consumo redundante") ||
      text.includes("consumo indevido") ||
      text.includes("redundant") ||
      text.includes("http 429"),
    build: () => ({
      id: "omie_rate_limit",
      place: "wait",
      where: "No OMIE (ele pediu para esperar um pouco).",
      problem:
        "O OMIE recebeu muitos pedidos ao mesmo tempo e pediu para aguardar. Nao e erro de cadastro.",
      steps: [WAIT_FOR_RETRY_STEP, SUPPORT_STEP]
    })
  },
  {
    matches: (text) =>
      text.includes("app_key") ||
      text.includes("app_secret") ||
      text.includes("credencial") ||
      text.includes("acesso negado") ||
      text.includes("omie nao configurado") ||
      text.includes("nao autorizado") ||
      text.includes("token de dispositivo"),
    build: () => ({
      id: "omie_credentials",
      place: "support",
      where: "Na ligacao do KyberRock com a conta do OMIE (chave de acesso).",
      problem:
        "A chave de acesso do OMIE nao foi aceita. Isso vale para todas as pesagens e so o suporte corrige.",
      steps: [
        "Nao precisa mexer em cadastro nenhum.",
        "Tire um print desta tela e mande para o suporte da Kybernan.",
        "As pesagens ficam salvas e sobem sozinhas quando a chave for corrigida."
      ]
    })
  },
  {
    // Rede / OMIE fora do ar. Fica DEPOIS das recusas especificas (ver comentario de RULES).
    matches: (text) =>
      text.includes("fetch failed") ||
      text.includes("failed to fetch") ||
      text.includes("timeout") ||
      text.includes("timed out") ||
      text.includes("econn") ||
      text.includes("network") ||
      text.includes("fora do ar") ||
      text.includes("sem internet") ||
      /http 5\d\d/.test(text),
    build: () => ({
      id: "omie_unavailable",
      place: "wait",
      where: "Na conexao com o OMIE (ele nao respondeu).",
      problem:
        "O OMIE ou a internet nao responderam a tempo. Nao e erro de cadastro: a pesagem esta salva.",
      steps: [
        "Confira se a internet deste computador esta funcionando (abra um site qualquer).",
        WAIT_FOR_RETRY_STEP,
        SUPPORT_STEP
      ]
    })
  }
];

const INFO_ONLY = ["sera enviad", "sera reenviad", "ainda na fila", "cliente cadastrado no omie"];

/**
 * Le a mensagem de recusa e devolve onde corrigir e o passo a passo. `null` quando nao ha
 * nada a explicar (pesagem so esperando a vez na fila, sem recusa nenhuma).
 */
export function describeOmieFault(context: OmieFaultContext): OmieFaultGuide | null {
  if (!context.isOnline) {
    return {
      id: "offline",
      place: "wait",
      where: "Na internet deste computador.",
      problem:
        "Este computador esta sem internet. A pesagem esta salva aqui e vai ao OMIE sozinha quando a conexao voltar.",
      steps: [
        "Confira o cabo de rede ou o Wi-Fi deste computador.",
        "Quando a internet voltar, nao precisa fazer nada: o envio e automatico.",
        "Se a internet estiver funcionando e o aviso continuar, reinicie o KyberRock."
      ]
    };
  }

  const message = context.message?.trim();
  if (!message) return null;

  const text = normalize(message);
  // Aviso de andamento, nao recusa ("Cliente cadastrado no OMIE. O fechamento sera
  // reenviado...", "Pedido ainda na fila..."): nao ha o que explicar.
  if (INFO_ONLY.some((fragment) => text.includes(fragment))) return null;

  const rule = RULES.find((candidate) => candidate.matches(text));
  if (rule) return rule.build(context);

  return {
    id: "unknown",
    place: "support",
    where: "Nao foi possivel identificar sozinho. Veja a mensagem do OMIE abaixo.",
    problem:
      "O OMIE recusou a pesagem por um motivo que o KyberRock ainda nao conhece. A pesagem esta salva e continua tentando.",
    steps: [
      'Leia a mensagem do OMIE abaixo: normalmente ela diz o campo que falta (a palavra depois de "tag").',
      'Se for um dado do cliente, corrija pelo botao "Editar itens" ou direto no cadastro do cliente no OMIE.',
      SUPPORT_STEP
    ]
  };
}
