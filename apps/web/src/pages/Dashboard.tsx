import "./dashboard.css";

import {
  BadgeDollarSign,
  BarChart3,
  ClipboardList,
  FolderOpen,
  ListChecks,
  PlusCircle,
  Receipt,
  Scale,
  Table2,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Alert } from "../components/ui";
import { useUser } from "../lib/auth";
import {
  OMIE_BACKLOG_DAYS,
  activityAt,
  buildHealthPills,
  classifyOpenAge,
  dashboardQueries,
  formatDashTons,
  formatElapsed,
  formatHour,
  formatKg,
  formatOldDate,
  isOpenOperation,
  omieBacklog,
  recentOperations,
  requestBacklog,
  summarizeDay,
  type DashboardTone,
  type HealthPill
} from "../lib/dashboard";
import { formatDateTime, formatMoney, formatPlate, periodToIso, todayIso } from "../lib/format";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { useExecutorStatus } from "./Operation";

/** De quanto em quanto tempo o painel rele a nuvem (o desktop atualiza a cada evento local). */
const REFRESH_MS = 30_000;

/**
 * "Painel operacional" — a tela inicial do KyberRock Desktop (`DashboardView.tsx`), lendo a
 * nuvem. A faixa de saude troca balanca/impressora/fila local pela balanca executora do site,
 * pelos envios ao OMIE e pelos pedidos do site; o resto tem a mesma disposicao.
 */
export function Dashboard() {
  const user = useUser();
  const navigate = useNavigate();
  const executor = useExecutorStatus();
  const [now, setNow] = useState(() => new Date());

  const today = todayIso(now);
  const todayPeriod = useMemo(() => periodToIso(today, today), [today]);
  const omieSince = useMemo(
    () => new Date(Date.now() - OMIE_BACKLOG_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    [today]
  );
  const requestsSince = useMemo(
    () => new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
    [now]
  );

  const open = useAsync(
    () => q.openOperations(user.companyId, user.unitId),
    [user.companyId, user.unitId]
  );
  const closedToday = useAsync(
    () =>
      q
        .closedOperations(user.companyId, todayPeriod.startIso, todayPeriod.endIso)
        .then((rows) => rows.filter((row) => row.unit_id === user.unitId)),
    [user.companyId, user.unitId, todayPeriod.startIso, todayPeriod.endIso]
  );
  const recentClosed = useAsync(
    () => dashboardQueries.recentClosed(user.companyId, user.unitId),
    [user.companyId, user.unitId]
  );
  const omieRows = useAsync(
    () => dashboardQueries.omieBacklogRows(user.companyId, user.unitId, omieSince),
    [user.companyId, user.unitId, omieSince]
  );
  const requests = useAsync(
    () => q.operationRequests(user.companyId, requestsSince),
    [user.companyId, requestsSince]
  );

  // Um tique so: anda o relogio (tempo no patio, "hoje") e o `requestsSince`, que recarrega os
  // pedidos; as outras leituras recarregam aqui.
  const reloadOpen = open.reload;
  const reloadClosed = closedToday.reload;
  const reloadRecent = recentClosed.reload;
  const reloadOmie = omieRows.reload;
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
      void reloadOpen();
      void reloadClosed();
      void reloadRecent();
      void reloadOmie();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reloadOpen, reloadClosed, reloadRecent, reloadOmie]);

  const kpis = useMemo(() => summarizeDay(closedToday.data ?? []), [closedToday.data]);
  const staleOpen = useMemo(() => classifyOpenAge(open.data ?? [], now), [open.data, now]);
  const recent = useMemo(
    () => recentOperations(open.data ?? [], recentClosed.data ?? []),
    [open.data, recentClosed.data]
  );
  const omie = useMemo(() => (omieRows.data ? omieBacklog(omieRows.data) : null), [omieRows.data]);
  const siteRequests = useMemo(
    () => (requests.data ? requestBacklog(requests.data) : null),
    [requests.data]
  );
  const executorInfo = executor === null ? undefined : executor.executor;
  const healthPills = useMemo(
    () =>
      buildHealthPills({
        executor: executorInfo,
        omie,
        requests: siteRequests,
        formatDateTime
      }),
    [executorInfo, omie, siteRequests]
  );

  const alarmed = staleOpen.filter((item) => item.tone !== "neutral").slice(0, 3);
  const calm = staleOpen.filter((item) => item.tone === "neutral").length;
  const executorDown = Boolean(executorInfo && !executorInfo.online);
  const hasPendingAttention =
    staleOpen.length > 0 ||
    (omie?.pending ?? 0) > 0 ||
    (omie?.failed ?? 0) > 0 ||
    (siteRequests?.waiting ?? 0) > 0 ||
    (siteRequests?.failed ?? 0) > 0 ||
    executorDown;

  const loadError =
    open.error ?? closedToday.error ?? recentClosed.error ?? omieRows.error ?? requests.error;

  return (
    <section className="dash">
      <header className="dash-card dash-hero">
        <div>
          <p className="desk-kicker">Tela inicial</p>
          <h1
            className="dash-hero-title"
            title="Visao rapida do turno: situacao da balanca, movimento do dia e o que precisa de atencao agora."
          >
            Painel operacional
          </h1>
        </div>
        <div className="dash-hero-actions">
          {user.canOperate && (
            <button type="button" className="btn primary" onClick={() => navigate("/nova-entrada")}>
              <PlusCircle size={16} />
              Nova entrada
            </button>
          )}
          <button type="button" className="btn" onClick={() => navigate("/operacoes")}>
            <ListChecks size={16} />
            Operacoes
          </button>
          <button type="button" className="btn" onClick={() => navigate("/cadastros")}>
            <FolderOpen size={16} />
            Cadastros
          </button>
          <button type="button" className="btn" onClick={() => navigate("/relatorios")}>
            <Table2 size={16} />
            Relatorios
          </button>
          <button type="button" className="btn" onClick={() => navigate("/insights")}>
            <BarChart3 size={16} />
            Ver insights
          </button>
        </div>
      </header>

      {loadError && <Alert kind="error">{loadError}</Alert>}

      <HealthPills pills={healthPills} onNavigate={navigate} />

      <div className="dash-columns">
        <article className="dash-card">
          <header className="dash-card-head">
            <div>
              <p className="desk-kicker">Hoje</p>
              <h2 className="dash-card-title">Resumo do turno</h2>
            </div>
            <span className="dash-muted">
              {now.toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                timeZone: "America/Sao_Paulo"
              })}
            </span>
          </header>
          <div className="dash-kpis">
            <KpiCell
              icon={ClipboardList}
              accent="1"
              label="Operacoes"
              value={kpis.operations.toLocaleString("pt-BR")}
              hint="Fechadas hoje"
            />
            <KpiCell
              icon={Scale}
              accent="5"
              label="Peso liquido"
              value={formatDashTons(kpis.weightKg)}
              hint={`${formatKg(kpis.weightKg)} kg`}
            />
            <KpiCell
              icon={BadgeDollarSign}
              accent="3"
              label="Faturamento"
              value={formatMoney(kpis.totalCents)}
              hint="Soma das operacoes fechadas"
            />
            <KpiCell
              icon={Receipt}
              accent="6"
              label="Ticket medio"
              value={formatMoney(kpis.ticketCents)}
              hint="Por operacao fechada"
            />
          </div>
        </article>

        <article className="dash-card">
          <header className="dash-card-head">
            <div>
              <p className="desk-kicker">Atencao</p>
            </div>
            {!hasPendingAttention && <span className="dash-ok-tag">Operacao em dia</span>}
          </header>

          {executorDown && executorInfo && (
            <PendingSection title="Balanca executora fora do ar" tone="danger">
              <PendingRow
                label={`${executorInfo.name} sem sinal`}
                detail={
                  executorInfo.seenAt
                    ? `Ultimo sinal em ${formatDateTime(executorInfo.seenAt)} - os pedidos do site esperam ela voltar`
                    : "Os pedidos do site esperam ela voltar"
                }
                action={{ label: "Abrir operacoes", onClick: () => navigate("/operacoes") }}
                tone="danger"
              />
            </PendingSection>
          )}

          {staleOpen.length > 0 && (
            <PendingSection
              title="Pesagens abertas ha muito tempo"
              tone={staleOpen.some((item) => item.tone === "danger") ? "danger" : "warning"}
            >
              {alarmed.map(({ operation, tone }) => (
                <PendingRow
                  key={operation.id}
                  label={`${formatPlate(operation.plate) || "--"} - ${operation.customer_name || "cliente"}`}
                  detail={`${operation.product_description || "produto"} - ${formatElapsed(operation.created_at, now)}`}
                  action={{ label: "Abrir operacoes", onClick: () => navigate("/operacoes") }}
                  tone={tone}
                />
              ))}
              {calm > 0 && (
                <PendingRow
                  label={`${calm} aberta(s) recente(s)`}
                  detail="Sem alerta, dentro do tempo normal"
                  action={{ label: "Abrir operacoes", onClick: () => navigate("/operacoes") }}
                  tone="neutral"
                />
              )}
            </PendingSection>
          )}

          {omie && omie.failed > 0 && (
            <PendingSection title="Envios ao OMIE com falha" tone="danger">
              <PendingRow
                label={`${omie.failed} pesagem(ns) nao aceita(s) pelo OMIE`}
                detail="Recusa do OMIE ou cadastro incompleto - veja a coluna Fiscal OMIE"
                action={{
                  label: "Ver concluidas",
                  onClick: () => navigate("/operacoes?aba=concluidas")
                }}
                tone="danger"
              />
            </PendingSection>
          )}

          {omie && omie.pending > 0 && (
            <PendingSection title="Pedidos OMIE pendentes" tone="warning">
              <PendingRow
                label={`${omie.pending} pedido(s) aguardando envio`}
                detail="A balanca envia ao OMIE na proxima sincronizacao"
                action={{
                  label: "Ver concluidas",
                  onClick: () => navigate("/operacoes?aba=concluidas")
                }}
                tone="warning"
              />
            </PendingSection>
          )}

          {siteRequests && (siteRequests.waiting > 0 || siteRequests.failed > 0) && (
            <PendingSection
              title="Pedidos do site"
              tone={siteRequests.failed > 0 ? "danger" : "warning"}
            >
              {siteRequests.waiting > 0 && (
                <PendingRow
                  label={`${siteRequests.waiting} pedido(s) aguardando a balanca`}
                  detail={
                    executorInfo?.online
                      ? "Balanca conectada - registrando"
                      : "Balanca fora do ar - registra quando voltar a conexao"
                  }
                  action={{ label: "Abrir operacoes", onClick: () => navigate("/operacoes") }}
                  tone="warning"
                />
              )}
              {siteRequests.failed > 0 && (
                <PendingRow
                  label={`${siteRequests.failed} pedido(s) nao registrado(s)`}
                  detail="A balanca devolveu sem registrar (ultimas 12 h)"
                  action={{ label: "Abrir operacoes", onClick: () => navigate("/operacoes") }}
                  tone="danger"
                />
              )}
            </PendingSection>
          )}

          {!hasPendingAttention && (
            <p className="dash-muted">
              Nenhuma pendencia no momento. As pesagens abertas estao dentro do tempo normal e nao
              ha envio ao OMIE nem pedido do site esperando.
            </p>
          )}
        </article>
      </div>

      <article className="dash-card">
        <header className="dash-card-head">
          <div>
            <p className="desk-kicker">Recente</p>
            <h2 className="dash-card-title">Ultimas pesagens</h2>
          </div>
          <button type="button" className="btn small" onClick={() => navigate("/operacoes")}>
            Ver todas
          </button>
        </header>
        {recent.length === 0 ? (
          <p className="dash-muted">
            {open.loading || recentClosed.loading
              ? "Carregando..."
              : "Nenhuma pesagem registrada ainda."}
          </p>
        ) : (
          <div className="dash-recent">
            <div className="dash-recent-row dash-recent-head">
              <span>Hora</span>
              <span>Placa / Cliente</span>
              <span>Produto</span>
              <span>Peso liquido</span>
              <span>Tipo</span>
              <span>Status</span>
            </div>
            {recent.map((op) => {
              const isOpen = isOpenOperation(op);
              const at = activityAt(op);
              const oldDate = formatOldDate(at, now);
              const plate = formatPlate(op.plate) || "--";
              return (
                <button
                  key={op.id}
                  type="button"
                  className="dash-recent-row dash-recent-item"
                  title={`${plate} - ${op.customer_name || "cliente"} | ${op.product_description || "produto"} | ${isOpen ? "Aberta" : "Fechada"}. Clique para abrir a lista de operacoes.`}
                  onClick={() => navigate(isOpen ? "/operacoes" : "/operacoes?aba=concluidas")}
                >
                  <span className="dash-recent-time">
                    {formatHour(at)}
                    {oldDate && <small className="dash-muted">{oldDate}</small>}
                  </span>
                  <span className="dash-recent-plate">
                    <strong>{plate}</strong>
                    <small className="dash-muted">
                      {op.customer_name || "Cliente nao informado"}
                    </small>
                  </span>
                  <span>{op.product_description || "--"}</span>
                  <span>
                    <strong>
                      {op.net_weight_kg !== null
                        ? formatKg(op.net_weight_kg)
                        : op.entry_weight_kg !== null
                          ? `E: ${formatKg(op.entry_weight_kg)}`
                          : "--"}
                    </strong>
                  </span>
                  <span>
                    <span
                      className={`dash-tag ${op.operation_type === "invoice" ? "invoice" : "internal"}`}
                    >
                      {op.operation_type === "invoice" ? "Com nota" : "Interna"}
                    </span>
                  </span>
                  <span>
                    <span className={`dash-tag ${isOpen ? "open" : "closed"}`}>
                      {isOpen ? "Aberta" : "Fechada"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}

function HealthPills({
  pills,
  onNavigate
}: {
  pills: HealthPill[];
  onNavigate: (to: string) => void;
}) {
  return (
    <div className="dash-health">
      {pills.map((pill) => {
        const to = pill.to;
        return (
          <button
            key={pill.id}
            type="button"
            className={`dash-health-pill ${pill.tone}${to ? " interactive" : ""}`}
            disabled={!to}
            title={pill.detail}
            onClick={to ? () => onNavigate(to) : undefined}
          >
            <span className="dash-health-label">{pill.label}</span>
            <span className="dash-health-value">{pill.value}</span>
          </button>
        );
      })}
    </div>
  );
}

function KpiCell({
  icon: Icon,
  accent,
  label,
  value,
  hint
}: {
  icon: LucideIcon;
  accent: "1" | "3" | "5" | "6";
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="dash-kpi">
      <span className="dash-kpi-top">
        <span className={`dash-kpi-icon chart-${accent}`}>
          <Icon size={15} strokeWidth={2.4} />
        </span>
        <span className="dash-kpi-label">{label}</span>
      </span>
      <span className="dash-kpi-value">{value}</span>
      <span className="dash-kpi-hint">{hint}</span>
    </div>
  );
}

function PendingSection({
  title,
  tone,
  children
}: {
  title: string;
  tone: DashboardTone;
  children: ReactNode;
}) {
  return (
    <div className={`dash-pending ${tone}`}>
      <strong className="dash-pending-title">{title}</strong>
      <div className="dash-pending-list">{children}</div>
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
  tone: DashboardTone;
}) {
  return (
    <div className="dash-pending-row">
      <div className="dash-pending-text">
        <span className="dash-pending-label">{label}</span>
        <span className="dash-pending-detail">{detail}</span>
      </div>
      <button type="button" className={`dash-pending-action ${tone}`} onClick={action.onClick}>
        {action.label}
      </button>
    </div>
  );
}
