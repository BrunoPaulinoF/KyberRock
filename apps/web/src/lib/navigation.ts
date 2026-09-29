import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Database,
  FileText,
  Handshake,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MonitorPlay,
  Receipt,
  ReceiptText,
  ScrollText,
  Truck,
  UserSearch,
  Wallet,
  type LucideIcon
} from "lucide-react";

import type { Screen } from "./permissions";

/**
 * As telas do menu lateral (mesmas secoes, nomes, ordem e icones do KyberRock Desktop). Mora
 * aqui para o menu (`Layout.tsx`) e a busca rapida (`CommandPalette.tsx`) usarem a MESMA lista:
 * o nome no menu, na busca e no titulo da tela e um so. `keywords` sao os outros nomes que a
 * pessoa digita procurando aquela tela.
 */
export interface NavItem {
  screen: Screen;
  to: string;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
}

export const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Operacional",
    items: [
      {
        screen: "painel",
        to: "/painel",
        label: "Painel",
        icon: LayoutDashboard,
        keywords: ["início", "resumo do dia", "pendências"]
      },
      {
        screen: "operacoes",
        to: "/operacoes",
        label: "Operações",
        icon: ListChecks,
        keywords: ["pesagens", "fila", "saída", "fechar pesagem", "abertas", "concluídas"]
      },
      {
        screen: "carteira",
        to: "/carteira",
        label: "Carteira",
        icon: Wallet,
        keywords: ["a receber", "vendas em carteira"]
      },
      {
        screen: "cadastros",
        to: "/cadastros",
        label: "Cadastros",
        icon: Database,
        keywords: ["clientes", "produtos", "motoristas", "placas", "transportadoras"]
      },
      {
        screen: "cupons",
        to: "/cupons",
        label: "Cupons",
        icon: Receipt,
        keywords: ["ticket", "via", "reimprimir"]
      },
      {
        screen: "senha-preco",
        to: "/senha-preco",
        label: "Senha de preço",
        icon: KeyRound,
        keywords: ["código", "liberar preço"]
      }
    ]
  },
  {
    title: "Análise",
    items: [
      {
        screen: "comercial",
        to: "/comercial",
        label: "Comercial",
        icon: Handshake,
        keywords: ["relatório de vendas", "vendas"]
      },
      {
        screen: "insights",
        to: "/insights",
        label: "Insights",
        icon: BarChart3,
        keywords: ["gráficos", "indicadores"]
      },
      {
        screen: "controle-caminhoes",
        to: "/controle-caminhoes",
        label: "Controle de caminhões",
        icon: Truck,
        keywords: ["pátio", "tempo de carga"]
      },
      {
        screen: "relatorio-cliente",
        to: "/relatorio-cliente",
        label: "Relatório por cliente",
        icon: UserSearch,
        keywords: ["extrato do cliente"]
      },
      {
        screen: "conferencia-faturamento",
        to: "/conferencia-faturamento",
        label: "Conferência de faturamento",
        icon: ClipboardCheck,
        keywords: ["nota fiscal", "NF-e", "OMIE"]
      },
      {
        screen: "fechamento",
        to: "/fechamento",
        label: "Fechamento de faturas",
        icon: ReceiptText,
        keywords: ["fatura", "quinzena", "boleto"]
      },
      {
        screen: "relatorios",
        to: "/relatorios",
        label: "Relatórios",
        icon: FileText,
        keywords: ["fechamento diário", "CSV", "destinatários"]
      },
      {
        screen: "monitoramento",
        to: "/monitoramento",
        label: "Monitoramento",
        icon: MonitorPlay,
        keywords: ["TV", "ao vivo"]
      },
      {
        screen: "documentacao",
        to: "/documentacao",
        label: "Documentação",
        icon: BookOpen,
        keywords: ["ajuda", "manual", "dúvidas"]
      }
    ]
  },
  {
    title: "Suporte",
    items: [
      {
        screen: "suporte",
        to: "/suporte",
        label: "Logs",
        icon: ScrollText,
        keywords: ["suporte", "erros", "diagnóstico"]
      }
    ]
  }
];

/**
 * Lugares DENTRO das telas que a busca rapida tambem acha (aba de Cadastros, aba das
 * Configuracoes). `screen` e a tela que o perfil precisa ver para o atalho aparecer.
 */
export const NAV_SHORTCUTS: Array<{
  screen: Screen;
  to: string;
  label: string;
  keywords?: string[];
}> = [
  { screen: "cadastros", to: "/cadastros/clientes", label: "Clientes", keywords: ["cliente"] },
  {
    screen: "cadastros",
    to: "/cadastros/produtos",
    label: "Produtos e preços",
    keywords: ["preço especial", "tabela de preço"]
  },
  {
    screen: "cadastros",
    to: "/cadastros/pagamento",
    label: "Formas e condições de pagamento",
    keywords: ["pix", "boleto", "condição"]
  },
  { screen: "cadastros", to: "/cadastros/transporte/motoristas", label: "Motoristas" },
  { screen: "cadastros", to: "/cadastros/transporte/transportadoras", label: "Transportadoras" },
  {
    screen: "cadastros",
    to: "/cadastros/transporte/placas",
    label: "Placas",
    keywords: ["veículo"]
  },
  { screen: "configuracoes", to: "/configuracoes/balanca", label: "Configurações da balança" },
  { screen: "configuracoes", to: "/configuracoes/impressao", label: "Configurações de impressão" },
  { screen: "configuracoes", to: "/configuracoes/cloud", label: "Configurações da nuvem" }
];

/** Nome da tela aberta, para a barra do celular (a tela das configuracoes nao esta no menu). */
export function currentLabel(pathname: string): string | null {
  if (pathname.startsWith("/configuracoes")) return "Configurações";
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item.label;
    }
  }
  return null;
}
