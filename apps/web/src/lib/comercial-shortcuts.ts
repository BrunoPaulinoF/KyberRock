/**
 * Atalhos grandes do topo da aba Comercial: o que o comercial mais faz no dia (abrir o cliente,
 * mexer em preco, passar a senha de preco, tirar o relatorio de um cliente). Cada atalho so
 * aparece para quem VE a tela de destino (`canSee`) — atalho para tela recusada levaria a
 * pessoa de volta para a tela inicial dela.
 */

import { canSee, type Role, type Screen } from "./permissions";

export type ComercialShortcutId = "clientes" | "precos" | "senha-preco" | "relatorio-cliente";

export interface ComercialShortcut {
  id: ComercialShortcutId;
  /** Tela que o perfil precisa ver para o atalho aparecer. */
  screen: Screen;
  to: string;
  label: string;
  /** Uma linha embaixo do nome: o que se faz la. */
  hint: string;
}

export const COMERCIAL_SHORTCUTS: readonly ComercialShortcut[] = [
  {
    id: "clientes",
    screen: "cadastros",
    to: "/cadastros/clientes",
    label: "Clientes",
    hint: "Cadastro, crédito e condições"
  },
  {
    id: "precos",
    screen: "cadastros",
    to: "/cadastros/produtos",
    label: "Preços",
    hint: "Preço padrão e especial por cliente"
  },
  {
    id: "senha-preco",
    screen: "senha-preco",
    to: "/senha-preco",
    label: "Senha de preço",
    hint: "O código que libera mudar preço"
  },
  {
    id: "relatorio-cliente",
    screen: "relatorio-cliente",
    to: "/relatorio-cliente",
    label: "Relatório por cliente",
    hint: "Compras, vencimentos e viagens"
  }
];

/** Os atalhos que este perfil ve, na ordem da fileira. */
export function comercialShortcuts(role: Role): ComercialShortcut[] {
  return COMERCIAL_SHORTCUTS.filter((shortcut) => canSee(role, shortcut.screen));
}
