import type { Screen } from "./permissions";

/**
 * O arquivo de cada tela, baixado so quando ela abre (`App.tsx`). Morar aqui permite o menu
 * PRE-carregar a tela quando o mouse passa por cima dela ou o dedo encosta (`Layout.tsx`): o
 * arquivo chega enquanto a pessoa ainda esta clicando, e a tela abre sem esperar a rede.
 */
export const SCREEN_MODULES = {
  painel: () => import("../pages/Dashboard"),
  operacoes: () => import("../pages/Operation"),
  carteira: () => import("../pages/Wallet"),
  cadastros: () => import("../pages/Registrations"),
  "senha-preco": () => import("../pages/PriceCode"),
  cupons: () => import("../pages/Receipts"),
  comercial: () => import("../pages/Comercial"),
  "ranking-clientes": () => import("../pages/CustomerRanking"),
  insights: () => import("../pages/Insights"),
  "controle-caminhoes": () => import("../pages/TruckControl"),
  "relatorio-cliente": () => import("../pages/CustomerReport"),
  "conferencia-faturamento": () => import("../pages/BillingConference"),
  fechamento: () => import("../pages/InvoiceClosing"),
  relatorios: () => import("../pages/SalesReport"),
  monitoramento: () => import("../pages/Monitor"),
  documentacao: () => import("../pages/Documentation"),
  suporte: () => import("../pages/SupportLogs"),
  configuracoes: () => import("../pages/Settings"),
  carregamento: () => import("../pages/Loading")
} satisfies Record<Screen, () => Promise<unknown>>;

const requested = new Set<Screen>();

/** Comeca a baixar a tela (uma vez so). Falha fica calada: o clique tenta de novo. */
export function preloadScreen(screen: Screen): void {
  if (requested.has(screen)) return;
  requested.add(screen);
  SCREEN_MODULES[screen]().catch(() => requested.delete(screen));
}
