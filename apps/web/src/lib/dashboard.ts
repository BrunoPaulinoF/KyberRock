/**
 * O "Painel operacional" do site — espelho de `apps/desktop/src/renderer/DashboardView.tsx`.
 *
 * O desktop mostra a saude da MAQUINA (balanca, impressora, fila cloud, fila OMIE, backup); o
 * site nao tem hardware nem fila local, entao a faixa de saude vira a situacao da balanca que
 * EXECUTA os pedidos do site, os envios ao OMIE (lidos de `omie_billing_status`, a projecao da
 * balanca) e os pedidos do site. O resto (Resumo do turno, Atencao, Ultimas pesagens) segue a
 * mesma disposicao e os mesmos textos.
 *
 * Regra de dinheiro (CLAUDE.md): o "hoje" do Resumo e o dia em que a pesagem FECHOU
 * (`closed_at`, com `created_at` so para pesagem antiga) — `q.closedOperations` ja recorta assim.
 * O tempo no patio conta pela ENTRADA (`created_at`).
 */

import { fiscalStatus, type OperationRequest } from "./operation";
import type { Operation } from "./queries";
import { supabase } from "./supabase";

export type DashboardTone = "success" | "warning" | "danger" | "neutral";

/** Status da pesagem concluida na nuvem (tudo o que a balanca ja fechou). */
export const CLOSED_STATUSES = [
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error"
] as const;

export const STALE_OPEN_HOURS_WARN = 2;
export const STALE_OPEN_HOURS_DANGER = 4;
export const RECENT_OPERATIONS_LIMIT = 5;
/** Quantos dias para tras o painel procura envio ao OMIE ainda nao confirmado. */
export const OMIE_BACKLOG_DAYS = 30;
const LONG_AGO_MS = 1000 * 60 * 60 * 24 * 7;
const TIME_ZONE = "America/Sao_Paulo";

// ---------- formatacao (a mesma do desktop) ----------

/** Toneladas com uma casa, como o KPI do desktop ("12,4 t"). */
export function formatDashTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

/** Quilos so com o numero: a coluna ja diz "Peso". */
export function formatKg(kg: number): string {
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatHour(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE
  });
}

/** Data curta embaixo da hora, so quando a pesagem tem mais de uma semana. */
export function formatOldDate(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (now.getTime() - date.getTime() <= LONG_AGO_MS) return null;
  return date.toLocaleDateString("pt-BR", { timeZone: TIME_ZONE });
}

/** "35 min" ou "2h05" desde a entrada. */
export function formatElapsed(fromIso: string, now: Date): string {
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return "tempo desconhecido";
  const diffMs = Math.max(0, now.getTime() - start);
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours <= 0) return `${Math.max(1, minutes)} min`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

// ---------- Resumo do turno ----------

export interface DayKpis {
  operations: number;
  weightKg: number;
  totalCents: number;
  ticketCents: number;
}

type KpiRow = Pick<Operation, "net_weight_kg" | "total_cents">;

export function summarizeDay(closedToday: KpiRow[]): DayKpis {
  const operations = closedToday.length;
  const weightKg = closedToday.reduce((sum, op) => sum + (op.net_weight_kg ?? 0), 0);
  const totalCents = closedToday.reduce((sum, op) => sum + (op.total_cents ?? 0), 0);
  const ticketCents = operations > 0 ? Math.round(totalCents / operations) : 0;
  return { operations, weightKg, totalCents, ticketCents };
}

// ---------- Atencao: pesagens abertas ha muito tempo ----------

type OpenRow = Pick<
  Operation,
  "id" | "created_at" | "plate" | "customer_name" | "product_description"
>;

export interface StaleOpen<T extends OpenRow = OpenRow> {
  operation: T;
  hours: number;
  tone: DashboardTone;
}

/** Abertas da mais antiga para a mais nova, com o alerta de 2 h (aviso) e 4 h (perigo). */
export function classifyOpenAge<T extends OpenRow>(open: T[], now: Date): StaleOpen<T>[] {
  return open
    .filter((op) => op.created_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((operation) => {
      const ageMs = now.getTime() - new Date(operation.created_at).getTime();
      const hours = Number.isNaN(ageMs) ? 0 : ageMs / (1000 * 60 * 60);
      let tone: DashboardTone = "neutral";
      if (hours >= STALE_OPEN_HOURS_DANGER) tone = "danger";
      else if (hours >= STALE_OPEN_HOURS_WARN) tone = "warning";
      return { operation, hours, tone };
    });
}

// ---------- Atencao: envios ao OMIE ----------

type FiscalRow = Parameters<typeof fiscalStatus>[0];

export interface OmieBacklog {
  /** Ainda nao confirmados: a balanca envia na proxima sincronizacao. */
  pending: number;
  /** Recusados ou com cadastro incompleto: precisam de alguem. */
  failed: number;
}

/**
 * Conta o que ainda nao chegou ao OMIE com a MESMA regra da coluna "Fiscal OMIE" das concluidas
 * (`fiscalStatus`): `neutral` e envio em andamento, `warning`/`danger` e envio que parou.
 */
export function omieBacklog(rows: FiscalRow[]): OmieBacklog {
  let pending = 0;
  let failed = 0;
  for (const row of rows) {
    const tone = fiscalStatus(row).tone;
    if (tone === "neutral") pending++;
    else if (tone === "warning" || tone === "danger") failed++;
  }
  return { pending, failed };
}

// ---------- Atencao: pedidos do site ----------

export interface RequestBacklog {
  /** Esperando a balanca pegar ou registrando agora. */
  waiting: number;
  /** A balanca devolveu sem registrar. */
  failed: number;
}

export function requestBacklog(requests: Pick<OperationRequest, "status">[]): RequestBacklog {
  let waiting = 0;
  let failed = 0;
  for (const request of requests) {
    if (request.status === "pending" || request.status === "processing") waiting++;
    else if (request.status === "failed") failed++;
  }
  return { waiting, failed };
}

// ---------- Ultimas pesagens ----------

type RecentRow = Pick<Operation, "id" | "status" | "created_at" | "updated_at" | "closed_at">;

export function isOpenOperation(op: Pick<Operation, "status">): boolean {
  return !(CLOSED_STATUSES as readonly string[]).includes(op.status) && op.status !== "cancelled";
}

/**
 * Hora que a linha mostra e pela qual ordena: a do fechamento para a concluida (o `updated_at`
 * dela anda sozinho quando a balanca projeta o status do OMIE) e a ultima mudanca para a aberta.
 */
export function activityAt(op: RecentRow): string {
  if (!isOpenOperation(op)) return op.closed_at ?? op.updated_at ?? op.created_at;
  return op.updated_at ?? op.created_at;
}

/** Abertas e concluidas juntas, mais nova primeiro — as 5 do desktop. */
export function recentOperations<T extends RecentRow>(
  open: T[],
  closed: T[],
  limit: number = RECENT_OPERATIONS_LIMIT
): T[] {
  const seen = new Set<string>();
  return [...open, ...closed]
    .filter((op) => {
      if (seen.has(op.id)) return false;
      seen.add(op.id);
      return Boolean(activityAt(op));
    })
    .sort((a, b) => Date.parse(activityAt(b)) - Date.parse(activityAt(a)))
    .slice(0, limit);
}

// ---------- faixa de saude ----------

export interface ExecutorInfo {
  name: string;
  online: boolean;
  seenAt: string | null;
}

export interface HealthPill {
  id: string;
  label: string;
  value: string;
  tone: DashboardTone;
  detail: string;
  /** Rota do site ao clicar; `null` = so informa. */
  to: string | null;
}

export interface HealthInput {
  /** `undefined` = ainda perguntando; `null` = nenhuma balanca executa pedidos do site. */
  executor: ExecutorInfo | null | undefined;
  omie: OmieBacklog | null;
  requests: RequestBacklog | null;
  formatDateTime: (iso: string) => string;
}

/**
 * A faixa de pilulas do topo. No desktop: Internet, Balanca, Cloud, OMIE, Fila cloud, Ultimo sync,
 * Ultimo backup e Impressora. No site so o que a nuvem sabe: a balanca executora (ligada e o
 * ultimo sinal), os envios ao OMIE e os pedidos do site.
 */
export function buildHealthPills(input: HealthInput): HealthPill[] {
  const pills: HealthPill[] = [];
  const { executor } = input;

  if (executor === undefined) {
    pills.push({
      id: "executor",
      label: "Balanca",
      value: "Verificando...",
      tone: "neutral",
      detail: "Consultando a balanca que executa os pedidos do site",
      to: null
    });
  } else if (executor === null) {
    pills.push({
      id: "executor",
      label: "Balanca",
      value: "Nao definida",
      tone: "warning",
      detail: "Nenhuma balanca da unidade executa os pedidos do site (defina no painel)",
      to: null
    });
  } else {
    pills.push({
      id: "executor",
      label: "Balanca",
      value: executor.online ? `${executor.name} conectada` : `${executor.name} fora do ar`,
      tone: executor.online ? "success" : "danger",
      detail: executor.online
        ? "Balanca executora conectada: os pedidos do site sao registrados na hora"
        : "Os pedidos do site ficam na fila ate a balanca voltar",
      to: null
    });
    pills.push({
      id: "executor-seen",
      label: "Ultimo sinal",
      value: executor.seenAt ? input.formatDateTime(executor.seenAt) : "Nunca",
      tone: executor.seenAt ? (executor.online ? "success" : "warning") : "warning",
      detail: "Ultima vez que a balanca executora falou com a nuvem",
      to: null
    });
  }

  if (input.omie) {
    const { pending, failed } = input.omie;
    if (failed > 0) {
      pills.push({
        id: "omie",
        label: "OMIE",
        value: `${failed} com falha`,
        tone: "danger",
        detail: "Pesagens que o OMIE recusou ou com cadastro incompleto",
        to: "/operacoes?aba=concluidas"
      });
    } else if (pending > 0) {
      pills.push({
        id: "omie",
        label: "OMIE",
        value: `${pending} pendente(s)`,
        tone: "warning",
        detail: "Pedidos aguardando envio ao OMIE pela balanca",
        to: "/operacoes?aba=concluidas"
      });
    } else {
      pills.push({
        id: "omie",
        label: "OMIE",
        value: "Em dia",
        tone: "success",
        detail: "Sem pedidos pendentes",
        to: "/operacoes?aba=concluidas"
      });
    }
  }

  if (input.requests) {
    const { waiting, failed } = input.requests;
    pills.push({
      id: "requests",
      label: "Pedidos do site",
      value:
        waiting > 0
          ? `${waiting} aguardando`
          : failed > 0
            ? `${failed} nao registrado(s)`
            : "Em dia",
      tone: waiting > 0 ? "warning" : failed > 0 ? "danger" : "success",
      detail:
        waiting > 0
          ? "Pedidos esperando a balanca executora registrar"
          : failed > 0
            ? "A balanca devolveu pedidos sem registrar (ultimas 12 h)"
            : "Nenhum pedido esperando a balanca",
      to: "/operacoes"
    });
  }

  return pills;
}

// ---------- consultas ----------

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export const dashboardQueries = {
  /** As ultimas concluidas da unidade, pela hora do fechamento. */
  recentClosed: async (companyId: string, unitId: string, limit = RECENT_OPERATIONS_LIMIT) => {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select("*")
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", [...CLOSED_STATUSES])
      .order("closed_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    fail(error);
    return (data ?? []) as Operation[];
  },
  /**
   * Concluidas da unidade nos ultimos `OMIE_BACKLOG_DAYS` dias que ainda nao tem pedido/OS no
   * OMIE nem nota: e so nelas que `fiscalStatus` pode dar pendente ou falha.
   */
  omieBacklogRows: async (companyId: string, unitId: string, sinceIso: string) => {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select(
        "id, operation_type, omie_billing_status, omie_billing_message, omie_sales_order_id, omie_service_order_id, omie_invoice_number"
      )
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", [...CLOSED_STATUSES])
      .or(`closed_at.gte."${sinceIso}",and(closed_at.is.null,created_at.gte."${sinceIso}")`)
      .is("omie_sales_order_id", null)
      .is("omie_service_order_id", null)
      .is("omie_invoice_number", null)
      .limit(1000);
    fail(error);
    return data ?? [];
  }
};
