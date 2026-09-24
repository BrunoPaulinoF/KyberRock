import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { DeskPanel, EmptyState, Pill } from "../components/desk";
import { Alert, DataTable } from "../components/ui";
import { callWebApi } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDateTime, formatMoney, formatPlate } from "../lib/format";
import { fiscalStatus, formatElapsedSince, REQUEST_KIND_LABELS } from "../lib/operation";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { useExecutorStatus } from "./Operation";

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
  return useAsync(
    async () =>
      ((await callWebApi("unit_devices")) as unknown as { devices: UnitDevice[] }).devices,
    []
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

export function Settings() {
  const params = useParams();
  const tab: SettingsTab = isTab(params.tab) ? params.tab : "balanca";
  if (tab === "impressao") return <PrintingSettings />;
  if (tab === "cloud") return <CloudSettings />;
  return <ScaleSettings />;
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
        <div className="desk-title-row">
          <h1 className="desk-title">Balancas da unidade</h1>
          <RefreshButton onClick={() => void devices.reload()} />
        </div>
        <p className="desk-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Os computadores de balanca desta pedreira. A conexao com a balanca (rede, USB ou serial) e
          configurada em cada computador, na tela Balanca do KyberRock Desktop.
        </p>
        {devices.error && <Alert kind="error">{devices.error}</Alert>}
        {rows.length === 0 && !devices.loading ? (
          <EmptyState title="Nenhuma balanca ativada nesta unidade." />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            empty={devices.loading ? "Carregando..." : "Nenhuma balanca."}
            columns={[
              {
                key: "name",
                header: "Balanca",
                render: (row) => (
                  <>
                    <strong>{row.name}</strong>
                    <span className="cell-sub">
                      {row.deviceNumber ? `No ${row.deviceNumber}` : ""}
                      {row.appVersion ? ` · versao ${row.appVersion}` : ""}
                      {row.updateChannel === "teste" ? " · anel de teste" : ""}
                    </span>
                  </>
                )
              },
              {
                key: "status",
                header: "Situacao",
                render: (row) =>
                  row.online ? (
                    <Pill tone="success">Ligada</Pill>
                  ) : (
                    <Pill tone="danger">Fora do ar</Pill>
                  )
              },
              {
                key: "seen",
                header: "Ultimo sinal",
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
                header: "Funcao",
                render: (row) => (
                  <span className="row-actions" style={{ justifyContent: "flex-start" }}>
                    {row.executesWebOperations && <Pill tone="info">Executa o site</Pill>}
                    {row.isPriceMaster && <Pill tone="info">Principal de precos</Pill>}
                    {!row.executesWebOperations && !row.isPriceMaster && "—"}
                  </span>
                )
              }
            ]}
          />
        )}
      </DeskPanel>

      <DeskPanel>
        <h2 className="desk-title">Leitura ao vivo</h2>
        <div className="settings-live">
          <strong>
            {!executor
              ? "Verificando..."
              : !executor.executor
                ? "Nenhuma balanca executa o site"
                : executor.executor.online
                  ? `${executor.executor.name} conectada`
                  : `${executor.executor.name} fora do ar`}
          </strong>
          <span>
            O site nao le o peso da balanca: na Nova entrada o peso e digitado, e a balanca
            executora registra a pesagem com as mesmas regras do botao "Capturar peso".
          </span>
        </div>
        <p className="desk-muted">
          Quem executa os pedidos do site e marcado no painel admin (Acessos do sistema → "Pesagem
          do site"), uma balanca por unidade.
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
  const requests = useAsync(
    () => q.operationRequests(user.companyId, since),
    [user.companyId, since]
  );
  const printed = (requests.data ?? []).filter((request) => request.print_status);
  const executor = useExecutorStatus();

  return (
    <div className="settings-grid">
      <DeskPanel>
        <div className="desk-title-row">
          <h1 className="desk-title">Perfil de cupom 80 mm</h1>
        </div>
        <div className="settings-live" style={{ minHeight: 0 }}>
          <strong>Impressora da balanca {executor?.executor?.name ?? "executora"}</strong>
          <span>
            O cupom das pesagens feitas pelo site sai na impressora do computador que executa os
            pedidos, com o perfil dele: tipo de impressora, numero de vias (1 ou 2), logo e
            telefone. Para mudar, use Configuracoes → Impressao no KyberRock Desktop desse
            computador.
          </span>
        </div>
      </DeskPanel>

      <DeskPanel>
        <div className="desk-title-row">
          <h2 className="desk-title">Cupons emitidos pelo site</h2>
          <RefreshButton onClick={() => void requests.reload()} />
        </div>
        <p className="desk-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Ultimos 7 dias. Cupom que nao imprimiu aparece em vermelho, com o motivo que a balanca
          devolveu.
        </p>
        {requests.error && <Alert kind="error">{requests.error}</Alert>}
        {printed.length === 0 && !requests.loading ? (
          <EmptyState title="Nenhum cupom emitido pelo site ainda." />
        ) : (
          <DataTable
            rows={printed}
            rowKey={(row) => row.id}
            empty={requests.loading ? "Carregando..." : "Nenhum cupom."}
            columns={[
              {
                key: "when",
                header: "Quando",
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
                        {result?.operationCode ? `No ${result.operationCode}` : ""}
                        {result?.plate ? ` · ${formatPlate(result.plate)}` : ""}
                      </span>
                    </>
                  );
                }
              },
              {
                key: "status",
                header: "Cupom",
                render: (row) =>
                  row.print_status === "printed" ? (
                    <Pill tone="success">Impresso</Pill>
                  ) : row.print_status === "failed" ? (
                    <Pill tone="danger">Nao imprimiu</Pill>
                  ) : (
                    <Pill>Nao precisou</Pill>
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
                render: (row) => row.requested_by_name ?? "—"
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
  const closed = useAsync(
    () => q.closedOperations(user.companyId, period.startIso, period.endIso),
    [user.companyId, period.startIso, period.endIso]
  );
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
          <h1 className="desk-title">Sincronizacao Supabase</h1>
          <p className="settings-status">
            <strong>Status:</strong> Conectado
          </p>
          <p className="desk-muted" style={{ marginTop: 0 }}>
            O site trabalha direto na nuvem: nao tem fila propria. Quem sincroniza e cada balanca —
            a saude da fila de cada uma aparece ao lado.
          </p>
        </DeskPanel>
        <DeskPanel>
          <div className="desk-title-row">
            <h2 className="desk-title">Fila OMIE (fechamentos a enviar)</h2>
            <RefreshButton onClick={() => void closed.reload()} />
          </div>
          {closed.error && <Alert kind="error">{closed.error}</Alert>}
          {pendingOmie.length === 0 ? (
            <p className="desk-muted" style={{ marginTop: 0 }}>
              {closed.loading
                ? "Carregando..."
                : "Nenhum item na fila: todos os fechamentos dos ultimos 30 dias chegaram ao OMIE."}
            </p>
          ) : (
            <DataTable
              rows={pendingOmie}
              rowKey={({ row }) => row.id}
              columns={[
                {
                  key: "op",
                  header: "Pesagem",
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
                  render: ({ row }) => formatDateTime(row.closed_at ?? row.created_at)
                },
                {
                  key: "total",
                  header: "Total",
                  numeric: true,
                  render: ({ row }) => formatMoney(row.total_cents)
                },
                {
                  key: "status",
                  header: "Situacao",
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
        <h2 className="desk-title">Status OMIE</h2>
        {devices.error && <Alert kind="error">{devices.error}</Alert>}
        {(devices.data ?? []).length === 0 ? (
          <p className="desk-muted">
            {devices.loading ? "Carregando status OMIE..." : "Nenhuma balanca nesta unidade."}
          </p>
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
                  <dt>Parados (precisam de correcao)</dt>
                  <dd>{device.health.queueBlocked ?? "—"}</dd>
                  <dt>Mais antigo na fila</dt>
                  <dd>
                    {device.health.oldestPendingAt
                      ? formatDateTime(device.health.oldestPendingAt)
                      : "—"}
                  </dd>
                  <dt>Ultimo erro</dt>
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
          As credenciais do OMIE e o envio ficam na balanca principal. Estes numeros sao os que cada
          balanca informou na ultima conversa com a nuvem.
        </p>
      </DeskPanel>
    </div>
  );
}
