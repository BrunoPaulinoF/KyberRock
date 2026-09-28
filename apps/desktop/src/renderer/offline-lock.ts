/**
 * Trava de telas sem internet.
 *
 * Quando a conexao cai, o operador so continua com o que nao depende da nuvem para
 * fazer sentido: registrar a ENTRADA do caminhao (a pesagem nasce no SQLite e sobe
 * quando a internet voltar), as telas de configuracao (balanca, impressao, cloud) e
 * os Insights. O resto fica bloqueado ate a conexao voltar, com um aviso na tela.
 *
 * Fica fora do App.tsx de proposito: a lista e a regra sao dados puros e testaveis.
 */

/** Tela para onde o app volta quando a internet cai numa tela bloqueada. */
export const OFFLINE_FALLBACK_VIEW = "new-weighing";

/** Telas que continuam liberadas sem internet. */
export const OFFLINE_ALLOWED_VIEWS: readonly string[] = [
  OFFLINE_FALLBACK_VIEW,
  "insights",
  "scale",
  "printing",
  "cloud"
];

export const OFFLINE_DROPPED_MESSAGE =
  "A conexao com a internet caiu. Enquanto ela nao voltar, nao e possivel acessar as " +
  "outras telas - so Nova entrada, Insights e Configuracoes.";

export const OFFLINE_BLOCKED_MESSAGE =
  "Sem internet: esta tela fica bloqueada ate a conexao voltar. " +
  "Voce pode usar Nova entrada, Insights e as Configuracoes.";

export function isViewBlockedOffline(view: string, online: boolean): boolean {
  if (online) return false;
  return !OFFLINE_ALLOWED_VIEWS.includes(view);
}
