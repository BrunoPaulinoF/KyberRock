import {
  AlertTriangle,
  Building2,
  CircleCheck,
  Download,
  MonitorSmartphone,
  RefreshCw,
  Users,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import { formatCents, type BillingSummary } from "../lib/billing";
import {
  buildOverview,
  isOnline,
  sinceLabel,
  type OverviewCompany,
  type OverviewDevice,
  type OverviewUnit,
  type OverviewUser
} from "../lib/overview";
import { Badge, Button, DataTable, KpiCard, PageHead, Panel } from "../components";
import type { Column } from "../components";
import type { CompanyOverview } from "../lib/overview";

export type OverviewTarget =
  | "companies"
  | "units"
  | "loaders"
  | "comercial"
  | "devices"
  | "updates"
  | "financeiro";

interface ReleaseInfo {
  version: string | null;
  onVersion: number;
  reporting: number;
}

/** Leitura extra que so enfeita a tela: falhar nela nunca pode esconder o resto. */
type Extra<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "failed" };

/**
 * Visao geral do painel: a primeira tela depois do login. Responde, sem clique, as perguntas
 * de quem abre o painel — quantas pedreiras e balancas estao funcionando, qual balanca precisa
 * de alguem e o que ficou por configurar — e cada numero leva para a aba que resolve.
 *
 * Pedreiras, unidades, logins e balancas vem da lista que o painel ja carregou. O financeiro e
 * a versao do desktop sao leituras a parte (`admin-billing` e `list_desktop_releases`) e
 * best-effort: sem elas o cartao mostra "—", e o resto da tela continua de pe.
 */
export function Overview({
  companies,
  units,
  users,
  devices,
  isRefreshing,
  onRefresh,
  onNavigate,
  onCreateCompany,
  onSessionExpired
}: {
  companies: readonly OverviewCompany[];
  units: readonly OverviewUnit[];
  users: readonly OverviewUser[];
  devices: readonly OverviewDevice[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onNavigate: (
    target: OverviewTarget,
    companyId?: string,
    filter?: "all" | "attention" | "no-login"
  ) => void;
  onCreateCompany: () => void;
  onSessionExpired: () => void;
}) {
  const [billing, setBilling] = useState<Extra<BillingSummary>>({ status: "loading" });
  const [release, setRelease] = useState<Extra<ReleaseInfo>>({ status: "loading" });
  const [now, setNow] = useState(() => new Date());

  const overview = useMemo(
    () => buildOverview({ companies, units, users, devices }, now),
    [companies, units, users, devices, now]
  );

  const loadExtras = useCallback(async () => {
    setNow(new Date());
    const onError = (error: unknown) => {
      if (error instanceof AdminSessionExpiredError) onSessionExpired();
    };
    await Promise.all([
      callAdminFunction<{ summary?: BillingSummary }>("admin-billing", { action: "list" })
        .then((data) =>
          setBilling(data.summary ? { status: "ready", value: data.summary } : { status: "failed" })
        )
        .catch((error) => {
          onError(error);
          setBilling({ status: "failed" });
        }),
      callAdminFunction<{
        releases?: Array<{ version: string; isCurrentProduction: boolean }>;
        devices?: Array<{ version: string | null; isActive?: boolean }>;
      }>("admin-api", { action: "list_desktop_releases" })
        .then((data) => {
          const production =
            data.releases?.find((item) => item.isCurrentProduction)?.version ?? null;
          const fleet = (data.devices ?? []).filter((device) => device.isActive !== false);
          setRelease({
            status: "ready",
            value: {
              version: production,
              onVersion: production
                ? fleet.filter((device) => device.version === production).length
                : 0,
              reporting: fleet.length
            }
          });
        })
        .catch((error) => {
          onError(error);
          setRelease({ status: "failed" });
        })
    ]);
  }, [onSessionExpired]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  // A lista das balancas se rele sozinha no painel; o relogio da tela anda junto, senao "ha 2
  // min" ficaria parado enquanto a aba estiver aberta.
  useEffect(() => {
    setNow(new Date());
  }, [devices]);

  const { devices: fleet } = overview;
  const attentionTotal = fleet.down + fleet.warn;
  const attentionTone = fleet.down > 0 ? "danger" : fleet.warn > 0 ? "warn" : "ok";

  const companyColumns: Array<Column<CompanyOverview>> = [
    {
      key: "company",
      header: "Pedreira",
      render: (row) => (
        <>
          <span className="adm-cell-primary">{row.company.name}</span>
          <p className="adm-cell-sub">
            {row.units} unidade{row.units === 1 ? "" : "s"} · {row.users} login
            {row.users === 1 ? "" : "s"}
          </p>
        </>
      )
    },
    {
      key: "online",
      header: "Balanças online",
      render: (row) =>
        row.devices === 0 ? (
          <span className="adm-cell-sub">Nenhuma ativada</span>
        ) : (
          <span
            className="adm-meter"
            title={`${row.online} de ${row.devices} com contato nos últimos 15 min`}
          >
            <span className="adm-meter-bar">
              <span style={{ width: `${Math.round((row.online / row.devices) * 100)}%` }} />
            </span>
            <span className="adm-mono">
              {row.online}/{row.devices}
            </span>
          </span>
        )
    },
    {
      key: "attention",
      header: "Atenção",
      render: (row) =>
        row.attention > 0 ? (
          <Badge tone="danger" dot>
            {row.attention} balança{row.attention > 1 ? "s" : ""}
          </Badge>
        ) : row.devices > 0 ? (
          <Badge tone="ok" dot>
            Tudo certo
          </Badge>
        ) : (
          <span className="adm-cell-sub">—</span>
        )
    },
    {
      key: "omie",
      header: "OMIE",
      render: (row) =>
        row.company.omieAppKeyMasked ? (
          <Badge tone="ok">Conectado</Badge>
        ) : (
          <Badge tone="warn">Sem chave</Badge>
        )
    },
    {
      key: "status",
      header: "Situação",
      render: (row) =>
        row.company.isActive ? (
          <Badge tone="ok" dot>
            Ativa
          </Badge>
        ) : (
          <Badge tone="danger" dot>
            Inativa
          </Badge>
        )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (row) => (
        <Button size="sm" onClick={() => onNavigate("devices", row.company.id)}>
          Ver balanças
        </Button>
      )
    }
  ];

  return (
    <>
      <PageHead
        title="Visão geral"
        description="Como está a plataforma agora e o que precisa de você."
        actions={
          <>
            <Button
              onClick={() => {
                onRefresh();
                void loadExtras();
              }}
              disabled={isRefreshing}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {isRefreshing ? "Atualizando..." : "Atualizar"}
            </Button>
            <Button variant="primary" onClick={onCreateCompany}>
              Nova pedreira
            </Button>
          </>
        }
      />

      <div className="adm-kpis">
        <KpiCard
          icon={<Building2 size={18} />}
          label="Pedreiras ativas"
          value={
            <>
              {overview.companies.active}
              <small> / {overview.companies.total}</small>
            </>
          }
          hint={`${overview.units.active} unidade${overview.units.active === 1 ? "" : "s"} ativa${overview.units.active === 1 ? "" : "s"}`}
          onClick={() => onNavigate("companies")}
        />
        <KpiCard
          icon={<MonitorSmartphone size={18} />}
          label="Balanças online"
          value={
            <>
              {fleet.online}
              <small> / {fleet.active}</small>
            </>
          }
          hint={
            fleet.active - fleet.online > 0
              ? `${fleet.active - fleet.online} sem contato há mais de 15 min`
              : "Todas com contato agora"
          }
          tone={fleet.active > 0 && fleet.online === fleet.active ? "ok" : "neutral"}
          onClick={() => onNavigate("devices")}
        />
        <KpiCard
          icon={<AlertTriangle size={18} />}
          label="Precisam de atenção"
          value={attentionTotal}
          hint={
            attentionTotal === 0
              ? "Nenhuma balança com problema"
              : [
                  fleet.down > 0 ? `${fleet.down} com envio parado` : "",
                  fleet.warn > 0 ? `${fleet.warn} sem contato ou atrasada` : ""
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          tone={attentionTone}
          onClick={() => onNavigate("devices", undefined, "attention")}
        />
        <KpiCard
          icon={<Users size={18} />}
          label="Logins do site"
          value={overview.users.total}
          hint={`${overview.users.loaders} carregador${overview.users.loaders === 1 ? "" : "es"} · ${overview.users.site} outros perfis`}
          onClick={() => onNavigate("comercial")}
        />
        <KpiCard
          icon={<Wallet size={18} />}
          label="A receber"
          value={
            billing.status === "ready"
              ? formatCents(billing.value.openAmountCents + billing.value.overdueAmountCents)
              : billing.status === "loading"
                ? "..."
                : "—"
          }
          hint={
            billing.status === "ready"
              ? billing.value.overdueCount > 0
                ? `${billing.value.overdueCount} fatura${billing.value.overdueCount > 1 ? "s" : ""} vencida${billing.value.overdueCount > 1 ? "s" : ""} · ${formatCents(billing.value.overdueAmountCents)}`
                : `${billing.value.openCount} em aberto, nenhuma vencida`
              : billing.status === "failed"
                ? "Não foi possível ler o financeiro"
                : undefined
          }
          tone={billing.status === "ready" && billing.value.overdueCount > 0 ? "danger" : "neutral"}
          onClick={() => onNavigate("financeiro")}
        />
        <KpiCard
          icon={<Download size={18} />}
          label="Desktop em produção"
          value={
            release.status === "ready"
              ? (release.value.version ?? "—")
              : release.status === "loading"
                ? "..."
                : "—"
          }
          hint={
            release.status === "ready" && release.value.version
              ? `${release.value.onVersion} de ${release.value.reporting} balança${release.value.reporting === 1 ? "" : "s"} nesta versão`
              : release.status === "failed"
                ? "Não foi possível ler as versões"
                : undefined
          }
          tone="accent"
          onClick={() => onNavigate("updates")}
        />
      </div>

      <div className="adm-dash-grid">
        <Panel
          title="Balanças que precisam de atenção"
          description="Envio parado primeiro: ele não volta sem alguém."
          actions={
            <Button size="sm" onClick={() => onNavigate("devices", undefined, "attention")}>
              Ver todas
            </Button>
          }
          flush
        >
          {overview.attention.length === 0 ? (
            <div className="adm-all-good">
              <CircleCheck size={28} aria-hidden="true" />
              <p>Todas as balanças ativas estão em dia.</p>
            </div>
          ) : (
            <ul className="adm-list">
              {overview.attention.slice(0, 8).map(({ device, health }) => (
                <li key={device.id} className="adm-list-row">
                  <span
                    className={`adm-list-dot adm-list-dot-${health.level === "down" ? "danger" : "warn"}`}
                    aria-hidden="true"
                  />
                  <div className="adm-list-main">
                    <p className="adm-cell-primary">{device.name}</p>
                    <p className="adm-cell-sub adm-clamp" title={health.detail}>
                      {companyName(companies, device.companyId)} · {health.detail}
                    </p>
                  </div>
                  <div className="adm-list-side">
                    <Badge tone={health.level === "down" ? "danger" : "warn"}>{health.label}</Badge>
                    <span className="adm-cell-sub" title={device.lastSeenAt ?? undefined}>
                      {isOnline(device.lastSeenAt, now)
                        ? "online"
                        : sinceLabel(device.lastSeenAt, now)}
                    </span>
                  </div>
                </li>
              ))}
              {overview.attention.length > 8 && (
                <li className="adm-list-more">
                  e mais {overview.attention.length - 8} — veja em Balanças
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel
          title="Pendências de configuração"
          description="O que ficou por fazer em cada pedreira ativa."
          flush
        >
          {overview.pending.length === 0 ? (
            <div className="adm-all-good">
              <CircleCheck size={28} aria-hidden="true" />
              <p>Nenhuma pendência. Todas as pedreiras estão configuradas.</p>
            </div>
          ) : (
            <ul className="adm-list">
              {overview.pending.slice(0, 10).map((item) => (
                <li key={`${item.kind}-${item.companyId}-${item.title}`}>
                  <button
                    type="button"
                    className="adm-list-row adm-list-link"
                    onClick={() =>
                      onNavigate(
                        item.target,
                        item.companyId,
                        item.kind === "no-login" ? "no-login" : "all"
                      )
                    }
                  >
                    <span
                      className={`adm-list-dot adm-list-dot-${item.tone === "warn" ? "warn" : "info"}`}
                      aria-hidden="true"
                    />
                    <span className="adm-list-main">
                      <span className="adm-cell-primary">{item.title}</span>
                      <span className="adm-cell-sub">
                        {item.companyName} · {item.detail}
                      </span>
                    </span>
                    <span className="adm-list-go" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
              {overview.pending.length > 10 && (
                <li className="adm-list-more">e mais {overview.pending.length - 10} pendências</li>
              )}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Pedreiras"
        description="Cada pedreira em uma linha. Clique para ver as balanças dela."
        flush
      >
        <DataTable
          columns={companyColumns}
          rows={[...overview.perCompany].sort(
            (a, b) =>
              Number(b.company.isActive) - Number(a.company.isActive) ||
              b.attention - a.attention ||
              a.company.name.localeCompare(b.company.name, "pt-BR")
          )}
          rowKey={(row) => row.company.id}
          rowClassName={(row) => (row.company.isActive ? undefined : "adm-row-muted")}
          empty="Nenhuma pedreira cadastrada ainda."
        />
      </Panel>
    </>
  );
}

function companyName(companies: readonly OverviewCompany[], companyId: string): string {
  return companies.find((company) => company.id === companyId)?.name ?? "—";
}
