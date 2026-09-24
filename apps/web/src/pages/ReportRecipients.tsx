import { useState } from "react";

import { EmptyState, IconAction, NewButton, Pill, SectionHead } from "../components/desk";
import { Alert, DataTable, Field, Modal, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useAsync } from "../lib/use-async";

/**
 * Quem recebe o fechamento diario (a tela Relatorios do desktop). A lista mora na nuvem
 * (`report_recipients`): o site grava pela `web-api`, as balancas puxam no `desktop-pull` e o
 * agendador da nuvem le dela. Os canais (SMTP e WhatsApp da pedreira) guardam senha e token,
 * entao aqui so aparece se estao configurados — configurar continua na balanca.
 */

interface Recipient {
  id: string;
  display_name: string | null;
  email: string | null;
  whatsapp_phone: string | null;
  send_email: boolean;
  send_whatsapp: boolean;
  report_types: string;
  send_financial: boolean;
  financial_schedule_time: string | null;
  is_active: boolean;
  updated_at: string;
}

interface Channels {
  emailConfigured: boolean;
  emailSender: string | null;
  whatsappConfigured: boolean;
  whatsappStatus: string | null;
}

const REPORT_TYPE_LABEL: Record<string, string> = {
  sales: "Vendas",
  trucks: "Caminhoes",
  both: "Vendas + Caminhoes"
};

type Channel = "email" | "whatsapp" | "both";

interface FormState {
  id: string | null;
  displayName: string;
  isActive: boolean;
  channel: Channel;
  email: string;
  whatsappPhone: string;
  reportTypes: string;
  sendFinancial: boolean;
  financialScheduleTime: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  displayName: "",
  isActive: true,
  channel: "email",
  email: "",
  whatsappPhone: "",
  reportTypes: "sales",
  sendFinancial: false,
  financialScheduleTime: ""
};

function channelOf(recipient: Recipient): Channel {
  if (recipient.send_email && recipient.send_whatsapp) return "both";
  return recipient.send_whatsapp ? "whatsapp" : "email";
}

const CHANNEL_LABEL: Record<Channel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  both: "Ambos"
};

export function ReportRecipients() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    async () =>
      (await callWebApi("list_report_recipients")) as unknown as {
        recipients: Recipient[];
        channels: Channels;
      },
    []
  );
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recipients = data?.recipients ?? [];
  const channels = data?.channels;

  function edit(recipient: Recipient) {
    setFormError(null);
    setForm({
      id: recipient.id,
      displayName: recipient.display_name ?? "",
      isActive: recipient.is_active,
      channel: channelOf(recipient),
      email: recipient.email ?? "",
      whatsappPhone: recipient.whatsapp_phone ?? "",
      reportTypes: recipient.report_types,
      sendFinancial: recipient.send_financial,
      financialScheduleTime: recipient.financial_schedule_time ?? ""
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setFormError(null);
    try {
      await callWebApi("save_report_recipient", {
        id: form.id ?? undefined,
        displayName: form.displayName,
        isActive: form.isActive,
        sendEmail: form.channel !== "whatsapp",
        sendWhatsapp: form.channel !== "email",
        email: form.email,
        whatsappPhone: form.whatsappPhone,
        reportTypes: form.reportTypes,
        sendFinancial: form.sendFinancial,
        financialScheduleTime: form.sendFinancial ? form.financialScheduleTime : null
      });
      toast.push(form.id ? "Destinatario atualizado." : "Destinatario adicionado.");
      setForm(null);
      await reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(recipient: Recipient) {
    const name = recipient.display_name || recipient.email || recipient.whatsapp_phone || "";
    if (!window.confirm(`Remover o destinatario ${name}?`)) return;
    try {
      await callWebApi("delete_report_recipient", { id: recipient.id });
      toast.push("Destinatario removido.");
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <SectionHead
        title="Destinatarios cadastrados"
        count={recipients.length}
        description="Quem recebe o fechamento diario por e-mail ou WhatsApp. Vale para todas as balancas da pedreira."
        action={
          <NewButton
            onClick={() => {
              setFormError(null);
              setForm(EMPTY_FORM);
            }}
          >
            Novo destinatario
          </NewButton>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      {channels && (
        <div className="recipients-channels">
          <span>
            E-mail:{" "}
            {channels.emailConfigured ? (
              <Pill tone="success">
                Configurado{channels.emailSender ? ` (${channels.emailSender})` : ""}
              </Pill>
            ) : (
              <Pill tone="warning">Nao configurado</Pill>
            )}
          </span>
          <span>
            WhatsApp:{" "}
            {channels.whatsappConfigured ? (
              <Pill tone={channels.whatsappStatus === "connected" ? "success" : "warning"}>
                {channels.whatsappStatus === "connected" ? "Conectado" : "Configurado"}
              </Pill>
            ) : (
              <Pill tone="warning">Nao configurado</Pill>
            )}
          </span>
          <small>O SMTP, o WhatsApp e o horario dos envios sao configurados na balanca.</small>
        </div>
      )}
      {!loading && recipients.length === 0 ? (
        <EmptyState title="Nenhum destinatario cadastrado." />
      ) : (
        <DataTable
          rows={recipients}
          rowKey={(row) => row.id}
          rowClassName={(row) => (row.is_active ? undefined : "inactive")}
          empty={loading ? "Carregando..." : "Nenhum destinatario cadastrado."}
          columns={[
            { key: "name", header: "Nome", render: (row) => row.display_name ?? "-" },
            { key: "channel", header: "Canal", render: (row) => CHANNEL_LABEL[channelOf(row)] },
            { key: "email", header: "E-mail", render: (row) => row.email ?? "-" },
            { key: "whatsapp", header: "WhatsApp", render: (row) => row.whatsapp_phone ?? "-" },
            {
              key: "types",
              header: "Relatorios",
              render: (row) => REPORT_TYPE_LABEL[row.report_types] ?? "Vendas"
            },
            {
              key: "financial",
              header: "Financeiro",
              render: (row) =>
                row.send_financial
                  ? row.financial_schedule_time
                    ? `Sim (${row.financial_schedule_time})`
                    : "Sim"
                  : "Nao"
            },
            {
              key: "status",
              header: "Status",
              render: (row) =>
                row.is_active ? <Pill tone="success">Ativo</Pill> : <Pill>Inativo</Pill>
            },
            {
              key: "actions",
              header: "Acoes",
              numeric: true,
              render: (row) => (
                <span className="row-actions">
                  <IconAction icon="edit" label="Editar destinatario" onClick={() => edit(row)} />
                  <IconAction
                    icon="trash"
                    label="Remover destinatario"
                    tone="danger"
                    onClick={() => void remove(row)}
                  />
                </span>
              )
            }
          ]}
        />
      )}

      {form && (
        <Modal
          title={form.id ? "Editar destinatario" : "Adicionar destinatario"}
          wide
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void save()}>
                {busy ? "Salvando..." : form.id ? "Salvar" : "Adicionar"}
              </button>
            </>
          }
        >
          {formError && <Alert kind="error">{formError}</Alert>}
          <div className="grid-3">
            <div>
              <h4 className="recipients-form-title">Identificacao</h4>
              <Field label="Nome (opcional)">
                <input
                  className="input"
                  value={form.displayName}
                  placeholder="Dono ou responsavel"
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                />
              </Field>
              <Field label="Ativo">
                <select
                  className="select"
                  value={form.isActive ? "yes" : "no"}
                  onChange={(event) => setForm({ ...form, isActive: event.target.value === "yes" })}
                >
                  <option value="yes">Sim</option>
                  <option value="no">Nao</option>
                </select>
              </Field>
            </div>
            <div>
              <h4 className="recipients-form-title">Canais</h4>
              <Field label="Enviar por">
                <select
                  className="select"
                  value={form.channel}
                  onChange={(event) => setForm({ ...form, channel: event.target.value as Channel })}
                >
                  <option value="email">E-mail</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="both">Ambos</option>
                </select>
              </Field>
              <Field label="E-mail">
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  placeholder="dono@pedreira.com"
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </Field>
              <Field label="WhatsApp">
                <input
                  className="input"
                  type="tel"
                  value={form.whatsappPhone}
                  placeholder="(11) 99999-9999"
                  onChange={(event) => setForm({ ...form, whatsappPhone: event.target.value })}
                />
              </Field>
            </div>
            <div>
              <h4 className="recipients-form-title">Relatorios</h4>
              <Field label="Relatorios enviados">
                <select
                  className="select"
                  value={form.reportTypes}
                  onChange={(event) => setForm({ ...form, reportTypes: event.target.value })}
                >
                  <option value="sales">Vendas</option>
                  <option value="trucks">Caminhoes</option>
                  <option value="both">Vendas + Caminhoes</option>
                </select>
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.sendFinancial}
                  onChange={(event) => setForm({ ...form, sendFinancial: event.target.checked })}
                />
                Recebe o relatorio financeiro (OMIE)
              </label>
              {form.sendFinancial && (
                <Field label="Horario do financeiro" hint="Vazio = o horario geral dos envios.">
                  <select
                    className="select"
                    value={form.financialScheduleTime}
                    onChange={(event) =>
                      setForm({ ...form, financialScheduleTime: event.target.value })
                    }
                  >
                    <option value="">Horario geral</option>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const value = `${String(hour).padStart(2, "0")}:00`;
                      return (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
