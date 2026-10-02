import { Cloud, Printer, RefreshCw, Scale } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { DeskPanel, IconAction, SectionHead } from "../components/desk";
import {
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pill,
  Skeleton,
  SkeletonRows,
  Tabs,
  useToast,
  type TabItem
} from "../components/ui";
import { callWebApi } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { formatDateTime, formatMoney, formatPlate } from "../lib/format";
import { fiscalStatus, formatElapsedSince, REQUEST_KIND_LABELS } from "../lib/operation";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { sendRequest, useExecutorStatus } from "./Operation";

/**
 * O menu da engrenagem do desktop (Balanca, Impressao, Cloud), na versao do site. No desktop
 * essas telas configuram O COMPUTADOR em que ele roda; o site nao tem balanca nem impressora,
 * entao aqui elas mostram o estado das balancas da unidade — quem executa os pedidos do site,
 * se os cupons pedidos pelo site sairam e o que ainda falta chegar ao OMIE. Configurar a
 * conexao da balanca e a impressora continua no computador dela.
 */

interface UnitDevice {
  id: string;
  name: string;
  deviceNumber: number | null;
  appVersion: string | null;
  updateChannel: "teste" | "producao";
  lastSeenAt: string | null;
  online: boolean;
  isPriceMaster: boolean;
  executesWebOperations: boolean;
  webExecutorSeenAt: string | null;
  health: {
    queuePending: number | null;
    queueBlocked: number | null;
    oldestPendingAt: string | null;
    lastError: string | null;
    collectedAt: string | null;
  };
}

function useUnitDevices() {
  const user = useUser();
  // As balancas da unidade do login: a mesma lista serve as abas Balanca e Cloud.
  return useAsync(
    async () =>
      ((await callWebApi("unit_devices")) as unknown as { devices: UnitDevice[] }).devices,
    [],
    { key: `configuracoes:balancas:${user.companyId}:${user.unitId}` }
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="icon-action neutral"
      aria-label="Atualizar"
      title="Atualizar"
      onClick={onClick}
    >
      <RefreshCw size={15} />
    </button>
  );
}

type SettingsTab = "balanca" | "impressao" | "cloud";

function isTab(value: string | undefined): value is SettingsTab {
  return value === "balanca" || value === "impressao" || value === "cloud";
}

/** As mesmas tres entradas da engrenagem do menu; cada aba e um endereco (`/configuracoes/:tab`). */
const SETTINGS_TABS: Array<TabItem<SettingsTab>> = [
  { id: "balanca", label: "Balança", icon: Scale },
  { id: "impressao", label: "Impressão", icon: Printer },
  { id: "cloud", label: "Cloud", icon: Cloud }
];

export function Settings() {
  const params = useParams();
  const navigate = useNavigate();
  const tab: SettingsTab = isTab(params.tab) ? params.tab : "balanca";
  return (
    <>
      <DeskPanel>
        <PageHeader
          title="Configurações"
          description="O estado das balanças da unidade, dos cupons pedidos pelo site e do envio ao OMIE. A conexão da balança e a impressora são configuradas no KyberRock Desktop de cada computador."
        />
        <Tabs
          label="Seções das configurações"
          tabs={SETTINGS_TABS}
          active={tab}
          onChange={(next) => navigate(`/configuracoes/${next}`)}
        />
      </DeskPanel>
      {tab === "impressao" ? (
        <PrintingSettings />
      ) : tab === "cloud" ? (
        <CloudSettings />
      ) : (
        <ScaleSettings />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Balanca
// ---------------------------------------------------------------------------

function ScaleSettings() {
  const devices = useUnitDevices();
  const executor = useExecutorStatus();
  const rows = devices.data ?? [];

  return (
    <div className="settings-grid">
      <DeskPanel>
        <SectionHead
          title="Balanças da unidade"
          description="Os computadores de balança desta pedreira. A conexão com a balança (rede, USB ou serial) é configurada em cada computador, na tela Balança do KyberRock Desktop."
          action={<RefreshButton onClick={() => void devices.reload()} />}
        />
        {devices.error && (
          <ErrorState message={devices.error} onRetry={() => void devices.reload()} />
        )}
        {!(devices.error && rows.length === 0) && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            loading={devices.loading}
            empty="Nenhuma balança ativada nesta unidade."
            columns={[
              {
                key: "name",
                header: "Balança",
                sortValue: (row) => row.name,
                render: (row) => (
                  <>
                    <strong>{row.name}</strong>
                    <span className="cell-sub">
                      {row.deviceNumber ? `Nº ${row.deviceNumber}` : ""}
                      {row.appVersion ? ` · versão ${row.appVersion}` : ""}
                      {row.updateChannel === "teste" ? " · anel de teste" : ""}
                    </span>
                  </>
                )
              },
              {
                key: "status",
                header: "Situação",
                sortValue: (row) => (row.online ? "Ligada" : "Fora do ar"),
                render: (row) =>
                  row.online ? (
                    <Pill tone="success">Ligada</Pill>
                  ) : (
                    <Pill tone="danger">Fora do ar</Pill>
                  )
              },
              {
                key: "seen",
                header: "Último sinal",
                sortValue: (row) => row.lastSeenAt,
                render: (row) =>
                  row.lastSeenAt ? (
                    <span title={formatDateTime(row.lastSeenAt)}>
                      {formatElapsedSince(row.lastSeenAt)}
                    </span>
                  ) : (
                    "Nunca"
                  )
              },
              {
                key: "roles",
                header: "Função",
                render: (row) => (
                  <span className="row-actions" style={{ justifyContent: "flex-start" }}>
                    {row.executesWebOperations && <Pill tone="info">Executa o site</Pill>}
                    {row.isPriceMaster && <Pill tone="info">Principal de preços</Pill>}
                    {!row.executesWebOperations && !row.isPriceMaster && "—"}
                  </span>
                )
              }
            ]}
          />
        )}
      </DeskPanel>

      <DeskPanel>
        <SectionHead title="Leitura ao vivo" />
        <div className="settings-live">
          {!executor ? (
            <div role="status" aria-label="Verificando a balança executora">
              <Skeleton width="70%" height={18} />
            </div>
          ) : (
            <strong>
              {!executor.executor
                ? "Nenhuma balança executa o site"
                : executor.executor.needsUpdate
                  ? `${executor.executor.name} precisa ser atualizada (versão ${executor.executor.minVersion ?? "mais nova"})`
                  : executor.executor.online
                    ? `${executor.executor.name} conectada`
                    : `${executor.executor.name} fora do ar`}
            </strong>
          )}
          <span>
            O site não lê o peso da balança: no fechamento pelo site o peso é digitado, e a balança
            executora registra a pesagem com as mesmas regras do botão "Capturar peso". A Nova
            entrada só é feita no KyberRock Desktop.
          </span>
        </div>
        <p className="desk-muted">
          Quem executa os pedidos do site é marcado no painel admin (Balanças → Configurar →
          "Pesagens pedidas pelo site"), uma balança por unidade.
        </p>
      </DeskPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impressao
// ---------------------------------------------------------------------------

function PrintingSettings() {
  const user = useUser();
  const since = useMemo(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), []);
  // Memoria pela empresa: a janela de 7 dias anda com o relogio, mas e a mesma lista.
  const requests = useAsync(
    () => q.operationRequests(user.companyId, since),
    [user.companyId, since],
    { key: `configuracoes:impressao:${user.companyId}` }
  );
  const printed = (requests.data ?? []).filter((request) => request.print_status);
  const executor = useExecutorStatus();
  const toast = useToast();

  // "Reimprimir segunda via" da lista de cupons, como no desktop (Impressao → Cupons emitidos):
  // vira um pedido de reimpressao, e a balanca executora imprime a proxima via.
  async function reprint(operationId: string) {
    if (await sendRequest(toast, "reprint", { operationId })) void requests.reload();
  }

  return (
    <div className="settings-grid">
      <DeskPanel>
        <SectionHead title="Perfil de cupom 80 mm" />
        <div className="settings-live" style={{ minHeight: 0 }}>
          <strong>Impressora da balança {executor?.executor?.name ?? "executora"}</strong>
          <span>
            O cupom das pesagens feitas pelo site sai na impressora do computador que executa os
            pedidos, com o perfil dele: tipo de impressora, número de vias (1 ou 2), logo e
            telefone. Para mudar, use Configurações → Impressão no KyberRock Desktop desse
            computador.
          </span>
        </div>
      </DeskPanel>

      <DeskPanel>
        <SectionHead
          title="Cupons emitidos pelo site"
          description="Últimos 7 dias. Cupom que não imprimiu aparece em vermelho, com o motivo que a balança devolveu."
          action={<RefreshButton onClick={() => void requests.reload()} />}
        />
        {requests.error && (
          <ErrorState message={requests.error} onRetry={() => void requests.reload()} />
        )}
        {!(requests.error && printed.length === 0) && (
          <DataTable
            rows={printed}
            rowKey={(row) => row.id}
            loading={requests.loading}
            empty="Nenhum cupom emitido pelo site ainda."
            columns={[
              {
                key: "when",
                header: "Quando",
                sortValue: (row) => row.processed_at ?? row.requested_at,
                render: (row) => formatDateTime(row.processed_at ?? row.requested_at)
              },
              {
                key: "what",
                header: "Pesagem",
                render: (row) => {
                  const result = row.result as { operationCode?: number; plate?: string } | null;
                  return (
                    <>
                      <strong>{REQUEST_KIND_LABELS[row.kind]}</strong>
                      <span className="cell-sub">
                        {result?.operationCode ? `Nº ${result.operationCode}` : ""}
                        {result?.plate ? ` · ${formatPlate(result.plate)}` : ""}
                      </span>
                    </>
                  );
                }
              },
              {
                key: "status",
                header: "Cupom",
                sortValue: (row) => row.print_status,
                render: (row) =>
                  row.print_status === "printed" ? (
                    <Pill tone="success">Impresso</Pill>
                  ) : row.print_status === "failed" ? (
                    <Pill tone="danger">Não imprimiu</Pill>
                  ) : (
                    <Pill>Não precisou</Pill>
                  )
              },
              {
                key: "message",
                header: "Detalhe",
                render: (row) => row.print_message ?? "—"
              },
              {
                key: "by",
                header: "Pedido por",
                sortValue: (row) => row.requested_by_name,
                render: (row) => row.requested_by_name ?? "—"
              },
              {
                key: "actions",
                header: "Ações",
                numeric: true,
                render: (row) =>
                  user.canOperate &&
                  row.kind !== "cancel" && (
                    <span className="row-actions">
                      <IconAction
                        icon="printer"
                        label="Reimprimir segunda via"
                        onClick={() => void reprint(row.operation_id)}
                      />
                    </span>
                  )
              }
            ]}
          />
        )}
      </DeskPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------------

function CloudSettings() {
  const user = useUser();
  const devices = useUnitDevices();
  const period = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }, []);
  // Memoria pela empresa: a janela de 30 dias anda com o relogio, mas e a mesma lista.
  const closed = useAsync(
    () => q.closedOperations(user.companyId, period.startIso, period.endIso),
    [user.companyId, period.startIso, period.endIso],
    { key: `configuracoes:cloud:${user.companyId}` }
  );
  // O pedido chegando ao OMIE (ou a nota saindo) na balanca some desta lista na hora.
  useOnCadastroChange(closed.refresh, CADASTRO_TABLES.operations);
  const pendingOmie = useMemo(
    () =>
      (closed.data ?? [])
        .filter((row) => row.unit_id === user.unitId && row.status !== "cancelled")
        .map((row) => ({ row, fiscal: fiscalStatus(row) }))
        .filter(({ row, fiscal }) =>
          fiscal.tone === "neutral"
            ? !row.omie_sales_order_id && !row.omie_service_order_id
            : fiscal.tone !== "success"
        )
        .sort((a, b) =>
          (b.row.closed_at ?? b.row.created_at).localeCompare(a.row.closed_at ?? a.row.created_at)
        ),
    [closed.data, user.unitId]
  );

  return (
    <div className="settings-grid">
      <div className="settings-stack">
        <DeskPanel>
          <SectionHead title="Sincronização Supabase" />
          <p className="settings-status">
            <strong>Status:</strong> Conectado
          </p>
          <p className="desk-muted" style={{ marginTop: 0 }}>
            O site trabalha direto na nuvem: não tem fila própria. Quem sincroniza é cada balança —
            a saúde da fila de cada uma aparece ao lado.
          </p>
        </DeskPanel>
        <DeskPanel>
          <SectionHead
            title="Fila OMIE (fechamentos a enviar)"
            action={<RefreshButton onClick={() => void closed.reload()} />}
          />
          {closed.error && (
            <ErrorState message={closed.error} onRetry={() => void closed.reload()} />
          )}
          {!(closed.error && pendingOmie.length === 0) && (
            <DataTable
              rows={pendingOmie}
              rowKey={({ row }) => row.id}
              loading={closed.loading}
              empty="Nenhum item na fila"
              emptyHint="Todos os fechamentos dos últimos 30 dias chegaram ao OMIE."
              columns={[
                {
                  key: "op",
                  header: "Pesagem",
                  sortValue: ({ row }) => formatPlate(row.plate ?? ""),
                  render: ({ row }) => (
                    <>
                      <strong>{formatPlate(row.plate ?? "")}</strong>
                      <span className="cell-sub">{row.customer_name}</span>
                    </>
                  )
                },
                {
                  key: "when",
                  header: "Fechada em",
                  sortValue: ({ row }) => row.closed_at ?? row.created_at,
                  render: ({ row }) => formatDateTime(row.closed_at ?? row.created_at)
                },
                {
                  key: "total",
                  header: "Total",
                  numeric: true,
                  sortValue: ({ row }) => row.total_cents,
                  render: ({ row }) => formatMoney(row.total_cents)
                },
                {
                  key: "status",
                  header: "Situação",
                  sortValue: ({ fiscal }) => fiscal.label,
                  render: ({ fiscal }) => (
                    <>
                      <Pill tone={fiscal.tone}>{fiscal.label}</Pill>
                      <span className="cell-sub">{fiscal.detail}</span>
                    </>
                  )
                }
              ]}
            />
          )}
        </DeskPanel>
      </div>

      <DeskPanel>
        <SectionHead title="Status OMIE" />
        {devices.error && (
          <ErrorState message={devices.error} onRetry={() => void devices.reload()} />
        )}
        {(devices.data ?? []).length === 0 ? (
          devices.loading ? (
            <SkeletonRows rows={3} columns={2} />
          ) : (
            !devices.error && <EmptyState title="Nenhuma balança nesta unidade." />
          )
        ) : (
          <div className="settings-devices">
            {(devices.data ?? []).map((device) => (
              <article key={device.id} className="settings-device">
                <header>
                  <strong>{device.name}</strong>
                  {device.online ? (
                    <Pill tone="success">Ligada</Pill>
                  ) : (
                    <Pill tone="danger">Fora do ar</Pill>
                  )}
                </header>
                <dl>
                  <dt>Envios pendentes</dt>
                  <dd>{device.health.queuePending ?? "—"}</dd>
                  <dt>Parados (precisam de correção)</dt>
                  <dd>{device.health.queueBlocked ?? "—"}</dd>
                  <dt>Mais antigo na fila</dt>
                  <dd>
                    {device.health.oldestPendingAt
                      ? formatDateTime(device.health.oldestPendingAt)
                      : "—"}
                  </dd>
                  <dt>Último erro</dt>
                  <dd>{device.health.lastError ?? "Nenhum"}</dd>
                  <dt>Informado em</dt>
                  <dd>
                    {device.health.collectedAt ? formatDateTime(device.health.collectedAt) : "—"}
                  </dd>
                </dl>
              </article>
            ))}
          </div>
        )}
        <p className="desk-muted">
          As credenciais do OMIE e o envio ficam na balança principal. Estes números são os que cada
          balança informou na última conversa com a nuvem.
        </p>
      </DeskPanel>
    </div>
  );
}
