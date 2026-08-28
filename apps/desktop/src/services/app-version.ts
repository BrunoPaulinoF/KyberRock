/**
 * Versao instalada deste desktop, disponivel fora do processo principal.
 *
 * Quem sabe a versao de verdade e o Electron (`app.getVersion()`), e `electron`
 * so pode ser importado no processo principal — os servicos daqui rodam tambem
 * no Vitest, onde esse import nao existe. Por isso o main GRAVA a versao no
 * arranque (`setInstalledAppVersion`) e os servicos apenas leem.
 *
 * O valor viaja no `desktop-status` para o painel poder mostrar o que cada
 * balanca esta REALMENTE rodando: liberar uma versao para producao nao instala
 * nada — a maquina troca de versao quando verifica e o operador fecha o app.
 *
 * `null` quando ninguem gravou (teste, script solto): a nuvem trata ausencia
 * como "nao sei", que e diferente de "esta desatualizada". Nunca invente um
 * numero aqui.
 */

let installedAppVersion: string | null = null;

/** Chamado uma vez pelo processo principal, com o `app.getVersion()` do Electron. */
export function setInstalledAppVersion(version: string | null | undefined): void {
  const normalized = typeof version === "string" ? version.trim().replace(/^v/, "") : "";
  installedAppVersion = /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : null;
}

export function readInstalledAppVersion(): string | null {
  return installedAppVersion;
}
