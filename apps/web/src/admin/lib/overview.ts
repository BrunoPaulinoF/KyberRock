/**
 * Visao geral do painel: o que a plataforma tem e o que precisa de alguem AGORA.
 *
 * Tudo sai da mesma resposta do `admin-api` `list` que as outras abas ja usam — nenhuma consulta
 * nova ao banco. O modulo e puro (recebe as listas e o relogio) para as regras de "o que conta
 * como pendencia" serem lidas e testadas sem abrir a tela.
 *
 * O dispositivo virtual do site (`web-<company_id>`) nao e um computador: nao pinga, nao tem
 * fila, e conta-lo faria toda pedreira aparecer com uma "balanca sem contato" para sempre.
 */
import { classifyDeviceHealth, type DeviceHealthVerdict } from "./device-health";

export interface OverviewCompany {
  id: string;
  name: string;
  isActive: boolean;
  omieAppKeyMasked?: string | null;
}

export interface OverviewUnit {
  id: string;
  companyId: string;
  name: string;
  isActive: boolean;
}

export interface OverviewUser {
  id: string;
  role: string;
  companyId: string;
  isActive: boolean;
  deviceId: string | null;
}

export interface OverviewDevice {
  id: string;
  companyId: string;
  unitId: string;
  name: string;
  isActive: boolean;
  isPriceMaster: boolean;
  executesWebOperations: boolean;
  lastSeenAt: string | null;
  healthQueuePending: number | null;
  healthQueueBlocked: number | null;
  healthOldestPendingAt: string | null;
  healthLastError: string | null;
  healthCollectedAt: string | null;
}

/** O dispositivo virtual do site (`web-<company_id>`) nao e um computador. */
export function isVirtualDevice(deviceId: string): boolean {
  return deviceId.startsWith("web-");
}

export function deviceHealth(device: OverviewDevice, now: Date = new Date()): DeviceHealthVerdict {
  return classifyDeviceHealth(
    {
      isActive: device.isActive,
      lastSeenAt: device.lastSeenAt,
      queuePending: device.healthQueuePending,
      queueBlocked: device.healthQueueBlocked,
      oldestPendingAt: device.healthOldestPendingAt,
      lastError: device.healthLastError,
      collectedAt: device.healthCollectedAt
    },
    now
  );
}

/** Mesmo limite do painel de saude: 15 min sem ping e a balanca conta como sem contato. */
export const ONLINE_WINDOW_MS = 15 * 60 * 1000;

export function isOnline(lastSeenAt: string | null, now: Date = new Date()): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return now.getTime() - seen <= ONLINE_WINDOW_MS;
}

export interface AttentionDevice {
  device: OverviewDevice;
  health: DeviceHealthVerdict;
}

export type PendingKind =
  | "no-device"
  | "no-omie"
  | "no-price-master"
  | "no-web-executor"
  | "no-login";

export interface PendingItem {
  kind: PendingKind;
  companyId: string;
  companyName: string;
  title: string;
  detail: string;
  tone: "warn" | "info";
  /** Aba do painel que resolve. */
  target: "companies" | "devices";
}

export interface CompanyOverview {
  company: OverviewCompany;
  units: number;
  devices: number;
  online: number;
  attention: number;
  users: number;
}

export interface Overview {
  companies: { total: number; active: number };
  units: { total: number; active: number };
  users: { total: number; loaders: number; site: number; blocked: number };
  devices: {
    /** Computadores de verdade e ativos (sem o dispositivo virtual do site). */
    active: number;
    online: number;
    blocked: number;
    down: number;
    warn: number;
  };
  attention: AttentionDevice[];
  pending: PendingItem[];
  perCompany: CompanyOverview[];
}

const TONE_ORDER: Record<PendingItem["tone"], number> = { warn: 0, info: 1 };

export function buildOverview(
  input: {
    companies: readonly OverviewCompany[];
    units: readonly OverviewUnit[];
    users: readonly OverviewUser[];
    devices: readonly OverviewDevice[];
  },
  now: Date = new Date()
): Overview {
  const physical = input.devices.filter((device) => !isVirtualDevice(device.id));
  const active = physical.filter((device) => device.isActive);
  const health = new Map(active.map((device) => [device.id, deviceHealth(device, now)]));

  // Quem precisa de gente primeiro: envio parado antes de silencio (a balanca desligada volta
  // sozinha quando alguem a liga; o envio parado nunca volta sem um clique).
  const attention = active
    .map((device) => ({ device, health: health.get(device.id)! }))
    .filter((entry) => entry.health.level === "down" || entry.health.level === "warn")
    .sort((a, b) => {
      if (a.health.level !== b.health.level) return a.health.level === "down" ? -1 : 1;
      return (
        (Date.parse(b.device.lastSeenAt ?? "") || 0) - (Date.parse(a.device.lastSeenAt ?? "") || 0)
      );
    });

  const pending: PendingItem[] = [];
  const perCompany: CompanyOverview[] = [];

  for (const company of input.companies) {
    const companyDevices = active.filter((device) => device.companyId === company.id);
    const companyUsers = input.users.filter((user) => user.companyId === company.id);
    perCompany.push({
      company,
      units: input.units.filter((unit) => unit.companyId === company.id).length,
      devices: companyDevices.length,
      online: companyDevices.filter((device) => isOnline(device.lastSeenAt, now)).length,
      attention: attention.filter((entry) => entry.device.companyId === company.id).length,
      users: companyUsers.length
    });

    if (!company.isActive) continue;
    const base = { companyId: company.id, companyName: company.name };

    if (companyDevices.length === 0) {
      pending.push({
        ...base,
        kind: "no-device",
        title: "Nenhuma balança ativada",
        detail: "Gere o código de ativação e instale o KyberRock Desktop no computador da balança.",
        tone: "warn",
        target: "devices"
      });
    }

    if (!company.omieAppKeyMasked) {
      pending.push({
        ...base,
        kind: "no-omie",
        title: "OMIE não configurado",
        detail: "Sem a chave do OMIE os pedidos das pesagens não chegam ao ERP.",
        tone: "warn",
        target: "companies"
      });
    }

    // Com duas balancas ou mais e nenhuma principal, cada uma fica com o preco que ela mesma
    // digitou (docs/preco-balanca-principal.md).
    if (companyDevices.length >= 2 && !companyDevices.some((device) => device.isPriceMaster)) {
      pending.push({
        ...base,
        kind: "no-price-master",
        title: "Sem balança principal de preços",
        detail: `${companyDevices.length} balanças e nenhuma define os preços: cada uma pode ficar com um preço diferente.`,
        tone: "warn",
        target: "devices"
      });
    }

    for (const unit of input.units) {
      if (unit.companyId !== company.id || !unit.isActive) continue;
      const unitDevices = companyDevices.filter((device) => device.unitId === unit.id);
      if (unitDevices.length > 0 && !unitDevices.some((device) => device.executesWebOperations)) {
        pending.push({
          ...base,
          kind: "no-web-executor",
          title: `${unit.name}: ninguém executa as pesagens do site`,
          detail:
            "Pedido de pesagem feito pelo site fica esperando até uma balança da unidade executar.",
          tone: "info",
          target: "devices"
        });
      }
    }

    const withoutLogin = companyDevices.filter(
      (device) => !input.users.some((user) => user.deviceId === device.id)
    ).length;
    if (withoutLogin > 0) {
      pending.push({
        ...base,
        kind: "no-login",
        title: `${withoutLogin} balança${withoutLogin > 1 ? "s" : ""} sem login do site`,
        detail: "Quem usa o computador ainda não tem e-mail e senha para entrar no KyberRock Web.",
        tone: "info",
        target: "devices"
      });
    }
  }

  pending.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

  const statusOf = (level: string) =>
    [...health.values()].filter((verdict) => verdict.level === level).length;

  return {
    companies: {
      total: input.companies.length,
      active: input.companies.filter((company) => company.isActive).length
    },
    units: {
      total: input.units.length,
      active: input.units.filter((unit) => unit.isActive).length
    },
    users: {
      total: input.users.length,
      loaders: input.users.filter((user) => user.role === "loader").length,
      site: input.users.filter((user) => user.role !== "loader").length,
      blocked: input.users.filter((user) => !user.isActive).length
    },
    devices: {
      active: active.length,
      online: active.filter((device) => isOnline(device.lastSeenAt, now)).length,
      blocked: physical.length - active.length,
      down: statusOf("down"),
      warn: statusOf("warn")
    },
    attention,
    pending,
    perCompany
  };
}

/** "ha 3 min", "ha 2 h" — ou "nunca" para quem nunca pingou. */
export function sinceLabel(value: string | null, now: Date = new Date()): string {
  if (!value) return "nunca";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - parsed) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}
