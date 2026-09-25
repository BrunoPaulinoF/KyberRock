/**
 * Perfis de acesso: que TELAS cada um ve e o que pode fazer nelas. O que cada um grava e
 * espelho de `supabase/functions/_shared/web-session.ts` (que e quem de fato recusa, com 403).
 * Aqui a regra so decide o que aparece: esconder um botao nao protege nada, e mostrar um botao
 * que a `web-api` recusa so irrita.
 *
 * Cada perfil tem um conjunto FECHADO de telas — o que nao e dele nem aparece no menu, e o
 * endereco digitado a mao volta para a tela inicial dele:
 *   - `loader`        carregador: so a fila de carregamento da propria unidade;
 *   - `monitoramento` so o painel de vendas em tempo real, sem configuracoes;
 *   - `comercial`     insights, conferencia de faturamento, relatorios, controle de caminhoes,
 *                     relatorio por cliente e cadastros — cadastra tudo e muda preco sem
 *                     senha; sem configuracoes;
 *   - `gestor`        tudo, menos a Nova entrada, com configuracoes;
 *   - `operacao`      tudo, com configuracoes; mudar preco sempre pede a senha da pedreira;
 *   - `administrador` tudo, sem senha, mais os logs de suporte, com configuracoes.
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
  "nova-entrada",
  "operacoes",
  "carteira",
  "cadastros",
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

/** As telas do KyberRock Desktop (menu lateral), na ordem dele. */
const DESK_SCREENS: readonly Screen[] = [
  "painel",
  "nova-entrada",
  "operacoes",
  "carteira",
  "cadastros",
  "insights",
  "controle-caminhoes",
  "relatorio-cliente",
  "conferencia-faturamento",
  "fechamento",
  "relatorios",
  "monitoramento",
  "documentacao",
  "configuracoes"
];

export const SCREENS_BY_ROLE: Record<Role, readonly Screen[]> = {
  loader: ["carregamento"],
  monitoramento: ["monitoramento"],
  comercial: [
    "cadastros",
    "insights",
    "controle-caminhoes",
    "relatorio-cliente",
    "conferencia-faturamento",
    "relatorios"
  ],
  gestor: DESK_SCREENS.filter((screen) => screen !== "nova-entrada"),
  operacao: DESK_SCREENS,
  administrador: [...DESK_SCREENS, "suporte"]
};

export function canSee(role: Role, screen: Screen): boolean {
  return SCREENS_BY_ROLE[role].includes(screen);
}

/**
 * Onde cada perfil comeca: o carregador na fila, o monitoramento no painel de vendas, o
 * comercial no relatorio de vendas (a tela dele no antigo portal) e o resto na tela Operacoes —
 * a mesma que o desktop abre para quem opera a balanca.
 */
export function homeFor(role: Role): string {
  if (role === "loader") return "/carregamento";
  if (role === "monitoramento") return "/monitoramento";
  if (role === "comercial") return "/relatorios?aba=vendas";
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
  /** Nova entrada pelo site: operacao e administrador (o gestor nao). */
  canCreateEntry: boolean;
  /** Engrenagem de configuracoes (Balanca, Impressao, Cloud). */
  hasSettings: boolean;
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
    canCreateEntry: role === "operacao" || role === "administrador",
    hasSettings: canSee(role, "configuracoes")
  };
}

/**
 * Quem digita a senha de alteracao de preco da pedreira: a `operacao` sempre, o `administrador`
 * e o `comercial` nunca, e o gestor conforme a marca do login no painel. Mesma regra de
 * `requiresPricePasswordFor` na `web-api`, que e quem confere a senha.
 */
export function requiresPricePasswordFor(role: Role, flagged: boolean): boolean {
  if (role === "administrador" || role === "comercial") return false;
  if (role === "operacao") return true;
  return flagged;
}
