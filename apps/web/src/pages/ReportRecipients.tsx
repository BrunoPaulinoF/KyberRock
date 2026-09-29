import { useState, type FormEvent } from "react";

import { IconAction, NewButton, SectionHead } from "../components/desk";
import {
  Alert,
  DataTable,
  ErrorState,
  Field,
  Modal,
  Pill,
  useConfirm,
  useDiscardGuard,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { useAsync } from "../lib/use-async";
import { fieldOfError, maskPhoneInput, whatsappForInput } from "./cadastro-form";

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
  trucks: "Caminhões",
  both: "Vendas + Caminhões"
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
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload, refresh } = useAsync(
    async () =>
      (await callWebApi("list_report_recipients")) as unknown as {
        recipients: Recipient[];
        channels: Channels;
      },
    [user.companyId],
    { key: `relatorios:destinatarios:${user.companyId}` }
  );
  useOnCadastroChange(refresh, CADASTRO_TABLES.reportRecipients);
  const [editing, setEditing] = useState<Recipient | "new" | null>(null);
  const recipients = data?.recipients ?? [];
  const channels = data?.channels;

  async function remove(recipient: Recipient) {
    const name = recipient.display_name || recipient.email || recipient.whatsapp_phone || "";
    const ok = await confirm({
      title: "Remover destinatário?",
      message: name ? (
        <>
          Remover o destinatário <strong>{name}</strong>? Os relatórios deixam de ser enviados para
          ele.
        </>
      ) : (
        "Os relatórios deixam de ser enviados para este destinatário."
      ),
      confirmLabel: "Remover",
      tone: "danger",
      irreversible: true
    });
    if (!ok) return;
    try {
      await callWebApi("delete_report_recipient", { id: recipient.id });
      toast.push("Destinatário removido.");
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <SectionHead
        title="Destinatários cadastrados"
        count={recipients.length}
        description="Quem recebe o fechamento diário por e-mail ou WhatsApp. Vale para todas as balanças da pedreira."
        action={<NewButton onClick={() => setEditing("new")}>Novo destinatário</NewButton>}
      />
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {channels && (
        <div className="recipients-channels">
          <span>
            E-mail:{" "}
            {channels.emailConfigured ? (
              <Pill tone="success">
                Configurado{channels.emailSender ? ` (${channels.emailSender})` : ""}
              </Pill>
            ) : (
              <Pill tone="warning">Não configurado</Pill>
            )}
          </span>
          <span>
            WhatsApp:{" "}
            {channels.whatsappConfigured ? (
              <Pill tone={channels.whatsappStatus === "connected" ? "success" : "warning"}>
                {channels.whatsappStatus === "connected" ? "Conectado" : "Configurado"}
              </Pill>
            ) : (
              <Pill tone="warning">Não configurado</Pill>
            )}
          </span>
          <small>O SMTP, o WhatsApp e o horário dos envios são configurados na balança.</small>
        </div>
      )}
      {!error && (
        <DataTable
          rows={recipients}
          rowKey={(row) => row.id}
          rowClassName={(row) => (row.is_active ? undefined : "inactive")}
          loading={loading}
          empty="Nenhum destinatário cadastrado."
          columns={[
            {
              key: "name",
              header: "Nome",
              sortValue: (row) => row.display_name,
              render: (row) => row.display_name ?? "-"
            },
            { key: "channel", header: "Canal", render: (row) => CHANNEL_LABEL[channelOf(row)] },
            {
              key: "email",
              header: "E-mail",
              sortValue: (row) => row.email,
              render: (row) => row.email ?? "-"
            },
            {
              key: "whatsapp",
              header: "WhatsApp",
              sortValue: (row) => row.whatsapp_phone,
              render: (row) => row.whatsapp_phone ?? "-"
            },
            {
              key: "types",
              header: "Relatórios",
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
                  : "Não"
            },
            {
              key: "status",
              header: "Status",
              render: (row) =>
                row.is_active ? <Pill tone="success">Ativo</Pill> : <Pill>Inativo</Pill>
            },
            {
              key: "actions",
              header: "Ações",
              numeric: true,
              render: (row) => (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label="Editar destinatário"
                    onClick={() => setEditing(row)}
                  />
                  <IconAction
                    icon="trash"
                    label="Remover destinatário"
                    tone="danger"
                    onClick={() => void remove(row)}
                  />
                </span>
              )
            }
          ]}
        />
      )}

      {editing && (
        <RecipientForm
          recipient={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </>
  );
}

/** O formulario como abre. O WhatsApp gravado (55 + DDD + numero) aparece como se digita. */
function recipientFormOf(recipient: Recipient | null): FormState {
  if (!recipient) return EMPTY_FORM;
  return {
    id: recipient.id,
    displayName: recipient.display_name ?? "",
    isActive: recipient.is_active,
    channel: channelOf(recipient),
    email: recipient.email ?? "",
    whatsappPhone: whatsappForInput(recipient.whatsapp_phone),
    reportTypes: recipient.report_types,
    sendFinancial: recipient.send_financial,
    financialScheduleTime: recipient.financial_schedule_time ?? ""
  };
}

type RecipientField = "channel" | "email" | "whatsappPhone";

/** A recusa da `web-api` que tem campo aparece embaixo dele; o resto, no alto da janela. */
const RECIPIENT_ERROR_FIELDS: ReadonlyArray<readonly [RecipientField, RegExp]> = [
  ["email", /e-mail/i],
  ["whatsappPhone", /whatsapp/i],
  ["channel", /canal/i]
];

function RecipientForm({
  recipient,
  onClose,
  onSaved
}: {
  recipient: Recipient | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [initial] = useState(() => recipientFormOf(recipient));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RecipientField, string>>>({});
  const [busy, setBusy] = useState(false);
  const dirty = (Object.keys(form) as Array<keyof FormState>).some(
    (key) => form[key] !== initial[key]
  );
  const guard = useDiscardGuard(dirty);

  function update(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setFieldErrors((current) => {
      // Trocar o canal muda quais campos valem: os erros antigos saem.
      if ("channel" in patch) return {};
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as RecipientField];
      return next;
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await callWebApi("save_report_recipient", {
        id: form.id ?? undefined,
        displayName: form.displayName,
        isActive: form.isActive,
        sendEmail: form.channel !== "whatsapp",
        sendWhatsapp: form.channel !== "email",
        email: form.email,
        // Sem mexer, sobe o numero gravado; o digitado a web-api deixa so com os digitos (e
        // poe o 55), entao a mascara nao muda o que e gravado.
        whatsappPhone:
          form.whatsappPhone === initial.whatsappPhone
            ? (recipient?.whatsapp_phone ?? "")
            : form.whatsappPhone,
        reportTypes: form.reportTypes,
        sendFinancial: form.sendFinancial,
        financialScheduleTime: form.sendFinancial ? form.financialScheduleTime : null
      });
      toast.push(form.id ? "Destinatário atualizado." : "Destinatário adicionado.");
      await onSaved();
    } catch (caught) {
      const message = errorMessage(caught);
      const field = fieldOfError(message, RECIPIENT_ERROR_FIELDS);
      if (field) setFieldErrors({ [field]: message });
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const formId = "recipient-form";
  return (
    <Modal
      title={form.id ? "Editar destinatário" : "Adicionar destinatário"}
      wide
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void guard(onClose)}>
            Cancelar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Salvando..." : form.id ? "Salvar" : "Adicionar"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-3">
          <div>
            <h4 className="recipients-form-title">Identificação</h4>
            <Field label="Nome (opcional)">
              <input
                className="input"
                value={form.displayName}
                placeholder="Dono ou responsável"
                onChange={(event) => update({ displayName: event.target.value })}
              />
            </Field>
            <Field label="Ativo">
              <select
                className="select"
                value={form.isActive ? "yes" : "no"}
                onChange={(event) => update({ isActive: event.target.value === "yes" })}
              >
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </Field>
          </div>
          <div>
            <h4 className="recipients-form-title">Canais</h4>
            <Field label="Enviar por" error={fieldErrors.channel}>
              <select
                className="select"
                value={form.channel}
                onChange={(event) => update({ channel: event.target.value as Channel })}
              >
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="both">Ambos</option>
              </select>
            </Field>
            <Field label="E-mail" error={fieldErrors.email}>
              <input
                className="input"
                type="email"
                value={form.email}
                placeholder="dono@pedreira.com"
                required={form.channel !== "whatsapp"}
                onChange={(event) => update({ email: event.target.value })}
              />
            </Field>
            <Field
              label="WhatsApp"
              hint="Com DDD. Número de outro país: comece com +."
              error={fieldErrors.whatsappPhone}
            >
              <input
                className="input"
                type="tel"
                inputMode="tel"
                value={form.whatsappPhone}
                placeholder="(11) 99999-9999"
                required={form.channel !== "email"}
                onChange={(event) => update({ whatsappPhone: maskPhoneInput(event.target.value) })}
              />
            </Field>
          </div>
          <div>
            <h4 className="recipients-form-title">Relatórios</h4>
            <Field label="Relatórios enviados">
              <select
                className="select"
                value={form.reportTypes}
                onChange={(event) => update({ reportTypes: event.target.value })}
              >
                <option value="sales">Vendas</option>
                <option value="trucks">Caminhões</option>
                <option value="both">Vendas + Caminhões</option>
              </select>
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={form.sendFinancial}
                onChange={(event) => update({ sendFinancial: event.target.checked })}
              />
              Recebe o relatório financeiro (OMIE)
            </label>
            {form.sendFinancial && (
              <Field label="Horário do financeiro" hint="Vazio = o horário geral dos envios.">
                <select
                  className="select"
                  value={form.financialScheduleTime}
                  onChange={(event) => update({ financialScheduleTime: event.target.value })}
                >
                  <option value="">Horário geral</option>
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
      </form>
    </Modal>
  );
}
