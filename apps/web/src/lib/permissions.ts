/**
 * Perfis de acesso e o que cada um pode no site — espelho de
 * `supabase/functions/_shared/web-session.ts` (que e quem de fato recusa, com 403). Aqui a regra
 * so decide o que aparece na tela: esconder um botao nao protege nada, e mostrar um botao que a
 * `web-api` recusa so irrita.
 *
 * Do que menos pode ao que mais pode:
 *   - `loader`        carregador: so a fila de carregamento da propria unidade;
 *   - `monitoramento` so consulta: cadastro e relatorios;
 *   - `operacao`      consulta + veiculo, motorista, transportadora e PESAGEM;
 *   - `comercial`     + clientes e precos (e o relatorio de vendas que ficava no portal);
 *   - `gestor`        + bloco comercial, carteira, fechamento e pesagem.
 */

export const ROLES = ["loader", "monitoramento", "operacao", "comercial", "gestor"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  loader: "Carregador",
  monitoramento: "Monitoramento",
  operacao: "Operacao",
  comercial: "Comercial",
  gestor: "Gestor"
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export interface Capabilities {
  /** Carregador: o site mostra so a fila de carregamento. */
  isLoader: boolean;
  /** Cliente (sobe ao OMIE): comercial e gestor. */
  canEditCustomers: boolean;
  /** Veiculo, motorista e transportadora: operacao, comercial e gestor. */
  canEditFleet: boolean;
  /** Bloco comercial/credito, carteira, fechamento e destinatarios: so o gestor. */
  canManagePrices: boolean;
  /** Preco padrao, especial por cliente e tabelas de preco: comercial e gestor. */
  canEditPrices: boolean;
  /**
   * Pesagem pelo site (entrada, fechamento, alterar, cancelar, reimprimir): operacao e gestor.
   * Quem executa e a balanca da unidade — o site so pede.
   */
  canOperate: boolean;
}

export function capabilitiesFor(role: Role): Capabilities {
  return {
    isLoader: role === "loader",
    canEditCustomers: role === "comercial" || role === "gestor",
    canEditFleet: role === "operacao" || role === "comercial" || role === "gestor",
    canManagePrices: role === "gestor",
    canEditPrices: role === "comercial" || role === "gestor",
    canOperate: role === "operacao" || role === "gestor"
  };
}
