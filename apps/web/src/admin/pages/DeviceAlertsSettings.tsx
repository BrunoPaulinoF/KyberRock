import { useEffect, useState } from "react";

import { useConfirm } from "../../components/ui";
import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  Badge,
  Button,
  DataTable,
  Field,
  Note,
  PageHead,
  Panel,
  type Column,
  type Tone
} from "../components";

// ---------------------------------------------------------------------------
// Alerta de balanca por WhatsApp.
//
// Quem recebe o aviso quando uma balanca para de responder no horario de trabalho, fica com
// envio parado esperando alguem ou com a fila atrasada — e de novo quando o problema termina.
// A regra de quando avisar vive na nuvem (`supabase/functions/_shared/device-alerts.ts`); esta
// tela so cadastra os numeros e mostra o historico.
//
// Destinatario sem pedreira e o SUPORTE: recebe de todas. O envio sai pela instancia de
// WhatsApp global da Kybernan (a mesma do financeiro).
// ---------------------------------------------------------------------------

interface RecipientRow {
  id: string;
  company_id: string | null;
  name: string;
  whatsapp_phone: string;
  is_active: boolean;
}

interface AlertRow {
  id: string;
  device_id: string;
  company_id: string;
  kind: "offline" | "queue_blocked" | "queue_stuck";
  detail: string | null;
  opened_at: string;
  notified_at: string | null;
  resolved_at: string | null;
  last_error: string | null;
}

interface Option {
  id: string;
  name: string;
}

const KIND_LABEL: Record<AlertRow["kind"], string> = {
  offline: "Sem contato",
  queue_blocked: "Envio parado",
  queue_stuck: "Fila atrasada"
};

const ALL_COMPANIES = "";

export function DeviceAlertsSettings({
  companies,
  devices,
  onSessionExpired
}: {
  companies: Option[];
  devices: Option[];
  onSessionExpired: () => void;
}) {
  const confirm = useConfirm();
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [whatsappConfigured, setWhatsappConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [companyId, setCompanyId] = useState(ALL_COMPANIES);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    void load();
  }, []);

  const companyName = (id: string | null) =>
    id ? (companies.find((company) => company.id === id)?.name ?? "Pedreira removida") : null;
  const deviceName = (id: string) => devices.find((device) => device.id === id)?.name ?? id;

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return null;
      }
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Erro" });
      return null;
    }
  }

  async function load() {
    setIsLoading(true);
    const data = await run(() =>
      callAdminFunction<{
        recipients: RecipientRow[];
        alerts: AlertRow[];
        whatsappConfigured: boolean;
      }>("admin-api", { action: "list_device_alerts" })
    );
    if (data) {
      setRecipients(data.recipients);
      setAlerts(data.alerts);
      setWhatsappConfigured(data.whatsappConfigured);
    }
    setIsLoading(false);
  }

  async function addRecipient() {
    setIsSaving(true);
    setFeedback(null);
    const saved = await run(() =>
      callAdminFunction("admin-api", {
        action: "save_device_alert_recipient",
        payload: { companyId: companyId || null, name, whatsappPhone: phone, isActive: true }
      })
    );
    if (saved) {
      setName("");
      setPhone("");
      setFeedback({ tone: "ok", text: "Número cadastrado." });
      await load();
    }
    setIsSaving(false);
  }

  async function toggleRecipient(row: RecipientRow) {
    setFeedback(null);
    const saved = await run(() =>
      callAdminFunction("admin-api", {
        action: "save_device_alert_recipient",
        payload: {
          id: row.id,
          companyId: row.company_id,
          name: row.name,
          whatsappPhone: row.whatsapp_phone,
          isActive: !row.is_active
        }
      })
    );
    if (saved) await load();
  }

  async function removeRecipient(row: RecipientRow) {
    if (
      !(await confirm({
        title: "Remover este número?",
        message: `${row.name || row.whatsapp_phone} deixa de receber os alertas de balança.`,
        confirmLabel: "Remover",
        tone: "danger"
      }))
    ) {
      return;
    }
    const removed = await run(() =>
      callAdminFunction("admin-api", {
        action: "delete_device_alert_recipient",
        payload: { id: row.id }
      })
    );
    if (removed) await load();
  }

  async function sendTest(row: RecipientRow) {
    setFeedback(null);
    const sent = await run(() =>
      callAdminFunction("admin-api", {
        action: "test_device_alert_recipient",
        payload: { whatsappPhone: row.whatsapp_phone }
      })
    );
    if (sent)
      setFeedback({ tone: "ok", text: `Mensagem de teste enviada para ${row.whatsapp_phone}.` });
  }

  const recipientColumns: Array<Column<RecipientRow>> = [
    {
      key: "company",
      header: "Recebe de",
      render: (row) => companyName(row.company_id) ?? <Badge tone="info">Todas (suporte)</Badge>
    },
    { key: "name", header: "Nome", render: (row) => row.name || "—" },
    { key: "phone", header: "WhatsApp", render: (row) => row.whatsapp_phone },
    {
      key: "status",
      header: "Situação",
      render: (row) =>
        row.is_active ? <Badge tone="ok">Ativo</Badge> : <Badge tone="neutral">Pausado</Badge>
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (row) => (
        <>
          <Button size="sm" onClick={() => void sendTest(row)}>
            Testar
          </Button>{" "}
          <Button size="sm" onClick={() => void toggleRecipient(row)}>
            {row.is_active ? "Pausar" : "Ativar"}
          </Button>{" "}
          <Button size="sm" variant="danger" onClick={() => void removeRecipient(row)}>
            Remover
          </Button>
        </>
      )
    }
  ];

  const alertColumns: Array<Column<AlertRow>> = [
    {
      key: "status",
      header: "Situação",
      render: (row) => {
        const [tone, label]: [Tone, string] = row.resolved_at
          ? ["ok", "Resolvido"]
          : row.kind === "queue_blocked"
            ? ["danger", "Aberto"]
            : ["warn", "Aberto"];
        return <Badge tone={tone}>{label}</Badge>;
      }
    },
    { key: "kind", header: "Problema", render: (row) => KIND_LABEL[row.kind] },
    {
      key: "where",
      header: "Balança",
      render: (row) => `${deviceName(row.device_id)} — ${companyName(row.company_id) ?? ""}`
    },
    { key: "detail", header: "Detalhe", render: (row) => row.detail ?? "—" },
    { key: "opened", header: "Início", render: (row) => formatDateTime(row.opened_at) },
    {
      key: "resolved",
      header: "Fim",
      render: (row) => (row.resolved_at ? formatDateTime(row.resolved_at) : "—")
    },
    {
      key: "sent",
      header: "Aviso",
      render: (row) =>
        row.notified_at
          ? "Enviado"
          : row.last_error
            ? `Não enviado: ${row.last_error}`
            : "Aguardando envio"
    }
  ];

  if (isLoading) {
    return (
      <Panel>
        <p className="adm-empty">Carregando alertas...</p>
      </Panel>
    );
  }

  return (
    <>
      <PageHead
        title="Alertas de balança"
        description="Aviso por WhatsApp quando uma balança para de responder (segunda a sábado, das 6h às 18h), fica com envio parado esperando alguém ou com a fila atrasada há mais de 1 hora — e outro aviso quando o problema se resolve. A conferência roda sozinha a cada 10 minutos."
      />

      {feedback && <Note tone={feedback.tone === "ok" ? "ok" : "danger"}>{feedback.text}</Note>}
      {!whatsappConfigured && (
        <Note tone="warn">
          O WhatsApp da plataforma não está configurado (endereço da instância na aba Financeiro e o
          secret UAZAPI_INSTANCE_TOKEN). Os alertas ficam guardados e são enviados quando ele
          estiver pronto.
        </Note>
      )}

      <Panel
        title="Quem recebe"
        description="Sem pedreira escolhida, o número é do suporte e recebe os alertas de todas."
        flush
      >
        <div className="adm-form" style={{ padding: "12px 16px" }}>
          <Field label="Pedreira">
            <select
              className="adm-select"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            >
              <option value={ALL_COMPANIES}>Todas (suporte Kybernan)</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nome">
            <input
              className="adm-input"
              value={name}
              placeholder="Ex.: Suporte, Gestor da pedreira"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="WhatsApp" hint="Com DDD. Ex.: (15) 99999-8888">
            <input
              className="adm-input"
              value={phone}
              inputMode="tel"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="primary"
              onClick={() => void addRecipient()}
              disabled={isSaving || !phone.trim()}
            >
              {isSaving ? "Salvando..." : "Adicionar número"}
            </Button>
          </div>
        </div>
        <DataTable
          columns={recipientColumns}
          rows={recipients}
          rowKey={(row) => row.id}
          empty="Nenhum número cadastrado: os alertas não são enviados para ninguém."
        />
      </Panel>

      <Panel title="Últimos alertas" flush>
        <DataTable
          columns={alertColumns}
          rows={alerts}
          rowKey={(row) => row.id}
          empty="Nenhum alerta até agora."
        />
      </Panel>
    </>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
