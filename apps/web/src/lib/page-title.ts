import { useEffect } from "react";

/**
 * Nome da aba do navegador: "Operacoes · KyberRock". Com todas as telas chamadas "KyberRock
 * Web", quem deixa o Painel, os Relatorios e os Cadastros abertos lado a lado nao achava a aba
 * certa. A pagina de apresentacao (`Landing.tsx`) escolhe o proprio titulo.
 */
export const SITE_NAME = "KyberRock";

export function documentTitle(page: string | null | undefined): string {
  const name = page?.trim();
  return name ? `${name} · ${SITE_NAME}` : SITE_NAME;
}

/** Poe o nome da tela aberta na aba do navegador. */
export function usePageTitle(page: string | null | undefined) {
  useEffect(() => {
    document.title = documentTitle(page);
  }, [page]);
}

/**
 * Telas fora da casca (a casca, `Layout`, poe o nome da tela aberta). `null` = quem cuida e a
 * propria tela ou a casca — a pagina de apresentacao escolhe o proprio titulo.
 */
export function standaloneTitle(pathname: string): string | null {
  if (pathname === "/login") return "Entrar";
  if (pathname === "/carregamento") return "Fila de carregamento";
  if (pathname === "/monitoramento") return "Monitoramento";
  if (pathname === "/admin/login") return "Entrar no painel";
  if (pathname === "/admin") return "Painel da plataforma";
  if (pathname.startsWith("/whatsapp/")) return "Conectar WhatsApp";
  return null;
}
