/**
 * Perfis de acesso: que TELAS cada um ve e o que pode fazer nelas. O que cada um grava e
 * espelho de `supabase/functions/_shared/web-session.ts` (que e quem de fato recusa, com 403).
 * Aqui a regra so decide o que aparece: esconder um botao nao protege nada, e mostrar um botao
 * que a `web-api` recusa so irrita.
 *
 * Cada perfil tem um conjunto FECHADO de telas — o que nao e dele nem aparece no menu, e o
 * endereco digitado a mao volta para a tela inicial dele:
 *   - `loader`        carregador: so a fila de carregamento da propria unidade;
 *   - `monitoramento` so o painel de vendas em tempo real, sem configuracoes — e e o UNICO
 *                     que ve essa tela;
 *   - `comercial`     aba Comercial (a tela do portal, e so dele), insights, conferencia de faturamento,
 *                     relatorios, controle de caminhoes, relatorio por cliente, cupons e
 *                     cadastros —
 *                     cadastra tudo e muda preco sem senha; sem configuracoes. E o unico (com o
 *                     administrador) que ve a tela "Senha de preco", o codigo rotativo que ele
 *                     passa para a operacao mudar preco;
 *   - `gestor`        tudo (menos Comercial e Monitoramento), com configuracoes;
 *   - `operacao`      tudo (menos Comercial e Monitoramento), com configuracoes; mudar preco sempre pede
 *                     a senha da pedreira;
 *   - `administrador` tudo (menos Comercial e Monitoramento), sem senha, mais os logs de suporte e a senha
 *                     de preco, com configuracoes.
 *
 * Nova entrada nao existe no site para perfil nenhum: a entrada so nasce no KyberRock Desktop,
 * na balanca (a `web-api` recusa o pedido de entrada).
 */

export const ROLES = [
  "loader",
  "monitoramento",
  "comercial",
  "gestor",
  "operacao",
  "administrador"
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  loader: "Carregador",
  monitoramento: "Monitoramento",
  comercial: "Comercial",
  gestor: "Gestor",
  operacao: "Operacao",
  administrador: "Administrador"
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** As telas do site. `configuracoes` e a engrenagem do rodape (Balanca, Impressao, Cloud). */
export const SCREENS = [
  "painel",
  "operacoes",
  "carteira",
  "cadastros",
  "senha-preco",
  "cupons",
  "comercial",
  "insights",
  "controle-caminhoes",
  "relatorio-cliente",
  "conferencia-faturamento",
  "fechamento",
  "relatorios",
  "monitoramento",
  "documentacao",
  "suporte",
  "configuracoes",
  "carregamento"
] as const;
export type Screen = (typeof SCREENS)[number];

/**
 * As telas do KyberRock Desktop (menu lateral), na ordem dele, menos a Nova entrada, a aba
 * Comercial e o Monitoramento — essas duas sao SO do perfil de mesmo nome.
 */
const DESK_SCREENS: readonly Screen[] = [
  "painel",
  "operacoes",
  "carteira",
  "cadastros",
  "insights",
  "controle-caminhoes",
  "relatorio-cliente",
  "conferencia-faturamento",
  "fechamento",
  "relatorios",
  "documentacao",
  "configuracoes"
];

export const SCREENS_BY_ROLE: Record<Role, readonly Screen[]> = {
  loader: ["carregamento"],
  monitoramento: ["monitoramento"],
  comercial: [
    "comercial",
    "cadastros",
    "senha-preco",
    "cupons",
    "insights",
    "controle-caminhoes",
    "relatorio-cliente",
    "conferencia-faturamento",
    "relatorios"
  ],
  // A consulta de cupom e so do site: na balanca o cupom se reimprime pela propria operacao.
  gestor: [...DESK_SCREENS, "cupons"],
  operacao: [...DESK_SCREENS, "cupons"],
  // A senha de preco nao e tela do desktop: la ninguem a ve, so digita.
  administrador: [...DESK_SCREENS, "cupons", "senha-preco", "suporte"]
};

export function canSee(role: Role, screen: Screen): boolean {
  return SCREENS_BY_ROLE[role].includes(screen);
}

/**
 * Onde cada perfil comeca: o carregador na fila, o monitoramento no painel de vendas, o
 * comercial na aba Comercial (a tela dele no KyberRock Portal) e o resto na tela Operacoes — a
 * mesma que o desktop abre para quem opera a balanca.
 */
export function homeFor(role: Role): string {
  if (role === "loader") return "/carregamento";
  if (role === "monitoramento") return "/monitoramento";
  if (role === "comercial") return "/comercial";
  return "/operacoes";
}

/** Perfis que usam o menu lateral (o carregador e o monitoramento tem tela cheia so deles). */
export function usesSidebar(role: Role): boolean {
  return SCREENS_BY_ROLE[role].some(
    (screen) => screen !== "carregamento" && screen !== "monitoramento"
  );
}

export interface Capabilities {
  /** Carregador: o site mostra so a fila de carregamento. */
  isLoader: boolean;
  /** Cliente (sobe ao OMIE) e o bloco comercial/credito dele. */
  canEditCustomers: boolean;
  /** Veiculo, motorista e transportadora. */
  canEditFleet: boolean;
  /** Carteira, fechamento e destinatarios (o nome ficou de quando era so do gestor). */
  canManagePrices: boolean;
  /** Preco padrao, especial por cliente e tabelas de preco. */
  canEditPrices: boolean;
  /**
   * Pesagem que ja existe (saida, alterar, cancelar, reimprimir). Quem executa e a balanca da
   * unidade — o site so pede.
   */
  canOperate: boolean;
  /** Engrenagem de configuracoes (Balanca, Impressao, Cloud). */
  hasSettings: boolean;
  /** Ve a senha rotativa de preco (comercial e administrador). */
  canSeePriceCode: boolean;
}

export function capabilitiesFor(role: Role): Capabilities {
  const runsTheQuarry = role === "gestor" || role === "operacao" || role === "administrador";
  const editsCadastro = runsTheQuarry || role === "comercial";
  return {
    isLoader: role === "loader",
    canEditCustomers: editsCadastro,
    canEditFleet: editsCadastro,
    canManagePrices: runsTheQuarry,
    canEditPrices: editsCadastro,
    canOperate: runsTheQuarry,
    hasSettings: canSee(role, "configuracoes"),
    canSeePriceCode: canSee(role, "senha-preco")
  };
}

/**
 * Quem digita a senha de alteracao de preco da pedreira: a `operacao` sempre, o `administrador`
 * e o `comercial` nunca, e o gestor conforme a marca do login no painel. Mesma regra de
 * `requiresPricePasswordFor` na `web-api`, que e quem confere a senha. A senha e o codigo
 * rotativo de 45 s que o comercial ve na tela "Senha de preco".
 */
export function requiresPricePasswordFor(role: Role, flagged: boolean): boolean {
  if (role === "administrador" || role === "comercial") return false;
  if (role === "operacao") return true;
  return flagged;
}
