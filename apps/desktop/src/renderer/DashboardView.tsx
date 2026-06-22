import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { PrintProfileSummary } from "../services/printing";
import type { DesktopStatusSnapshot } from "../services/status";
import type { WeighingOperationSummary } from "../services/weighing-operations";
import { buildStatusIndicatorViewModels, type StatusIndicatorTone } from "./status-view-model";
import { Tooltip, HelpTooltip } from "./Tooltip";
import { TIPS } from "./tooltip-messages";

type ActiveView =
  | "dashboard"
  | "new-weighing"
  | "open-operations"
  | "scale"
  | "registrations"
  | "printing"
  | "cloud"
  | "insights"
  | "documentation";

export interface DashboardOmieStatus {
  configured: boolean;
  pendingPushCustomers: number;
  pendingOmieJobs: number;
  lastSyncAt: string | null;
}

export interface DashboardViewProps {
  status: DesktopStatusSnapshot | null;
  openOperations: WeighingOperationSummary[];
  closedOperations: WeighingOperationSummary[];
  cloudConnected: boolean;
  omieStatus: DashboardOmieStatus | null;
  printProfiles: PrintProfileSummary[];
  errorLogsCount: number;
  onNavigate: (view: ActiveView) => void;
  onSyncOmie: () => void | Promise<void>;
  onSyncCloud: () => void | Promise<void>;
  onOpenLogs: () => void;
}

const STALE_OPEN_HOURS_WARN = 2;
const STALE_OPEN_HOURS_DANGER = 4;
const RECENT_OPERATIONS_LIMIT = 5;
const LONG_AGO_MS = 1000 * 60 * 60 * 24 * 7;

function formatMoney(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

function formatKg(kg: number): string {
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

function formatHour(iso: string | null): string {
  if (!iso) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(fromIso: string, now: Date): string {
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return "tempo desconhecido";
  const diffMs = Math.max(0, now.getTime() - start);
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours <= 0) {
    const mins = Math.max(1, minutes);
    return `${mins} min`;
  }
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function isSameLocalDay(iso: string, now: Date): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function toneColor(tone: StatusIndicatorTone): { bg: string; fg: string; border: string } {
  switch (tone) {
    case "success":
      return { bg: "#dcfce7", fg: "#166534", border: "#86efac" };
    case "warning":
      return { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d" };
    case "danger":
      return { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
    case "neutral":
    default:
      return { bg: "#e2e8f0", fg: "#475569", border: "#cbd5e1" };
  }
}

function buildHealthPills(
  props: DashboardViewProps
): Array<{ id: string; label: string; value: string; tone: StatusIndicatorTone; detail: string; onClick: (() => void) | null }> {
  const pills: Array<{
    id: string;
    label: string;
    value: string;
    tone: StatusIndicatorTone;
    detail: string;
    onClick: (() => void) | null;
  }> = [];

  if (props.status) {
    const indicators = buildStatusIndicatorViewModels(props.status);
    for (const indicator of indicators) {
      pills.push({
        id: `system-${indicator.label}`,
        label: indicator.label,
        value: indicator.value,
        tone: indicator.tone,
        detail: indicator.detail,
        onClick: null
      });
    }
  } else {
    pills.push({
      id: "system-loading",
      label: "Sistema",
      value: "Carregando...",
      tone: "neutral",
      detail: "Coletando status do desktop",
      onClick: null
    });
  }

  if (props.printProfiles.length > 0) {
    const activePrinter = props.printProfiles.find((p) => p.isActive) ?? props.printProfiles[0];
    pills.push({
      id: "system-printer",
      label: "Impressora",
      value: activePrinter.windowsPrinterName,
      tone: "success",
      detail: "Perfil ativo para cupom 80 mm",
      onClick: () => props.onNavigate("printing")
    });
  } else {
    pills.push({
      id: "system-printer",
      label: "Impressora",
      value: "Nao configurada",
      tone: "warning",
      detail: "Configure um perfil em Impressao para emitir cupons",
      onClick: () => props.onNavigate("printing")
    });
  }

  if (props.omieStatus) {
    if (!props.omieStatus.configured) {
      pills.push({
        id: "system-omie-jobs",
        label: "OMIE",
        value: "Nao configurado",
        tone: "warning",
        detail: "Credenciais nao informadas",
        onClick: () => props.onNavigate("cloud")
      });
    } else if (props.omieStatus.pendingOmieJobs > 0) {
      pills.push({
        id: "system-omie-jobs",
        label: "OMIE",
        value: `${props.omieStatus.pendingOmieJobs} pendente(s)`,
        tone: "warning",
        detail: "Pedidos aguardando envio ao OMIE",
        onClick: () => props.onSyncOmie()
      });
    } else {
      pills.push({
        id: "system-omie-jobs",
        label: "OMIE",
        value: "Em dia",
        tone: "success",
        detail: "Sem pedidos pendentes",
        onClick: () => props.onNavigate("cloud")
      });
    }
  }

  if (props.status) {
    const pending = props.status.pendingSyncJobs;
    pills.push({
      id: "system-cloud-queue",
      label: "Cloud (fila)",
      value: pending > 0 ? `${pending} pendente(s)` : "Vazia",
      tone: pending > 0 ? "warning" : "success",
      detail: pending > 0 ? "Itens aguardando sincronizacao" : "Sem itens na fila",
      onClick: pending > 0 ? () => props.onSyncCloud() : () => props.onNavigate("cloud")
    });
  }

  return pills;
}

export function DashboardView(props: DashboardViewProps) {
  const now = useMemo(() => new Date(), []);

  const closedToday = useMemo(
    () => props.closedOperations.filter((op) => isSameLocalDay(op.updatedAt, now)),
    [props.closedOperations, now]
  );

  const todayKpis = useMemo(() => {
    const operations = closedToday.length;
    const weightKg = closedToday.reduce(
      (sum, op) => sum + (op.netWeightKg ?? 0),
      0
    );
    const totalCents = closedToday.reduce((sum, op) => sum + (op.totalCents ?? 0), 0);
    const ticketCents = operations > 0 ? Math.round(totalCents / operations) : 0;
    return { operations, weightKg, totalCents, ticketCents };
  }, [closedToday]);

  const staleOpen = useMemo(() => {
    const sorted = [...props.openOperations]
      .filter((op) => op.createdAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return sorted.map((op) => {
      const ageMs = now.getTime() - new Date(op.createdAt).getTime();
      const hours = ageMs / (1000 * 60 * 60);
      let tone: StatusIndicatorTone = "neutral";
      if (hours >= STALE_OPEN_HOURS_DANGER) tone = "danger";
      else if (hours >= STALE_OPEN_HOURS_WARN) tone = "warning";
      return { operation: op, ageMs, hours, tone };
    });
  }, [props.openOperations, now]);

  const recentOperations = useMemo(() => {
    const merged: Array<WeighingOperationSummary & { _sortKey: string }> = [
      ...props.openOperations.map((op) => ({ ...op, _sortKey: op.updatedAt })),
      ...props.closedOperations.map((op) => ({ ...op, _sortKey: op.updatedAt }))
    ];
    return merged
      .filter((op) => op._sortKey)
      .sort((a, b) => b._sortKey.localeCompare(a._sortKey))
      .slice(0, RECENT_OPERATIONS_LIMIT);
  }, [props.openOperations, props.closedOperations]);

  const healthPills = useMemo(() => buildHealthPills(props), [props]);

  const hasPendingAttention =
    staleOpen.length > 0 ||
    (props.omieStatus?.pendingOmieJobs ?? 0) > 0 ||
    (props.status?.pendingSyncJobs ?? 0) > 0 ||
    props.errorLogsCount > 0;

  return (
    <section style={styles.page}>
      <header style={styles.hero}>
        <div>
          <p style={styles.kicker}>Tela inicial</p>
          <h2 style={styles.heroTitle}>Painel operacional</h2>
          <p style={styles.subtitle}>
            Visao rapida do turno: integridade dos sistemas, movimento do dia e o que precisa de
            atencao agora.
          </p>
        </div>
        <div style={styles.heroActions}>
          <button
              type="button"
              onClick={() => props.onNavigate("new-weighing")}
              style={styles.primaryButton}
            >
              + Nova entrada
            </button>
          <HelpTooltip content={TIPS.dashboard.newEntry} placement="bottom" shortcut="F2" />
          <button
              type="button"
              onClick={() => props.onNavigate("insights")}
              style={styles.secondaryButton}
            >
              Ver insights (F5)
            </button>
          <HelpTooltip content={TIPS.dashboard.insights} placement="bottom" shortcut="F5" />
        </div>
      </header>

      <HealthPills pills={healthPills} />

      <div style={styles.twoColumns}>
        <article style={styles.panel}>
          <header style={styles.panelHeader}>
            <div>
              <p style={styles.kicker}>Hoje</p>
              <h3 style={styles.panelTitle}>Resumo do turno</h3>
            </div>
            <span style={styles.muted}>
              {now.toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long"
              })}
            </span>
          </header>
          <div style={styles.kpiGrid}>
            <KpiCell
              label="Operacoes"
              value={todayKpis.operations.toLocaleString("pt-BR")}
              hint="Fechadas hoje"
            />
            <KpiCell
              label="Peso liquido"
              value={formatTons(todayKpis.weightKg)}
              hint={formatKg(todayKpis.weightKg)}
            />
            <KpiCell
              label="Faturamento"
              value={formatMoney(todayKpis.totalCents)}
              hint="Soma das operacoes fechadas"
            />
            <KpiCell
              label="Ticket medio"
              value={formatMoney(todayKpis.ticketCents)}
              hint="Por operacao fechada"
            />
          </div>
        </article>

        <article style={styles.panel}>
          <header style={styles.panelHeader}>
            <div>
              <p style={styles.kicker}>Atencao</p>
              <h3 style={styles.panelTitle} title={TIPS.dashboard.pending}>Pendencias</h3>
            </div>
            {hasPendingAttention ? null : (
              <span style={{ ...styles.pillNeutral, padding: "4px 10px", fontSize: "11px" }}>
                Operacao em dia
              </span>
            )}
          </header>

          {staleOpen.length > 0 ? (
            <PendingSection
              title="Pesagens abertas ha muito tempo"
              tone={staleOpen.some((s) => s.tone === "danger") ? "danger" : "warning"}
            >
              {staleOpen
                .filter((s) => s.tone !== "neutral")
                .slice(0, 3)
                .map(({ operation, tone }) => (
                  <PendingRow
                    key={operation.id}
                    label={`${operation.plate || "--"} - ${operation.customerName || "cliente"}`}
                    detail={`${operation.productDescription || "produto"} - ${formatElapsed(operation.createdAt, now)}`}
                    action={{ label: "Abrir operacoes", onClick: () => props.onNavigate("open-operations") }}
                    tone={tone}
                  />
                ))}
              {staleOpen.filter((s) => s.tone === "neutral").length > 0 ? (
                <PendingRow
                  label={`${staleOpen.filter((s) => s.tone === "neutral").length} aberta(s) recente(s)`}
                  detail="Sem alerta, dentro do tempo normal"
                  action={{ label: "Abrir operacoes", onClick: () => props.onNavigate("open-operations") }}
                  tone="neutral"
                />
              ) : null}
            </PendingSection>
          ) : null}

          {props.omieStatus && props.omieStatus.pendingOmieJobs > 0 ? (
            <PendingSection title="Pedidos OMIE pendentes" tone="warning">
              <PendingRow
                label={`${props.omieStatus.pendingOmieJobs} pedido(s) aguardando envio`}
                detail="Sincronize para faturar no OMIE"
                action={{ label: "Sincronizar (F9)", onClick: () => void props.onSyncOmie() }}
                tone="warning"
              />
            </PendingSection>
          ) : null}

          {props.status && props.status.pendingSyncJobs > 0 ? (
            <PendingSection title="Fila cloud (Supabase)" tone="warning">
              <PendingRow
                label={`${props.status.pendingSyncJobs} item(ns) na fila`}
                detail={props.cloudConnected ? "Conectado - sincronize para enviar" : "Offline - sincronizara quando voltar a conexao"}
                action={
                  props.cloudConnected
                    ? { label: "Sincronizar", onClick: () => void props.onSyncCloud() }
                    : { label: "Ver cloud", onClick: () => props.onNavigate("cloud") }
                }
                tone="warning"
              />
            </PendingSection>
          ) : null}

          {props.errorLogsCount > 0 ? (
            <PendingSection title="Erros recentes" tone="danger">
              <PendingRow
                label={`${props.errorLogsCount} log(s) capturado(s)`}
                detail="Abra o console para inspecao"
                action={{ label: "Abrir logs (F10)", onClick: props.onOpenLogs }}
                tone="danger"
              />
            </PendingSection>
          ) : null}

          {!hasPendingAttention ? (
            <p style={styles.muted}>
              Nenhuma pendencia no momento. As pesagens abertas estao dentro do tempo normal e a
              fila de sincronizacao esta vazia.
            </p>
          ) : null}
        </article>
      </div>

        <article style={{ ...styles.panel, ...styles.recentPanel }}>
        <header style={styles.panelHeader}>
          <div>
            <p style={styles.kicker}>Recente</p>
            <h3 style={styles.panelTitle}>Ultimas pesagens</h3>
          </div>
          <button
              type="button"
              onClick={() => props.onNavigate("open-operations")}
              style={{ ...styles.secondaryButton, padding: "6px 10px", fontSize: "12px" }}
            >
              Ver todas
            </button>
          <HelpTooltip content={TIPS.dashboard.recent} placement="left" shortcut="F3" />
        </header>
        {recentOperations.length === 0 ? (
          <p style={styles.muted}>Nenhuma pesagem registrada ainda.</p>
        ) : (
          <div style={styles.recentTable}>
            <div style={{ ...styles.recentRow, ...styles.recentHead }}>
              <span>Hora</span>
              <span>Placa / Cliente</span>
              <span>Produto</span>
              <span>Peso liquido</span>
              <span>Tipo</span>
              <span>Status</span>
            </div>
            {recentOperations.map((op) => {
              const updated = new Date(op.updatedAt).getTime();
              const isOpen = op.status !== "closed_local" && op.status !== "synced" && op.status !== "cancelled";
              const row = (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => props.onNavigate("open-operations")}
                  style={{
                    ...styles.recentRow,
                    background: "transparent",
                    border: "none",
                    width: "100%",
                    textAlign: "left" as const,
                    cursor: "pointer",
                    color: "var(--kr-text)"
                  }}
                >
                  <span style={styles.recentTimeCell}>
                    {formatHour(op.updatedAt)}
                    {now.getTime() - updated > LONG_AGO_MS ? (
                      <small style={styles.muted}>
                        {new Date(op.updatedAt).toLocaleDateString("pt-BR")}
                      </small>
                    ) : null}
                  </span>
                  <span style={styles.recentPlateCell}>
                    <strong>{op.plate || "--"}</strong>
                    <small style={styles.muted}>{op.customerName || "Cliente nao informado"}</small>
                  </span>
                  <span>{op.productDescription || "--"}</span>
                  <span>
                    <strong>
                      {op.netWeightKg !== null ? formatKg(op.netWeightKg) : op.entryWeightKg !== null ? `E: ${formatKg(op.entryWeightKg)}` : "--"}
                    </strong>
                  </span>
                  <span>
                    <span
                      style={
                        op.operationType === "invoice"
                          ? styles.pillInvoice
                          : styles.pillInternal
                      }
                    >
                      {op.operationType === "invoice" ? "Com nota" : "Interna"}
                    </span>
                  </span>
                  <span>
                    <span style={isOpen ? styles.pillOpen : styles.pillClosed}>
                      {isOpen ? "Aberta" : "Fechada"}
                    </span>
                  </span>
                </button>
              );
              return (
                <Tooltip
                  key={op.id}
                  content={`${op.plate || "--"} - ${op.customerName || "cliente"} | ${op.productDescription || "produto"} | ${isOpen ? "Aberta" : "Fechada"}. Clique para abrir a lista de operacoes.`}
                  placement="top"
                >
                  {row}
                </Tooltip>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}

interface HealthPillItem {
  id: string;
  label: string;
  value: string;
  tone: StatusIndicatorTone;
  detail: string;
  onClick: (() => void) | null;
}

function HealthPills({ pills }: { pills: HealthPillItem[] }): ReactNode {
  return (
    <div style={styles.healthRow}>
      {pills.map((pill) => {
        const colors = toneColor(pill.tone);
        const interactive = pill.onClick !== null;
        return (
          <button
            key={pill.id}
            type="button"
            onClick={pill.onClick ?? undefined}
            disabled={!interactive}
            title={pill.detail}
            style={{
              ...styles.healthPill,
              background: colors.bg,
              color: colors.fg,
              borderColor: colors.border,
              cursor: interactive ? "pointer" : "default",
              opacity: interactive ? 1 : 0.95
            }}
          >
            <span style={styles.healthPillLabel}>{pill.label}</span>
            <span style={styles.healthPillValue}>{pill.value}</span>
          </button>
        );
      })}
    </div>
  );
}

function KpiCell({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div style={styles.kpiCell}>
      <span style={styles.kpiLabel}>{label}</span>
      <span style={styles.kpiValue}>{value}</span>
      {hint ? <span style={styles.kpiHint}>{hint}</span> : null}
    </div>
  );
}

function PendingSection({
  title,
  tone,
  children
}: {
  title: string;
  tone: StatusIndicatorTone;
  children: ReactNode;
}): ReactNode {
  const colors = toneColor(tone);
  return (
    <div style={{ ...styles.pendingSection, borderLeftColor: colors.border, background: colors.bg }}>
      <strong style={{ ...styles.pendingTitle, color: colors.fg }}>{title}</strong>
      <div style={styles.pendingList}>{children}</div>
    </div>
  );
}

function PendingRow({
  label,
  detail,
  action,
  tone
}: {
  label: string;
  detail: string;
  action: { label: string; onClick: () => void };
  tone: StatusIndicatorTone;
}): ReactNode {
  const colors = toneColor(tone);
  return (
    <div style={styles.pendingRow}>
      <div style={styles.pendingRowText}>
        <span style={styles.pendingRowLabel}>{label}</span>
        <span style={styles.pendingRowDetail}>{detail}</span>
      </div>
      <button
        type="button"
        onClick={action.onClick}
        style={{
          ...styles.pendingAction,
          color: colors.fg,
          borderColor: colors.border,
          background: "#ffffff"
        }}
      >
        {action.label}
      </button>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginTop: "4px"
  },
  hero: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    padding: "20px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)"
  },
  heroTitle: {
    margin: "6px 0 4px 0",
    fontSize: "26px",
    color: "var(--kr-text-strong)"
  },
  heroActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap"
  },
  primaryButton: {
    border: "none",
    borderRadius: "8px",
    padding: "10px 14px",
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  secondaryButton: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "8px",
    padding: "8px 12px",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  kicker: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase"
  },
  subtitle: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "13px",
    maxWidth: "520px"
  },
  healthRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)"
  },
  healthPill: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    padding: "6px 10px",
    borderRadius: "10px",
    border: "1px solid transparent",
    fontFamily: "inherit",
    minWidth: "110px"
  },
  healthPillLabel: {
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    opacity: 0.85
  },
  healthPillValue: {
    fontSize: "13px",
    fontWeight: 800,
    lineHeight: 1.2
  },
  twoColumns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "12px"
  },
  panel: {
    padding: "16px",
    borderRadius: "12px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)",
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px"
  },
  panelTitle: {
    margin: "4px 0 0 0",
    fontSize: "16px",
    color: "var(--kr-text-strong)"
  },
  muted: {
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  pillNeutral: {
    borderRadius: "999px",
    background: "#e2e8f0",
    color: "#475569",
    fontWeight: 700
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "10px"
  },
  kpiCell: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface-soft)"
  },
  kpiLabel: {
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--kr-muted)"
  },
  kpiValue: {
    fontSize: "20px",
    fontWeight: 800,
    color: "var(--kr-text-strong)"
  },
  kpiHint: {
    fontSize: "11px",
    color: "var(--kr-muted)"
  },
  pendingSection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 12px",
    borderLeft: "3px solid",
    borderRadius: "8px"
  },
  pendingTitle: {
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  },
  pendingList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  pendingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "8px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)"
  },
  pendingRowText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0
  },
  pendingRowLabel: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  pendingRowDetail: {
    fontSize: "11px",
    color: "var(--kr-muted)"
  },
  pendingAction: {
    border: "1px solid",
    borderRadius: "6px",
    padding: "4px 8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "11px",
    background: "#ffffff"
  },
  recentPanel: {
    marginTop: 0
  },
  recentTable: {
    display: "flex",
    flexDirection: "column",
    borderRadius: "10px",
    border: "1px solid var(--kr-border)",
    overflow: "hidden"
  },
  recentRow: {
    display: "grid",
    gridTemplateColumns: "70px 1.4fr 1.4fr 1fr 0.8fr 0.8fr",
    gap: "10px",
    alignItems: "center",
    padding: "8px 12px",
    fontSize: "12px"
  },
  recentHead: {
    background: "var(--kr-surface-soft)",
    color: "var(--kr-muted)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontSize: "10px"
  },
  recentTimeCell: {
    display: "flex",
    flexDirection: "column",
    color: "var(--kr-text-strong)",
    fontWeight: 700
  },
  recentPlateCell: {
    display: "flex",
    flexDirection: "column",
    color: "var(--kr-text-strong)"
  },
  pillInvoice: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1e3a8a",
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  },
  pillInternal: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    background: "#fef3c7",
    color: "#92400e",
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  },
  pillOpen: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  },
  pillClosed: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.05em"
  }
};
