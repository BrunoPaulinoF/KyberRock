import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  centsToInput,
  daysOverdue,
  describeNextClosing,
  downloadBase64Pdf,
  filterInvoices,
  findSecret,
  formatCents,
  formatDateBr,
  formatDateTimeBr,
  invoiceStatusLabel,
  invoiceStatusTone,
  parseMoneyToCents,
  summarizeInvoiceList
} from "../lib/billing";
import type {
  BillingCompany,
  BillingInvoice,
  BillingSecretStatus,
  BillingSettingsView,
  BillingSummary
} from "../lib/billing";
import {
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Field,
  Fieldset,
  LinkButton,
  Modal,
  Note,
  PageHead,
  Panel,
  Stat,
  StatGrid
} from "../components/admin";
import type { Column } from "../components/admin";

/**
 * Backoffice financeiro — secao "Financeiro" do console administrativo.
 *
 * E a cobranca DA PLATAFORMA: a Kybernan fatura cada pedreira pelo valor
 * acertado no cadastro dela. Nada aqui tem relacao com o financeiro das
 * operacoes da balanca (esse vive no OMIE e no relatorio de vendas).
 *
 * Toda regra (fechamento, rateio da primeira fatura, vencimento, boleto do
 * Mercado Pago, envio por WhatsApp, bloqueio por inadimplencia) roda na Edge
 * Function `admin-billing`, que compartilha o motor com a passada automatica do
 * `billing-run`. Esta tela dispara acoes e mostra resultado — nunca recalcula
 * data ou valor por conta propria.
 *
 * As credenciais NAO sao editaveis aqui: vem sempre dos secrets do Supabase, e
 * a aba de configuracao apenas exibe a situacao de cada uma.
 */

type FinancialTab = "invoices" | "companies" | "settings";

interface FinancialData {
  today: string;
  settings: BillingSettingsView;
  companies: BillingCompany[];
  invoices: BillingInvoice[];
  summary: BillingSummary;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function FinancialBackoffice({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [tab, setTab] = useState<FinancialTab>("invoices");
  const [data, setData] = useState<FinancialData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [editingCompany, setEditingCompany] = useState<BillingCompany | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<BillingInvoice | null>(null);
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "danger", text: error instanceof Error ? error.message : fallback });
    },
    [onSessionExpired]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await callAdminFunction<FinancialData>("admin-billing", { action: "list" }));
    } catch (error) {
      handleError(error, "Nao foi possivel carregar o financeiro.");
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Toda acao passa por aqui: trava o botao, mostra o resultado e recarrega. Sem
   * o recarregamento a tela mentiria — boleto emitido continuaria "sem boleto"
   * ate alguem apertar F5.
   */
  const run = useCallback(
    async (
      key: string,
      action: string,
      payload: Record<string, unknown>,
      successMessage: string
    ): Promise<boolean> => {
      setBusy(key);
      setFeedback(null);
      try {
        const response = await callAdminFunction<{ warning?: string | null; warnings?: string[] }>(
          "admin-billing",
          { action, payload }
        );
        const warnings = [response.warning, ...(response.warnings ?? [])].filter(
          (value): value is string => Boolean(value)
        );
        setFeedback({
          tone: warnings.length > 0 ? "danger" : "ok",
          text: warnings.length > 0 ? `${successMessage} ${warnings.join(" ")}` : successMessage
        });
        await load();
        return true;
      } catch (error) {
        handleError(error, "A acao falhou.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [handleError, load]
  );

  const companiesById = useMemo(
    () => new Map((data?.companies ?? []).map((company) => [company.id, company.name])),
    [data]
  );

  const visibleInvoices = useMemo(
    () =>
      filterInvoices(data?.invoices ?? [], companiesById, {
        companyId: filterCompanyId,
        status: filterStatus,
        search
      }),
    [data, companiesById, filterCompanyId, filterStatus, search]
  );

  const totals = useMemo(() => summarizeInvoiceList(visibleInvoices), [visibleInvoices]);

  // O detalhe e resolvido por ID a cada render: guardar o objeto faria o modal
  // continuar mostrando "sem boleto" logo depois de emitir um.
  const detailInvoice = useMemo(
    () => data?.invoices.find((invoice) => invoice.id === openInvoiceId) ?? null,
    [data, openInvoiceId]
  );

  async function downloadPdf(invoice: BillingInvoice): Promise<void> {
    setBusy(`pdf:${invoice.id}`);
    try {
      const response = await callAdminFunction<{ fileName: string; base64: string }>(
        "admin-billing",
        { action: "invoice_pdf", payload: { invoiceId: invoice.id } }
      );
      downloadBase64Pdf(response.base64, response.fileName);
    } catch (error) {
      handleError(error, "Nao foi possivel gerar o PDF da fatura.");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading && !data) {
    return (
      <Panel>
        <p className="adm-empty">Carregando o financeiro...</p>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel>
        <Note tone="danger">
          Nao foi possivel carregar o financeiro. Verifique se a Edge Function{" "}
          <code>admin-billing</code> esta implantada e se as migracoes do backoffice foram
          aplicadas.
        </Note>
        <div style={{ marginTop: "16px" }}>
          <Button variant="primary" onClick={() => void load()}>
            Tentar de novo
          </Button>
        </div>
      </Panel>
    );
  }

  const { settings, summary } = data;

  const invoiceColumns: Array<Column<BillingInvoice>> = [
    {
      key: "company",
      header: "Pedreira",
      render: (invoice) => (
        <>
          <span className="adm-cell-primary">
            {companiesById.get(invoice.company_id) ?? "Pedreira removida"}
          </span>
          <p className="adm-cell-sub adm-mono">
            {invoice.number} · {invoice.reference_label}
          </p>
        </>
      )
    },
    {
      key: "period",
      header: "Periodo",
      render: (invoice) => (
        <>
          <span className="adm-mono">
            {formatDateBr(invoice.period_start)} – {formatDateBr(invoice.period_end)}
          </span>
          {invoice.is_prorated && invoice.prorated_days && invoice.full_period_days && (
            <p className="adm-cell-sub">
              Proporcional: {invoice.prorated_days}/{invoice.full_period_days} dias
            </p>
          )}
        </>
      )
    },
    {
      key: "due",
      header: "Vencimento",
      render: (invoice) => (
        <>
          <span className="adm-mono">{formatDateBr(invoice.due_date)}</span>
          {invoice.status === "overdue" && (
            <p className="adm-cell-sub adm-text-danger">
              {Math.max(0, daysOverdue(invoice.due_date, data.today))} dia(s) de atraso
            </p>
          )}
        </>
      )
    },
    {
      key: "amount",
      header: "Valor",
      numeric: true,
      render: (invoice) => formatCents(invoice.amount_cents)
    },
    {
      key: "delivery",
      header: "Boleto / envio",
      render: (invoice) => (
        <ButtonGroup>
          <Badge tone={invoice.boleto_payment_id ? "ok" : "neutral"} dot>
            {invoice.boleto_payment_id ? "Boleto" : "Sem boleto"}
          </Badge>
          <Badge tone={invoice.whatsapp_sent_at ? "ok" : "neutral"} dot>
            {invoice.whatsapp_sent_at ? "Enviada" : "Nao enviada"}
          </Badge>
        </ButtonGroup>
      )
    },
    {
      key: "status",
      header: "Situacao",
      render: (invoice) => (
        <Badge tone={invoiceStatusTone(invoice.status)} dot>
          {invoiceStatusLabel(invoice.status)}
        </Badge>
      )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (invoice) => (
        <ButtonGroup>
          {invoice.boleto_url && (
            <LinkButton href={invoice.boleto_url} size="sm">
              Boleto
            </LinkButton>
          )}
          <Button size="sm" onClick={() => setOpenInvoiceId(invoice.id)}>
            Detalhes
          </Button>
        </ButtonGroup>
      )
    }
  ];

  const companyColumns: Array<Column<BillingCompany>> = [
    {
      key: "name",
      header: "Pedreira",
      render: (company) => (
        <>
          <span className="adm-cell-primary">{company.name}</span>
          <p className="adm-cell-sub">{describeNextClosing(company)}</p>
        </>
      )
    },
    {
      key: "amount",
      header: "Valor acertado",
      numeric: true,
      render: (company) =>
        company.billing_monthly_amount_cents
          ? formatCents(company.billing_monthly_amount_cents)
          : "—"
    },
    {
      key: "cycle",
      header: "Ciclo",
      render: (company) => (
        <span className="adm-mono">
          virada {formatDateBr(company.billing_start_date) || "—"} · fecha dia{" "}
          {company.billing_plan.closingDay} · vence dia {company.billing_plan.dueDay}
        </span>
      )
    },
    {
      key: "grace",
      header: "Bloqueio apos",
      numeric: true,
      render: (company) => `${company.billing_plan.graceDays} d`
    },
    {
      key: "status",
      header: "Situacao",
      render: (company) => (
        <ButtonGroup>
          <Badge tone={company.billing_enabled ? "ok" : "neutral"} dot>
            {company.billing_enabled ? "Cobranca ativa" : "Sem cobranca"}
          </Badge>
          {company.payment_blocked && (
            <Badge tone="danger" dot>
              Bloqueada
            </Badge>
          )}
          {company.billing_block_exempt && <Badge tone="warn">Isenta</Badge>}
          {company.billing_plan.blockers.length > 0 && (
            <Badge tone="warn">Cadastro incompleto</Badge>
          )}
        </ButtonGroup>
      )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (company) => (
        <ButtonGroup>
          <Button size="sm" onClick={() => setEditingCompany(company)}>
            Cobranca
          </Button>
          <Button
            size="sm"
            disabled={!company.billing_plan.readyToClose || busy === `gen:${company.id}`}
            title={
              company.billing_plan.readyToClose
                ? undefined
                : `Pendente: ${company.billing_plan.blockers.join(", ")}`
            }
            onClick={() =>
              void run(
                `gen:${company.id}`,
                "generate_invoice",
                { companyId: company.id },
                "Fatura gerada, boleto emitido e envio disparado."
              )
            }
          >
            Faturar
          </Button>
          <Button
            size="sm"
            variant={company.payment_blocked ? "default" : "danger"}
            onClick={() =>
              company.payment_blocked
                ? void run(
                    `block:${company.id}`,
                    "set_payment_block",
                    { companyId: company.id, blocked: false },
                    "Acesso liberado."
                  )
                : setConfirming({
                    title: `Bloquear ${company.name}`,
                    message:
                      "A balanca desta pedreira para de operar ate a liberacao. O bloqueio manual nao e desfeito pela passada automatica.",
                    confirmLabel: "Bloquear acesso",
                    onConfirm: () => {
                      setConfirming(null);
                      void run(
                        `block:${company.id}`,
                        "set_payment_block",
                        {
                          companyId: company.id,
                          blocked: true,
                          reason: "Bloqueio manual do financeiro."
                        },
                        "Pedreira bloqueada."
                      );
                    }
                  })
            }
          >
            {company.payment_blocked ? "Liberar" : "Bloquear"}
          </Button>
        </ButtonGroup>
      )
    }
  ];

  return (
    <>
      <PageHead
        title="Financeiro"
        description="Mensalidade da plataforma por pedreira: fechamento, fatura, boleto do Mercado Pago, envio por WhatsApp e bloqueio por inadimplencia."
        actions={
          <Button
            variant="primary"
            disabled={busy === "run-cycle"}
            onClick={() =>
              void run(
                "run-cycle",
                "run_cycle",
                {},
                "Passada de cobranca executada. Confira as faturas."
              )
            }
          >
            {busy === "run-cycle" ? "Processando..." : "Rodar cobranca agora"}
          </Button>
        }
      />

      {feedback && <Note tone={feedback.tone === "ok" ? "ok" : "danger"}>{feedback.text}</Note>}

      <StatGrid>
        <Stat
          label="Recorrencia mensal"
          value={formatCents(summary.monthlyRecurringCents)}
          hint={`${summary.billedCompanies} pedreira(s) com cobranca ativa`}
          tone="accent"
        />
        <Stat
          label="Em aberto"
          value={formatCents(summary.openAmountCents)}
          hint={`${summary.openCount} fatura(s)`}
        />
        <Stat
          label="Vencidas"
          value={formatCents(summary.overdueAmountCents)}
          hint={`${summary.overdueCount} fatura(s)`}
          tone={summary.overdueCount > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Recebido"
          value={formatCents(summary.paidAmountCents)}
          hint={`${summary.paidCount} fatura(s) paga(s)`}
          tone="ok"
        />
        <Stat
          label="Bloqueadas"
          value={String(summary.blockedCompanies)}
          hint="Pedreiras sem acesso a balanca"
          tone={summary.blockedCompanies > 0 ? "danger" : "neutral"}
        />
      </StatGrid>

      <div className="adm-panel-actions">
        {(
          [
            ["invoices", "Faturas"],
            ["companies", "Cobranca por pedreira"],
            ["settings", "Configuracoes"]
          ] as Array<[FinancialTab, string]>
        ).map(([id, label]) => (
          <Button key={id} variant={tab === id ? "primary" : "default"} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === "invoices" && (
        <Panel
          flush
          toolbar={
            <>
              <select
                className="adm-select adm-toolbar-grow"
                aria-label="Filtrar por pedreira"
                value={filterCompanyId}
                onChange={(event) => setFilterCompanyId(event.target.value)}
              >
                <option value="">Todas as pedreiras</option>
                {data.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <select
                className="adm-select adm-toolbar-grow"
                aria-label="Filtrar por situacao"
                value={filterStatus}
                onChange={(event) => setFilterStatus(event.target.value)}
              >
                <option value="">Todas as situacoes</option>
                <option value="open">Em aberto</option>
                <option value="overdue">Vencidas</option>
                <option value="paid">Pagas</option>
                <option value="canceled">Canceladas</option>
              </select>
              <input
                className="adm-input adm-toolbar-grow"
                aria-label="Buscar fatura"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por numero, referencia ou pedreira"
              />
            </>
          }
          footer={
            visibleInvoices.length > 0 ? (
              <>
                <span>{totals.count} fatura(s)</span>
                <span>Em aberto: {formatCents(totals.openCents)}</span>
                <span>Vencidas: {formatCents(totals.overdueCents)}</span>
                <span>Recebido: {formatCents(totals.paidCents)}</span>
              </>
            ) : undefined
          }
        >
          <DataTable
            columns={invoiceColumns}
            rows={visibleInvoices}
            rowKey={(invoice) => invoice.id}
            rowClassName={(invoice) =>
              invoice.status === "overdue"
                ? "adm-row-alert"
                : invoice.status === "canceled"
                  ? "adm-row-muted"
                  : undefined
            }
            empty='Nenhuma fatura encontrada. Faturas nascem no fechamento do ciclo — use "Faturar" na aba de cobranca por pedreira para antecipar.'
          />
        </Panel>
      )}

      {tab === "companies" && (
        <Panel
          title="Cobranca por pedreira"
          description="Cada pedreira tem o seu valor acertado, a data de virada do sistema e o proprio calendario de fechamento e vencimento."
          flush
        >
          <DataTable
            columns={companyColumns}
            rows={data.companies}
            rowKey={(company) => company.id}
            rowClassName={(company) => (company.payment_blocked ? "adm-row-alert" : undefined)}
            empty="Nenhuma pedreira cadastrada."
          />
        </Panel>
      )}

      {tab === "settings" && (
        <BillingSettingsForm
          settings={settings}
          busy={busy === "settings"}
          onSave={(payload) =>
            void run("settings", "update_settings", payload, "Configuracao salva.")
          }
        />
      )}

      {detailInvoice && (
        <InvoiceDetailModal
          invoice={detailInvoice}
          companyName={companiesById.get(detailInvoice.company_id) ?? "Pedreira removida"}
          today={data.today}
          busy={busy}
          onClose={() => setOpenInvoiceId(null)}
          onEdit={() => {
            setEditingInvoice(detailInvoice);
            setOpenInvoiceId(null);
          }}
          onDownloadPdf={() => void downloadPdf(detailInvoice)}
          onAction={(action, payload, message) =>
            void run(`${action}:${detailInvoice.id}`, action, payload, message)
          }
          onConfirm={setConfirming}
        />
      )}

      {editingCompany && (
        <CompanyBillingModal
          company={editingCompany}
          settings={settings}
          busy={busy === `company:${editingCompany.id}`}
          onClose={() => setEditingCompany(null)}
          onSave={async (payload) => {
            const ok = await run(
              `company:${editingCompany.id}`,
              "update_company_billing",
              { companyId: editingCompany.id, ...payload },
              "Cadastro de cobranca salvo."
            );
            if (ok) setEditingCompany(null);
          }}
        />
      )}

      {editingInvoice && (
        <InvoiceEditModal
          invoice={editingInvoice}
          busy={busy === `edit:${editingInvoice.id}`}
          onClose={() => setEditingInvoice(null)}
          onSave={async (payload) => {
            const ok = await run(
              `edit:${editingInvoice.id}`,
              "update_invoice",
              { invoiceId: editingInvoice.id, ...payload },
              "Fatura ajustada."
            );
            if (ok) setEditingInvoice(null);
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.title}
          message={confirming.message}
          confirmLabel={confirming.confirmLabel}
          onConfirm={confirming.onConfirm}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detalhe da fatura
// ---------------------------------------------------------------------------

/**
 * Detalhe + todas as acoes. Existe porque a fatura tem nove acoes possiveis e
 * espalha-las na linha da tabela deixava a lista ilegivel: na tabela ficam as
 * duas de uso diario (abrir boleto, abrir detalhe) e o resto vive aqui.
 */
function InvoiceDetailModal({
  invoice,
  companyName,
  today,
  busy,
  onClose,
  onEdit,
  onDownloadPdf,
  onAction,
  onConfirm
}: {
  invoice: BillingInvoice;
  companyName: string;
  today: string;
  busy: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDownloadPdf: () => void;
  onAction: (action: string, payload: Record<string, unknown>, message: string) => void;
  onConfirm: (dialog: ConfirmState) => void;
}) {
  const isClosed = invoice.status === "paid" || invoice.status === "canceled";
  const isBusy = Boolean(busy?.endsWith(invoice.id));

  return (
    <Modal
      title={`${invoice.number} — ${companyName}`}
      description={`Referencia ${invoice.reference_label} · ${formatDateBr(invoice.period_start)} a ${formatDateBr(invoice.period_end)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onDownloadPdf} disabled={isBusy}>
            Baixar PDF
          </Button>
          {!isClosed && (
            <Button onClick={onEdit} disabled={isBusy}>
              Ajustar
            </Button>
          )}
          {!isClosed && (
            <Button
              variant="primary"
              disabled={isBusy}
              onClick={() =>
                onConfirm({
                  title: `Confirmar recebimento de ${invoice.number}`,
                  message: `Dar baixa em ${formatCents(invoice.amount_cents)}. Se nao restar fatura vencida, o acesso da pedreira e liberado.`,
                  confirmLabel: "Confirmar recebimento",
                  onConfirm: () =>
                    onAction(
                      "mark_invoice_paid",
                      { invoiceId: invoice.id },
                      "Fatura quitada. O acesso e liberado se nao houver outra pendencia."
                    )
                })
              }
            >
              Marcar como paga
            </Button>
          )}
        </>
      }
    >
      <div className="adm-form">
        <dl className="adm-kv">
          <div className="adm-kv-item">
            <dt>Situacao</dt>
            <dd>
              <Badge tone={invoiceStatusTone(invoice.status)} dot>
                {invoiceStatusLabel(invoice.status)}
              </Badge>
              {invoice.status === "overdue" && (
                <span className="adm-text-danger" style={{ marginLeft: "8px", fontSize: "12px" }}>
                  {Math.max(0, daysOverdue(invoice.due_date, today))} dia(s) de atraso
                </span>
              )}
            </dd>
          </div>
          <div className="adm-kv-item">
            <dt>Valor</dt>
            <dd className="adm-mono">{formatCents(invoice.amount_cents)}</dd>
          </div>
          <div className="adm-kv-item">
            <dt>Fechamento</dt>
            <dd className="adm-mono">{formatDateBr(invoice.closing_date)}</dd>
          </div>
          <div className="adm-kv-item">
            <dt>Vencimento</dt>
            <dd className="adm-mono">{formatDateBr(invoice.due_date)}</dd>
          </div>
          <div className="adm-kv-item">
            <dt>Valor do periodo</dt>
            <dd className="adm-mono">{formatCents(invoice.base_amount_cents)}</dd>
          </div>
          {invoice.addition_cents > 0 && (
            <div className="adm-kv-item">
              <dt>Acrescimo</dt>
              <dd className="adm-mono">{formatCents(invoice.addition_cents)}</dd>
            </div>
          )}
          {invoice.discount_cents > 0 && (
            <div className="adm-kv-item">
              <dt>Desconto</dt>
              <dd className="adm-mono">- {formatCents(invoice.discount_cents)}</dd>
            </div>
          )}
          {invoice.is_prorated && invoice.prorated_days && invoice.full_period_days && (
            <div className="adm-kv-item">
              <dt>Rateio</dt>
              <dd>
                {invoice.prorated_days} de {invoice.full_period_days} dias do ciclo
              </dd>
            </div>
          )}
          {invoice.paid_at && (
            <div className="adm-kv-item">
              <dt>Pagamento</dt>
              <dd>
                {formatDateTimeBr(invoice.paid_at)} · {invoice.payment_method ?? "—"}
              </dd>
            </div>
          )}
        </dl>

        <Fieldset legend="Boleto">
          <div className="adm-form">
            <p className="adm-field-hint">
              {invoice.boleto_payment_id
                ? `Mercado Pago ${invoice.boleto_payment_id} · situacao "${invoice.boleto_status ?? "emitido"}"`
                : "Nenhum boleto emitido para esta fatura."}
            </p>
            {invoice.boleto_barcode && (
              <div>
                <p className="adm-field-label">Linha digitavel</p>
                <p className="adm-mono adm-barcode">{invoice.boleto_barcode}</p>
                <CopyButton value={invoice.boleto_barcode} label="Copiar linha digitavel" />
              </div>
            )}
            {invoice.boleto_error && <Note tone="danger">{invoice.boleto_error}</Note>}
            {!isClosed && (
              <ButtonGroup>
                {invoice.boleto_url && (
                  <LinkButton href={invoice.boleto_url} size="sm">
                    Abrir boleto
                  </LinkButton>
                )}
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() =>
                    onAction(
                      "issue_boleto",
                      { invoiceId: invoice.id, reissue: Boolean(invoice.boleto_payment_id) },
                      invoice.boleto_payment_id ? "Boleto reemitido." : "Boleto emitido."
                    )
                  }
                >
                  {invoice.boleto_payment_id ? "Reemitir boleto" : "Emitir boleto"}
                </Button>
                {invoice.boleto_payment_id && (
                  <Button
                    size="sm"
                    disabled={isBusy}
                    onClick={() =>
                      onAction(
                        "refresh_invoice",
                        { invoiceId: invoice.id },
                        "Situacao do boleto atualizada."
                      )
                    }
                  >
                    Consultar situacao
                  </Button>
                )}
              </ButtonGroup>
            )}
          </div>
        </Fieldset>

        <Fieldset legend="Envio por WhatsApp">
          <div className="adm-form">
            <p className="adm-field-hint">
              {invoice.whatsapp_sent_at
                ? `Enviada em ${formatDateTimeBr(invoice.whatsapp_sent_at)} para ${invoice.whatsapp_to ?? "—"}.`
                : "Ainda nao enviada."}
            </p>
            {invoice.whatsapp_error && <Note tone="warn">{invoice.whatsapp_error}</Note>}
            {!isClosed && (
              <ButtonGroup>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() =>
                    onAction(
                      "send_invoice",
                      { invoiceId: invoice.id },
                      "Fatura enviada pelo WhatsApp."
                    )
                  }
                >
                  {invoice.whatsapp_sent_at ? "Reenviar" : "Enviar agora"}
                </Button>
              </ButtonGroup>
            )}
          </div>
        </Fieldset>

        {invoice.notes && <Note>{invoice.notes}</Note>}
        {invoice.cancel_reason && <Note tone="warn">Cancelamento: {invoice.cancel_reason}</Note>}

        {invoice.status !== "paid" && (
          <Fieldset legend="Zona de risco">
            <ButtonGroup>
              {invoice.status !== "canceled" && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isBusy}
                  onClick={() => {
                    const reason = prompt("Motivo do cancelamento:") ?? "";
                    if (!reason.trim()) return;
                    onAction(
                      "cancel_invoice",
                      { invoiceId: invoice.id, reason },
                      "Fatura cancelada."
                    );
                  }}
                >
                  Cancelar fatura
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={isBusy}
                onClick={() =>
                  onConfirm({
                    title: `Excluir ${invoice.number}`,
                    message:
                      "A fatura some do historico. Para manter o registro e apenas encerra-la, cancele em vez de excluir.",
                    confirmLabel: "Excluir fatura",
                    onConfirm: () =>
                      onAction("delete_invoice", { invoiceId: invoice.id }, "Fatura excluida.")
                  })
                }
              >
                Excluir fatura
              </Button>
            </ButtonGroup>
          </Fieldset>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cadastro de cobranca da pedreira
// ---------------------------------------------------------------------------

function CompanyBillingModal({
  company,
  settings,
  busy,
  onClose,
  onSave
}: {
  company: BillingCompany;
  settings: BillingSettingsView;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [amountInput, setAmountInput] = useState(
    centsToInput(company.billing_monthly_amount_cents)
  );
  const [amountError, setAmountError] = useState<string | null>(null);
  const formId = "company-billing-form";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const monthlyAmountCents = amountInput.trim() ? parseMoneyToCents(amountInput) : null;
    if (amountInput.trim() && monthlyAmountCents === null) {
      setAmountError("Valor invalido. Use o formato 1.234,56.");
      return;
    }
    setAmountError(null);

    void onSave({
      billingEnabled: form.get("billingEnabled") === "on",
      billingBlockExempt: form.get("billingBlockExempt") === "on",
      billingMonthlyAmountCents: monthlyAmountCents,
      billingStartDate: String(form.get("billingStartDate") ?? ""),
      billingClosingDay: emptyToNull(form.get("billingClosingDay")),
      billingDueDay: emptyToNull(form.get("billingDueDay")),
      billingGraceDays: emptyToNull(form.get("billingGraceDays")),
      billingLegalName: form.get("billingLegalName"),
      billingDocument: form.get("billingDocument"),
      billingEmail: form.get("billingEmail"),
      billingPhone: form.get("billingPhone"),
      billingContactName: form.get("billingContactName"),
      billingZipcode: form.get("billingZipcode"),
      billingAddressStreet: form.get("billingAddressStreet"),
      billingAddressNumber: form.get("billingAddressNumber"),
      billingAddressComplement: form.get("billingAddressComplement"),
      billingNeighborhood: form.get("billingNeighborhood"),
      billingCity: form.get("billingCity"),
      billingState: form.get("billingState"),
      billingNotes: form.get("billingNotes")
    });
  }

  return (
    <Modal
      title={`Cobranca — ${company.name}`}
      description="Valor acertado, calendario do ciclo e os dados que o boleto do Mercado Pago exige."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId} disabled={busy}>
            {busy ? "Salvando..." : "Salvar cobranca"}
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form" onSubmit={handleSubmit}>
        {company.billing_plan.blockers.length > 0 && (
          <Note tone="warn">
            Pendente para faturar: {company.billing_plan.blockers.join(", ")}.
          </Note>
        )}

        <Fieldset legend="Contrato">
          <div className="adm-grid">
            <Field
              label="Valor acertado (mensal)"
              hint="Negociado caso a caso. A primeira fatura sai proporcional aos dias usados."
              error={amountError}
            >
              <input
                className="adm-input adm-input-mono"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="900,00"
                inputMode="decimal"
              />
            </Field>
            <Field
              label="Data de virada do sistema"
              hint="Primeiro dia de uso cobrado; base do rateio da primeira fatura."
            >
              <input
                className="adm-input"
                name="billingStartDate"
                type="date"
                defaultValue={company.billing_start_date ?? ""}
              />
            </Field>
            <Field
              label="Dia do fechamento"
              hint={`Vazio usa o padrao (${settings.defaultClosingDay}).`}
            >
              <input
                className="adm-input"
                name="billingClosingDay"
                type="number"
                min={1}
                max={31}
                defaultValue={company.billing_closing_day ?? ""}
              />
            </Field>
            <Field
              label="Dia do vencimento"
              hint={`Vazio usa o padrao (${settings.defaultDueDay}).`}
            >
              <input
                className="adm-input"
                name="billingDueDay"
                type="number"
                min={1}
                max={31}
                defaultValue={company.billing_due_day ?? ""}
              />
            </Field>
            <Field
              label="Dias de inadimplencia ate o bloqueio"
              hint={`Vazio usa o padrao (${settings.defaultGraceDays}).`}
            >
              <input
                className="adm-input"
                name="billingGraceDays"
                type="number"
                min={0}
                max={365}
                defaultValue={company.billing_grace_days ?? ""}
              />
            </Field>
          </div>
          <div className="adm-grid adm-grid-spaced">
            <Checkbox
              name="billingEnabled"
              defaultChecked={company.billing_enabled}
              label="Cobrar automaticamente no fechamento"
            />
            <Checkbox
              name="billingBlockExempt"
              defaultChecked={company.billing_block_exempt}
              label="Isenta do bloqueio automatico"
            />
          </div>
        </Fieldset>

        <Fieldset legend="Dados do boleto">
          <p className="adm-field-hint">
            O Mercado Pago exige documento, e-mail e endereco completo do pagador. Faltando um
            deles, a emissao inteira e recusada.
          </p>
          <div className="adm-grid">
            <Field label="Razao social (cobranca)" hint="Vazio usa a razao social do cadastro.">
              <input
                className="adm-input"
                name="billingLegalName"
                defaultValue={company.billing_legal_name ?? ""}
                placeholder={company.legal_name ?? ""}
              />
            </Field>
            <Field label="CNPJ/CPF (cobranca)" hint="Vazio usa o documento do cadastro.">
              <input
                className="adm-input adm-input-mono"
                name="billingDocument"
                defaultValue={company.billing_document ?? ""}
                placeholder={company.document ?? ""}
              />
            </Field>
            <Field label="E-mail de cobranca">
              <input
                className="adm-input"
                name="billingEmail"
                type="email"
                defaultValue={company.billing_email ?? ""}
              />
            </Field>
            <Field label="WhatsApp de cobranca" hint="Para onde a fatura e o boleto sao enviados.">
              <input
                className="adm-input adm-input-mono"
                name="billingPhone"
                defaultValue={company.billing_phone ?? ""}
                placeholder="(31) 99999-9999"
              />
            </Field>
            <Field label="Contato do financeiro">
              <input
                className="adm-input"
                name="billingContactName"
                defaultValue={company.billing_contact_name ?? ""}
              />
            </Field>
            <Field label="CEP">
              <input
                className="adm-input adm-input-mono"
                name="billingZipcode"
                defaultValue={company.billing_zipcode ?? ""}
              />
            </Field>
            <Field label="Endereco">
              <input
                className="adm-input"
                name="billingAddressStreet"
                defaultValue={company.billing_address_street ?? ""}
              />
            </Field>
            <Field label="Numero">
              <input
                className="adm-input"
                name="billingAddressNumber"
                defaultValue={company.billing_address_number ?? ""}
              />
            </Field>
            <Field label="Complemento">
              <input
                className="adm-input"
                name="billingAddressComplement"
                defaultValue={company.billing_address_complement ?? ""}
              />
            </Field>
            <Field label="Bairro">
              <input
                className="adm-input"
                name="billingNeighborhood"
                defaultValue={company.billing_neighborhood ?? ""}
              />
            </Field>
            <Field label="Cidade">
              <input
                className="adm-input"
                name="billingCity"
                defaultValue={company.billing_city ?? ""}
              />
            </Field>
            <Field label="UF">
              <input
                className="adm-input adm-input-mono"
                name="billingState"
                maxLength={2}
                defaultValue={company.billing_state ?? ""}
              />
            </Field>
          </div>
        </Fieldset>

        <Field label="Observacoes internas">
          <textarea
            className="adm-textarea"
            name="billingNotes"
            rows={3}
            defaultValue={company.billing_notes ?? ""}
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ajuste da fatura
// ---------------------------------------------------------------------------

function InvoiceEditModal({
  invoice,
  busy,
  onClose,
  onSave
}: {
  invoice: BillingInvoice;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [base, setBase] = useState(centsToInput(invoice.base_amount_cents));
  const [discount, setDiscount] = useState(centsToInput(invoice.discount_cents));
  const [addition, setAddition] = useState(centsToInput(invoice.addition_cents));
  const [error, setError] = useState<string | null>(null);
  const formId = "invoice-edit-form";

  const preview = useMemo(() => {
    const baseCents = parseMoneyToCents(base) ?? 0;
    const discountCents = parseMoneyToCents(discount) ?? 0;
    const additionCents = parseMoneyToCents(addition) ?? 0;
    return Math.max(0, baseCents + additionCents - discountCents);
  }, [base, discount, addition]);

  return (
    <Modal
      title={`Ajustar ${invoice.number}`}
      description={`Referencia ${invoice.reference_label}. O total e sempre valor do periodo + acrescimo - desconto.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId} disabled={busy}>
            {busy ? "Salvando..." : "Salvar fatura"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="adm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const baseCents = parseMoneyToCents(base);
          if (baseCents === null) {
            setError("Valor do periodo invalido.");
            return;
          }
          setError(null);
          const form = new FormData(event.currentTarget);
          void onSave({
            baseAmountCents: baseCents,
            discountCents: parseMoneyToCents(discount) ?? 0,
            additionCents: parseMoneyToCents(addition) ?? 0,
            dueDate: form.get("dueDate"),
            notes: form.get("notes")
          });
        }}
      >
        <div className="adm-grid">
          <Field label="Valor do periodo" error={error}>
            <input
              className="adm-input adm-input-mono"
              value={base}
              onChange={(event) => setBase(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Acrescimo">
            <input
              className="adm-input adm-input-mono"
              value={addition}
              onChange={(event) => setAddition(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Desconto">
            <input
              className="adm-input adm-input-mono"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Vencimento">
            <input
              className="adm-input"
              name="dueDate"
              type="date"
              defaultValue={invoice.due_date}
            />
          </Field>
        </div>

        <Note tone="ok">
          Total: <strong className="adm-mono">{formatCents(preview)}</strong>
        </Note>

        {invoice.boleto_payment_id && (
          <Note tone="warn">
            Ja existe boleto emitido com o valor e o vencimento antigos. Depois de salvar, use
            &quot;Reemitir boleto&quot; — o papel que o cliente recebeu nao muda sozinho.
          </Note>
        )}

        <Field label="Observacoes">
          <textarea
            className="adm-textarea"
            name="notes"
            rows={3}
            defaultValue={invoice.notes ?? ""}
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Configuracoes
// ---------------------------------------------------------------------------

/**
 * Um segredo, SOMENTE LEITURA. Nao ha campo para digitar: o valor vem sempre do
 * secret do Supabase e o nome da variavel e fixo no codigo. Campo que nao existe
 * e campo onde ninguem cola um token por engano.
 */
function SecretStatusRow({ secret }: { secret: BillingSecretStatus }) {
  return (
    <div className="adm-secret-row">
      <div>
        <div className="adm-secret-title">
          <strong>{secret.label}</strong>
          {!secret.required && <span className="adm-field-hint">(opcional)</span>}
        </div>
        <p className="adm-field-hint">{secret.purpose}</p>
        <code className="adm-secret-var">{secret.envVar}</code>
        {!secret.configured && <p className="adm-field-hint">{secret.missingHint}</p>}
      </div>
      <ButtonGroup>
        {secret.configured && <span className="adm-mono">{secret.preview}</span>}
        <Badge tone={secret.configured ? "ok" : secret.required ? "danger" : "warn"} dot>
          {secret.configured ? "Configurado" : "Pendente"}
        </Badge>
        <CopyButton value={secret.envVar} label="Copiar nome" />
      </ButtonGroup>
    </div>
  );
}

function BillingSettingsForm({
  settings,
  busy,
  onSave
}: {
  settings: BillingSettingsView;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const formId = "billing-settings-form";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      mercadoPagoEnvironment: form.get("mercadoPagoEnvironment"),
      // Segredo nao aparece no payload: nem valor, nem nome de variavel. Eles
      // vem sempre dos secrets do Supabase e esta tela apenas exibe a situacao.
      whatsappUrl: form.get("whatsappUrl"),
      whatsappInstanceName: form.get("whatsappInstanceName"),
      defaultClosingDay: form.get("defaultClosingDay"),
      defaultDueDay: form.get("defaultDueDay"),
      defaultGraceDays: form.get("defaultGraceDays"),
      autoCloseEnabled: form.get("autoCloseEnabled") === "on",
      autoBoletoEnabled: form.get("autoBoletoEnabled") === "on",
      autoWhatsappEnabled: form.get("autoWhatsappEnabled") === "on",
      autoBlockEnabled: form.get("autoBlockEnabled") === "on",
      issuerName: form.get("issuerName"),
      issuerDocument: form.get("issuerDocument"),
      issuerEmail: form.get("issuerEmail"),
      issuerPhone: form.get("issuerPhone"),
      issuerPixKey: form.get("issuerPixKey"),
      invoiceDescriptionTemplate: form.get("invoiceDescriptionTemplate"),
      whatsappMessageTemplate: form.get("whatsappMessageTemplate")
    });
  }

  return (
    <form id={formId} className="adm-form" onSubmit={handleSubmit}>
      <Panel
        title="Credenciais"
        description="Vem sempre dos secrets do Supabase — nao ha o que preencher aqui. Grave o valor em Supabase > Edge Functions > Secrets (ou `supabase secrets set NOME=valor`) com o nome indicado."
      >
        <SecretStatusRow secret={findSecret(settings, "mercadoPagoAccessToken")} />
        <SecretStatusRow secret={findSecret(settings, "mercadoPagoWebhookSecret")} />
        <SecretStatusRow secret={findSecret(settings, "whatsappInstanceToken")} />
      </Panel>

      <Panel title="Mercado Pago">
        <div className="adm-grid">
          <Field label="Ambiente">
            <select
              className="adm-select"
              name="mercadoPagoEnvironment"
              defaultValue={settings.mercadoPagoEnvironment}
            >
              <option value="production">Producao</option>
              <option value="sandbox">Sandbox (teste)</option>
            </select>
          </Field>
        </div>
      </Panel>

      <Panel
        title="WhatsApp da cobranca"
        description="Instancia UAZAPI da Kybernan, usada para mandar fatura e boleto a todas as pedreiras. E diferente da instancia que cada pedreira configura para os relatorios dela."
      >
        <div className="adm-grid">
          <Field label="URL da instancia">
            <input
              className="adm-input"
              name="whatsappUrl"
              defaultValue={settings.whatsappUrl}
              placeholder="https://sua-instancia.uazapi.com"
            />
          </Field>
          <Field label="Nome da instancia">
            <input
              className="adm-input"
              name="whatsappInstanceName"
              defaultValue={settings.whatsappInstanceName}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Padroes do ciclo"
        description="Valem para a pedreira que nao definiu o proprio calendario."
      >
        <div className="adm-grid">
          <Field label="Dia do fechamento" hint="Meses curtos fecham no ultimo dia.">
            <input
              className="adm-input"
              name="defaultClosingDay"
              type="number"
              min={1}
              max={31}
              defaultValue={settings.defaultClosingDay}
            />
          </Field>
          <Field
            label="Dia do vencimento"
            hint="Menor ou igual ao fechamento vence no mes seguinte."
          >
            <input
              className="adm-input"
              name="defaultDueDay"
              type="number"
              min={1}
              max={31}
              defaultValue={settings.defaultDueDay}
            />
          </Field>
          <Field
            label="Dias de inadimplencia ate o bloqueio"
            hint="Passados esses dias apos o vencimento, o acesso a balanca e bloqueado automaticamente."
          >
            <input
              className="adm-input"
              name="defaultGraceDays"
              type="number"
              min={0}
              max={365}
              defaultValue={settings.defaultGraceDays}
            />
          </Field>
        </div>
        <div className="adm-grid adm-grid-spaced">
          <Checkbox
            name="autoCloseEnabled"
            defaultChecked={settings.autoCloseEnabled}
            label="Fechar o ciclo automaticamente"
          />
          <Checkbox
            name="autoBoletoEnabled"
            defaultChecked={settings.autoBoletoEnabled}
            label="Emitir o boleto automaticamente"
          />
          <Checkbox
            name="autoWhatsappEnabled"
            defaultChecked={settings.autoWhatsappEnabled}
            label="Enviar por WhatsApp automaticamente"
          />
          <Checkbox
            name="autoBlockEnabled"
            defaultChecked={settings.autoBlockEnabled}
            label="Bloquear por inadimplencia"
          />
        </div>
      </Panel>

      <Panel
        title="Emitente e textos"
        description="Aparecem na fatura em PDF, na descricao do boleto e na mensagem enviada ao cliente."
      >
        <div className="adm-grid">
          <Field label="Nome do emitente">
            <input className="adm-input" name="issuerName" defaultValue={settings.issuerName} />
          </Field>
          <Field label="CNPJ do emitente">
            <input
              className="adm-input adm-input-mono"
              name="issuerDocument"
              defaultValue={settings.issuerDocument}
            />
          </Field>
          <Field label="E-mail">
            <input className="adm-input" name="issuerEmail" defaultValue={settings.issuerEmail} />
          </Field>
          <Field label="Telefone de suporte">
            <input className="adm-input" name="issuerPhone" defaultValue={settings.issuerPhone} />
          </Field>
          <Field
            label="Chave PIX"
            hint="Opcional; entra na fatura e na mensagem como alternativa ao boleto."
          >
            <input className="adm-input" name="issuerPixKey" defaultValue={settings.issuerPixKey} />
          </Field>
        </div>
        <div className="adm-form adm-grid-spaced">
          <Field
            label="Descricao do boleto"
            hint="Marcadores: {emitente} {pedreira} {referencia} {periodo}. Vazio usa o texto padrao."
          >
            <input
              className="adm-input"
              name="invoiceDescriptionTemplate"
              defaultValue={settings.invoiceDescriptionTemplate}
              placeholder="{emitente} - Mensalidade {referencia} - {pedreira}"
            />
          </Field>
          <Field
            label="Mensagem do WhatsApp"
            hint="Marcadores: {pedreira} {numero} {referencia} {valor} {vencimento} {boleto} {linha_digitavel} {pix}. Vazio usa a mensagem padrao."
          >
            <textarea
              className="adm-textarea"
              name="whatsappMessageTemplate"
              rows={4}
              defaultValue={settings.whatsappMessageTemplate}
            />
          </Field>
        </div>
      </Panel>

      <div>
        <Button type="submit" variant="primary" form={formId} disabled={busy}>
          {busy ? "Salvando..." : "Salvar configuracoes"}
        </Button>
      </div>
    </form>
  );
}

function emptyToNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
