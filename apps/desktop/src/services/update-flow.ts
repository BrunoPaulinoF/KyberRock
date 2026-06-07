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
