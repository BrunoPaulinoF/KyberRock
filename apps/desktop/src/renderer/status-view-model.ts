import type {
  DesktopStatusSnapshot,
  IntegrationStatus,
  ScaleRuntimeStatus
} from "../services/status";

export type StatusIndicatorTone = "success" | "warning" | "danger" | "neutral";

export interface StatusIndicatorViewModel {
  label: string;
  value: string;
  tone: StatusIndicatorTone;
  detail: string;
}

export function buildStatusIndicatorViewModels(
  snapshot: DesktopStatusSnapshot
): StatusIndicatorViewModel[] {
  return [
    {
      label: "Internet",
      value: snapshot.internet === "online" ? "Online" : "Offline",
      tone: snapshot.internet === "online" ? "success" : "danger",
      detail:
        snapshot.internet === "online"
          ? "Rede disponivel para sync futuro"
          : "Operacao local continua disponivel"
    },
    buildScaleIndicator(snapshot.scale),
    buildIntegrationIndicator("Firebase", snapshot.firebase),
    buildIntegrationIndicator("OMIE", snapshot.omie),
    {
      label: "Fila pendente",
      value: `${snapshot.pendingSyncJobs} pendente(s)`,
      tone: snapshot.pendingSyncJobs > 0 ? "warning" : "success",
      detail:
        snapshot.pendingSyncJobs > 0 ? "Itens aguardando sincronizacao" : "Sem itens pendentes"
    },
    {
      label: "Ultimo backup",
      value: snapshot.lastBackupAt ? formatDateTime(snapshot.lastBackupAt) : "Nunca executado",
      tone: snapshot.lastBackupAt ? "success" : "warning",
      detail: snapshot.lastBackupAt
        ? "Backup local registrado"
        : "Backup automatico sera executado pelo desktop"
    }
  ];
}

function buildScaleIndicator(status: ScaleRuntimeStatus): StatusIndicatorViewModel {
  const values: Record<ScaleRuntimeStatus, StatusIndicatorViewModel> = {
    connected: {
      label: "Balanca",
      value: "Conectada",
      tone: "success",
      detail: "Adapter ativo"
    },
    disconnected: {
      label: "Balanca",
      value: "Desconectada",
      tone: "danger",
      detail: "Pesagem real ficara bloqueada"
    },
    not_configured: {
      label: "Balanca",
      value: "Nao configurada",
      tone: "warning",
      detail: "Configuracao sera feita antes da pesagem real"
    },
    unknown: {
      label: "Balanca",
      value: "Status desconhecido",
      tone: "neutral",
      detail: "Adapter configurado, sem leitura ativa"
    }
  };

  return values[status];
}

function buildIntegrationIndicator(
  label: "Firebase" | "OMIE",
  status: IntegrationStatus
): StatusIndicatorViewModel {
  const values: Record<IntegrationStatus, Omit<StatusIndicatorViewModel, "label">> = {
    online: {
      value: "Online",
      tone: "success",
      detail: "Integracao disponivel"
    },
    offline: {
      value: "Offline",
      tone: "danger",
      detail: "Operacao local continua disponivel"
    },
    not_configured: {
      value: "Nao configurado",
      tone: "warning",
      detail: "Credenciais seguem fora do Git"
    },
    unknown: {
      value: "Status desconhecido",
      tone: "neutral",
      detail: "Configurado, sem teste ativo"
    }
  };

  return {
    label,
    ...values[status]
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}
