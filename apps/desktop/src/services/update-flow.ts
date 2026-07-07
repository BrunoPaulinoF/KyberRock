/**
 * Politica de atualizacao automatica do app do operador.
 *
 * - `AUTO_DOWNLOAD_UPDATES`: assim que uma versao nova e detectada, o
 *   `electron-updater` baixa em segundo plano, sem acao do operador.
 * - `AUTO_INSTALL_ON_QUIT`: a atualizacao baixada e aplicada na proxima vez
 *   que o operador fechar o app, sem interromper a operacao em andamento.
 *
 * O instalador em si e gerado e publicado automaticamente pelo pipeline
 * `.github/workflows/desktop-release.yml` a cada mudanca na `main`, entao nao
 * e preciso gerar um instalador novo manualmente.
 */
export const AUTO_DOWNLOAD_UPDATES = true;
export const AUTO_INSTALL_ON_QUIT = true;

export const UPDATE_STATUSES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "error"
] as const;

export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export interface UpdateState {
  status: UpdateStatus;
  availableVersion: string | null;
  errorMessage: string | null;
}

export function createInitialUpdateState(): UpdateState {
  return {
    status: "idle",
    availableVersion: null,
    errorMessage: null
  };
}

export function getManualUpdateButtonLabel(status: UpdateStatus): string {
  if (status === "available") {
    return "Baixar e instalar atualizacao";
  }

  if (status === "downloaded") {
    return "Reiniciar e instalar";
  }

  if (status === "checking") {
    return "Verificando...";
  }

  if (status === "downloading") {
    return "Baixando...";
  }

  return "Verificar atualizacao";
}
