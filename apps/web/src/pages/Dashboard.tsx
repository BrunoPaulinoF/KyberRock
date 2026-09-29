import "./dashboard.css";

import {
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  ListChecks,
  Receipt,
  Scale,
  Table2,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyState, ErrorState, PageHeader, Pill, Skeleton, SkeletonRows } from "../components/ui";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  OMIE_BACKLOG_DAYS,
  activityAt,
  attentionState,
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
  plural,
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

/**
 * Rede de seguranca: de quanto em quanto tempo o painel rele a nuvem mesmo sem aviso. O normal
 * e reler na hora, pelo aviso de pesagem da balanca (`useOnCadastroChange`).
 */
const REFRESH_MS = 30_000;

/** O que o KPI mostra enquanto a primeira leitura do dia nao chegou. */
const EMPTY_VALUE = "—";

/**
 * "Painel" (o "Painel operacional" do KyberRock Desktop, `DashboardView.tsx`), lendo a nuvem. A
 * faixa de saude troca balanca/impressora/fila local pela balanca executora do site, pelos envios
 * ao OMIE e pelos pedidos do site.
 *
 * E a central do dia do gestor e da operacao: com pendencia (`attentionState`), o cartao Atencao
 * vem PRIMEIRO, na largura toda, antes dos numeros; sem pendencia, os numeros vem primeiro e o
 * "Operacao em dia" e uma linha discreta embaixo deles.
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

  /*
   * Memoria entre telas: voltar ao Painel mostra na hora o que ja tinha e rele por tras. A
   * chave leva empresa, unidade e dia. Os pedidos do site andam numa janela de 12 h que se move
   * a cada tique; a chave fica no dia de proposito — com o instante nela, cada tique viraria uma
   * leitura nova na memoria.
   */
  const cacheScope = `${user.companyId}:${user.unitId}:${today}`;
  const open = useAsync(
    () => q.openOperations(user.companyId, user.unitId),
    [user.companyId, user.unitId],
    { key: `painel:abertas:${cacheScope}` }
  );
  const closedToday = useAsync(
    () =>
      q
        .closedOperations(user.companyId, todayPeriod.startIso, todayPeriod.endIso)
        .then((rows) => rows.filter((row) => row.unit_id === user.unitId)),
    [user.companyId, user.unitId, todayPeriod.startIso, todayPeriod.endIso],
    { key: `painel:fechadas:${cacheScope}` }
  );
  const recentClosed = useAsync(
    () => dashboardQueries.recentClosed(user.companyId, user.unitId),
    [user.companyId, user.unitId],
    { key: `painel:recentes:${cacheScope}` }
  );
  const omieRows = useAsync(
    () => dashboardQueries.omieBacklogRows(user.companyId, user.unitId, omieSince),
    [user.companyId, user.unitId, omieSince],
    { key: `painel:omie:${cacheScope}` }
  );
  const requests = useAsync(
    () => q.operationRequests(user.companyId, requestsSince),
    [user.companyId, requestsSince],
    { key: `painel:pedidos:${cacheScope}` }
  );

  // Um tique so: anda o relogio (tempo no patio, "hoje") e o `requestsSince`, que recarrega os
  // pedidos; as outras leituras recarregam aqui.
  // Releitura silenciosa: o painel nao pisca "Carregando..." a cada tique.
  const reloadOpen = open.refresh;
  const reloadClosed = closedToday.refresh;
  const reloadRecent = recentClosed.refresh;
  const reloadOmie = omieRows.refresh;
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

  // Pesagem aberta, fechada, editada ou cancelada na balanca aparece no painel na hora.
  useOnCadastroChange(reloadOpen, CADASTRO_TABLES.operationsAndLoading);
  useOnCadastroChange(reloadClosed, CADASTRO_TABLES.operations);
  useOnCadastroChange(reloadRecent, CADASTRO_TABLES.operations);
  useOnCadastroChange(reloadOmie, CADASTRO_TABLES.operations);

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

  const loadError =
    open.error ?? closedToday.error ?? recentClosed.error ?? omieRows.error ?? requests.error;
  function reloadAll() {
    void open.reload();
    void closedToday.reload();
    void recentClosed.reload();
    void omieRows.reload();
    void requests.reload();
  }
  /*
   * Antes da primeira resposta o painel nao afirma nada: "0 operacoes", "R$ 0,00" e "Operacao
   * em dia" na tela enquanto a nuvem ainda responde pareciam o dia parado e tudo certo.
   */
  const dayLoaded = closedToday.data !== null;
  const attentionReady =
    open.data !== null && omieRows.data !== null && requests.data !== null && executor !== null;
  /*
   * A "central do dia": com pendencia, o cartao Atencao vem PRIMEIRO e largo; sem ela, os
   * numeros vem primeiro e o "em dia" e uma linha discreta embaixo deles.
   */
  const attention = attentionState({
    ready: attentionReady,
    openTones: staleOpen.map((item) => item.tone),
    omie,
    requests: siteRequests,
    executorDown
  });
  const attentionTone: DashboardTone =
    executorDown ||
    staleOpen.some((item) => item.tone === "danger") ||
    (omie?.failed ?? 0) > 0 ||
    (siteRequests?.failed ?? 0) > 0
      ? "danger"
      : "warning";
  const openOperations = () => navigate("/operacoes");

  const attentionCard = (
    <article
      className={`dash-card dash-attention ${attentionTone}`}
      aria-labelledby="dash-attention"
    >
      <header className="dash-card-head">
        <div>
          <p className="desk-kicker">Atenção</p>
          <h2 className="dash-card-title" id="dash-attention">
            O que precisa de você agora
          </h2>
        </div>
      </header>

      <div className="dash-attention-list">
        {executorDown && executorInfo && (
          <PendingSection title="Balança executora fora do ar" tone="danger">
            <PendingRow
              label={`${executorInfo.name} sem sinal`}
              detail={
                executorInfo.seenAt
                  ? `Último sinal em ${formatDateTime(executorInfo.seenAt)} - os pedidos do site esperam ela voltar`
                  : "Os pedidos do site esperam ela voltar"
              }
              action={{ label: "Abrir operações", onClick: openOperations }}
              tone="danger"
            />
          </PendingSection>
        )}

        {alarmed.length > 0 && (
          <PendingSection
            title="Pesagens abertas há muito tempo"
            tone={alarmed.some((item) => item.tone === "danger") ? "danger" : "warning"}
          >
            {alarmed.map(({ operation, tone }) => (
              <PendingRow
                key={operation.id}
                label={`${formatPlate(operation.plate) || "--"} - ${operation.customer_name || "cliente"}`}
                detail={`${operation.product_description || "produto"} - ${formatElapsed(operation.created_at, now)}`}
                action={{ label: "Abrir operações", onClick: openOperations }}
                tone={tone}
              />
            ))}
            {calm > 0 && (
              <PendingRow
                label={`${calm} ${plural(calm, "aberta recente", "abertas recentes")}`}
                detail="Sem alerta, dentro do tempo normal"
                action={{ label: "Abrir operações", onClick: openOperations }}
                tone="neutral"
              />
            )}
          </PendingSection>
        )}

        {omie && omie.failed > 0 && (
          <PendingSection title="Envios ao OMIE com falha" tone="danger">
            <PendingRow
              label={`${omie.failed} ${plural(omie.failed, "pesagem não aceita", "pesagens não aceitas")} pelo OMIE`}
              detail="Recusa do OMIE ou cadastro incompleto - veja a coluna Fiscal OMIE"
              action={{
                label: "Ver concluídas",
                onClick: () => navigate("/operacoes?aba=concluidas")
              }}
              tone="danger"
            />
          </PendingSection>
        )}

        {omie && omie.pending > 0 && (
          <PendingSection title="Pedidos OMIE pendentes" tone="warning">
            <PendingRow
              label={`${omie.pending} ${plural(omie.pending, "pedido aguardando", "pedidos aguardando")} envio`}
              detail="A balança envia ao OMIE na próxima sincronização"
              action={{
                label: "Ver concluídas",
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
                label={`${siteRequests.waiting} ${plural(siteRequests.waiting, "pedido aguardando", "pedidos aguardando")} a balança`}
                detail={
                  executorInfo?.online
                    ? "Balança conectada - registrando"
                    : "Balança fora do ar - registra quando voltar a conexão"
                }
                action={{ label: "Abrir operações", onClick: openOperations }}
                tone="warning"
              />
            )}
            {siteRequests.failed > 0 && (
              <PendingRow
                label={`${siteRequests.failed} ${plural(siteRequests.failed, "pedido não registrado", "pedidos não registrados")}`}
                detail="A balança devolveu sem registrar (últimas 12 h)"
                action={{ label: "Abrir operações", onClick: openOperations }}
                tone="danger"
              />
            )}
          </PendingSection>
        )}

        {/* Pendencia de outro tipo com o patio andando normal: as abertas aparecem sem alarme. */}
        {alarmed.length === 0 && calm > 0 && (
          <PendingSection title="Pesagens abertas" tone="neutral">
            <PendingRow
              label={`${calm} ${plural(calm, "aberta recente", "abertas recentes")}`}
              detail="Sem alerta, dentro do tempo normal"
              action={{ label: "Abrir operações", onClick: openOperations }}
              tone="neutral"
            />
          </PendingSection>
        )}
      </div>
    </article>
  );

  return (
    <section className="dash">
      <PageHeader
        kicker="Central do dia"
        title="Painel"
        description="Painel operacional: a balança, o movimento de hoje e o que precisa de atenção agora."
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate("/operacoes")}>
              <ListChecks size={16} />
              Operações
            </button>
            <button type="button" className="btn" onClick={() => navigate("/cadastros")}>
              <FolderOpen size={16} />
              Cadastros
            </button>
            <button type="button" className="btn" onClick={() => navigate("/relatorios")}>
              <Table2 size={16} />
              Relatórios
            </button>
            <button type="button" className="btn" onClick={() => navigate("/insights")}>
              <BarChart3 size={16} />
              Ver insights
            </button>
          </>
        }
      />

      {loadError && <ErrorState message={loadError} onRetry={reloadAll} />}

      {attention === "pending" && attentionCard}

      <HealthPills pills={healthPills} onNavigate={navigate} />

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
            label="Operações"
            value={dayLoaded ? kpis.operations.toLocaleString("pt-BR") : EMPTY_VALUE}
            hint="Fechadas hoje"
          />
          <KpiCell
            icon={Scale}
            accent="5"
            label="Peso líquido"
            value={dayLoaded ? formatDashTons(kpis.weightKg) : EMPTY_VALUE}
            hint={dayLoaded ? `${formatKg(kpis.weightKg)} kg` : <Skeleton width={70} height={10} />}
          />
          <KpiCell
            icon={BadgeDollarSign}
            accent="3"
            label="Faturamento"
            value={dayLoaded ? formatMoney(kpis.totalCents) : EMPTY_VALUE}
            hint="Soma das operações fechadas"
          />
          <KpiCell
            icon={Receipt}
            accent="6"
            label="Ticket médio"
            value={dayLoaded ? formatMoney(kpis.ticketCents) : EMPTY_VALUE}
            hint="Por operação fechada"
          />
        </div>
      </article>

      {attention === "clear" && (
        <div className="dash-ok" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <strong>Operação em dia</strong>
          <span className="dash-ok-detail">
            {calm > 0
              ? `${calm} ${plural(calm, "pesagem aberta", "pesagens abertas")} dentro do tempo normal, sem envio ao OMIE nem pedido do site esperando.`
              : "Nenhuma pendência no momento."}
          </span>
          {calm > 0 && (
            <button type="button" className="dash-ok-action" onClick={openOperations}>
              Abrir operações
            </button>
          )}
        </div>
      )}
      {attention === "checking" && !loadError && (
        <div className="dash-ok is-checking" role="status" aria-label="Verificando pendências">
          <Skeleton width={16} height={16} radius={8} />
          <span className="dash-ok-detail">Verificando pendências...</span>
        </div>
      )}

      <article className="dash-card">
        <header className="dash-card-head">
          <div>
            <p className="desk-kicker">Recente</p>
            <h2 className="dash-card-title">Últimas pesagens</h2>
          </div>
          <button type="button" className="btn small" onClick={() => navigate("/operacoes")}>
            Ver todas
          </button>
        </header>
        {recent.length === 0 ? (
          open.loading || recentClosed.loading ? (
            <SkeletonRows rows={4} columns={6} />
          ) : (
            <EmptyState title="Nenhuma pesagem registrada ainda." />
          )
        ) : (
          <div className="dash-recent">
            <div className="dash-recent-row dash-recent-head">
              <span>Hora</span>
              <span>Placa / Cliente</span>
              <span>Produto</span>
              <span>Peso líquido</span>
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
                  title={`${plate} - ${op.customer_name || "cliente"} | ${op.product_description || "produto"} | ${isOpen ? "Aberta" : "Fechada"}. Clique para abrir a lista de operações.`}
                  onClick={() => navigate(isOpen ? "/operacoes" : "/operacoes?aba=concluidas")}
                >
                  <span className="dash-recent-time">
                    {formatHour(at)}
                    {oldDate && <small className="dash-muted">{oldDate}</small>}
                  </span>
                  <span className="dash-recent-plate">
                    <strong>{plate}</strong>
                    <small className="dash-muted">
                      {op.customer_name || "Cliente não informado"}
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
                    {op.operation_type === "invoice" ? (
                      <Pill tone="info">Com nota</Pill>
                    ) : (
                      <Pill>Interna</Pill>
                    )}
                  </span>
                  <span>
                    <Pill tone={isOpen ? "danger" : "success"}>
                      {isOpen ? "Aberta" : "Fechada"}
                    </Pill>
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
  hint: ReactNode;
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
